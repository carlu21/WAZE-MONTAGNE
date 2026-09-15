/**
 * Tests du découpage en passages (sections 7, 8, 9, 13, 15, 19).
 *
 * Le réseau de test reproduit une configuration corse courante : un axe unique
 * (parking de Grotelle → montée → lac, vallée de la Restonica) découpé en trois
 * segments qui partagent exactement leurs nœuds, plus une variante qui part de
 * l'intersection. Toutes les géométries sont construites avec `offsetPoint`
 * depuis un même départ : les points d'un même axe sont donc rigoureusement
 * alignés, et les extrémités partagées rigoureusement confondues.
 *
 * Les vitesses sont celles du moteur (`DEFAULT_SPEED_MS`) : marche 4 km/h,
 * trail 8 km/h, VTT 12 km/h. Avec un relevé toutes les 9 s, le pas vaut
 * respectivement 10, 20 et 30 m — des nombres ronds qui rendent les durées
 * attendues vérifiables à la main (1 m de marche = 0,9 s).
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint, type LngLat } from "../geo";
import type { LatLng } from "../types";
import { DEFAULT_SPEED_MS } from "../navigation/eta";
import { cumulativeDistances, pointAtAlong } from "../navigation/geometry";
import { buildPathGraph, makeSegment } from "../navigation/graph";
import type { PathSegment } from "../navigation/types";
import type { MatchedPoint, PointQuality, ScoredPoint } from "./types";
import {
  REVERSAL_TOLERANCE_M,
  extractOffNetworkRuns,
  extractTraversals,
  matchTrace,
  toObservations,
} from "./traversals";

/* ------------------------------------------------------------------ */
/* Réseau de test : vallée de la Restonica                             */
/* ------------------------------------------------------------------ */

/** Parking de Grotelle (haute Restonica). */
const DEPART: LatLng = { lat: 42.2727, lng: 9.0728 };
/** Cap de l'axe : la vallée monte vers le nord-est. */
const AXE_BRG = 40;

const MARCHE = DEFAULT_SPEED_MS.hiking;
const TRAIL = DEFAULT_SPEED_MS.trail;
const VTT = DEFAULT_SPEED_MS.mtb;
/** Cadence des relevés : 9 s (pas de 10 / 20 / 30 m selon l'activité). */
const INTERVAL_MS = 9000;
const T0 = Date.UTC(2025, 6, 12, 6, 30);

/** Point à l'abscisse `d` de l'axe, décalé de `lateralM` (positif = sud-est). */
function pointOnAxis(d: number, lateralM = 0): LatLng {
  const p = offsetPoint(DEPART, d, AXE_BRG);
  if (lateralM === 0) return p;
  return offsetPoint(p, Math.abs(lateralM), AXE_BRG + (lateralM > 0 ? 90 : -90));
}

/** Géométrie d'une portion de l'axe, un sommet tous les `stepM` mètres. */
function axisCoords(fromM: number, toM: number, stepM = 50): LngLat[] {
  const out: LngLat[] = [];
  for (let d = fromM; d < toM - 1e-6; d += stepM) {
    const p = pointOnAxis(d);
    out.push([p.lng, p.lat]);
  }
  const end = pointOnAxis(toM);
  out.push([end.lng, end.lat]);
  return out;
}

const PARKING = makeSegment("restonica-parking", axisCoords(0, 300), { name: "Piste de Grotelle", kind: "track", source: "seed" });
const MONTEE = makeSegment("restonica-montee", axisCoords(300, 900), { name: "Sentier du lac de Melo", kind: "path", source: "seed" });
const LAC = makeSegment("restonica-lac", axisCoords(900, 1800), { name: "Sentier du lac de Capitello", kind: "path", source: "seed" });
const JONCTION = pointOnAxis(900);
const VARIANTE = makeSegment(
  "bavella-variante",
  [
    [JONCTION.lng, JONCTION.lat],
    ...[100, 200, 300, 400].map((d) => {
      const p = offsetPoint(JONCTION, d, AXE_BRG + 90);
      return [p.lng, p.lat] as LngLat;
    }),
  ],
  { name: "Variante des bergeries", kind: "path", source: "seed" },
);
/** Deux très courts segments, hors graphe, pour les cas limites de durée et de nombre de points. */
const PASSERELLE = makeSegment("golo-passerelle", axisCoords(0, 8, 8), { name: "Passerelle du Golo", kind: "footway" });
const GUE = makeSegment("golo-gue", axisCoords(0, 40, 40), { name: "Gué du Golo", kind: "path", ford: true });

