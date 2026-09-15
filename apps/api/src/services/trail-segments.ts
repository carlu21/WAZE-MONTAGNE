/**
 * CE QUE CETTE RANDONNÉE EMPRUNTE.
 *
 * Une relation OpenStreetMap dit « ce parcours est fait de ces ways ». Notre
 * réseau, lui, découpe chaque way à ses intersections. Ce module fait le joint
 * entre les deux : il retrouve tous les segments issus des ways d'une relation,
 * les remet dans l'ordre de parcours, détermine le sens de chacun, et mesure ce
 * qu'il n'a pas réussi à retrouver.
 *
 * Trois choses valent d'être dites sur la conception :
 *
 *  1. La correspondance passe TOUJOURS par `source_feature_id`. Aucun
 *     `startsWith("osm_")` ici ni ailleurs : le jour où la convention de
 *     nommage des segments changera, rien ne se cassera en silence.
 *  2. La relation est N↔N. Deux itinéraires qui empruntent le même sentier
 *     produisent deux lignes distinctes ; ré-associer l'un ne touche jamais
 *     l'autre.
 *  3. Ce qui manque est COMPTÉ, pas ignoré. « 120 membres résolus sur 127 »
 *     n'est pas la même donnée que « 127 sur 127 », et seule la seconde permet
 *     d'annoncer un itinéraire comme navigable sans réserve.
 */
import { eq, inArray, sql } from "drizzle-orm";
import {
  bearing,
  bearingBetweenAlong,
  cumulativeDistances,
  headingDiff,
  projectOnPolyline,
  type LngLat,
  type TrailSource,
} from "@mountain-live/core";
import { db } from "../db/client";
import { paths, trailSegments, trails, type PathRow, type TrailRow, type TrailSegmentRow } from "../db/schema";
import { osmFeatureId, segmentRowsByFeatureIds } from "./paths";
import { nowIso } from "./util";

/** Une association randonnée ↔ segment, prête à être écrite. */
export interface TrailSegmentLink {
  segmentId: string;
  sequence: number;
  direction: "forward" | "backward";
  role: string;
}

/** Ce que l'association a donné, pour le rapport d'import et la navigabilité. */
export interface LinkResult {
  trailId: string;
  /** Membres attendus (ways de la relation). */
  expectedWays: number;
  /** Membres effectivement retrouvés dans `paths`. */
  resolvedWays: number;
  /** Segments associés (un way peut en donner plusieurs). */
  linkedSegments: number;
  /** `resolvedWays / expectedWays`, 0..1. Vaut 0 quand rien n'était attendu. */
  coverage: number;
}

/**
 * Sens dans lequel un segment est emprunté. On compare le cap du segment au cap
 * du parcours à l'endroit où il s'y rattache : au-delà d'un quart de tour, le
 * segment est parcouru à l'envers. Un même sentier appartient au GR dans un
 * sens et à la boucle locale dans l'autre — d'où une colonne, et pas une
 * convention implicite.
 */
function directionOf(segment: readonly LngLat[], line: readonly LngLat[], cumulative: readonly number[], along: number): "forward" | "backward" {
  const start = segment[0];
  const end = segment[segment.length - 1];
  if (!start || !end) return "forward";
  const segBearing = bearing({ lng: start[0], lat: start[1] }, { lng: end[0], lat: end[1] });
  const total = cumulative[cumulative.length - 1] ?? 0;
  const ahead = Math.min(total, along + 50);
  const behind = Math.max(0, ahead - 100);
  const routeBearing = bearingBetweenAlong(line, cumulative, behind, ahead);
  return headingDiff(segBearing, routeBearing) > 90 ? "backward" : "forward";
}

export interface ResolveInput {
  /** Tracé assemblé de la relation : sert uniquement à ORDONNER les segments. */
  geometry: readonly LngLat[];
  /** Identifiants des ways membres, dans l'ordre de la relation. */
  memberWayIds: readonly number[];
  role?: string;
}

