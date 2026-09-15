/**
 * Tests des statistiques collectives par segment
 * (sections 9, 10, 11, 13, 14, 15, 26, 30, 31, 32, 42, 43).
 *
 * Les scénarios sont ceux du terrain corse : la montée des bergeries de
 * Grotelle au lac de Melo (Restonica), une portion de GR 20 et un chemin
 * équestre de Bavella. Les géométries sont construites avec `offsetPoint`, et
 * les durées en découlent aux vitesses de référence du cahier des charges
 * (marche 4 km/h, trail 8 km/h, VTT 12 km/h) : aucune valeur n'est inventée.
 */
import { describe, expect, it } from "vitest";
import { offsetPoint, polylineLengthM, type LngLat } from "../geo";
import { K_ANONYMITY_MIN, type SegmentStatistics, type TraversalObservation } from "./types";
import {
  ACTIVITY_QUALIFIERS,
  DIVERSITY_USERS_FULL,
  INSUFFICIENT_DATA_LABEL,
  POPULARITY_HALF_LIFE_DAYS,
  SESSION_GAP_MS,
  STATISTICS_MIN_OBSERVATIONS,
  aggregateAll,
  aggregateSegment,
  describeFrequentation,
  durationStats,
  freshnessWeight,
  frequentationLevel,
  percentile,
} from "./statistics";

/* ------------------------------------------------------------------ */
/* Terrain : montée Grotelle → lac de Melo (Restonica)                 */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute Restonica. */
const GROTELLE = { lat: 42.2718, lng: 9.0731 };

/** Ligne droite de `lengthM` mètres depuis `start` au cap `brg`. */
function line(start: { lat: number; lng: number }, brg: number, lengthM: number, stepM = 100): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    const p = offsetPoint(start, Math.min(d, lengthM), brg);
    out.push([p.lng, p.lat]);
  }
  return out;
}

const MELO = line(GROTELLE, 160, 1900);
/** Longueur réelle de la géométrie construite (≈ 1,9 km). */
const MELO_M = polylineLengthM(MELO);

const WALK_MS = 4000 / 3600;
const TRAIL_MS = 8000 / 3600;
const MTB_MS = 12000 / 3600;

/** Durée (ms) du segment complet à la vitesse donnée. */
const durationAt = (speedMs: number): number => Math.round((MELO_M / speedMs) * 1000);

const WALK_DURATION = durationAt(WALK_MS); // ≈ 28 min
const TRAIL_DURATION = durationAt(TRAIL_MS); // ≈ 14 min

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** 15 juillet 2025, 12 h — heure locale, comme la saisonnalité (section 31). */
const NOW = new Date(2025, 6, 15, 12, 0, 0).getTime();

function obs(extra: Partial<TraversalObservation> = {}): TraversalObservation {
  return {
    segmentId: "melo",
    activity: "hiking",
    direction: "forward",
    at: NOW - DAY,
    durationMs: WALK_DURATION,
    distanceM: MELO_M,
    coverage: 1,
    userKey: "u0",
    confidence: 0.9,
    ...extra,
  };
}

/** `count` passages répartis du plus ancien (`fromDaysAgo`) au plus récent. */
function serie(
  count: number,
  fromDaysAgo: number,
  stepDays: number,
  users: number,
  extra: Partial<TraversalObservation> = {},
): TraversalObservation[] {
  const out: TraversalObservation[] = [];
  for (let i = 0; i < count; i++) {
    out.push(obs({ at: NOW - (fromDaysAgo - i * stepDays) * DAY, userKey: `u${i % users}`, ...extra }));
  }
  return out;
}

const ALL_BOTH = { segmentId: "melo", activity: "all", direction: "both" } as const;

/* ------------------------------------------------------------------ */