const RESEAU: PathSegment[] = [PARKING, MONTEE, LAC, VARIANTE];
const GRAPHE = buildPathGraph(RESEAU);
const SEGMENTS = new Map(RESEAU.map((s) => [s.id, s]));
const COURTS = new Map([
  [PASSERELLE.id, PASSERELLE],
  [GUE.id, GUE],
]);
const QUI = { activity: "hiking" as const, userKey: "pseudo-9f3" };

/* ------------------------------------------------------------------ */
/* Fabriques de points                                                 */
/* ------------------------------------------------------------------ */

function scored(p: LatLng, at: number, extra: Partial<ScoredPoint> = {}): ScoredPoint {
  return {
    lat: p.lat,
    lng: p.lng,
    alt: null,
    at,
    accuracy: 10,
    speed: null,
    heading: null,
    quality: 4,
    flags: [],
    observedSpeedMs: null,
    stepM: null,
    ...extra,
  };
}

/** Trace brute le long de l'axe, à vitesse constante et décalage latéral constant. */
function traceAlongAxis(
  fromM: number,
  toM: number,
  speedMs: number,
  opts: { offsetM?: number; intervalMs?: number; startAt?: number } = {},
): ScoredPoint[] {
  const intervalMs = opts.intervalMs ?? INTERVAL_MS;
  const startAt = opts.startAt ?? T0;
  const stepM = (speedMs * intervalMs) / 1000;
  const n = Math.round((toM - fromM) / stepM);
  const out: ScoredPoint[] = [];
  for (let k = 0; k <= n; k++) {
    out.push(scored(pointOnAxis(fromM + k * stepM, opts.offsetM ?? 0), startAt + k * intervalMs));
  }
  return out;
}

/** Point rattaché synthétique, positionné à son abscisse sur le segment. */
function matchedOn(seg: PathSegment, along: number, at: number, index: number, confidence = 0.8): MatchedPoint {
  const p = pointAtAlong(seg.coordinates, cumulativeDistances(seg.coordinates), along);
  return { index, at, segmentId: seg.id, lat: p.lat, lng: p.lng, along, confidence, deviationM: 4, alt: null, accuracy: 10 };
}

/** Suite de points rattachés régulièrement espacés sur un segment, à vitesse constante. */
function onSegment(
  seg: PathSegment,
  fromAlong: number,
  toAlong: number,
  stepM: number,
  speedMs: number,
  startAt: number,
  opts: { confidence?: number; startIndex?: number } = {},
): MatchedPoint[] {
  const sign = toAlong >= fromAlong ? 1 : -1;
  const span = Math.abs(toAlong - fromAlong);
  const n = Math.max(1, Math.round(span / stepM));
  const startIndex = opts.startIndex ?? 0;
  const out: MatchedPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const travelled = Math.min(k * stepM, span);
    out.push(
      matchedOn(seg, fromAlong + sign * travelled, startAt + Math.round((travelled / speedMs) * 1000), startIndex + k, opts.confidence ?? 0.8),
    );
  }
  return out;
}

const last = <T>(list: readonly T[]): T => list[list.length - 1];

/* ------------------------------------------------------------------ */

