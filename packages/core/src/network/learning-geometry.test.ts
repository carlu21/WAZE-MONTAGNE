/**
 * Tests de l'apprentissage géométrique collectif
 * (sections 17, 18, 19, 20, 21 du cahier des charges « moteur cartographique »).
 *
 * Le terrain est corse : la montée des bergeries de Grotelle vers le lac de
 * Melo (Restonica) pour la géométrie, un raccourci de Bavella pour les chemins
 * potentiels, et le GR 20 entre le col de Bavella et le refuge de Paliri pour
 * les variantes. Toutes les géométries sont construites avec `offsetPoint` — un
 * axe, un cap, un décalage latéral en mètres — et jamais avec des coordonnées
 * inventées à la main : ce qu'un test affirme en mètres est donc vérifiable.
 *
 * Le bruit GPS est simulé par une sinusoïde de phase fixe par trace : réaliste
 * (le faisceau oscille autour du passage réel), et surtout déterministe.
 */
import { describe, expect, it } from "vitest";
import { distanceToPolylineM, offsetPoint, polylineLengthM, type LngLat } from "../geo";
import { makeSegment } from "../navigation/graph";
import type { ActivityMode } from "../navigation/types";
import type { LatLng } from "../types";
import { K_ANONYMITY_MIN, type CorridorTrace, type OffNetworkRun, type PathObservation } from "./types";
import {
  CANDIDATE_MAX_DISPERSION_RATIO,
  MIN_CANDIDATE_CONFIDENCE,
  communityCenterline,
  detectPotentialTrails,
  detectVariants,
  geometryCandidate,
} from "./learning-geometry";

/* ------------------------------------------------------------------ */
/* Terrain et outils de construction                                   */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute vallée de la Restonica. */
const GROTELLE: LatLng = { lat: 42.2718, lng: 9.0731 };
/** Orientation de la montée vers le lac de Melo. */
const MELO_BRG = 118;

/** Col de Bavella. */
const BAVELLA: LatLng = { lat: 41.7975, lng: 9.2264 };

/** Vitesses de référence du cahier des charges (m/s). */
const MARCHE_MS = 4000 / 3600;
const TRAIL_MS = 8000 / 3600;
const VTT_MS = 12000 / 3600;

/** Un jour en millisecondes. */
const JOUR = 86_400_000;
/** Instant de référence des tests (1er septembre 2025, 8 h UTC). */
const MAINTENANT = Date.UTC(2025, 8, 1, 8, 0, 0);

/** Ligne droite de `lengthM` mètres depuis `start` au cap `brg`, extrémité comprise. */
function line(start: LatLng, brg: number, lengthM: number, stepM = 25): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d < lengthM; d += stepM) {
    const p = offsetPoint(start, d, brg);
    out.push([p.lng, p.lat]);
  }
  const end = offsetPoint(start, lengthM, brg);
  out.push([end.lng, end.lat]);
  return out;
}

/** Décale un point perpendiculairement au cap : positif = à droite. */
function lateral(p: LatLng, brg: number, offsetM: number): LatLng {
  return offsetM === 0 ? p : offsetPoint(p, Math.abs(offsetM), brg + (offsetM > 0 ? 90 : -90));
}

/** Écart latéral oscillant autour de `base`, de phase propre à chaque trace. */
function ondule(base: number, amplitudeM: number, phase: number): (d: number) => number {
  return (d) => base + amplitudeM * Math.sin(d / 37 + phase);
}

interface TraceOptions {
  start?: LatLng;
  brg?: number;
  lengthM?: number;
  stepM?: number;
  accuracy?: number | null;
  activity?: ActivityMode;
}

/** Trace d'un utilisateur le long d'un axe, décalée latéralement. */
function corridorTrace(
  userKey: string,
  at: number,
  offsetM: (d: number) => number,
  o: TraceOptions = {},
): CorridorTrace {
  const start = o.start ?? GROTELLE;
  const brg = o.brg ?? MELO_BRG;
  const lengthM = o.lengthM ?? 600;
  const stepM = o.stepM ?? 20;
  const points: { lat: number; lng: number; accuracy: number | null }[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    const along = Math.min(d, lengthM);
    const p = lateral(offsetPoint(start, along, brg), brg, offsetM(along));
    points.push({ lat: p.lat, lng: p.lng, accuracy: o.accuracy === undefined ? 8 : o.accuracy });
  }
  return { userKey, activity: o.activity ?? "hiking", at, points };
}