describe("percentile", () => {
  it("interpole linéairement entre les deux valeurs encadrantes", () => {
    const v = [10, 20, 30, 40];
    expect(percentile(v, 0.5)).toBe(25);
    expect(percentile(v, 0.25)).toBe(17.5);
    expect(percentile(v, 0)).toBe(10);
    expect(percentile(v, 1)).toBe(40);
    // L'entrée n'a pas besoin d'être triée, et n'est pas modifiée.
    const desordre = [40, 10, 30, 20];
    expect(percentile(desordre, 0.5)).toBe(25);
    expect(desordre[0]).toBe(40);
  });

  it("gère le vide, la valeur unique, les bornes débordées et les valeurs aberrantes", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([42], 0.9)).toBe(42);
    expect(percentile([10, 20, 30, 40], -1)).toBe(10);
    expect(percentile([10, 20, 30, 40], 5)).toBe(40);
    expect(percentile([10, Number.NaN, 30], 0.5)).toBe(20);
    expect(percentile([Number.POSITIVE_INFINITY], 0.5)).toBe(0);
  });
});

describe("durationStats", () => {
  it("privilégie la médiane et mesure la dispersion", () => {
    // Cinq montées à Melo, de 25 à 32 min : la médiane est la référence.
    const d = [1_500_000, 1_600_000, 1_700_000, 1_800_000, 1_900_000];
    const stats = durationStats(d);
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(5);
    expect(stats?.medianMs).toBe(1_700_000);
    expect(stats?.p25Ms).toBe(1_600_000);
    expect(stats?.p75Ms).toBe(1_800_000);
    expect(stats?.averageMs).toBe(1_700_000);
    expect(stats?.spread).toBeCloseTo(0.1176, 4);
  });

  it("résiste à une pause prolongée : la moyenne dérive, pas la médiane", () => {
    // Quatre marcheurs réguliers, un cinquième qui pique-nique une heure au lac.
    const avecPause = [WALK_DURATION, WALK_DURATION, WALK_DURATION, WALK_DURATION, WALK_DURATION + 3_600_000];
    const stats = durationStats(avecPause);
    expect(stats?.medianMs).toBe(WALK_DURATION);
    expect(stats?.averageMs).toBeGreaterThan(WALK_DURATION + 600_000);
  });

  it("renvoie null sans mesure exploitable et ignore les durées absurdes", () => {
    expect(durationStats([])).toBeNull();
    expect(durationStats([0, -5, Number.NaN])).toBeNull();
    const stats = durationStats([WALK_DURATION, -1, Number.NaN, TRAIL_DURATION]);
    expect(stats?.count).toBe(2);
    expect(stats?.spread).toBeGreaterThan(0);
    expect(durationStats([WALK_DURATION, WALK_DURATION])?.spread).toBe(0);
  });
});

describe("freshnessWeight (section 42)", () => {
  it("vaut 1 aujourd'hui et 0,5 à une demi-vie", () => {
    expect(freshnessWeight(NOW, NOW)).toBe(1);
    expect(freshnessWeight(NOW - POPULARITY_HALF_LIFE_DAYS * DAY, NOW)).toBeCloseTo(0.5, 6);
    expect(freshnessWeight(NOW - 2 * POPULARITY_HALF_LIFE_DAYS * DAY, NOW)).toBeCloseTo(0.25, 6);
    expect(freshnessWeight(NOW - 30 * DAY, NOW, 30)).toBeCloseTo(0.5, 6);
    // Décroissance stricte : un passage plus ancien pèse toujours moins.
    expect(freshnessWeight(NOW - 10 * DAY, NOW)).toBeGreaterThan(freshnessWeight(NOW - 11 * DAY, NOW));
  });

  it("ne récompense ni les horloges en avance ni les demi-vies absurdes", () => {
    expect(freshnessWeight(NOW + 5 * DAY, NOW)).toBe(1);
    expect(freshnessWeight(NOW - POPULARITY_HALF_LIFE_DAYS * DAY, NOW, 0)).toBeCloseTo(0.5, 6);
    expect(freshnessWeight(Number.NaN, NOW)).toBe(0);
  });
});