/**
 * Ways de la relation → segments du réseau, ordonnés le long du parcours.
 *
 * L'ordre ne vient pas de l'ordre des membres OSM (qui n'est pas garanti) mais
 * de la position réelle de chaque segment sur le tracé assemblé : on projette
 * le milieu du segment sur la ligne et on trie par abscisse curviligne. C'est
 * robuste aux relations mal ordonnées, qui sont la règle plutôt que l'exception.
 */
export function resolveTrailSegments(input: ResolveInput): { links: TrailSegmentLink[]; expectedWays: number; resolvedWays: number } {
  const role = input.role ?? "main";
  const wayIds = [...new Set(input.memberWayIds)];
  const featureIds = wayIds.map((id) => osmFeatureId(id));
  const byFeature = segmentRowsByFeatureIds(featureIds);
  const resolvedWays = featureIds.filter((id) => (byFeature.get(id)?.length ?? 0) > 0).length;

  const line = input.geometry.map((c) => [c[0], c[1]] as LngLat);
  const cumulative = line.length >= 2 ? cumulativeDistances(line) : [0];

  const placed: { row: PathRow; along: number; direction: "forward" | "backward" }[] = [];
  const seen = new Set<string>();
  for (const featureId of featureIds) {
    for (const row of byFeature.get(featureId) ?? []) {
      // Un way partagé par deux membres de la même relation ne doit compter
      // qu'une fois : sinon le parcours repasserait deux fois au même endroit.
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const coords = row.coordinates;
      if (coords.length < 2) continue;
      const middle = coords[Math.floor(coords.length / 2)];
      const projection = line.length >= 2 ? projectOnPolyline({ lng: middle[0], lat: middle[1] }, line, cumulative) : null;
      const along = projection?.along ?? 0;
      placed.push({ row, along, direction: line.length >= 2 ? directionOf(coords, line, cumulative, along) : "forward" });
    }
  }
  placed.sort((a, b) => a.along - b.along);

  return {
    links: placed.map((p, sequence) => ({ segmentId: p.row.id, sequence, direction: p.direction, role })),
    expectedWays: wayIds.length,
    resolvedWays,
  };
}

/**
 * Remplace les associations d'UN itinéraire. La suppression est strictement
 * limitée à `trail_id` : les associations des autres randonnées qui empruntent
 * les mêmes segments ne sont jamais touchées.
 */