/** Faisceau de `count` traces réparties sur `users` contributeurs et `spanDays` jours. */
function faisceau(
  count: number,
  users: number,
  base: number,
  o: TraceOptions & { spanDays?: number; lastAt?: number } = {},
): CorridorTrace[] {
  const spanDays = o.spanDays ?? 60;
  const lastAt = o.lastAt ?? MAINTENANT;
  const out: CorridorTrace[] = [];
  for (let i = 0; i < count; i++) {
    const at = lastAt - Math.round(((count - 1 - i) / Math.max(1, count - 1)) * spanDays * JOUR);
    out.push(corridorTrace(`rando-${i % users}`, at, ondule(base, 3, i), o));
  }
  return out;
}

/** Portion hors réseau (raccourci de Bavella) parcourue à la marche. */
function offRun(
  userKey: string,
  at: number,
  offsetM: (d: number) => number,
  o: TraceOptions & { speedMs?: number } = {},
): OffNetworkRun {
  const start = o.start ?? BAVELLA;
  const brg = o.brg ?? 200;
  const lengthM = o.lengthM ?? 320;
  const stepM = o.stepM ?? 20;
  const speedMs = o.speedMs ?? MARCHE_MS;
  const points: { lat: number; lng: number; at: number; accuracy: number | null }[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    const along = Math.min(d, lengthM);
    const p = lateral(offsetPoint(start, along, brg), brg, offsetM(along));
    points.push({
      lat: p.lat,
      lng: p.lng,
      at: at + Math.round((along / speedMs) * 1000),
      accuracy: o.accuracy === undefined ? 10 : o.accuracy,
    });
  }
  return {
    userKey,
    activity: o.activity ?? "hiking",
    at,
    fromIndex: 0,
    toIndex: points.length - 1,
    lengthM,
    points,
  };
}

/** Écart maximal (m) entre une ligne et une ligne de référence. */
function ecartMax(ligne: readonly LngLat[], reference: readonly LngLat[]): number {
  let max = 0;
  for (const c of ligne) max = Math.max(max, distanceToPolylineM({ lng: c[0], lat: c[1] }, reference));
  return max;
}

/** Axe officiel de la montée et axe réellement emprunté (8 m à droite). */
const AXE_OFFICIEL = line(GROTELLE, MELO_BRG, 600);
const AXE_REEL = line(lateral(GROTELLE, MELO_BRG, 8), MELO_BRG, 600);

/* ------------------------------------------------------------------ */