describe("matchTrace (sections 7 et 8)", () => {
  it("rattache toute la montée du lac de Melo et conserve le lien avec la trace brute", () => {
    const brute = traceAlongAxis(320, 820, MARCHE, { offsetM: 8 });
    const matched = matchTrace(brute, GRAPHE, "hiking");

    expect(matched).toHaveLength(brute.length);
    expect(matched.map((m) => m.index)).toEqual(brute.map((_, i) => i));
    expect(matched.every((m) => m.segmentId === "restonica-montee")).toBe(true);
    expect(matched[0].along).toBeCloseTo(20, 0);
    expect(last(matched).along).toBeCloseTo(520, 0);
    expect(matched[25].deviationM).toBeCloseTo(8, 0);
    expect(matched[25].confidence).toBeGreaterThan(0.5);
    // La position retenue est recalée sur le chemin, pas la position brute.
    expect(haversineM(matched[25], pointOnAxis(570))).toBeLessThan(1.5);
    expect(haversineM(matched[25], brute[25])).toBeCloseTo(8, 0);
  });

  it("ignore les points de qualité insuffisante sans les faire disparaître", () => {
    const brute = traceAlongAxis(320, 820, MARCHE, { offsetM: 8 });
    const avecAberrant = [...brute];
    // Relevé déclassé par le contrôle qualité : 200 m à l'écart, précision 120 m.
    avecAberrant[10] = scored(pointOnAxis(420, 200), brute[10].at, { quality: 1, flags: ["accuracy"], accuracy: 120 });
    const matched = matchTrace(avecAberrant, GRAPHE, "hiking");

    expect(matched).toHaveLength(brute.length);
    expect(matched[10].segmentId).toBeNull();
    expect(matched[10].confidence).toBe(0);
    expect(matched[10].deviationM).toBe(0);
    expect(matched[10].index).toBe(10);
    expect(matched[10].lat).toBe(avecAberrant[10].lat);
    expect(matched[10].lng).toBe(avecAberrant[10].lng);
    // Le matching reprend au point suivant, sans avoir été entraîné à l'écart.
    expect(matched[11].segmentId).toBe("restonica-montee");
    expect(matched[11].along).toBeGreaterThan(matched[9].along);
  });

  it("applique le seuil de qualité demandé", () => {
    const brute = traceAlongAxis(320, 820, MARCHE, { offsetM: 8 });
    const mediocre = [...brute];
    mediocre[20] = { ...brute[20], quality: 2 as PointQuality };

    expect(matchTrace(mediocre, GRAPHE, "hiking")[20].segmentId).toBe("restonica-montee");
    expect(matchTrace(mediocre, GRAPHE, "hiking", { minQuality: 3 })[20].segmentId).toBeNull();
  });

  it("ne rattache rien à 150 m de tout chemin connu", () => {
    const brute = traceAlongAxis(320, 620, MARCHE, { offsetM: 150 });
    const matched = matchTrace(brute, GRAPHE, "hiking");

    expect(matched.every((m) => m.segmentId === null)).toBe(true);
    expect(matched[0].lat).toBe(brute[0].lat);
    expect(matched[0].lng).toBe(brute[0].lng);
    expect(matched.every((m) => m.confidence === 0)).toBe(true);
  });

  it("maxSnapM resserre le rattachement sans relâcher le matcher", () => {
    const brute = traceAlongAxis(320, 620, MARCHE, { offsetM: 18 });
    expect(matchTrace(brute, GRAPHE, "hiking").every((m) => m.segmentId !== null)).toBe(true);
    expect(matchTrace(brute, GRAPHE, "hiking", { maxSnapM: 12 }).every((m) => m.segmentId === null)).toBe(true);
  });

  it("une trace vide ne produit rien", () => {
    expect(matchTrace([], GRAPHE, "mtb")).toEqual([]);
  });
});