describe("aggregateSegment — comptages (section 9)", () => {
  it("compte les passages par fenêtre glissante", () => {
    const observations = [
      obs({ at: NOW - 2 * DAY, userKey: "a" }),
      obs({ at: NOW - 5 * DAY, userKey: "b" }),
      obs({ at: NOW - 20 * DAY, userKey: "c" }),
      obs({ at: NOW - 200 * DAY, userKey: "d" }),
      obs({ at: NOW - 400 * DAY, userKey: "e" }),
    ];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    expect(stats.passages).toEqual({ last7: 2, last30: 3, last365: 4, total: 5 });
    expect(stats.uniqueUsers).toBe(5);
    expect(stats.uniqueSessions).toBe(5);
    expect(stats.firstPassageAt).toBe(NOW - 400 * DAY);
    expect(stats.lastPassageAt).toBe(NOW - 2 * DAY);
  });

  it("ne compte qu'une session pour un aller-retour de la même sortie", () => {
    const depart = new Date(2025, 6, 10, 8, 0).getTime();
    const sortie = [
      obs({ at: depart, direction: "forward", userKey: "sophie" }),
      obs({ at: depart + 4 * HOUR, direction: "backward", userKey: "sophie" }),
    ];
    const memeSortie = aggregateSegment(sortie, ALL_BOTH, { now: NOW });
    expect(memeSortie.passages.total).toBe(2);
    expect(memeSortie.uniqueUsers).toBe(1);
    expect(memeSortie.uniqueSessions).toBe(1);

    // Le trou se mesure entre passages successifs : une longue journée de
    // marche, avec un passage toutes les trois heures, reste une seule sortie.
    const longueJournee = aggregateSegment(
      [
        ...sortie,
        obs({ at: depart + 7 * HOUR, userKey: "sophie" }),
        obs({ at: depart + 10 * HOUR, userKey: "sophie" }),
      ],
      ALL_BOTH,
      { now: NOW },
    );
    expect(longueJournee.passages.total).toBe(4);
    expect(longueJournee.uniqueSessions).toBe(1);

    // Plus de six heures après le dernier passage : nouvelle sortie.
    const deuxSorties = aggregateSegment(
      [...sortie, obs({ at: depart + 4 * HOUR + SESSION_GAP_MS + HOUR, userKey: "sophie" })],
      ALL_BOTH,
      { now: NOW },
    );
    expect(deuxSorties.uniqueSessions).toBe(2);
    expect(deuxSorties.uniqueUsers).toBe(1);

    // Deux week-ends différents, même personne : deux sorties.
    const deuxWeekEnds = aggregateSegment([...sortie, obs({ at: depart + 8 * DAY, userKey: "sophie" })], ALL_BOTH, {
      now: NOW,
    });
    expect(deuxWeekEnds.uniqueSessions).toBe(2);
  });

  it("filtre sur la clé : segment, activité et sens (sections 14 et 15)", () => {
    const observations = [
      ...serie(6, 30, 2, 3, { activity: "hiking", direction: "forward" }),
      ...serie(4, 25, 2, 2, { activity: "mtb", direction: "backward", durationMs: durationAt(MTB_MS) }),
      obs({ segmentId: "gr20-bavella", userKey: "z" }),
    ];
    expect(aggregateSegment(observations, ALL_BOTH, { now: NOW }).passages.total).toBe(10);
    expect(
      aggregateSegment(observations, { segmentId: "melo", activity: "mtb", direction: "both" }, { now: NOW }).passages
        .total,
    ).toBe(4);
    expect(
      aggregateSegment(observations, { segmentId: "melo", activity: "all", direction: "forward" }, { now: NOW })
        .passages.total,
    ).toBe(6);
    expect(
      aggregateSegment(observations, { segmentId: "melo", activity: "mtb", direction: "forward" }, { now: NOW })
        .passages.total,
    ).toBe(0);
    expect(
      aggregateSegment(observations, { segmentId: "gr20-bavella", activity: "all", direction: "both" }, { now: NOW })
        .passages.total,
    ).toBe(1);
  });
});

