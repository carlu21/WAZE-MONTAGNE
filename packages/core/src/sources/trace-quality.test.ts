/**
 * Tests du contrôle qualité des traces importées (sections 9 et 24).
 *
 * Toutes les traces sont fabriquées ici, par des helpers locaux, et
 * manifestement fictives (« Sentier de démonstration », coordonnées choisies
 * arbitrairement) : aucun test ne prétend décrire une trace réelle ni une
 * plateforme existante.
 *
 * Deux exigences guident ces cas : une trace « propre » (régulière, sans
 * altitude ni horodatage) ne doit jamais être récompensée comme une
 * observation du terrain, et une trace sans horodatage ne doit jamais être
 * soupçonnée de vitesse implausible.
 */
import { describe, expect, it } from "vitest";
import { METERS_PER_DEG_LAT, type LngLat } from "../geo";
import { DAY_MS } from "../time";
import { MIN_USABLE_QUALITY_SCORE, type GpxQualityReport, type NormalizedTrace } from "./types";
import {
  GPX_BLOCKING_FLAGS,
  GPX_DUPLICATE_FLAG_RATIO,
  GPX_EARLIEST_PLAUSIBLE_TIME,
  GPX_FLAG_ORDER,
  GPX_FLAG_REASONS,
  GPX_FUTURE_TOLERANCE_MS,
  GPX_HAND_DRAWN_SPACING_M,
  GPX_INFORMATIVE_FLAGS,
  GPX_MIN_POINTS,
  GPX_MIN_TRACE_LENGTH_M,
  GPX_QUALITY_CRITERIA,
  GPX_NO_DEFECT_LABEL,
  GPX_NO_GEOMETRY_SCORE,
  GPX_QUALITY_LEVEL_LABELS,
  GPX_QUALITY_WEIGHTS,
  GPX_QUALITY_SCORE_CAPS,
  GPX_QUALITY_THRESHOLDS,
  GPX_SPARSE_SPACING_M,
  GPX_STALE_DAYS,
  GPX_THOUSANDS_SEPARATOR,
  GPX_UNDATED_SUMMARY,
  GPX_UNUSABLE_NOTICE,
  compareQuality,
  describeGpxQuality,
  gpxQuality,
  gpxQualityLevel,
} from "./trace-quality";

/* ------------------------------------------------------------------ */
/* Jeux de données locaux (tous fictifs)                               */
/* ------------------------------------------------------------------ */

/** 15 septembre 2026, midi UTC : instant de référence de tous les tests. */
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

const START_LAT = 42.1;
const START_LNG = 9.05;

/**
 * Ligne plein nord : l'espacement curviligne demandé est respecté à 0,2 % près
 * (la constante `METERS_PER_DEG_LAT` et le rayon terrestre du haversine ne
 * coïncident pas exactement), ce qui suffit largement à tous les seuils testés.
 */
function lineNorth(count: number, spacingAt: (i: number) => number): LngLat[] {
  const out: LngLat[] = [];
  let lat = START_LAT;
  for (let i = 0; i < count; i++) {
    if (i > 0) lat += spacingAt(i) / METERS_PER_DEG_LAT;
    out.push([START_LNG, lat]);
  }
  return out;
}

/** Espacement mécanique : le pas d'un itinéraire dessiné sur une carte. */
const uniform =
  (m: number) =>
  (): number =>
    m;

/** Suite de facteurs fixe : irrégulière comme un relevé, mais déterministe. */
const IRREGULAR_FACTORS = [0.4, 1, 1.8, 0.6, 2.4, 0.9, 1.3, 0.5];
const irregular =
  (m: number) =>
  (i: number): number =>
    m * IRREGULAR_FACTORS[i % IRREGULAR_FACTORS.length];

/** Profil altimétrique croissant, plausible en montagne. */
const risingElevations = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => 1000 + i * 3);

/** Horodatages réguliers à partir d'une date donnée. */
const timesEvery = (count: number, startAt: number, stepMs: number): number[] =>
  Array.from({ length: count }, (_, i) => startAt + i * stepMs);