export function replaceTrailSegments(trailId: string, links: readonly TrailSegmentLink[], source: TrailSource): number {
  const now = nowIso();
  db.delete(trailSegments).where(eq(trailSegments.trailId, trailId)).run();
  if (links.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < links.length; i += 500) {
    const batch = links.slice(i, i + 500);
    db.transaction((tx) => {
      for (const link of batch) {
        tx.insert(trailSegments)
          .values({
            id: `${trailId}::${link.segmentId}::${link.sequence}`,
            trailId,
            segmentId: link.segmentId,
            sequence: link.sequence,
            direction: link.direction,
            role: link.role,
            source,
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
        n++;
      }
    });
  }
  return n;
}

/**
 * Associe un itinéraire importé à son réseau et enregistre la qualité de la
 * liaison sur la fiche. Renvoie de quoi rendre compte de l'import.
 */
export function linkImportedTrail(input: { trailId: string; geometry: readonly LngLat[]; memberWayIds: readonly number[]; source: TrailSource; gaps?: number }): LinkResult {
  const { links, expectedWays, resolvedWays } = resolveTrailSegments({ geometry: input.geometry, memberWayIds: input.memberWayIds });
  const linkedSegments = replaceTrailSegments(input.trailId, links, input.source);
  const coverage = expectedWays > 0 ? resolvedWays / expectedWays : 0;
  db.update(trails)
    .set({
      memberWayCount: expectedWays,
      resolvedWayCount: resolvedWays,
      linkCoverage: coverage,
      geometryConfidence: geometryConfidence(coverage, input.gaps ?? 0),
    })
    .where(eq(trails.id, input.trailId))
    .run();
  return { trailId: input.trailId, expectedWays, resolvedWays, linkedSegments, coverage };
}

/**
 * Confiance dans la géométrie assemblée (0..1) : la couverture des membres,
 * amputée de 10 % par tronçon non raccordé. Une relation dont les morceaux ne
 * se touchent pas décrit mal le terrain, même si tous ses ways sont connus —
 * les ruptures sont exactement les endroits où un tracé traverse dans le vide.
 */
export function geometryConfidence(coverage: number, gaps: number): number {
  const penalty = Math.min(0.6, Math.max(0, gaps) * 0.1);
  return Math.max(0, Math.min(1, coverage - penalty));
}

/** Segments d'un itinéraire, dans l'ordre de parcours, avec leur sens. */
export function trailSegmentRows(trailId: string): { link: TrailSegmentRow; path: PathRow }[] {
  const links = db.select().from(trailSegments).where(eq(trailSegments.trailId, trailId)).orderBy(trailSegments.sequence).all();
  if (links.length === 0) return [];
  const rows = new Map<string, PathRow>();
  const ids = links.map((l) => l.segmentId);
  for (let i = 0; i < ids.length; i += 400) {
    for (const row of db.select().from(paths).where(inArray(paths.id, ids.slice(i, i + 400))).all()) rows.set(row.id, row);
  }
  const out: { link: TrailSegmentRow; path: PathRow }[] = [];
  for (const link of links) {
    const path = rows.get(link.segmentId);
    // Un segment disparu (réimport partiel) est ignoré, jamais remplacé par un
    // trait droit entre ses voisins : c'est précisément le mensonge à éviter.
    if (path) out.push({ link, path });
  }
  return out;
}

/**
 * Tracé reconstruit depuis les segments RÉELS du réseau, dans l'ordre et dans
 * le bon sens. C'est cette géométrie que la navigation utilise : elle suit par
 * construction des chemins qui existent.
 *
 * Deux segments qui se touchent partagent un point : on ne le répète pas. Deux
 * segments séparés par un vrai trou restent séparés dans le résultat — à
 * l'appelant de décider quoi en faire, mais jamais de le combler ici.
 */
export function geometryFromSegments(rows: readonly { link: TrailSegmentRow; path: PathRow }[]): LngLat[][] {
  const parts: LngLat[][] = [];
  let current: LngLat[] = [];
  const JOIN_TOLERANCE_M = 15;
  for (const { link, path } of rows) {
    const coords = link.direction === "backward" ? [...path.coordinates].reverse() : path.coordinates;
    if (coords.length < 2) continue;
    if (current.length === 0) {
      current = coords.map((c) => [c[0], c[1]] as LngLat);
      continue;
    }
    const last = current[current.length - 1];
    const first = coords[0];
    const gapM = Math.hypot((first[0] - last[0]) * 111_320 * Math.cos((first[1] * Math.PI) / 180), (first[1] - last[1]) * 111_320);
    if (gapM <= JOIN_TOLERANCE_M) {
      current.push(...coords.slice(1).map((c) => [c[0], c[1]] as LngLat));
    } else {
      parts.push(current);
      current = coords.map((c) => [c[0], c[1]] as LngLat);
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

/** Nombre total d'associations, et nombre d'itinéraires qui en ont au moins une. */
export function trailSegmentCounts(): { trailSegments: number; linkedTrails: number } {
  const total = db.select({ n: sql<number>`count(*)` }).from(trailSegments).get()?.n ?? 0;
  const linked = db.select({ n: sql<number>`count(distinct ${trailSegments.trailId})` }).from(trailSegments).get()?.n ?? 0;
  return { trailSegments: total, linkedTrails: linked };
}

/* ------------------------------------------------------------------ */
/* Liaison par corridor : pour tout ce qui n'a pas de way ids          */
/* ------------------------------------------------------------------ */

/** Écart maximal (m) entre un segment et le tracé pour les considérer confondus. */
export const CORRIDOR_TOLERANCE_M = 30;

/**
 * Segments du réseau qui suivent RÉELLEMENT un tracé donné.
 *
 * Sert dans deux cas où les identifiants de ways ne sont pas disponibles :
 * ré-associer un itinéraire importé avant que les way ids ne soient conservés,
 * et — plus tard — rattacher une trace GPX ou IGN au même réseau logique
 * (section 44 du cahier des charges). Un segment n'est retenu que si TOUS ses
 * points échantillonnés longent le tracé à moins de `toleranceM` : un sentier
 * qui s'en écarte au milieu n'en fait pas partie, même si ses extrémités
 * coïncident.
 */
export function resolveTrailSegmentsByCorridor(
  geometry: readonly LngLat[],
  opts: { toleranceM?: number; role?: string; limit?: number } = {},
): { links: TrailSegmentLink[]; matchedLengthM: number; trailLengthM: number } {
  const tolerance = opts.toleranceM ?? CORRIDOR_TOLERANCE_M;
  const line = geometry.map((c) => [c[0], c[1]] as LngLat);
  if (line.length < 2) return { links: [], matchedLengthM: 0, trailLengthM: 0 };
  const cumulative = cumulativeDistances(line);
  const trailLengthM = cumulative[cumulative.length - 1] ?? 0;

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of line) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const pad = tolerance / 111_320 + 0.0005;
  const candidates = db
    .select()
    .from(paths)
    .where(
      sql`${paths.minLat} <= ${maxLat + pad} AND ${paths.maxLat} >= ${minLat - pad} AND ${paths.minLng} <= ${maxLng + pad} AND ${paths.maxLng} >= ${minLng - pad}`,
    )
    .limit(opts.limit ?? 20_000)
    .all();

  const placed: { row: PathRow; along: number; direction: "forward" | "backward" }[] = [];
  let matchedLengthM = 0;
  for (const row of candidates) {
    const coords = row.coordinates;
    if (coords.length < 2) continue;
    // Échantillonnage : début, milieu, fin, plus deux quarts. Cinq points
    // suffisent à écarter un segment qui bifurque, sans coûter un projeté par sommet.
    const picks = [0, 0.25, 0.5, 0.75, 1].map((t) => coords[Math.min(coords.length - 1, Math.round(t * (coords.length - 1)))]);
    let worst = 0;
    let alongSum = 0;
    let ok = true;
    for (const c of picks) {
      const projection = projectOnPolyline({ lng: c[0], lat: c[1] }, line, cumulative);
      if (!projection || projection.distanceM > tolerance) {
        ok = false;
        break;
      }
      worst = Math.max(worst, projection.distanceM);
      alongSum += projection.along;
    }
    if (!ok) continue;
    const along = alongSum / picks.length;
    placed.push({ row, along, direction: directionOf(coords, line, cumulative, along) });
    matchedLengthM += row.lengthM;
  }
  placed.sort((a, b) => a.along - b.along);
  return {
    links: placed.map((p, sequence) => ({ segmentId: p.row.id, sequence, direction: p.direction, role: opts.role ?? "main" })),
    matchedLengthM,
    trailLengthM,
  };
}

/** Itinéraires candidats à une ré-association (tous ceux qui ont une géométrie). */
export function listTrailsForRelink(): TrailRow[] {
  return db.select().from(trails).all();
}

/**
 * Ré-associe un itinéraire déjà en base en repartant de sa géométrie. La
 * couverture est alors mesurée en LONGUEUR (part du tracé effectivement
 * couverte par des segments connus) et non en nombre de membres : c'est la
 * seule mesure disponible quand les membres d'origine sont perdus.
 */
export function relinkTrailByGeometry(row: TrailRow): LinkResult {
  const coords = row.geometry.type === "LineString" ? (row.geometry.coordinates as LngLat[]) : [];
  const { links, matchedLengthM, trailLengthM } = resolveTrailSegmentsByCorridor(coords);
  const source = (row.source ?? "local") as TrailSource;
  const linkedSegments = replaceTrailSegments(row.id, links, source);
  const coverage = trailLengthM > 0 ? Math.min(1, matchedLengthM / trailLengthM) : 0;
  db.update(trails)
    .set({ resolvedWayCount: links.length, linkCoverage: coverage, geometryConfidence: geometryConfidence(coverage, row.gapCount ?? 0) })
    .where(eq(trails.id, row.id))
    .run();
  return { trailId: row.id, expectedWays: row.memberWayCount ?? links.length, resolvedWays: links.length, linkedSegments, coverage };
}