describe("communityCenterline (section 18 : reconstruction collective)", () => {
  it("place la ligne centrale sur le passage réel, pas sur l'axe officiel", () => {
    const centre = communityCenterline(faisceau(12, 6, 8), AXE_OFFICIEL);
    expect(centre).not.toBeNull();
    if (!centre) return;
    expect(centre.observations).toBe(12);
    expect(centre.uniqueUsers).toBe(6);
    // 600 m au pas de 10 m : la ligne couvre tout le faisceau.
    expect(centre.coordinates.length).toBeGreaterThan(50);
    expect(polylineLengthM(centre.coordinates)).toBeGreaterThan(560);
    // Le faisceau oscille de ±3 m autour d'un passage situé 8 m à droite :
    // la ligne centrale doit retrouver ce passage, pas l'axe de référence.
    expect(ecartMax(centre.coordinates, AXE_REEL)).toBeLessThan(2.5);
    expect(ecartMax(centre.coordinates, AXE_OFFICIEL)).toBeGreaterThan(5.5);
    expect(centre.dispersionM).toBeGreaterThan(0);
    expect(centre.dispersionM).toBeLessThan(6);
    expect(centre.confidence).toBeGreaterThan(0.6);
    expect(centre.lastSeenAt).toBe(MAINTENANT);
    expect(centre.firstSeenAt).toBeLessThan(centre.lastSeenAt);
  });

  it("ignore la trace qui a suivi le chemin parallèle", () => {
    const traces = faisceau(12, 6, 8);
    const perdu = corridorTrace("rando-fantaisiste", MAINTENANT, ondule(45, 2, 1));
    const centre = communityCenterline([...traces, perdu], AXE_OFFICIEL);
    expect(centre).not.toBeNull();
    if (!centre) return;
    // La trace aberrante compte comme observation mais ne déplace pas le centre.
    expect(centre.observations).toBe(13);
    expect(ecartMax(centre.coordinates, AXE_REEL)).toBeLessThan(2.5);
  });

  it("écarte les observations de précision insuffisante", () => {
    const flou = faisceau(12, 6, 8, { accuracy: 45 });
    expect(communityCenterline(flou, AXE_OFFICIEL)).toBeNull();
    // Le même faisceau redevient exploitable si l'on accepte cette précision.
    expect(communityCenterline(flou, AXE_OFFICIEL, { maxAccuracyM: 50 })).not.toBeNull();
  });

  it("reconstruit un axe sans géométrie de référence", () => {
    const centre = communityCenterline(faisceau(10, 5, 8), null);
    expect(centre).not.toBeNull();
    if (!centre) return;
    expect(centre.coordinates.length).toBeGreaterThan(2);
    // Le squelette est une trace du faisceau : la ligne centrale doit malgré
    // tout retomber sur le passage réel.
    expect(ecartMax(centre.coordinates, AXE_REEL)).toBeLessThan(4);
    expect(polylineLengthM(centre.coordinates)).toBeGreaterThan(500);
    expect(polylineLengthM(centre.coordinates)).toBeLessThan(700);
  });

  it("exige assez de traces et assez de contributeurs distincts", () => {
    expect(communityCenterline([], null)).toBeNull();
    expect(communityCenterline(faisceau(1, 1, 8), AXE_OFFICIEL)).toBeNull();
    // 8 passages mais deux personnes : k-anonymat non atteint.
    expect(communityCenterline(faisceau(8, 2, 8), AXE_OFFICIEL)).toBeNull();
    // Et l'exigence ne se débranche pas par un réglage : un appelant peut
    // relever le seuil, jamais descendre sous K_ANONYMITY_MIN.
    expect(communityCenterline(faisceau(8, 2, 8), AXE_OFFICIEL, { minUsers: 2 })).toBeNull();
    expect(communityCenterline(faisceau(8, K_ANONYMITY_MIN, 8), AXE_OFFICIEL, { minUsers: 2 })).not.toBeNull();
    expect(communityCenterline(faisceau(12, 6, 8), AXE_OFFICIEL, { minTraces: 20 })).toBeNull();
  });

  it("supporte les géométries dégénérées", () => {
    const traces = faisceau(12, 6, 8);
    const unPoint: LngLat[] = [[GROTELLE.lng, GROTELLE.lat]];
    // Référence inutilisable : le faisceau fournit son propre squelette.
    expect(communityCenterline(traces, unPoint)).not.toBeNull();
    // Référence de longueur nulle : aucune abscisse à échantillonner.
    expect(communityCenterline(traces, [unPoint[0], unPoint[0]])).toBeNull();
    // Traces réduites à un point : rien à recaler.
    const ponctuelles = traces.map((t) => ({ ...t, points: t.points.slice(0, 1) }));
    expect(communityCenterline(ponctuelles, AXE_OFFICIEL)).toBeNull();
  });

  it("le pas d'échantillonnage commande la finesse de la ligne", () => {
    const fin = communityCenterline(faisceau(12, 6, 8), AXE_OFFICIEL, { stepM: 5 });
    const grossier = communityCenterline(faisceau(12, 6, 8), AXE_OFFICIEL, { stepM: 50 });
    expect(fin).not.toBeNull();
    expect(grossier).not.toBeNull();
    if (!fin || !grossier) return;
    expect(fin.coordinates.length).toBeGreaterThan(grossier.coordinates.length * 5);
    // Les deux décrivent le même passage.
    expect(ecartMax(grossier.coordinates, AXE_REEL)).toBeLessThan(3);
  });
});

