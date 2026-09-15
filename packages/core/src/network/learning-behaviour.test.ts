/**
 * Tests de l'apprentissage des comportements collectifs (sections 27, 28, 29).
 *
 * Terrain corse : la montée des bergeries de Grotelle vers le lac de Melo
 * (Restonica), une portion de GR 20 et l'embranchement des aiguilles de
 * Bavella. Les géométries sont construites avec `offsetPoint` — aucune
 * coordonnée n'est inventée à la main — et les vitesses sont celles du cahier
 * des charges : marche 4 km/h, trail 8 km/h, VTT 12 km/h.
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint, polylineLengthM, type LngLat } from "../geo";
import { makeSegment } from "../navigation/graph";
import type { PathSegment } from "../navigation/types";
import type { LatLng } from "../types";
import { K_ANONYMITY_MIN, type MatchedPoint, type SegmentTraversal, type TraversalDirection } from "./types";
import {
  DEFAULT_SLOW_ZONE_OPTIONS,
  SPEED_SAMPLE_MAX_SPEED_MS,
  detectConfusionPoints,
  detectSlowZones,
  detectTurnarounds,
  speedSamples,
} from "./learning-behaviour";
import type { SessionPath } from "./types";

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute Restonica. */
const GROTELLE: LatLng = { lat: 42.2718, lng: 9.0731 };
/** Col de Bavella. */
const BAVELLA: LatLng = { lat: 41.7986, lng: 9.2247 };

/** Ligne droite de `lengthM` mètres depuis `start` au cap `brg`, un point tous les `stepM`. */
function line(start: LatLng, brg: number, lengthM: number, stepM = 50): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    const p = offsetPoint(start, Math.min(d, lengthM), brg);
    out.push([p.lng, p.lat]);
  }
  return out;
}

const KMH = (speedMs: number): number => speedMs * 3.6;
const MS = (kmh: number): number => kmh / 3.6;

const WALK = MS(4);
const TRAIL = MS(8);
const MTB = MS(12);

/* ------------------------------------------------------------------ */
/* Constructeurs de traces et de sessions                              */
/* ------------------------------------------------------------------ */

interface WalkSpec {
  segmentId: string;
  origin: LatLng;
  brg: number;
  fromAlong?: number;
  toAlong: number;
  /** Vitesse (m/s) au point d'abscisse donné : c'est là qu'on place les ralentissements. */
  speedAt: (along: number) => number;
  stepMs: number;
  startAt: number;
}

/** Trace rattachée d'une personne qui remonte un segment à la vitesse voulue. */
function marche(spec: WalkSpec): MatchedPoint[] {
  const out: MatchedPoint[] = [];
  let along = spec.fromAlong ?? 0;
  let at = spec.startAt;
  let index = 0;
  while (along <= spec.toAlong && index < 5000) {
    const p = offsetPoint(spec.origin, along, spec.brg);
    out.push({
      index,
      at,
      segmentId: spec.segmentId,
      lat: p.lat,
      lng: p.lng,
      along,
      confidence: 0.9,
      deviationM: 3,
      alt: null,
      accuracy: 8,
    });
    along += spec.speedAt(along) * (spec.stepMs / 1000);
    at += spec.stepMs;
    index++;
  }
  return out;
}

/** Point rattaché isolé (cas limites). */
function point(segmentId: string | null, along: number, at: number, index = 0): MatchedPoint {
  return { index, at, segmentId, lat: GROTELLE.lat, lng: GROTELLE.lng, along, confidence: 0.8, deviationM: 4, alt: null, accuracy: 10 };
}

/** Passage sur un segment, cohérent en durée, distance et vitesse. */
function passage(
  segmentId: string,
  direction: TraversalDirection,
  enteredAt: number,
  coverage: number,
  lengthM: number,
  speedMs: number,
): SegmentTraversal {
  const distanceM = coverage * lengthM;
  const durationMs = Math.round((distanceM / speedMs) * 1000);
  return {
    segmentId,
    direction,
    enteredAt,
    exitedAt: enteredAt + durationMs,
    durationMs,
    coverage,
    distanceM,
    averageSpeedMs: speedMs,
    points: Math.max(2, Math.round(durationMs / 10_000)),
    confidence: 0.85,
  };
}