describe("extractTraversals (sections 9 et 13)", () => {
  it("mesure un passage complet à 4 km/h", () => {
    const points = onSegment(MONTEE, 0, 600, 20, MARCHE, T0);
    const res = extractTraversals(points, SEGMENTS);

    expect(res).toHaveLength(1);
    const t = res[0];
    expect(t.segmentId).toBe("restonica-montee");
    expect(t.direction).toBe("forward");
    expect(t.coverage).toBeCloseTo(1, 2);
    expect(t.distanceM).toBeCloseTo(600, 0);
    expect(t.points).toBe(31);
    expect(t.enteredAt).toBe(T0);
    expect(t.durationMs).toBe(540_000); // 600 m à 4 km/h = 9 min
    expect(t.averageSpeedMs).toBeCloseTo(MARCHE, 2);
    expect(t.confidence).toBeCloseTo(0.8, 2);
  });

  it("interpole l'entrée et la sortie pour rendre les durées comparables", () => {
    const corps = onSegment(MONTEE, 40, 560, 20, MARCHE, T0, { startIndex: 1 });
    const avant = matchedOn(PARKING, 290, T0 - 40_000, 0);
    const apres = matchedOn(LAC, 15, last(corps).at + 40_000, corps.length + 1);
    const res = extractTraversals([avant, ...corps, apres], SEGMENTS);

    expect(res).toHaveLength(1);
    // 40 m manquants à l'entrée, parcourus en 36 s à 4 km/h.
    expect(res[0].enteredAt).toBeCloseTo(T0 - 36_000, -2);
    expect(res[0].durationMs).toBeCloseTo(540_000, -2);
    expect(res[0].coverage).toBeCloseTo(1, 2);
    expect(res[0].averageSpeedMs).toBeCloseTo(MARCHE, 2);

    // Sans voisins, rien n'est extrapolé : le passage reste ce qui a été observé.
    const seul = extractTraversals(corps, SEGMENTS);
    expect(seul[0].enteredAt).toBe(T0);
    expect(seul[0].durationMs).toBe(468_000);
    expect(seul[0].coverage).toBeCloseTo(520 / 600, 2);
  });

  it("mesure le sens inverse avec les mêmes bornes interpolées", () => {
    const corps = onSegment(MONTEE, 560, 40, 20, TRAIL, T0, { startIndex: 1 });
    const avant = matchedOn(LAC, 20, T0 - 20_000, 0);
    const apres = matchedOn(PARKING, 280, last(corps).at + 20_000, corps.length + 1);
    const res = extractTraversals([avant, ...corps, apres], SEGMENTS);

    expect(res).toHaveLength(1);
    expect(res[0].direction).toBe("backward");
    expect(res[0].coverage).toBeCloseTo(1, 2);
    expect(res[0].enteredAt).toBeCloseTo(T0 - 18_000, -2); // 40 m à 8 km/h
    expect(res[0].durationMs).toBeCloseTo(270_000, -2);
  });

  it("borne l'interpolation à ce que la cadence des relevés autorise", () => {
    const points = onSegment(MONTEE, 0, 600, 20, MARCHE, T0);
    // Deuxième relevé déclassé : le passage repart à 40 m de l'entrée du segment.
    const avecTrou = points.map((p, i) => (i === 1 ? { ...p, segmentId: null, along: 0, confidence: 0 } : p));
    const res = extractTraversals(avecTrou, SEGMENTS);

    expect(res).toHaveLength(1);
    // 18 s depuis le point déclassé : au plus 20 m d'interpolation, pas les 40 m
    // qui ramèneraient artificiellement à l'entrée du segment.
    expect(res[0].coverage).toBeCloseTo(580 / 600, 2);
    expect(res[0].enteredAt).toBe(points[1].at);
  });

  it("un aller-retour produit deux passages, un par sens (section 15)", () => {
    const aller = onSegment(MONTEE, 0, 600, 20, TRAIL, T0);
    const retour = onSegment(MONTEE, 580, 0, 20, TRAIL, last(aller).at + INTERVAL_MS, { startIndex: aller.length });
    const res = extractTraversals([...aller, ...retour], SEGMENTS);

    expect(res).toHaveLength(2);
    expect(res.map((t) => t.direction)).toEqual(["forward", "backward"]);
    expect(res[0].durationMs).toBe(270_000); // 600 m à 8 km/h = 4 min 30
    expect(res[1].durationMs).toBe(270_000);
    // Le point le plus avancé ferme l'aller et ouvre le retour : aucun trou, aucun recouvrement.
    expect(res[0].exitedAt).toBe(res[1].enteredAt);
    expect(res[1].coverage).toBeCloseTo(1, 2);
    expect(res[1].averageSpeedMs).toBeCloseTo(TRAIL, 2);
  });

  it("tolère un recul d'abscisse compatible avec le bruit, coupe au-delà", () => {
    const base = onSegment(MONTEE, 0, 600, 20, MARCHE, T0);
    // Recul de 10 m par rapport au point le plus avancé : sous la tolérance.
    const bruite = base.map((p, i) => (i === 15 ? { ...p, along: p.along - 30 } : p));
    const doux = extractTraversals(bruite, SEGMENTS);
    expect(REVERSAL_TOLERANCE_M).toBe(15);
    expect(doux).toHaveLength(1);
    expect(doux[0].points).toBe(31);
    expect(doux[0].coverage).toBeCloseTo(1, 2);

    // Recul de 20 m : demi-tour franc, l'aller devient trop partiel et disparaît.
    const casse = base.map((p, i) => (i === 15 ? { ...p, along: p.along - 40 } : p));
    const coupe = extractTraversals(casse, SEGMENTS);
    expect(coupe).toHaveLength(1);
    expect(coupe[0].direction).toBe("forward");
    expect(coupe[0].coverage).toBeCloseTo(340 / 600, 2);
  });

  it("un trou de données coupe le passage, et les moitiés partielles sont écartées", () => {
    const avant = onSegment(MONTEE, 0, 280, 20, MARCHE, T0);
    const apres = onSegment(MONTEE, 320, 600, 20, MARCHE, last(avant).at + 300_000, { startIndex: avant.length });
    const trace = [...avant, ...apres];

    expect(extractTraversals(trace, SEGMENTS)).toEqual([]);
    // En tolérant le trou, le passage redevient complet (mais sa durée inclut l'arrêt).
    const tolerant = extractTraversals(trace, SEGMENTS, { maxGapMs: 600_000 });
    expect(tolerant).toHaveLength(1);
    expect(tolerant[0].coverage).toBeCloseTo(1, 2);
    expect(tolerant[0].durationMs).toBe(804_000);
  });

  it("retient un passage sur une arête très longue, où « la moitié » n'a plus de sens", () => {
    // Une section de GR que nulle intersection ne coupe : 40 km d'un seul tenant.
    const GR = makeSegment("gr20-sud", axisCoords(0, 40_000, 200), { name: "GR20 sud", kind: "path", source: "seed" });
    const reseau = new Map([[GR.id, GR]]);
    // Une sortie réelle en parcourt 3 km : 7 % de l'arête, mais un vrai passage.
    const sortie = onSegment(GR, 5_000, 8_000, 20, MARCHE, T0);
    const passages = extractTraversals(sortie, reseau);
    expect(passages).toHaveLength(1);
    expect(passages[0].distanceM).toBeGreaterThan(2_900);
    expect(passages[0].coverage).toBeLessThan(0.1);
    // La couverture voyage avec le passage : la couche statistique saura que
    // cette DURÉE n'est pas comparable, même si la fréquentation, elle, compte.
    expect(passages[0].coverage).toBeGreaterThan(0);

    // Sous la distance plancher, la règle de couverture reprend la main.
    const brefve = onSegment(GR, 5_000, 5_300, 20, MARCHE, T0);
    expect(extractTraversals(brefve, reseau)).toEqual([]);
    expect(extractTraversals(brefve, reseau, { minDistanceM: 200 })).toHaveLength(1);
  });

  it("écarte les passages partiels, incertains, trop courts ou trop rares", () => {
    const partiel = onSegment(MONTEE, 100, 350, 20, MARCHE, T0); // 250 m sur 600
    expect(extractTraversals(partiel, SEGMENTS)).toEqual([]);
    expect(extractTraversals(partiel, SEGMENTS, { minCoverage: 0.3 })).toHaveLength(1);

    const incertain = onSegment(MONTEE, 0, 600, 20, MARCHE, T0, { confidence: 0.2 });
    expect(extractTraversals(incertain, SEGMENTS)).toEqual([]);
    expect(extractTraversals(incertain, SEGMENTS, { minConfidence: 0.1 })).toHaveLength(1);

    // Passerelle de 8 m franchie en VTT : 2,4 s, trop court pour en tirer un temps.
    const passerelle = onSegment(PASSERELLE, 0, 8, 8, VTT, T0);
    expect(extractTraversals(passerelle, COURTS)).toEqual([]);
    expect(extractTraversals(passerelle, COURTS, { minDurationMs: 1000 })).toHaveLength(1);

    // Deux relevés suffisent quand ils encadrent vraiment le segment (gué de 40 m, 36 s).
    const deuxPoints = onSegment(GUE, 0, 40, 40, MARCHE, T0);
    expect(extractTraversals(deuxPoints, COURTS)).toHaveLength(1);
    expect(extractTraversals(deuxPoints, COURTS, { minPoints: 3 })).toEqual([]);
  });

  it("gère les entrées vides, uniques et les segments inconnus", () => {
    expect(extractTraversals([], SEGMENTS)).toEqual([]);
    expect(extractTraversals([matchedOn(MONTEE, 120, T0, 0)], SEGMENTS)).toEqual([]);
    const complet = onSegment(MONTEE, 0, 600, 20, MARCHE, T0);
    expect(extractTraversals(complet, new Map())).toEqual([]);
    expect(extractTraversals(complet.map((p) => ({ ...p, segmentId: "inconnu" })), SEGMENTS)).toEqual([]);
    // Une trace entièrement hors réseau ne produit aucun passage.
    expect(extractTraversals(complet.map((p) => ({ ...p, segmentId: null })), SEGMENTS)).toEqual([]);
  });
});