describe("geometryCandidate (section 17 : géométrie imprécise)", () => {
  /** Sentier officiel est-ouest : la droite du tracé est au sud. */
  const SENTIER = makeSegment("restonica-grotelle", line(GROTELLE, 90, 800), {
    name: "Sentier de Grotelle",
    kind: "path",
    source: "osm",
  });

  it("propose une correction quand cent passages sortent du même côté", () => {
    const traces = faisceau(100, 8, 8, { start: GROTELLE, brg: 90, lengthM: 800 });
    const candidat = geometryCandidate(SENTIER, traces);
    expect(candidat).not.toBeNull();
    if (!candidat) return;
    expect(candidat.segmentId).toBe("restonica-grotelle");
    expect(candidat.observations).toBe(100);
    expect(candidat.uniqueUsers).toBe(8);
    // 8 m à droite du sens de la géométrie : signe positif, valeur retrouvée.
    expect(candidat.offsetM).toBeGreaterThan(6.5);
    expect(candidat.offsetM).toBeLessThan(9.5);
    expect(candidat.maxOffsetM).toBeGreaterThanOrEqual(Math.abs(candidat.offsetM));
    expect(candidat.confidence).toBeGreaterThan(0.7);
    // La candidature décrit bien une ligne décalée par rapport à l'officielle.
    expect(ecartMax(candidat.coordinates, SENTIER.coordinates)).toBeGreaterThan(5);
  });

  it("le signe du décalage suit le sens de la géométrie", () => {
    const aGauche = faisceau(100, 8, -8, { start: GROTELLE, brg: 90, lengthM: 800 });
    const candidat = geometryCandidate(SENTIER, aGauche);
    expect(candidat).not.toBeNull();
    expect(candidat?.offsetM).toBeLessThan(-6.5);

    // Même faisceau, géométrie officielle décrite dans l'autre sens : le même
    // terrain passe alors à droite.
    const inverse = makeSegment("restonica-inverse", [...SENTIER.coordinates].reverse());
    const candidatInverse = geometryCandidate(inverse, aGauche);
    expect(candidatInverse).not.toBeNull();
    expect(candidatInverse?.offsetM).toBeGreaterThan(6.5);
  });

  it("ne propose rien pour un décalage de l'ordre du bruit", () => {
    const presqueDessus = faisceau(100, 8, 2, { start: GROTELLE, brg: 90, lengthM: 800 });
    expect(geometryCandidate(SENTIER, presqueDessus)).toBeNull();
    // Trois garde-fous indépendants, et il en reste toujours un debout quand on
    // n'abaisse que le précédent :
    //  1. l'écart absolu demandé…
    expect(geometryCandidate(SENTIER, presqueDessus, { minOffsetM: 1 })).toBeNull();
    //  2. …l'écart rapporté à la précision annoncée (2 m pour des relevés à 15 m
    //     près, cela reste du bruit)…
    expect(geometryCandidate(SENTIER, presqueDessus, { minOffsetM: 1, noiseAccuracyShare: 0.05 })).toBeNull();
    //  3. …et la dispersion du faisceau : un décalage de 2 m noyé dans 4 m
    //     d'oscillation n'est pas un décalage systématique.
    const centre = communityCenterline(presqueDessus, SENTIER.coordinates);
    expect(centre?.dispersionM).toBeGreaterThan(2 * CANDIDATE_MAX_DISPERSION_RATIO);
    const candidat = geometryCandidate(SENTIER, presqueDessus, {
      minOffsetM: 1,
      noiseAccuracyShare: 0.05,
      maxDispersionRatio: 4,
    });
    expect(candidat?.offsetM).toBeGreaterThan(1);
  });

  it("ne propose rien sur un faisceau trop mince", () => {
    const mince = faisceau(3, 3, 8, { start: GROTELLE, brg: 90, lengthM: 800 });
    const centre = communityCenterline(mince, SENTIER.coordinates);
    // La ligne centrale existe, mais sa confiance ne suffit pas à corriger une carte.
    expect(centre).not.toBeNull();
    expect(centre?.confidence).toBeLessThan(MIN_CANDIDATE_CONFIDENCE);
    expect(geometryCandidate(SENTIER, mince)).toBeNull();
  });

  it("refuse les entrées inexploitables", () => {
    const traces = faisceau(100, 8, 8, { start: GROTELLE, brg: 90, lengthM: 800 });
    const degenere = makeSegment("point", [[GROTELLE.lng, GROTELLE.lat]]);
    expect(geometryCandidate(degenere, traces)).toBeNull();
    expect(geometryCandidate(SENTIER, [])).toBeNull();
    // Faisceau qui longe un autre versant : aucun point ne se recale.
    const ailleurs = faisceau(100, 8, 8, { start: offsetPoint(GROTELLE, 900, 0), brg: 90, lengthM: 800 });
    expect(geometryCandidate(SENTIER, ailleurs)).toBeNull();
  });
});