describe("aggregateSegment — durées (section 13)", () => {
  it("extrapole les passages partiels au segment complet", () => {
    const partiel = { coverage: 0.5, durationMs: Math.round(WALK_DURATION * 0.5), distanceM: MELO_M * 0.5 };
    const observations = [
      obs({ userKey: "a", at: NOW - 3 * DAY }),
      obs({ userKey: "b", at: NOW - 4 * DAY }),
      obs({ userKey: "c", at: NOW - 5 * DAY, ...partiel }),
      obs({ userKey: "d", at: NOW - 6 * DAY, ...partiel }),
      obs({ userKey: "e", at: NOW - 7 * DAY, ...partiel }),
    ];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    expect(stats.duration?.count).toBe(5);
    // Sans extrapolation, la médiane tomberait à la moitié (≈ 14 min).
    expect(stats.duration?.medianMs).toBeCloseTo(WALK_DURATION, -2);
    expect(stats.duration?.spread).toBeLessThan(0.01);
    // La vitesse moyenne reste celle du marcheur, l'extrapolation ne la touche pas.
    expect(stats.averageSpeedMs).toBeCloseTo(WALK_MS, 2);
  });

  it("écarte des durées un passage trop partiel, sans l'effacer des comptages", () => {
    const observations = [
      ...serie(4, 20, 3, 4),
      obs({ userKey: "x", at: NOW - 2 * DAY, coverage: 0.05, durationMs: 60_000, distanceM: MELO_M * 0.05 }),
    ];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    expect(stats.passages.total).toBe(5);
    expect(stats.duration?.count).toBe(4);
    expect(stats.duration?.medianMs).toBe(WALK_DURATION);
  });

  it("calcule une vitesse moyenne cohérente avec l'activité", () => {
    const vtt = serie(6, 40, 5, 3, { activity: "mtb", durationMs: durationAt(MTB_MS) });
    const stats = aggregateSegment(vtt, ALL_BOTH, { now: NOW });
    expect(stats.averageSpeedMs).toBeCloseTo(MTB_MS, 2);
    expect(stats.duration?.medianMs).toBe(durationAt(MTB_MS));

    // Durées nulles ou négatives : aucune durée, aucune vitesse, mais des passages.
    const cassé = aggregateSegment(
      serie(5, 20, 2, 5, { durationMs: 0, distanceM: 0 }),
      ALL_BOTH,
      { now: NOW },
    );
    expect(cassé.passages.total).toBe(5);
    expect(cassé.duration).toBeNull();
    expect(cassé.averageSpeedMs).toBeNull();
  });
});