describe("toObservations (vie privée et statistiques)", () => {
  const aller = onSegment(MONTEE, 0, 600, 20, TRAIL, T0);
  const retour = onSegment(MONTEE, 580, 0, 20, TRAIL, last(aller).at + INTERVAL_MS, { startIndex: aller.length });
  const passages = extractTraversals([...aller, ...retour], SEGMENTS);

  it("reporte la fin du passage et les métadonnées, sans aucune position", () => {
    const obs = toObservations(passages, { activity: "trail", userKey: "pseudo-4f2" });

    expect(obs).toHaveLength(2);
    expect(obs[0].at).toBe(passages[0].exitedAt);
    expect(obs[0].segmentId).toBe("restonica-montee");
    expect(obs[0].activity).toBe("trail");
    expect(obs[0].userKey).toBe("pseudo-4f2");
    expect(obs[0].durationMs).toBe(passages[0].durationMs);
    expect(obs.map((o) => o.direction)).toEqual(["forward", "backward"]);
    expect(Object.keys(obs[0])).not.toContain("lat");
    expect(Object.keys(obs[0])).not.toContain("lng");
  });

  it("aucune observation sans passage", () => {
    expect(toObservations([], { activity: "hiking", userKey: "pseudo-4f2" })).toEqual([]);
  });
});