const JULY = new Date(2025, 6, 12, 8, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;

/* ------------------------------------------------------------------ */
/* 1. Vitesses échantillonnées (section 27)                            */
/* ------------------------------------------------------------------ */

describe("speedSamples", () => {
  const trace = marche({
    segmentId: "melo",
    origin: GROTELLE,
    brg: 160,
    toAlong: 300,
    speedAt: () => WALK,
    stepMs: 12_000,
    startAt: JULY,
  });

  it("mesure la vitesse le long du chemin, au milieu de chaque couple", () => {
    const samples = speedSamples(trace, { activity: "hiking", userKey: "u1" });
    expect(samples.length).toBe(trace.length - 1);
    for (const s of samples) {
      expect(KMH(s.speedMs)).toBeCloseTo(4, 3);
      expect(s.activity).toBe("hiking");
      expect(s.userKey).toBe("u1");
      expect(s.segmentId).toBe("melo");
    }
    // Abscisse médiane du couple : milieu du déplacement, pas une de ses bornes.
    expect(samples[0].along).toBeCloseTo((trace[0].along + trace[1].along) / 2, 2);
    expect(samples[0].at).toBe(JULY + 6000);
    // Abscisses strictement croissantes le long de la montée.
    expect(samples.every((s, i) => i === 0 || s.along > samples[i - 1].along)).toBe(true);
  });

  it("ignore les points non rattachés et les couples à cheval sur deux segments", () => {
    const melo = point("melo", 100, JULY);
    const perdu = point(null, 0, JULY + 20_000, 1);
    const retour = point("melo", 140, JULY + 40_000, 2);
    const autre = point("gr20", 0, JULY + 60_000, 3);
    const samples = speedSamples([melo, perdu, retour, autre], { activity: "hiking", userKey: "u1" });
    expect(samples.length).toBe(0);
  });

  it("écarte le bruit : une base de mesure trop courte en temps", () => {
    const trop_rapproches = speedSamples([point("melo", 0, JULY), point("melo", 40, JULY + 1500, 1)], {
      activity: "trail",
      userKey: "u1",
    });
    expect(trop_rapproches.length).toBe(0);
  });

  it("mesure l'immobilité au lieu de la jeter", () => {
    // Une minute sur place : 2 m d'oscillation d'abscisse. L'ancienne règle
    // « moins de 3 m parcourus = rebut » écartait précisément les échantillons
    // LENTS — ceux que la détection des ralentissements cherche. Une base de
    // mesure assez longue donne ici la bonne réponse : cette personne est
    // arrêtée.
    const immobile = speedSamples([point("melo", 500, JULY), point("melo", 502, JULY + 60_000, 1)], {
      activity: "hiking",
      userKey: "u1",
    });
    expect(immobile).toHaveLength(1);
    expect(immobile[0].speedMs).toBeLessThan(0.1);

    // Et une marche lente échantillonnée finement n'est plus perdue : la
    // fenêtre s'allonge jusqu'à une distance mesurable.
    const lent: MatchedPoint[] = [];
    for (let i = 0; i <= 20; i++) lent.push(point("melo", 100 + i * 2, JULY + i * 6000, i));
    const echantillons = speedSamples(lent, { activity: "hiking", userKey: "u2" });
    expect(echantillons.length).toBeGreaterThan(3);
    for (const e of echantillons) {
      expect(e.speedMs).toBeGreaterThan(0.25);
      expect(e.speedMs).toBeLessThan(0.45);
    }
  });

  it("écarte les vitesses aberrantes et les cas limites", () => {
    const teleporte = speedSamples([point("melo", 0, JULY), point("melo", 800, JULY + 3000, 1)], {
      activity: "hiking",
      userKey: "u1",
    });
    expect(teleporte.length).toBe(0);
    expect(800 / 3).toBeGreaterThan(SPEED_SAMPLE_MAX_SPEED_MS);

    expect(speedSamples([], { activity: "hiking", userKey: "u1" })).toEqual([]);
    expect(speedSamples([point("melo", 0, JULY)], { activity: "hiking", userKey: "u1" })).toEqual([]);
    // Points à rebours du temps : écartés par le seuil de durée.
    expect(speedSamples([point("melo", 100, JULY + 60_000), point("melo", 0, JULY, 1)], { activity: "hiking", userKey: "u1" })).toEqual([]);
  });

  it("mesure une descente (abscisse décroissante) comme une vitesse positive", () => {
    const samples = speedSamples([point("melo", 300, JULY), point("melo", 200, JULY + 50_000, 1)], {
      activity: "trail",
      userKey: "u1",
    });
    expect(samples.length).toBe(1);
    expect(samples[0].speedMs).toBeCloseTo(2, 3);
    expect(samples[0].along).toBe(250);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Ralentissements systématiques (section 27)                       */
/* ------------------------------------------------------------------ */

/** Six randonneurs montent vers le lac de Melo, avec le passage rocheux demandé. */
function monteeMelo(ralenti: boolean, users = 6): MatchedPoint[][] {
  const facteurs = [0.92, 0.96, 1, 1.04, 1.08, 1.12, 0.94, 1.06];
  const traces: MatchedPoint[][] = [];
  for (let u = 0; u < users; u++) {
    const facteur = facteurs[u % facteurs.length];
    traces.push(
      marche({
        segmentId: "melo",
        origin: GROTELLE,
        brg: 160,
        toAlong: 900,
        // 4,2 km/h avant et après, 1,4 km/h sur les 50 m du passage rocheux.
        speedAt: (along) => (ralenti && along >= 300 && along < 350 ? MS(1.4) : MS(4.2)) * facteur,
        stepMs: 12_000,
        startAt: JULY + u * HOUR,
      }),
    );
  }
  return traces;
}

function samplesOf(traces: MatchedPoint[][], activity: "hiking" | "trail" | "mtb" = "hiking", prefix = "u") {
  return traces.flatMap((t, i) => speedSamples(t, { activity, userKey: `${prefix}${i}` }));
}

describe("detectSlowZones", () => {
  it("détecte le passage rocheux du cahier des charges (4,2 km/h → 1,4 km/h sur 50 m)", () => {
    const zones = detectSlowZones(samplesOf(monteeMelo(true)));
    expect(zones.length).toBe(1);
    const zone = zones[0];
    expect(zone.segmentId).toBe("melo");
    expect(zone.fromAlong).toBe(300);
    expect(zone.toAlong).toBe(350);
    expect(KMH(zone.speedMs)).toBeCloseTo(1.4, 0);
    expect(KMH(zone.referenceSpeedMs)).toBeCloseTo(4.2, 0);
    expect(zone.ratio).toBeLessThan(0.5);
    expect(zone.ratio).toBeGreaterThan(0.2);
    expect(zone.uniqueUsers).toBe(6);
    expect(zone.observations).toBeGreaterThanOrEqual(DEFAULT_SLOW_ZONE_OPTIONS.minObservations);
    expect(zone.confidence).toBeGreaterThan(0.4);
    expect(zone.confidence).toBeLessThanOrEqual(1);
  });

  it("ne signale rien sur une montée régulière", () => {
    expect(detectSlowZones(samplesOf(monteeMelo(false)))).toEqual([]);
    expect(detectSlowZones([])).toEqual([]);
  });

  it("ne publie rien sous le seuil d'anonymat, même si l'appelant l'exige", () => {
    const deuxPersonnes = samplesOf(monteeMelo(true, 2));
    expect(detectSlowZones(deuxPersonnes)).toEqual([]);
    expect(detectSlowZones(deuxPersonnes, { minUsers: 1, minObservations: 1 })).toEqual([]);
    expect(K_ANONYMITY_MIN).toBe(3);
  });

  it("exige une zone assez longue : 25 m de ralentissement ne suffisent pas", () => {
    const traces: MatchedPoint[][] = [];
    for (let u = 0; u < 6; u++) {
      traces.push(
        marche({
          segmentId: "melo",
          origin: GROTELLE,
          brg: 160,
          toAlong: 600,
          speedAt: (along) => (along >= 300 && along < 325 ? MS(1.2) : MS(4.2)),
          stepMs: 12_000,
          startAt: JULY + u * HOUR,
        }),
      );
    }
    const samples = samplesOf(traces);
    expect(detectSlowZones(samples)).toEqual([]);
    const tolerant = detectSlowZones(samples, { minLengthM: 20 });
    expect(tolerant.length).toBe(1);
    expect(tolerant[0].fromAlong).toBe(300);
    expect(tolerant[0].toAlong).toBe(325);
  });

  it("ne confond pas un changement d'activité avec un ralentissement", () => {
    // Piste de Bavella : les vététistes (12 km/h) la font en entier, les
    // randonneurs (4 km/h) ne rejoignent qu'à mi-parcours. Tous ralentissent au
    // tiers de leur allure sur le ressaut rocheux de 500 à 575 m.
    const lent = (base: number) => (along: number) => (along >= 500 && along < 575 ? base / 3 : base);
    const vtt: MatchedPoint[][] = [];
    for (let u = 0; u < 5; u++) {
      vtt.push(
        marche({ segmentId: "bavella", origin: BAVELLA, brg: 20, toAlong: 800, speedAt: lent(MTB), stepMs: 6000, startAt: JULY + u * HOUR }),
      );
    }
    const marcheurs: MatchedPoint[][] = [];
    for (let u = 0; u < 5; u++) {
      marcheurs.push(
        marche({
          segmentId: "bavella",
          origin: BAVELLA,
          brg: 20,
          fromAlong: 400,
          toAlong: 800,
          speedAt: lent(WALK),
          stepMs: 12_000,
          startAt: JULY + u * HOUR,
        }),
      );
    }
    const samples = [...samplesOf(vtt, "mtb", "v"), ...samplesOf(marcheurs, "hiking", "m")];

    const zones = detectSlowZones(samples);
    // Une seule zone : le ressaut. L'abscisse 400, où la population change
    // brutalement d'activité, n'en est pas une.
    expect(zones.length).toBe(1);
    expect(zones[0].fromAlong).toBe(500);
    expect(zones[0].toAlong).toBe(575);
    expect(zones[0].ratio).toBeLessThan(0.5);
    expect(zones[0].uniqueUsers).toBe(10);
    // Sans normalisation par activité, la moitié basse (VTT seuls, 12 km/h)
    // ferait passer la moitié haute (randonneurs, 4 km/h) pour un ralentissement.
    expect(zones.some((z) => z.fromAlong < 500)).toBe(false);
  });

  it("ne signale rien quand tout le segment est lent (c'est un temps de parcours, pas une alerte)", () => {
    const traces: MatchedPoint[][] = [];
    for (let u = 0; u < 6; u++) {
      traces.push(
        marche({ segmentId: "gr20", origin: BAVELLA, brg: 340, toAlong: 600, speedAt: () => MS(1.5), stepMs: 12_000, startAt: JULY + u * HOUR }),
      );
    }
    expect(detectSlowZones(samplesOf(traces))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Demi-tours (section 28)                                          */
/* ------------------------------------------------------------------ */

/** Sentier de la haute Restonica, coupé par un torrent aux deux tiers. */
const RESTONICA_COORDS = line(GROTELLE, 160, 900);
const RESTONICA_M = polylineLengthM(RESTONICA_COORDS);
const RESTONICA = makeSegment("restonica", RESTONICA_COORDS, { name: "Sentier du lac de Melo", source: "seed" });
const SEGMENTS: ReadonlyMap<string, PathSegment> = new Map([[RESTONICA.id, RESTONICA]]);

/** `count` sorties qui traversent le segment de bout en bout. */
function traversees(count: number, from = 0): SessionPath[] {
  const out: SessionPath[] = [];
  for (let i = 0; i < count; i++) {
    const at = JULY + (from + i) * HOUR;
    out.push({ userKey: `t${from + i}`, activity: "hiking", at, traversals: [passage("restonica", "forward", at, 1, RESTONICA_M, WALK)] });
  }
  return out;
}

/** `count` sorties qui rebroussent chemin à `coverage` du segment. */
function demiTours(count: number, coverage: number, pauseMs = 2 * MINUTE, userPrefix = "d"): SessionPath[] {
  const out: SessionPath[] = [];
  for (let i = 0; i < count; i++) {
    const at = JULY + i * HOUR;
    const aller = passage("restonica", "forward", at, coverage, RESTONICA_M, WALK);
    const retour = passage("restonica", "backward", aller.exitedAt + pauseMs, coverage, RESTONICA_M, WALK);
    out.push({ userKey: `${userPrefix}${i}`, activity: "hiking", at: retour.exitedAt, traversals: [aller, retour] });
  }
  return out;
}

describe("detectTurnarounds", () => {
  it("signale le torrent en crue : 6 demi-tours sur 32 passages, au même endroit", () => {
    const spots = detectTurnarounds([...traversees(20), ...demiTours(6, 0.6)], SEGMENTS);
    expect(spots.length).toBe(1);
    const spot = spots[0];
    expect(spot.segmentId).toBe("restonica");
    expect(spot.along).toBeCloseTo(0.6 * RESTONICA_M, 0);
    // Le point publié est bien sur le terrain, à 600 m au sud-est des bergeries.
    expect(haversineM(spot, offsetPoint(GROTELLE, 0.6 * RESTONICA_M, 160))).toBeLessThan(5);
    expect(spot.observations).toBe(6);
    expect(spot.uniqueUsers).toBe(6);
    // 6 demi-tours pour 20 + 12 = 32 passages du segment (taux arrondi au millième).
    expect(spot.rate).toBe(0.188);
    expect(spot.confidence).toBeGreaterThan(0.3);
  });

  it("ne signale pas des demi-tours trop rares pour être un obstacle", () => {
    const spots = detectTurnarounds([...traversees(50), ...demiTours(4, 0.6)], SEGMENTS);
    // 4 demi-tours sur 58 passages : 7 %, sous le seuil d'anormalité.
    expect(spots).toEqual([]);
  });

  it("ne confond pas une pause au lac avec un demi-tour d'obstacle", () => {
    const piqueNique = demiTours(6, 0.6, 2 * HOUR);
    expect(detectTurnarounds([...traversees(20), ...piqueNique], SEGMENTS)).toEqual([]);
    // Le même aller-retour, enchaîné sans pause, est bien un demi-tour.
    expect(detectTurnarounds([...traversees(20), ...demiTours(6, 0.6, 30_000)], SEGMENTS).length).toBe(1);
  });

  it("tolère un passage intercalé entre l'aller et le retour", () => {
    // La personne pousse 30 m sur la sente d'en face avant de renoncer.
    const sessions = demiTours(6, 0.6).map((s) => {
      const [aller, retour] = s.traversals;
      const sente = passage("sente", "forward", aller.exitedAt + 10_000, 0.3, 100, WALK);
      return { ...s, traversals: [aller, sente, retour] };
    });
    const spots = detectTurnarounds([...traversees(20), ...sessions], SEGMENTS);
    expect(spots.length).toBe(1);
    expect(spots[0].observations).toBe(6);
  });

  it("ne compte qu'un demi-tour par hésitation (aller, retour, on repart)", () => {
    // Monter aux deux tiers, redescendre un peu, repartir : le point fiable est
    // l'abscisse extrême atteinte, pas chacun des changements de sens.
    const hesitations: SessionPath[] = [];
    for (let i = 0; i < 6; i++) {
      const at = JULY + i * HOUR;
      const aller = passage("restonica", "forward", at, 0.6, RESTONICA_M, WALK);
      const recul = passage("restonica", "backward", aller.exitedAt + MINUTE, 0.4, RESTONICA_M, WALK);
      const reprise = passage("restonica", "forward", recul.exitedAt + MINUTE, 0.4, RESTONICA_M, WALK);
      hesitations.push({ userKey: `h${i}`, activity: "hiking", at: reprise.exitedAt, traversals: [aller, recul, reprise] });
    }
    const spots = detectTurnarounds([...traversees(14), ...hesitations], SEGMENTS);
    expect(spots.length).toBe(1);
    expect(spots[0].observations).toBe(6);
    expect(spots[0].along).toBeCloseTo(0.6 * RESTONICA_M, 0);
  });

  it("ne publie rien sous le seuil d'anonymat, ni sans géométrie connue", () => {
    // Six demi-tours, mais deux personnes seulement (trois sorties chacune).
    const deuxPersonnes = demiTours(6, 0.6).map((s, i) => ({ ...s, userKey: `p${i % 2}` }));
    expect(detectTurnarounds([...traversees(20), ...deuxPersonnes], SEGMENTS)).toEqual([]);
    expect(detectTurnarounds([...traversees(20), ...deuxPersonnes], SEGMENTS, { minUsers: 1, minObservations: 1 })).toEqual([]);
    // Segment absent du réseau fourni : rien à localiser, donc rien à publier.
    expect(detectTurnarounds([...traversees(20), ...demiTours(6, 0.6)], new Map())).toEqual([]);
    expect(detectTurnarounds([], SEGMENTS)).toEqual([]);
  });

  it("sépare deux lieux de demi-tour distincts sur le même segment", () => {
    const bas = demiTours(6, 0.25, 2 * MINUTE, "b");
    const haut = demiTours(6, 0.75, 2 * MINUTE, "h");
    const spots = detectTurnarounds([...bas, ...haut], SEGMENTS, { minRate: 0.1 });
    expect(spots.length).toBe(2);
    expect(spots[0].along).toBeLessThan(spots[1].along);
    expect(spots[0].along).toBeCloseTo(0.25 * RESTONICA_M, 0);
    expect(spots[1].along).toBeCloseTo(0.75 * RESTONICA_M, 0);
    // 6 demi-tours chacun, pour 24 passages du segment au total.
    expect(spots[0].rate).toBeCloseTo(0.25, 3);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Erreurs de navigation (section 29)                               */
/* ------------------------------------------------------------------ */

/** Embranchement de Bavella : l'approche, la bonne branche, et la sente trompeuse. */
const CARREFOUR = offsetPoint(BAVELLA, 500, 90);
const APPROCHE = makeSegment("approche", line(BAVELLA, 90, 500), { name: "GR 20", source: "seed" });
const AIGUILLES = makeSegment("aiguilles", line(CARREFOUR, 45, 600), { name: "Aiguilles de Bavella", source: "seed" });
const SENTE = makeSegment("sente", line(CARREFOUR, 350, 120), { name: "Sente de la bergerie", source: "seed" });
const LONGUE_SENTE = makeSegment("longue-sente", line(CARREFOUR, 350, 400), { source: "seed" });

const APPROCHE_M = polylineLengthM(APPROCHE.coordinates);
const AIGUILLES_M = polylineLengthM(AIGUILLES.coordinates);
const SENTE_M = polylineLengthM(SENTE.coordinates);
const LONGUE_M = polylineLengthM(LONGUE_SENTE.coordinates);

const RESEAU: ReadonlyMap<string, PathSegment> = new Map(
  [APPROCHE, AIGUILLES, SENTE, LONGUE_SENTE].map((s) => [s.id, s] as const),
);

/** Sortie sans erreur : on arrive au carrefour et on prend la bonne branche. */
function sortieDirecte(i: number): SessionPath {
  const at = JULY + i * HOUR;
  const approche = passage("approche", "forward", at, 1, APPROCHE_M, WALK);
  const suite = passage("aiguilles", "forward", approche.exitedAt + 30_000, 1, AIGUILLES_M, WALK);
  return { userKey: `ok${i}`, activity: "hiking", at: suite.exitedAt, traversals: [approche, suite] };
}

/**
 * Sortie avec erreur : on s'engage sur la sente, on revient, on repart par la
 * bonne branche. `spur` permet d'allonger la fausse piste, `speedMs` de ralentir.
 */
function sortieEgaree(i: number, spur: PathSegment = SENTE, spurM: number = SENTE_M, speedMs = WALK): SessionPath {
  const at = JULY + i * HOUR;
  const approche = passage("approche", "forward", at, 1, APPROCHE_M, WALK);
  const erreur = passage(spur.id, "forward", approche.exitedAt + 20_000, 1, spurM, speedMs);
  const retour = passage(spur.id, "backward", erreur.exitedAt + 20_000, 1, spurM, speedMs);
  const suite = passage("aiguilles", "forward", retour.exitedAt + 20_000, 1, AIGUILLES_M, WALK);
  return { userKey: `ko${i}`, activity: "hiking", at: suite.exitedAt, traversals: [approche, erreur, retour, suite] };
}

const DIRECTES = [0, 1, 2, 3, 4, 5, 6].map(sortieDirecte);
const EGAREES = [0, 1, 2, 3, 4].map((i) => sortieEgaree(i));

describe("detectConfusionPoints", () => {
  it("désigne le carrefour de Bavella et la sente qui trompe", () => {
    const points = detectConfusionPoints([...DIRECTES, ...EGAREES], RESEAU);
    expect(points.length).toBe(1);
    const p = points[0];
    expect(haversineM(p, CARREFOUR)).toBeLessThan(2);
    expect(p.wrongSegmentIds).toEqual(["sente"]);
    expect(p.observations).toBe(5);
    expect(p.uniqueUsers).toBe(5);
    // 5 erreurs pour 17 arrivées au carrefour (7 directes, 5 × 2 pour les égarées).
    expect(p.rate).toBeCloseTo(5 / 17, 3);
    expect(p.confidence).toBeGreaterThan(0.3);
  });

  it("ignore les détours trop longs ou trop lents : ce ne sont plus des erreurs", () => {
    const longues = [0, 1, 2, 3, 4].map((i) => sortieEgaree(i, LONGUE_SENTE, LONGUE_M));
    expect(detectConfusionPoints([...DIRECTES, ...longues], RESEAU)).toEqual([]);
    // 800 m aller-retour : c'est une variante assumée, sauf si l'appelant l'assume aussi.
    expect(detectConfusionPoints([...DIRECTES, ...longues], RESEAU, { maxDetourM: 900 }).length).toBe(1);

    // Aller-retour de 240 m, mais en 40 min : la personne a fait autre chose.
    const lentes = [0, 1, 2, 3, 4].map((i) => sortieEgaree(i, SENTE, SENTE_M, MS(0.4)));
    expect(detectConfusionPoints([...DIRECTES, ...lentes], RESEAU)).toEqual([]);
    expect(detectConfusionPoints([...DIRECTES, ...lentes], RESEAU, { maxDetourMs: HOUR }).length).toBe(1);
  });

  it("compte aussi le renoncement : repartir par le chemin d'arrivée", () => {
    const renoncements = EGAREES.map((s) => {
      const [approche, erreur, retour] = s.traversals;
      const demiTour = passage("approche", "backward", retour.exitedAt + 20_000, 1, APPROCHE_M, WALK);
      return { ...s, traversals: [approche, erreur, retour, demiTour] };
    });
    const points = detectConfusionPoints([...DIRECTES, ...renoncements], RESEAU);
    expect(points.length).toBe(1);
    expect(points[0].observations).toBe(5);
    expect(points[0].wrongSegmentIds).toEqual(["sente"]);
  });

  it("n'accuse pas un carrefour sans la séquence complète", () => {
    // Sorties qui s'arrêtent après être revenues : on ne sait pas si elles se
    // sont trompées ou si elles sont simplement rentrées.
    const inachevees = EGAREES.map((s) => ({ ...s, traversals: s.traversals.slice(0, 3) }));
    expect(detectConfusionPoints([...DIRECTES, ...inachevees], RESEAU)).toEqual([]);
    // Cinq erreurs, mais deux personnes seulement.
    const deuxPersonnes = EGAREES.map((s, i) => ({ ...s, userKey: `p${i % 2}` }));
    expect(detectConfusionPoints([...DIRECTES, ...deuxPersonnes], RESEAU)).toEqual([]);
    expect(detectConfusionPoints([...DIRECTES, ...deuxPersonnes], RESEAU, { minUsers: 1, minObservations: 1 })).toEqual([]);
    // Rien du tout, réseau vide, sessions vides.
    expect(detectConfusionPoints(DIRECTES, RESEAU)).toEqual([]);
    expect(detectConfusionPoints([...DIRECTES, ...EGAREES], new Map())).toEqual([]);
    expect(detectConfusionPoints([], RESEAU)).toEqual([]);
  });

  it("classe les mauvaises branches de la plus fréquente à la moins fréquente", () => {
    const autres = [5, 6, 7].map((i) => sortieEgaree(i, LONGUE_SENTE, LONGUE_M));
    const points = detectConfusionPoints([...DIRECTES, ...EGAREES, ...autres], RESEAU, { maxDetourM: 900 });
    expect(points.length).toBe(1);
    expect(points[0].wrongSegmentIds).toEqual(["sente", "longue-sente"]);
    expect(points[0].observations).toBe(8);
    expect(points[0].uniqueUsers).toBe(8);
  });

  it("remet les passages d'une sortie dans l'ordre avant de conclure", () => {
    // Même sortie, passages fournis dans le désordre : le résultat ne change pas.
    const melangees = EGAREES.map((s) => ({ ...s, traversals: [s.traversals[2], s.traversals[0], s.traversals[3], s.traversals[1]] }));
    const points = detectConfusionPoints([...DIRECTES, ...melangees], RESEAU);
    expect(points.length).toBe(1);
    expect(points[0].observations).toBe(5);
  });
});