describe("aggregateSegment — saisonnalité et horaires (section 31)", () => {
  it("répartit les passages par mois et par heure locale", () => {
    const observations = [
      obs({ at: new Date(2025, 6, 20, 6, 30).getTime(), userKey: "a" }),
      obs({ at: new Date(2025, 6, 21, 6, 45).getTime(), userKey: "b" }),
      obs({ at: new Date(2025, 0, 3, 14, 0).getTime(), userKey: "c" }),
    ];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    expect(Object.keys(stats.monthly)).toHaveLength(12);
    expect(Object.keys(stats.hourly)).toHaveLength(24);
    expect(stats.monthly["7"]).toBe(2);
    expect(stats.monthly["1"]).toBe(1);
    expect(stats.monthly["3"]).toBe(0);
    expect(stats.hourly["6"]).toBe(2);
    expect(stats.hourly["14"]).toBe(1);
    expect(stats.hourly["23"]).toBe(0);
  });

  it("répartit les activités en fractions sommant à 1", () => {
    const observations = [...serie(10, 60, 5, 5), ...serie(2, 20, 5, 2, { activity: "mtb" })];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    const mix = stats.activityMix;
    expect(mix.hiking).toBeCloseTo(10 / 12, 3);
    expect(mix.mtb).toBeCloseTo(2 / 12, 3);
    expect(mix.trail).toBeUndefined();
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe("aggregateSegment — popularité (sections 32 et 42)", () => {
  it("croît avec le volume, sature à 100 et n'est jamais négatif", () => {
    const dix = aggregateSegment(serie(10, 60, 6, 5), ALL_BOTH, { now: NOW });
    const trente = aggregateSegment(serie(30, 60, 2, 8), ALL_BOTH, { now: NOW });
    const soixante = aggregateSegment(serie(60, 60, 1, 10), ALL_BOTH, { now: NOW });
    expect(dix.popularityScore).toBeGreaterThan(0);
    expect(trente.popularityScore).toBeGreaterThan(dix.popularityScore);
    expect(soixante.popularityScore).toBe(100);
    expect(soixante.frequentation).toBe("very_high");
    expect(aggregateSegment([], ALL_BOTH, { now: NOW }).popularityScore).toBe(0);
  });

  it("dévalue les passages anciens à volume égal", () => {
    const recents = aggregateSegment(serie(20, 60, 3, 5), ALL_BOTH, { now: NOW });
    const anciens = aggregateSegment(serie(20, 800, 3, 5), ALL_BOTH, { now: NOW });
    expect(anciens.popularityScore).toBeLessThan(recents.popularityScore / 3);
    expect(anciens.popularityScore).toBeGreaterThan(0);
    // La référence est un réglage produit : l'abaisser rehausse le score.
    const exigeante = aggregateSegment(serie(20, 60, 3, 5), ALL_BOTH, { now: NOW, referenceWeight: 200 });
    expect(exigeante.popularityScore).toBeLessThan(recents.popularityScore);
  });

  it("récompense la régularité et la diversité des contributeurs", () => {
    // Même volume et même fraîcheur moyenne : 20 passages sur 10 mois pèsent
    // plus lourd que 20 passages concentrés sur deux semaines.
    const etales = aggregateSegment(serie(20, 300, 15, DIVERSITY_USERS_FULL), ALL_BOTH, {
      now: NOW,
      referenceWeight: 200,
    });
    const groupes = aggregateSegment(serie(20, 300, 0.5, DIVERSITY_USERS_FULL), ALL_BOTH, {
      now: NOW,
      referenceWeight: 200,
    });
    expect(etales.popularityScore).toBeGreaterThan(groupes.popularityScore);

    const unSeulContributeur = aggregateSegment(serie(20, 60, 3, 1), ALL_BOTH, { now: NOW, referenceWeight: 200 });
    const dixContributeurs = aggregateSegment(serie(20, 60, 3, 10), ALL_BOTH, { now: NOW, referenceWeight: 200 });
    expect(dixContributeurs.popularityScore).toBeGreaterThan(unSeulContributeur.popularityScore);
  });
});

describe("aggregateSegment — tendance et inactivité (section 30)", () => {
  it("compare les 12 derniers mois aux 12 précédents", () => {
    const stable = aggregateSegment([...serie(12, 350, 30, 6), ...serie(12, 715, 30, 6)], ALL_BOTH, { now: NOW });
    expect(stable.trend).toBeCloseTo(1, 3);
    expect(stable.possiblyInactive).toBe(false);

    const sansHistorique = aggregateSegment(serie(10, 200, 20, 5), ALL_BOTH, { now: NOW });
    expect(sansHistorique.trend).toBeNull();
    expect(sansHistorique.possiblyInactive).toBe(false);
  });

  it("signale un effondrement ou un long silence, sans conclure", () => {
    const effondre = aggregateSegment([...serie(15, 700, 20, 6), ...serie(2, 100, 50, 2)], ALL_BOTH, { now: NOW });
    expect(effondre.trend).toBeLessThan(0.2);
    expect(effondre.possiblyInactive).toBe(true);
    // Le chemin n'est pas effacé pour autant : les passages restent comptés.
    expect(effondre.passages.total).toBe(17);

    const silencieux = aggregateSegment(serie(8, 900, 20, 4), ALL_BOTH, { now: NOW });
    expect(silencieux.passages.last365).toBe(0);
    expect(silencieux.passages.total).toBe(8);
    expect(silencieux.possiblyInactive).toBe(true);

    // Deux passages qui passent à zéro ne sont pas un signal statistique.
    const petitVolume = aggregateSegment([...serie(2, 700, 20, 2), ...serie(1, 100, 1, 1)], ALL_BOTH, { now: NOW });
    expect(petitVolume.trend).toBeCloseTo(0.5, 3);
    expect(petitVolume.possiblyInactive).toBe(false);
  });
});

describe("aggregateSegment — données insuffisantes (section 43)", () => {
  it("refuse de conclure sous le seuil de passages ou d'anonymat", () => {
    const troisPassages = aggregateSegment(serie(3, 20, 5, 3), ALL_BOTH, { now: NOW });
    expect(troisPassages.passages.total).toBe(3);
    expect(troisPassages.insufficientData).toBe(true);
    expect(troisPassages.frequentation).toBe("unknown");
    expect(describeFrequentation(troisPassages)).toBe(INSUFFICIENT_DATA_LABEL);

    // Assez de passages, mais deux contributeurs seulement : k-anonymat non atteint.
    const deuxContributeurs = aggregateSegment(serie(10, 40, 4, 2), ALL_BOTH, { now: NOW });
    expect(deuxContributeurs.uniqueUsers).toBeLessThan(K_ANONYMITY_MIN);
    expect(deuxContributeurs.insufficientData).toBe(true);
    expect(deuxContributeurs.frequentation).toBe("unknown");

    const publiable = aggregateSegment(serie(STATISTICS_MIN_OBSERVATIONS, 40, 4, 4), ALL_BOTH, { now: NOW });
    expect(publiable.insufficientData).toBe(false);
    expect(publiable.frequentation).not.toBe("unknown");
  });

  it("produit un agrégat valide et honnête sans aucune observation", () => {
    const vide = aggregateSegment([], ALL_BOTH, { now: NOW });
    expect(vide.passages).toEqual({ last7: 0, last30: 0, last365: 0, total: 0 });
    expect(vide.uniqueUsers).toBe(0);
    expect(vide.uniqueSessions).toBe(0);
    expect(vide.duration).toBeNull();
    expect(vide.averageSpeedMs).toBeNull();
    expect(vide.firstPassageAt).toBeNull();
    expect(vide.lastPassageAt).toBeNull();
    expect(vide.trend).toBeNull();
    // Absence de données n'est pas absence de chemin : aucun signal d'inactivité.
    expect(vide.possiblyInactive).toBe(false);
    expect(vide.confidence).toBe(0);
    expect(vide.activityMix).toEqual({});
    expect(describeFrequentation(vide)).toBe(INSUFFICIENT_DATA_LABEL);
  });

  it("ignore les observations non datables et les pseudonymes manquants", () => {
    const observations = [
      ...serie(5, 30, 5, 5),
      obs({ at: Number.NaN, userKey: "zz" }),
      obs({ at: NOW - 2 * DAY, userKey: "" }),
    ];
    const stats = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    // Le passage sans date disparaît, celui sans pseudonyme compte sans
    // prouver de diversité de contributeurs.
    expect(stats.passages.total).toBe(6);
    expect(stats.uniqueUsers).toBe(5);
    expect(stats.uniqueSessions).toBe(5);
  });

  it("respecte un seuil d'observations réglé par l'appelant", () => {
    const observations = serie(4, 20, 4, 4);
    expect(aggregateSegment(observations, ALL_BOTH, { now: NOW }).insufficientData).toBe(true);
    expect(aggregateSegment(observations, ALL_BOTH, { now: NOW, minObservations: 4 }).insufficientData).toBe(false);
  });
});

describe("aggregateSegment — fiabilité (section 26)", () => {
  it("croît avec le volume, la diversité et la fraîcheur", () => {
    const maigre = aggregateSegment(serie(5, 60, 10, 3), ALL_BOTH, { now: NOW });
    const solide = aggregateSegment(serie(40, 60, 1.5, 10), ALL_BOTH, { now: NOW });
    expect(solide.confidence).toBeGreaterThan(maigre.confidence);
    expect(solide.confidence).toBeLessThanOrEqual(1);
    expect(maigre.confidence).toBeGreaterThan(0);

    const ancien = aggregateSegment(serie(40, 900, 1.5, 10), ALL_BOTH, { now: NOW });
    expect(ancien.confidence).toBeLessThan(solide.confidence);

    const malRattache = aggregateSegment(serie(40, 60, 1.5, 10, { confidence: 0.2 }), ALL_BOTH, { now: NOW });
    expect(malRattache.confidence).toBeLessThan(solide.confidence);
  });

  it("décroît quand les durées sont très dispersées", () => {
    const reguliers = serie(20, 60, 3, 8);
    const disperses = reguliers.map((o, i) =>
      // Mêmes passages, mais des durées allant de 15 min à 1 h 30.
      ({ ...o, durationMs: i % 2 === 0 ? TRAIL_DURATION : WALK_DURATION * 3 }),
    );
    const a = aggregateSegment(reguliers, ALL_BOTH, { now: NOW });
    const b = aggregateSegment(disperses, ALL_BOTH, { now: NOW });
    expect(b.duration?.spread ?? 0).toBeGreaterThan(a.duration?.spread ?? 0);
    expect(b.confidence).toBeLessThan(a.confidence);
  });
});

describe("aggregateAll", () => {
  it("produit toutes les combinaisons observées, triées et déterministes", () => {
    const observations = [
      ...serie(6, 60, 5, 3, { activity: "hiking", direction: "forward" }),
      ...serie(4, 50, 5, 3, { activity: "hiking", direction: "backward" }),
      ...serie(5, 40, 5, 3, { activity: "mtb", direction: "forward", durationMs: durationAt(MTB_MS) }),
      ...serie(3, 30, 5, 3, { segmentId: "gr20-bavella", activity: "trail", direction: "forward" }),
    ];
    const tous = aggregateAll(observations, { now: NOW });
    const cle = (s: SegmentStatistics): string => `${s.segmentId}|${s.activity}|${s.direction}`;
    const cles = tous.map(cle);

    // Segment « melo » : 1 agrégat global, 2 activités, 2 sens, 3 croisements.
    expect(cles).toContain("melo|all|both");
    expect(cles).toContain("melo|hiking|both");
    expect(cles).toContain("melo|all|forward");
    expect(cles).toContain("melo|mtb|forward");
    expect(cles).not.toContain("melo|mtb|backward");
    expect(cles.filter((k) => k.startsWith("melo|"))).toHaveLength(8);
    expect(cles.filter((k) => k.startsWith("gr20-bavella|"))).toHaveLength(4);
    // Tri stable : le segment de Bavella précède celui de la Restonica.
    expect(cles[0]).toBe("gr20-bavella|all|both");
    expect(aggregateAll(observations, { now: NOW }).map(cle)).toEqual(cles);
  });

  it("donne les mêmes chiffres que l'agrégation d'une clé isolée", () => {
    const observations = [
      ...serie(6, 60, 5, 3, { direction: "forward" }),
      ...serie(4, 50, 5, 3, { direction: "backward" }),
    ];
    const tous = aggregateAll(observations, { now: NOW });
    const global = tous.find((s) => s.activity === "all" && s.direction === "both");
    const aller = tous.find((s) => s.activity === "all" && s.direction === "forward");
    const direct = aggregateSegment(observations, ALL_BOTH, { now: NOW });

    expect(global).toEqual(direct);
    expect(global?.passages.total).toBe(10);
    expect(aller?.passages.total).toBe(6);
    expect(aller?.direction).toBe("forward");
  });

  it("supporte un lot vide et des observations inexploitables", () => {
    expect(aggregateAll([], { now: NOW })).toEqual([]);
    expect(aggregateAll([obs({ segmentId: "" }), obs({ at: Number.NaN })], { now: NOW })).toEqual([]);
  });

  it("ne confond pas deux segments aux identifiants ambigus", () => {
    // Identifiants choisis pour tenter une collision de clé de regroupement.
    const observations = [
      ...serie(5, 30, 4, 5, { segmentId: "way/1|all" }),
      ...serie(3, 30, 4, 3, { segmentId: "way/1" }),
    ];
    const tous = aggregateAll(observations, { now: NOW });
    const a = tous.find((s) => s.segmentId === "way/1|all" && s.activity === "all" && s.direction === "both");
    const b = tous.find((s) => s.segmentId === "way/1" && s.activity === "all" && s.direction === "both");
    expect(a?.passages.total).toBe(5);
    expect(b?.passages.total).toBe(3);
  });
});

describe("frequentationLevel et describeFrequentation (sections 10 et 11)", () => {
  it("dérive le niveau du score", () => {
    expect(frequentationLevel(0)).toBe("very_low");
    expect(frequentationLevel(4.9)).toBe("very_low");
    expect(frequentationLevel(10)).toBe("low");
    expect(frequentationLevel(30)).toBe("moderate");
    expect(frequentationLevel(60)).toBe("high");
    expect(frequentationLevel(100)).toBe("very_high");
    expect(frequentationLevel(Number.NaN)).toBe("unknown");
  });

  it("décrit un sentier très fréquenté par les randonneurs", () => {
    const stats = aggregateSegment(serie(40, 59, 1.5, DIVERSITY_USERS_FULL), ALL_BOTH, { now: NOW });
    expect(stats.frequentation).toBe("very_high");
    expect(describeFrequentation(stats)).toBe("Très fréquenté par les randonneurs");
  });

  it("nomme l'activité dominante et se tait quand aucune ne se dégage", () => {
    const base = aggregateSegment(serie(20, 60, 3, 6), ALL_BOTH, { now: NOW });
    // Les niveaux sont testés ici en isolant la restitution de l'agrégation.
    const vtt: SegmentStatistics = { ...base, frequentation: "high", activityMix: { mtb: 1 } };
    const chevaux: SegmentStatistics = { ...base, frequentation: "low", activityMix: { equestrian: 0.9, hiking: 0.1 } };
    const rare: SegmentStatistics = { ...base, frequentation: "very_low", activityMix: { hiking: 1 } };
    const mixte: SegmentStatistics = {
      ...base,
      frequentation: "moderate",
      activityMix: { hiking: 0.4, mtb: 0.35, trail: 0.25 },
    };
    const inconnue: SegmentStatistics = { ...base, frequentation: "high", activityMix: { other: 1 } };

    expect(describeFrequentation(vtt)).toBe("Fréquenté par les VTT");
    expect(describeFrequentation(chevaux)).toBe("Principalement utilisé à cheval");
    expect(describeFrequentation(rare)).toBe("Rarement emprunté");
    expect(describeFrequentation(mixte)).toBe("Régulièrement emprunté");
    expect(describeFrequentation(inconnue)).toBe("Fréquenté");
    expect(ACTIVITY_QUALIFIERS.other).toBeNull();
    expect(describeFrequentation({ ...base, insufficientData: true })).toBe(INSUFFICIENT_DATA_LABEL);
  });
});

describe("pureté", () => {
  it("ne modifie pas ses entrées et reste déterministe", () => {
    const observations = [...serie(12, 90, 7, 4), ...serie(5, 40, 5, 3, { activity: "trail" })];
    const empreinte = JSON.stringify(observations);
    const a = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    const b = aggregateSegment(observations, ALL_BOTH, { now: NOW });
    expect(JSON.stringify(observations)).toBe(empreinte);
    expect(b).toEqual(a);
    // `now` est bien un paramètre : avancer l'horloge change les fenêtres.
    const plusTard = aggregateSegment(observations, ALL_BOTH, { now: NOW + 400 * DAY });
    expect(plusTard.passages.total).toBe(a.passages.total);
    expect(plusTard.passages.last365).toBeLessThan(a.passages.last365);
    expect(plusTard.popularityScore).toBeLessThan(a.popularityScore);
  });
});