describe("extractOffNetworkRuns (section 19)", () => {
  const brute = traceAlongAxis(320, 620, MARCHE, { offsetM: 150 });
  const horsReseau = matchTrace(brute, GRAPHE, "hiking");

  it("isole une portion de 300 m hors de tout chemin connu", () => {
    const runs = extractOffNetworkRuns(horsReseau, QUI);

    expect(runs).toHaveLength(1);
    expect(runs[0].lengthM).toBeCloseTo(300, 0);
    expect(runs[0].points).toHaveLength(31);
    expect(runs[0].fromIndex).toBe(0);
    expect(runs[0].toIndex).toBe(30);
    expect(runs[0].at).toBe(T0);
    expect(runs[0].userKey).toBe("pseudo-9f3");
    expect(runs[0].activity).toBe("hiking");
    // Ce sont bien les positions brutes qui sont transmises.
    expect(haversineM(runs[0].points[0], brute[0])).toBeLessThan(0.001);
  });

  it("écarte ce qui est trop court ou trop peu documenté", () => {
    const court = matchTrace(traceAlongAxis(320, 380, MARCHE, { offsetM: 150 }), GRAPHE, "hiking");
    expect(extractOffNetworkRuns(court, QUI)).toEqual([]);
    expect(extractOffNetworkRuns(court, QUI, { minLengthM: 50 })).toHaveLength(1);

    // Quatre relevés espacés de 100 m : 300 m, mais rien qui décrive un tracé.
    const rares = [0, 100, 200, 300].map((d, i) => {
      const p = pointOnAxis(320 + d, 150);
      return { index: i, at: T0 + i * 90_000, segmentId: null, lat: p.lat, lng: p.lng, along: 0, confidence: 0, deviationM: 0, alt: null, accuracy: 15 };
    });
    expect(extractOffNetworkRuns(rares, QUI)).toEqual([]);
    expect(extractOffNetworkRuns(rares, QUI, { minPoints: 3 })).toHaveLength(1);
  });

  it("une portion collée à un chemin connu coupe la série", () => {
    const coupe = horsReseau.map((p, i) => (i === 15 ? { ...p, segmentId: "restonica-montee", along: 150, confidence: 0.7 } : p));
    const runs = extractOffNetworkRuns(coupe, QUI);

    expect(runs).toHaveLength(2);
    expect(runs[0].fromIndex).toBe(0);
    expect(runs[0].toIndex).toBe(14);
    expect(runs[0].lengthM).toBeCloseTo(140, 0);
    expect(runs[1].fromIndex).toBe(16);
    expect(runs[1].toIndex).toBe(30);
  });

  it("un long silence sépare deux portions distinctes", () => {
    const trou = horsReseau.map((p, i) => (i >= 15 ? { ...p, at: p.at + 600_000 } : p));
    const runs = extractOffNetworkRuns(trou, QUI);

    expect(runs).toHaveLength(2);
    expect(runs[0].toIndex).toBe(14);
    expect(runs[1].at).toBe(trou[15].at);
  });

  it("aucune portion sur une trace vide ou entièrement rattachée", () => {
    expect(extractOffNetworkRuns([], QUI)).toEqual([]);
    const surSentier = matchTrace(traceAlongAxis(320, 820, MARCHE, { offsetM: 8 }), GRAPHE, "hiking");
    expect(extractOffNetworkRuns(surSentier, QUI)).toEqual([]);
  });
});