describe("detectPotentialTrails (sections 19 et 20 : nouveaux chemins)", () => {
  /** 10 passages, 6 personnes, étalés sur 40 jours : un raccourci installé. */
  function raccourciDeBavella(): OffNetworkRun[] {
    const runs: OffNetworkRun[] = [];
    for (let i = 0; i < 10; i++) {
      runs.push(
        offRun(`marcheur-${i % 6}`, MAINTENANT - (40 - i * 4) * JOUR, ondule(0, 5, i), {
          activity: i < 7 ? "hiking" : "trail",
          speedMs: i < 7 ? MARCHE_MS : TRAIL_MS,
        }),
      );
    }
    return runs;
  }

  it("reconnaît un corridor collectif et durable", () => {
    const trails = detectPotentialTrails(raccourciDeBavella(), {}, MAINTENANT);
    expect(trails).toHaveLength(1);
    const trail = trails[0];
    expect(trail.observations).toBe(10);
    expect(trail.uniqueUsers).toBe(6);
    expect(trail.lengthM).toBeGreaterThan(270);
    expect(trail.lengthM).toBeLessThan(370);
    expect(trail.dispersionM).toBeLessThan(15);
    expect(trail.activityMix.hiking).toBeCloseTo(0.7, 2);
    expect(trail.activityMix.trail).toBeCloseTo(0.3, 2);
    expect(trail.confidence).toBeGreaterThan(0.3);
    expect(trail.lastSeenAt - trail.firstSeenAt).toBe(36 * JOUR);
    // La géométrie reconstruite suit bien le raccourci emprunté.
    expect(ecartMax(trail.coordinates, line(BAVELLA, 200, 320))).toBeLessThan(8);
  });

  it("produit un identifiant stable quel que soit l'ordre des portions", () => {
    const runs = raccourciDeBavella();
    const premier = detectPotentialTrails(runs, {}, MAINTENANT)[0];
    const melange = detectPotentialTrails([...runs].reverse(), {}, MAINTENANT)[0];
    expect(melange.id).toBe(premier.id);
    expect(melange.lengthM).toBe(premier.lengthM);
    expect(premier.id.startsWith("trail-")).toBe(true);
  });

  it("une seule personne qui se perd ne crée jamais un chemin", () => {
    const solo = raccourciDeBavella().map((r) => ({ ...r, userKey: "marcheur-unique" }));
    expect(detectPotentialTrails(solo, {}, MAINTENANT)).toEqual([]);
    // Six personnes, mais toutes le même jour : c'est une sortie de groupe.
    const memeJour = raccourciDeBavella().map((r) => ({ ...r, at: MAINTENANT - JOUR }));
    expect(detectPotentialTrails(memeJour, {}, MAINTENANT)).toEqual([]);
  });

  it("écarte les portions trop courtes et les groupes trop petits", () => {
    const runs = raccourciDeBavella();
    expect(detectPotentialTrails(runs.slice(0, 7), {}, MAINTENANT)).toEqual([]);
    const courts = runs.map((r, i) => offRun(`marcheur-${i % 6}`, r.at, ondule(0, 3, i), { lengthM: 80 }));
    expect(detectPotentialTrails(courts, {}, MAINTENANT)).toEqual([]);
    expect(detectPotentialTrails(courts, { minLengthM: 50 }, MAINTENANT)).toHaveLength(1);
  });

  it("ne fusionne pas deux corridors voisins mais distincts", () => {
    const autreDepart = offsetPoint(BAVELLA, 600, 90);
    const secondCorridor: OffNetworkRun[] = [];
    for (let i = 0; i < 9; i++) {
      secondCorridor.push(
        offRun(`vttiste-${i % 5}`, MAINTENANT - (30 - i * 3) * JOUR, ondule(0, 4, i), {
          start: autreDepart,
          brg: 160,
          lengthM: 400,
          activity: "mtb",
          speedMs: VTT_MS,
        }),
      );
    }
    const trails = detectPotentialTrails([...raccourciDeBavella(), ...secondCorridor], {}, MAINTENANT);
    expect(trails).toHaveLength(2);
    expect(new Set(trails.map((t) => t.id)).size).toBe(2);
    expect(trails.some((t) => t.activityMix.mtb === 1)).toBe(true);
  });

  it("supporte les entrées vides ou inexploitables", () => {
    expect(detectPotentialTrails([], {}, MAINTENANT)).toEqual([]);
    const ponctuels = raccourciDeBavella().map((r) => ({ ...r, points: r.points.slice(0, 1) }));
    expect(detectPotentialTrails(ponctuels, {}, MAINTENANT)).toEqual([]);
    // Un corridor ancien reste détecté, mais avec une confiance moindre.
    const vieux = detectPotentialTrails(raccourciDeBavella(), {}, MAINTENANT + 3 * 365 * JOUR);
    const recent = detectPotentialTrails(raccourciDeBavella(), {}, MAINTENANT);
    expect(vieux[0].confidence).toBeLessThan(recent[0].confidence);
  });
});