/** Trace normalisée de démonstration : tout est surchargeable. */
function makeTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  const coordinates = overrides.coordinates ?? [];
  return {
    coordinates,
    elevations: null,
    times: null,
    lengthM: 0,
    elevationGainM: null,
    elevationLossM: null,
    bbox: { west: START_LNG, south: START_LAT, east: START_LNG, north: START_LAT + 0.1 },
    removed: {},
    segments: 1,
    breaks: [],
    ...overrides,
  };
}

/**
 * Trace de référence « excellente » : 400 points, espacement irrégulier autour
 * de 8 m, altitude et horodatage présents, sortie de l'été 2025.
 */
const SUMMER_2025 = Date.UTC(2025, 6, 12, 6, 0, 0);
function excellentTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  const count = 400;
  return makeTrace({
    coordinates: lineNorth(count, irregular(8)),
    elevations: risingElevations(count),
    times: timesEvery(count, SUMMER_2025, 10_000),
    ...overrides,
  });
}

/** Itinéraire dessiné sur une carte : régulier, nu, sans rien du terrain. */
function handDrawnTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  return makeTrace({ coordinates: lineNorth(60, uniform(40)), ...overrides });
}

/** Rapport fabriqué de toutes pièces, pour éprouver le comparateur seul. */
function makeReport(overrides: Partial<GpxQualityReport> = {}): GpxQualityReport {
  return {
    score: 70,
    level: "good",
    points: 100,
    medianSpacingM: 10,
    maxGapM: 12,
    hasElevation: true,
    hasTime: true,
    ageDays: 100,
    flags: [],
    usable: true,
    summary: "Sentier de démonstration",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Chemin nominal                                                   */
/* ------------------------------------------------------------------ */

describe("gpxQuality — trace dense, datée et altimétrée", () => {
  it("atteint le niveau excellent et reste exploitable", () => {
    const report = gpxQuality(excellentTrace(), undefined, NOW);
    expect(report.level).toBe("excellent");
    expect(report.usable).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("ne relève aucun défaut sur une trace saine", () => {
    const report = gpxQuality(excellentTrace(), undefined, NOW);
    expect(report.flags).toEqual([]);
  });

  it("restitue les mesures brutes attendues", () => {
    const report = gpxQuality(excellentTrace(), undefined, NOW);
    expect(report.points).toBe(400);
    expect(report.hasElevation).toBe(true);
    expect(report.hasTime).toBe(true);
    expect(report.medianSpacingM).toBeGreaterThan(5);
    expect(report.medianSpacingM).toBeLessThan(12);
    expect(report.ageDays).toBeGreaterThan(400);
  });

  it("produit un résumé français prêt à afficher", () => {
    const count = 1240;
    const trace = makeTrace({
      coordinates: lineNorth(count, irregular(8)),
      elevations: risingElevations(count),
      times: timesEvery(count, Date.UTC(2019, 5, 8, 7, 0, 0), 10_000),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.summary).toBe(
      `1${GPX_THOUSANDS_SEPARATOR}240 points, espacement médian 8 m, altitude présente, trace de 2019`,
    );
  });

  it("monte le score quand les autres sources corroborent la trace", () => {
    const trace = excellentTrace();
    const seule = gpxQuality(trace, undefined, NOW);
    const corroborée = gpxQuality(
      trace,
      { source: { reliabilityScore: 90 }, matchedRatio: 0.95, corridorAgreement: 0.9 },
      NOW,
    );
    expect(corroborée.score).toBeGreaterThan(seule.score);
  });

  it("ne punit pas une trace qui ne correspond à aucun chemin connu", () => {
    // Section 13 : un chemin absent de la carte est la matière même de la
    // collecte, pas une faute de la trace.
    const trace = excellentTrace();
    const sansContexte = gpxQuality(trace, undefined, NOW);
    const sansRattachement = gpxQuality(trace, { matchedRatio: 0, corridorAgreement: 0 }, NOW);
    expect(sansRattachement.score).toBe(sansContexte.score);
  });

  it("tient compte de la fiabilité constatée de la source", () => {
    const trace = excellentTrace();
    const fiable = gpxQuality(trace, { source: { reliabilityScore: 95 } }, NOW);
    const douteuse = gpxQuality(trace, { source: { reliabilityScore: 5 } }, NOW);
    expect(fiable.score).toBeGreaterThan(douteuse.score);
  });

  it("ignore un contexte vide ou aux champs nuls sans rien casser", () => {
    const trace = excellentTrace();
    const référence = gpxQuality(trace, undefined, NOW);
    expect(gpxQuality(trace, {}, NOW).score).toBe(référence.score);
    expect(gpxQuality(trace, { source: null, matchedRatio: null, corridorAgreement: null }, NOW).score).toBe(
      référence.score,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 2. Tracé à la main                                                  */
/* ------------------------------------------------------------------ */

describe("gpxQuality — reconnaître un tracé dessiné à la main", () => {
  it("signale un espacement mécanique sans altitude ni horodatage", () => {
    const report = gpxQuality(handDrawnTrace(), undefined, NOW);
    expect(report.flags).toContain("hand_drawn");
  });

  it("empêche une trace propre mais non observée d'atteindre le niveau excellent", () => {
    // Corroborée de partout, elle reste plafonnée : la propreté n'est pas une
    // observation du terrain.
    const report = gpxQuality(
      handDrawnTrace(),
      { source: { reliabilityScore: 100 }, matchedRatio: 1, corridorAgreement: 1 },
      NOW,
    );
    expect(report.level).not.toBe("excellent");
    expect(report.score).toBeLessThanOrEqual(GPX_QUALITY_SCORE_CAPS.hand_drawn ?? 100);
  });

  it("le dit dans le résumé affiché au modérateur", () => {
    const report = gpxQuality(handDrawnTrace(), undefined, NOW);
    expect(report.summary).toContain("dessiné à la main");
  });

  it("signale aussi un tracé bien trop lâche pour être un relevé", () => {
    const trace = makeTrace({ coordinates: lineNorth(20, irregular(GPX_HAND_DRAWN_SPACING_M * 4)) });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).toContain("hand_drawn");
  });

  it("ne confond pas un relevé dépouillé de ses métadonnées avec un dessin", () => {
    // Beaucoup de plateformes publient des GPX sans temps ni altitude :
    // l'espacement irrégulier suffit à reconnaître un vrai relevé.
    const trace = makeTrace({ coordinates: lineNorth(400, irregular(8)) });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).not.toContain("hand_drawn");
    expect(report.flags).toContain("no_elevation");
    expect(report.flags).toContain("no_time");
  });

  it("ne signale pas un relevé régulier qui porte une altitude", () => {
    const count = 60;
    const trace = makeTrace({ coordinates: lineNorth(count, uniform(10)), elevations: risingElevations(count) });
    expect(gpxQuality(trace, undefined, NOW).flags).not.toContain("hand_drawn");
  });

  it("ne signale pas un relevé régulier qui porte un horodatage", () => {
    const count = 60;
    const trace = makeTrace({
      coordinates: lineNorth(count, uniform(10)),
      times: timesEvery(count, SUMMER_2025, 10_000),
    });
    expect(gpxQuality(trace, undefined, NOW).flags).not.toContain("hand_drawn");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Vitesse implausible                                              */
/* ------------------------------------------------------------------ */

describe("gpxQuality — vitesse implausible", () => {
  it("écarte une trace dont les horodatages imposent une vitesse impossible", () => {
    const count = 200;
    const trace = makeTrace({
      coordinates: lineNorth(count, uniform(20)),
      elevations: risingElevations(count),
      // 20 m toutes les demi-secondes : 144 km/h sur un sentier.
      times: timesEvery(count, SUMMER_2025, 500),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).toContain("implausible_speed");
    expect(report.usable).toBe(false);
  });

  it("ne soupçonne jamais une trace privée d'horodatage", () => {
    const trace = makeTrace({ coordinates: lineNorth(400, irregular(8)) });
    expect(gpxQuality(trace, undefined, NOW).flags).not.toContain("implausible_speed");
  });

  it("laisse passer une allure de marche normale", () => {
    const count = 300;
    const trace = makeTrace({
      coordinates: lineNorth(count, irregular(5)),
      elevations: risingElevations(count),
      // 5 m toutes les 5 s : environ 3,6 km/h.
      times: timesEvery(count, SUMMER_2025, 5_000),
    });
    expect(gpxQuality(trace, undefined, NOW).flags).not.toContain("implausible_speed");
  });

  it("traite des horodatages d'époque Unix comme une absence d'horodatage", () => {
    const count = 200;
    const trace = makeTrace({
      coordinates: lineNorth(count, irregular(8)),
      elevations: risingElevations(count),
      times: timesEvery(count, GPX_EARLIEST_PLAUSIBLE_TIME - 10 * 365 * DAY_MS, 10_000),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.hasTime).toBe(false);
    expect(report.ageDays).toBeNull();
    expect(report.flags).toContain("no_time");
    expect(report.flags).not.toContain("stale");
    expect(report.summary).toContain(GPX_UNDATED_SUMMARY);
  });

  it("refuse une trace horodatée dans le futur", () => {
    const count = 200;
    const trace = makeTrace({
      coordinates: lineNorth(count, irregular(8)),
      times: timesEvery(count, NOW + 30 * DAY_MS + GPX_FUTURE_TOLERANCE_MS, 10_000),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.hasTime).toBe(false);
    expect(report.ageDays).toBeNull();
  });

  it("refuse des horodatages qui reculent d'un bout à l'autre", () => {
    const count = 200;
    const times = timesEvery(count, SUMMER_2025, 10_000).reverse();
    const trace = makeTrace({ coordinates: lineNorth(count, irregular(8)), times });
    expect(gpxQuality(trace, undefined, NOW).hasTime).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Altitude et horodatage                                           */
/* ------------------------------------------------------------------ */

describe("gpxQuality — altitude et horodatage", () => {
  it("signale et pénalise l'absence d'altitude", () => {
    const complète = gpxQuality(excellentTrace(), undefined, NOW);
    const sansAltitude = gpxQuality(excellentTrace({ elevations: null }), undefined, NOW);
    expect(sansAltitude.flags).toContain("no_elevation");
    expect(sansAltitude.hasElevation).toBe(false);
    expect(sansAltitude.score).toBeLessThan(complète.score);
    expect(sansAltitude.usable).toBe(true);
  });

  it("refuse une altitude constante, qui n'est qu'un remplissage", () => {
    const count = 400;
    const trace = excellentTrace({ elevations: new Array<number>(count).fill(0) });
    expect(gpxQuality(trace, undefined, NOW).hasElevation).toBe(false);
  });

  it("refuse des altitudes hors de toute plage terrestre", () => {
    const count = 400;
    const trace = excellentTrace({ elevations: risingElevations(count).map((e) => e + 100_000) });
    expect(gpxQuality(trace, undefined, NOW).hasElevation).toBe(false);
  });

  it("écarte en bloc des tableaux annexes mal alignés", () => {
    const trace = excellentTrace({ elevations: [1, 2, 3], times: [SUMMER_2025, SUMMER_2025 + 1000] });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.hasElevation).toBe(false);
    expect(report.hasTime).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Continuité, sauts, doublons                                      */
/* ------------------------------------------------------------------ */

describe("gpxQuality — continuité et propreté", () => {
  it("signale une trace à trous et lui fait perdre des points", () => {
    const saine = gpxQuality(excellentTrace(), undefined, NOW);
    const àTrous = gpxQuality(
      excellentTrace({ coordinates: lineNorth(400, (i) => (i === 200 ? 900 : irregular(8)(i))) }),
      undefined,
      NOW,
    );
    expect(àTrous.flags).toContain("gaps");
    expect(àTrous.maxGapM).toBeGreaterThan(800);
    expect(àTrous.score).toBeLessThan(saine.score);
  });

  it("signale une trace livrée en plusieurs morceaux", () => {
    const report = gpxQuality(excellentTrace({ segments: 3, breaks: [120, 260] }), undefined, NOW);
    expect(report.flags).toContain("gaps");
  });

  it("ne prend pas l'espacement large d'un itinéraire pour une interruption", () => {
    const trace = makeTrace({
      coordinates: lineNorth(40, uniform(400)),
      elevations: risingElevations(40),
      times: timesEvery(40, SUMMER_2025, 300_000),
    });
    expect(gpxQuality(trace, undefined, NOW).flags).not.toContain("gaps");
  });

  it("signale les sauts GPS écartés au nettoyage", () => {
    const report = gpxQuality(excellentTrace({ removed: { spike: 30 } }), undefined, NOW);
    expect(report.flags).toContain("spikes");
    expect(report.score).toBeLessThan(gpxQuality(excellentTrace(), undefined, NOW).score);
  });

  it("range les coordonnées impossibles et l'île nulle dans la même famille", () => {
    const report = gpxQuality(excellentTrace({ removed: { out_of_bounds: 12, null_island: 12 } }), undefined, NOW);
    expect(report.flags).toContain("spikes");
  });

  it("signale les doublons au-delà de la part tolérée", () => {
    const doublons = Math.ceil(400 * GPX_DUPLICATE_FLAG_RATIO * 2);
    const report = gpxQuality(excellentTrace({ removed: { duplicate: doublons } }), undefined, NOW);
    expect(report.flags).toContain("duplicates");
  });

  it("ne signale rien pour une poignée de doublons sur une longue trace", () => {
    expect(gpxQuality(excellentTrace({ removed: { duplicate: 1 } }), undefined, NOW).flags).not.toContain(
      "duplicates",
    );
  });

  it("pénalise un horodatage désordonné sans le nier", () => {
    const report = gpxQuality(excellentTrace({ removed: { time_disorder: 80 } }), undefined, NOW);
    expect(report.hasTime).toBe(true);
    expect(report.score).toBeLessThan(gpxQuality(excellentTrace(), undefined, NOW).score);
  });

  it("signale un aller-retour sans lui faire perdre de points", () => {
    const aller = lineNorth(60, uniform(15));
    const retour = [...aller].reverse();
    const trace = excellentTrace({
      coordinates: [...aller, ...retour],
      elevations: [...risingElevations(60), ...risingElevations(60).reverse()],
      times: timesEvery(120, SUMMER_2025, 20_000),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).toContain("self_overlap");
    expect(GPX_INFORMATIVE_FLAGS).toContain("self_overlap");
    expect(report.usable).toBe(true);
  });

  it("ne voit aucun recouvrement sur une trace à sens unique", () => {
    expect(gpxQuality(excellentTrace(), undefined, NOW).flags).not.toContain("self_overlap");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Densité et âge                                                   */
/* ------------------------------------------------------------------ */

describe("gpxQuality — densité et âge", () => {
  it("signale une trace aux points trop espacés", () => {
    const count = 60;
    const trace = makeTrace({
      coordinates: lineNorth(count, irregular(GPX_SPARSE_SPACING_M * 1.5)),
      elevations: risingElevations(count),
      times: timesEvery(count, SUMMER_2025, 120_000),
    });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).toContain("sparse");
    expect(report.medianSpacingM).toBeGreaterThanOrEqual(GPX_SPARSE_SPACING_M);
  });

  it("signale une trace très ancienne sans la déclarer fausse", () => {
    const count = 400;
    const vieille = excellentTrace({
      times: timesEvery(count, NOW - (GPX_STALE_DAYS + 400) * DAY_MS, 10_000),
    });
    const report = gpxQuality(vieille, undefined, NOW);
    expect(report.flags).toContain("stale");
    expect(report.ageDays).toBeGreaterThan(GPX_STALE_DAYS);
    expect(report.score).toBeLessThan(gpxQuality(excellentTrace(), undefined, NOW).score);
  });

  it("ne signale pas une trace de la saison passée", () => {
    expect(gpxQuality(excellentTrace(), undefined, NOW).flags).not.toContain("stale");
  });

  it("signale un espacement erratique", () => {
    const count = 200;
    const trace = excellentTrace({
      // Relevé en rafales : des points à un mètre, puis un bond de 55 m quand
      // le signal se perd. L'écart interquartile explose, la médiane non.
      coordinates: lineNorth(count, (i) => (i % 3 === 0 ? 55 : 1)),
      elevations: risingElevations(count),
      times: timesEvery(count, SUMMER_2025, 60_000),
    });
    expect(gpxQuality(trace, undefined, NOW).flags).toContain("irregular_spacing");
  });
});

/* ------------------------------------------------------------------ */
/* 7. Cas dégénérés                                                    */
/* ------------------------------------------------------------------ */

describe("gpxQuality — cas dégénérés", () => {
  it("ne jette pas sur une trace vide", () => {
    const report = gpxQuality(makeTrace(), undefined, NOW);
    expect(report.points).toBe(0);
    expect(report.score).toBe(GPX_NO_GEOMETRY_SCORE);
    expect(report.level).toBe("unusable");
    expect(report.usable).toBe(false);
    expect(report.flags).toContain("too_few_points");
    expect(report.summary).toContain("aucun point");
  });

  it("ne jette pas sur une trace d'un seul point", () => {
    const report = gpxQuality(makeTrace({ coordinates: lineNorth(1, uniform(10)) }), undefined, NOW);
    expect(report.points).toBe(1);
    expect(report.medianSpacingM).toBe(0);
    expect(report.maxGapM).toBe(0);
    expect(report.usable).toBe(false);
  });

  it("écarte une trace de trois points", () => {
    const report = gpxQuality(makeTrace({ coordinates: lineNorth(3, uniform(500)) }), undefined, NOW);
    expect(report.points).toBeLessThan(GPX_MIN_POINTS);
    expect(report.flags).toContain("too_few_points");
    expect(report.usable).toBe(false);
    expect(report.score).toBeLessThanOrEqual(GPX_QUALITY_SCORE_CAPS.too_few_points ?? 100);
  });

  it("écarte une trace dont tous les points sont identiques", () => {
    const count = 50;
    const report = gpxQuality(
      makeTrace({ coordinates: Array.from({ length: count }, (): LngLat => [START_LNG, START_LAT]) }),
      undefined,
      NOW,
    );
    expect(report.points).toBe(count);
    expect(report.medianSpacingM).toBe(0);
    expect(report.flags).toContain("too_few_points");
    expect(report.score).toBe(GPX_NO_GEOMETRY_SCORE);
    expect(report.usable).toBe(false);
  });

  it("écarte une trace sans étendue mais ne jette pas", () => {
    const trace = makeTrace({ coordinates: lineNorth(40, uniform(GPX_MIN_TRACE_LENGTH_M / 100)) });
    const report = gpxQuality(trace, undefined, NOW);
    expect(report.flags).toContain("too_few_points");
    expect(report.score).toBe(GPX_NO_GEOMETRY_SCORE);
    expect(report.level).toBe("unusable");
  });

  it("ignore les coordonnées invalides sans perdre l'alignement des annexes", () => {
    const bonnes = lineNorth(20, irregular(10));
    const coordinates: LngLat[] = [[Number.NaN, START_LAT], ...bonnes, [500, 500]];
    const elevations = [7777, ...risingElevations(20), 8888];
    const times = [SUMMER_2025 - 10_000, ...timesEvery(20, SUMMER_2025, 10_000), SUMMER_2025 + 999_000];
    const report = gpxQuality(makeTrace({ coordinates, elevations, times }), undefined, NOW);
    expect(report.points).toBe(20);
    expect(report.hasElevation).toBe(true);
    expect(report.hasTime).toBe(true);
  });

  it("supporte des champs annexes tous nuls ou absents", () => {
    const trace = makeTrace({
      coordinates: lineNorth(40, irregular(10)),
      elevations: null,
      times: null,
      removed: {},
      breaks: [],
      segments: 1,
    });
    expect(() => gpxQuality(trace, undefined, NOW)).not.toThrow();
  });

  it("ne produit jamais de NaN ni d'Infinity, quelle que soit la trace", () => {
    const traces = [
      makeTrace(),
      makeTrace({ coordinates: lineNorth(2, uniform(0)) }),
      excellentTrace(),
      handDrawnTrace(),
      excellentTrace({ removed: { spike: 10_000, duplicate: 10_000 } }),
      excellentTrace({ segments: 50, breaks: [1, 2, 3] }),
    ];
    for (const trace of traces) {
      const r = gpxQuality(trace, undefined, NOW);
      expect(Number.isFinite(r.score)).toBe(true);
      expect(Number.isFinite(r.points)).toBe(true);
      expect(Number.isFinite(r.medianSpacingM)).toBe(true);
      expect(Number.isFinite(r.maxGapM)).toBe(true);
      expect(r.ageDays === null || Number.isFinite(r.ageDays)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("retombe sur l'instant courant si `now` est illisible", () => {
    expect(() => gpxQuality(excellentTrace(), undefined, Number.NaN)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* 8. Seuils et niveaux                                                */
/* ------------------------------------------------------------------ */

describe("gpxQualityLevel", () => {
  it("rend le niveau du premier palier atteint", () => {
    for (const tier of GPX_QUALITY_THRESHOLDS) {
      expect(gpxQualityLevel(tier.minScore)).toBe(tier.level);
    }
  });

  it("classe juste en dessous de chaque palier", () => {
    expect(gpxQualityLevel(84.9)).toBe("good");
    expect(gpxQualityLevel(64.9)).toBe("fair");
    expect(gpxQualityLevel(MIN_USABLE_QUALITY_SCORE - 0.1)).toBe("poor");
    expect(gpxQualityLevel(19.9)).toBe("unusable");
  });

  it("cale le seuil d'exploitabilité sur le contrat partagé", () => {
    expect(gpxQualityLevel(MIN_USABLE_QUALITY_SCORE)).toBe("fair");
    expect(GPX_QUALITY_THRESHOLDS.some((t) => t.minScore === MIN_USABLE_QUALITY_SCORE)).toBe(true);
  });

  it("refuse de deviner un niveau à partir d'un score illisible", () => {
    expect(gpxQualityLevel(Number.NaN)).toBe("unusable");
    expect(gpxQualityLevel(Number.POSITIVE_INFINITY)).toBe("unusable");
  });

  it("garde tous les défauts rédhibitoires sous le seuil d'exploitabilité", () => {
    for (const flag of GPX_BLOCKING_FLAGS) {
      const cap = GPX_QUALITY_SCORE_CAPS[flag];
      expect(cap).toBeDefined();
      expect(cap ?? 100).toBeLessThan(MIN_USABLE_QUALITY_SCORE);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 9. Explication                                                      */
/* ------------------------------------------------------------------ */

describe("describeGpxQuality", () => {
  it("énumère les défauts qui ont coûté des points", () => {
    const report = gpxQuality(excellentTrace({ elevations: null, times: null }), undefined, NOW);
    const phrase = describeGpxQuality(report);
    expect(phrase).toContain(GPX_FLAG_REASONS.no_elevation);
    expect(phrase).toContain(GPX_FLAG_REASONS.no_time);
    expect(phrase).toContain(GPX_QUALITY_LEVEL_LABELS[report.level]);
  });

  it("le dit quand il n'y a rien à reprocher", () => {
    expect(describeGpxQuality(gpxQuality(excellentTrace(), undefined, NOW))).toContain(GPX_NO_DEFECT_LABEL);
  });

  it("range le recouvrement dans une clause « À noter »", () => {
    const phrase = describeGpxQuality(makeReport({ flags: ["self_overlap"] }));
    expect(phrase).toContain("À noter");
    expect(phrase).toContain(GPX_NO_DEFECT_LABEL);
  });

  it("avertit quand la trace est écartée du réseau", () => {
    const phrase = describeGpxQuality(gpxQuality(makeTrace(), undefined, NOW));
    expect(phrase).toContain(GPX_UNUSABLE_NOTICE);
  });

  it("résiste à un rapport aux drapeaux inconnus ou en double", () => {
    const report = makeReport({ flags: ["stale", "stale"] });
    const phrase = describeGpxQuality(report);
    expect(phrase.match(/trace ancienne/g)?.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 10. Tri                                                             */
/* ------------------------------------------------------------------ */

describe("compareQuality", () => {
  it("met la meilleure trace d'abord", () => {
    const bonne = makeReport({ score: 90 });
    const moyenne = makeReport({ score: 50 });
    expect([moyenne, bonne].sort(compareQuality)[0]).toBe(bonne);
  });

  it("fait passer toute trace exploitable avant une trace écartée", () => {
    const écartée = makeReport({ score: 95, usable: false });
    const retenue = makeReport({ score: 45, usable: true });
    expect([écartée, retenue].sort(compareQuality)[0]).toBe(retenue);
  });

  it("départage à score égal par la densité de points", () => {
    const dense = makeReport({ points: 900 });
    const clairsemée = makeReport({ points: 90 });
    expect([clairsemée, dense].sort(compareQuality)[0]).toBe(dense);
  });

  it("préfère la trace la plus récente à mesures égales", () => {
    const récente = makeReport({ ageDays: 10 });
    const ancienne = makeReport({ ageDays: 3000 });
    expect([ancienne, récente].sort(compareQuality)[0]).toBe(récente);
  });

  it("relègue les scores illisibles en fin de tri", () => {
    const illisible = makeReport({ score: Number.NaN });
    const normale = makeReport({ score: 10 });
    expect([illisible, normale].sort(compareQuality)[0]).toBe(normale);
  });

  it("rend toujours -1, 0 ou 1", () => {
    const a = makeReport({ score: 90, ageDays: null });
    const b = makeReport({ score: Number.NaN, ageDays: null });
    for (const v of [compareQuality(a, b), compareQuality(b, a), compareQuality(a, a)]) {
      expect([-1, 0, 1]).toContain(v);
    }
  });

  it("donne un ordre total : deux rapports identiques sont équivalents", () => {
    expect(compareQuality(makeReport(), makeReport())).toBe(0);
  });

  it("trie de la même façon quel que soit l'ordre d'entrée", () => {
    const rapports = [
      makeReport({ score: 70, summary: "b" }),
      makeReport({ score: 90, summary: "a" }),
      makeReport({ score: 70, summary: "a" }),
      makeReport({ score: 30, usable: false, summary: "c" }),
    ];
    const direct = [...rapports].sort(compareQuality).map((r) => r.summary + r.score);
    const inverse = [...rapports].reverse().sort(compareQuality).map((r) => r.summary + r.score);
    expect(inverse).toEqual(direct);
  });
});

/* ------------------------------------------------------------------ */
/* 11. Déterminisme                                                    */
/* ------------------------------------------------------------------ */

describe("déterminisme", () => {
  it("compose le score sur tous les critères, une seule fois chacun", () => {
    expect(new Set(GPX_QUALITY_CRITERIA).size).toBe(GPX_QUALITY_CRITERIA.length);
    const somme = GPX_QUALITY_CRITERIA.reduce((acc, k) => acc + GPX_QUALITY_WEIGHTS[k], 0);
    expect(somme).toBeCloseTo(1, 10);
  });

  it("rend deux fois exactement le même rapport", () => {
    const trace = excellentTrace({ removed: { spike: 4, duplicate: 9 }, segments: 2, breaks: [200] });
    const contexte = { source: { reliabilityScore: 62 }, matchedRatio: 0.44, corridorAgreement: 0.71 };
    expect(gpxQuality(trace, contexte, NOW)).toEqual(gpxQuality(trace, contexte, NOW));
  });

  it("ordonne les drapeaux selon GPX_FLAG_ORDER, quelle que soit la trace", () => {
    const trace = makeTrace({
      coordinates: lineNorth(60, uniform(80)),
      removed: { spike: 20, duplicate: 20 },
      segments: 2,
      breaks: [30],
    });
    const flags = gpxQuality(trace, undefined, NOW).flags;
    const rangs = flags.map((f) => GPX_FLAG_ORDER.indexOf(f));
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    expect(new Set(flags).size).toBe(flags.length);
  });

  it("ne mute jamais la trace qu'on lui confie", () => {
    const trace = excellentTrace();
    const copie = structuredClone(trace);
    gpxQuality(trace, { matchedRatio: 0.5 }, NOW);
    expect(trace).toEqual(copie);
  });
});