describe("chaîne complète (trace → passages → observations)", () => {
  it("découpe une sortie trail de 1,8 km en trois passages enchaînés", () => {
    const brute = traceAlongAxis(0, 1800, TRAIL, { offsetM: 6 });
    const matched = matchTrace(brute, GRAPHE, "trail");
    expect(matched.filter((m) => m.segmentId === null)).toEqual([]);

    const res = extractTraversals(matched, SEGMENTS);
    expect(res.map((t) => t.segmentId)).toEqual(["restonica-parking", "restonica-montee", "restonica-lac"]);
    expect(res.every((t) => t.direction === "forward")).toBe(true);
    expect(res.every((t) => t.coverage > 0.9)).toBe(true);
    expect(res.reduce((sum, t) => sum + t.distanceM, 0)).toBeCloseTo(1800, -2);

    // Les bornes interpolées se rejoignent aux intersections : pas de temps perdu
    // entre deux segments, pas de temps compté deux fois.
    expect(res[1].enteredAt - res[0].exitedAt).toBeGreaterThanOrEqual(0);
    expect(res[1].enteredAt - res[0].exitedAt).toBeLessThan(INTERVAL_MS);
    expect(res[2].enteredAt - res[1].exitedAt).toBeGreaterThanOrEqual(0);
    expect(res[2].enteredAt - res[1].exitedAt).toBeLessThan(INTERVAL_MS);
    expect(res[2].exitedAt - res[0].enteredAt).toBeCloseTo(810_000, -4); // 1,8 km à 8 km/h

    const obs = toObservations(res, { activity: "trail", userKey: "pseudo-1" });
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => o.activity === "trail" && o.userKey === "pseudo-1")).toBe(true);
    expect(extractOffNetworkRuns(matched, { activity: "trail", userKey: "pseudo-1" })).toEqual([]);
  });
});