describe("detectVariants (section 21 : variantes)", () => {
  const COL = "col-bavella";
  const PALIRI = "refuge-paliri";
  const GR20 = ["gr20-1", "gr20-2", "gr20-3"];
  const BOMBE = ["bombe-1", "bombe-2"];

  function passage(
    segmentIds: readonly string[],
    i: number,
    o: { users?: number; distanceM?: number; speedMs?: number; inverse?: boolean } = {},
  ): PathObservation {
    const distanceM = o.distanceM ?? 3200;
    const speedMs = o.speedMs ?? MARCHE_MS;
    const ids = o.inverse ? [...segmentIds].reverse() : [...segmentIds];
    return {
      fromNode: o.inverse ? PALIRI : COL,
      toNode: o.inverse ? COL : PALIRI,
      segmentIds: ids,
      distanceM,
      // Durée théorique à la vitesse de référence, plus une variation de cadence.
      durationMs: Math.round((distanceM / speedMs) * 1000) + (i % 5) * 60_000,
      userKey: `rando-${i % (o.users ?? 12)}`,
      at: MAINTENANT - i * JOUR,
    };
  }

  /** 24 passages par le GR 20 (dont 8 en sens inverse), 8 par le Trou de la Bombe, 3 hors sentier. */
  function observations(): PathObservation[] {
    const out: PathObservation[] = [];
    for (let i = 0; i < 24; i++) out.push(passage(GR20, i, { inverse: i % 3 === 0 }));
    for (let i = 0; i < 8; i++) out.push(passage(BOMBE, i, { users: 6, distanceM: 3900 }));
    for (let i = 0; i < 3; i++) out.push(passage(["hors-sentier-1"], i, { users: 2, distanceM: 2900 }));
    return out;
  }

  it("classe les variantes par part d'usage", () => {
    const variantes = detectVariants(observations());
    expect(variantes).toHaveLength(2);
    const [principale, alternative] = variantes;
    // 35 passages en tout : 24 par le GR 20, 8 par la Bombe, 3 confidentiels.
    expect(principale.segmentIds).toEqual(GR20);
    expect(principale.passages).toBe(24);
    expect(principale.share).toBeCloseTo(24 / 35, 3);
    expect(alternative.segmentIds).toEqual(BOMBE);
    expect(alternative.passages).toBe(8);
    expect(alternative.share).toBeCloseTo(8 / 35, 3);
    expect(principale.share).toBeGreaterThan(alternative.share);
    // La part se calcule sur tous les passages, y compris ceux non publiés.
    expect(principale.share + alternative.share).toBeLessThan(1);
  });

  it("le couple inverse décrit le même itinéraire", () => {
    const variantes = detectVariants(observations());
    const principale = variantes[0];
    // Les 8 passages descendants sont comptés avec les 16 montants…
    expect(principale.passages).toBe(24);
    // … sous le couple de nœuds normalisé et la suite de segments canonique.
    expect(principale.fromNode).toBe(COL);
    expect(principale.toNode).toBe(PALIRI);
    expect(principale.segmentIds).toEqual(GR20);
    expect(principale.uniqueUsers).toBe(12);
  });

  it("restitue distance et durée médianes plausibles", () => {
    const [principale, alternative] = detectVariants(observations());
    expect(principale.distanceM).toBe(3200);
    expect(alternative.distanceM).toBe(3900);
    // 3,2 km à 4 km/h = 2 h 52 min, plus la variation de cadence (≤ 4 min).
    expect(principale.medianDurationMs).toBeGreaterThanOrEqual(2_880_000);
    expect(principale.medianDurationMs).toBeLessThan(2_880_000 + 300_000);
    // La variante est plus longue : elle prend plus de temps.
    expect(alternative.medianDurationMs).toBeGreaterThan(principale.medianDurationMs ?? 0);
  });

  it("une longue pause ne déplace pas la durée de référence", () => {
    const base: PathObservation[] = [];
    for (let i = 0; i < 5; i++) base.push(passage(GR20, i, { users: 5 }));
    const sansPause = detectVariants(base, { minPassages: 5, minUsers: 5 })[0];
    const avecPause = detectVariants(
      [...base, { ...passage(GR20, 5, { users: 5 }), userKey: "rando-5", durationMs: 2_880_000 + 3 * 3_600_000 }],
      { minPassages: 5, minUsers: 5 },
    )[0];
    expect(avecPause.passages).toBe(6);
    expect(avecPause.medianDurationMs).not.toBeNull();
    // La moyenne aurait bondi de plus de 30 minutes ; la médiane bouge à peine.
    expect(Math.abs((avecPause.medianDurationMs ?? 0) - (sansPause.medianDurationMs ?? 0))).toBeLessThan(120_000);
  });

  it("applique les seuils de publication", () => {
    const obs = observations();
    // La variante confidentielle (3 passages, 2 personnes) reste invisible…
    expect(detectVariants(obs).some((v) => v.segmentIds.includes("hors-sentier-1"))).toBe(false);
    // … et elle le reste : le seuil d'utilisateurs distincts ne se débranche
    // pas par un réglage, seuls les autres seuils sont assouplissables.
    const permissif = detectVariants(obs, { minPassages: 2, minUsers: 2, minShare: 0 });
    expect(permissif).toHaveLength(2);
    expect(permissif.some((v) => v.segmentIds.includes("hors-sentier-1"))).toBe(false);
    for (const variante of permissif) expect(variante.uniqueUsers).toBeGreaterThanOrEqual(K_ANONYMITY_MIN);
    // Un itinéraire marginal en part d'usage est écarté par `minShare`.
    const marginal: PathObservation[] = [];
    for (let i = 0; i < 200; i++) marginal.push(passage(GR20, i));
    for (let i = 0; i < 6; i++) marginal.push(passage(BOMBE, i, { users: 6 }));
    const filtrees = detectVariants(marginal);
    expect(filtrees).toHaveLength(1);
    expect(detectVariants(marginal, { minShare: 0.02 })).toHaveLength(2);
  });

  it("supporte les entrées vides ou malformées", () => {
    expect(detectVariants([])).toEqual([]);
    const vides: PathObservation[] = [
      { fromNode: COL, toNode: PALIRI, segmentIds: [], distanceM: 1000, durationMs: 900_000, userKey: "a", at: MAINTENANT },
      { fromNode: "", toNode: PALIRI, segmentIds: GR20, distanceM: 1000, durationMs: 900_000, userKey: "b", at: MAINTENANT },
    ];
    expect(detectVariants(vides, { minPassages: 1, minUsers: 1 })).toEqual([]);
    // Distances et durées aberrantes : la variante reste publiée, sans mesure inventée.
    const aberrantes: PathObservation[] = [];
    for (let i = 0; i < 5; i++) {
      aberrantes.push({ ...passage(GR20, i, { users: 5 }), distanceM: Number.NaN, durationMs: -1 });
    }
    const variante = detectVariants(aberrantes, { minPassages: 5, minUsers: 5 })[0];
    expect(variante.medianDurationMs).toBeNull();
    expect(variante.distanceM).toBe(0);
  });
});
