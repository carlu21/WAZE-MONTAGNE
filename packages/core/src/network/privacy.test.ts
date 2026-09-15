/**
 * Tests de la barrière de vie privée (sections 34, 35, 36 et 43).
 *
 * Terrain : la montée des bergeries de Grotelle vers le lac de Melo
 * (Restonica). Les traces sont fabriquées avec `offsetPoint`, à pas constant
 * sur un même cap : la distance curviligne d'un point est donc connue
 * exactement (100 m par relevé), ce qui permet de vérifier des rognages en
 * mètres et non « en nombre de points ».
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint } from "../geo";
import { DAY_MS } from "../time";
import { STATISTICS_MIN_OBSERVATIONS } from "./statistics";
import {
  K_ANONYMITY_MIN,
  RAW_TRACE_RETENTION_DAYS,
  type PrivacyZone,
  type RawPoint,
  type SegmentStatistics,
} from "./types";
import {
  PRIVACY_ZONE_MIN_RADIUS_M,
  PUBLICATION_MIN_PASSAGES,
  TRACE_TRIM_END_M,
  TRACE_TRIM_START_M,
  anonymitySummary,
  inPrivacyZone,
  isPublishable,
  isRawTraceExpired,
  maskTrace,
  redactStatistics,
  retentionCutoff,
} from "./privacy";

/* ------------------------------------------------------------------ */
/* Jeux de données locaux                                              */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute Restonica : le « domicile » de nos scénarios. */
const GROTELLE = { lat: 42.2718, lng: 9.0731 };

/** Cap de la montée vers le lac de Melo. */
const BEARING = 160;

/** 15 juillet 2025, 8 h : départ de la sortie. */
const START_AT = new Date(2025, 6, 15, 8, 0, 0).getTime();

/** Un relevé par minute : l'instant dit l'index du point d'origine. */
const STEP_MS = 60_000;

/** Position située à `d` mètres du départ, sur la ligne de montée. */
const at = (d: number): { lat: number; lng: number } => offsetPoint(GROTELLE, d, BEARING);

/**
 * Trace régulière de `lengthM` mètres, un relevé tous les `stepM` mètres.
 * Le point d'index `i` est à `i * stepM` mètres du départ.
 */
function trace(lengthM: number, stepM = 100): RawPoint[] {
  const out: RawPoint[] = [];
  for (let i = 0; i * stepM <= lengthM; i++) {
    const d = i * stepM;
    const p = at(d);
    out.push({
      lat: p.lat,
      lng: p.lng,
      alt: 1370 + d / 10,
      at: START_AT + i * STEP_MS,
      accuracy: 8,
      speed: 1.1,
      heading: BEARING,
    });
  }
  return out;
}

/** Index d'origine d'un point publié (les instants sont les index × STEP_MS). */
const indexOf = (point: RawPoint): number => Math.round((point.at - START_AT) / STEP_MS);

/** Zone privée centrée sur un point de la montée. */
const zoneAt = (d: number, radiusM: number): PrivacyZone => ({ ...at(d), radiusM });

/** Statistique complète et publiable, à décliner par surcharge. */
function stats(extra: Partial<SegmentStatistics> = {}): SegmentStatistics {
  return {
    segmentId: "melo",
    activity: "hiking",
    direction: "forward",
    passages: { last7: 3, last30: 9, last365: 24, total: 24 },
    uniqueSessions: 20,
    uniqueUsers: 6,
    duration: { count: 18, averageMs: 1_700_000, medianMs: 1_680_000, p25Ms: 1_500_000, p75Ms: 1_900_000, spread: 0.24 },
    averageSpeedMs: 1.13,
    firstPassageAt: START_AT - 400 * DAY_MS,
    lastPassageAt: START_AT,
    popularityScore: 52.4,
    frequentation: "high",
    confidence: 0.71,
    insufficientData: false,
    activityMix: { hiking: 0.8, trail: 0.2 },
    monthly: { "7": 12, "8": 12 },
    hourly: { "8": 10, "9": 14 },
    trend: 1.4,
    possiblyInactive: false,
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Rognage des extrémités (section 36)                              */
/* ------------------------------------------------------------------ */

describe("maskTrace — rognage curviligne des extrémités", () => {
  it("écarte par défaut au moins 250 m au départ et à l'arrivée", () => {
    const points = trace(3000);
    const masked = maskTrace(points);
    expect(TRACE_TRIM_START_M).toBe(250);
    expect(TRACE_TRIM_END_M).toBe(250);
    expect(masked.dropped).toBe(false);
    expect(masked.trimmedStartM).toBeGreaterThanOrEqual(TRACE_TRIM_START_M);
    expect(masked.trimmedEndM).toBeGreaterThanOrEqual(TRACE_TRIM_END_M);
    // Le vrai départ n'est plus déductible : le premier point publié en est loin.
    expect(haversineM(masked.points[0], points[0])).toBeGreaterThanOrEqual(TRACE_TRIM_START_M);
    expect(haversineM(masked.points[masked.points.length - 1], points[points.length - 1])).toBeGreaterThanOrEqual(
      TRACE_TRIM_END_M,
    );
  });

  it("rogne en mètres et non en nombre de points (deux échantillonnages, même résultat)", () => {
    const dense = maskTrace(trace(3000, 25));
    const sparse = maskTrace(trace(3000, 250));
    expect(dense.trimmedStartM).toBeGreaterThanOrEqual(TRACE_TRIM_START_M);
    expect(sparse.trimmedStartM).toBeGreaterThanOrEqual(TRACE_TRIM_START_M);
    // Les deux traces publiées couvrent la même portion de terrain, à un pas près.
    expect(Math.abs(dense.trimmedStartM - sparse.trimmedStartM)).toBeLessThanOrEqual(250);
    expect(haversineM(dense.points[0], sparse.points[0])).toBeLessThanOrEqual(250);
  });

  it("traite `options` absent comme les valeurs par défaut", () => {
    const points = trace(2000);
    const implicite = maskTrace(points);
    const explicite = maskTrace(points, { trimStartM: TRACE_TRIM_START_M, trimEndM: TRACE_TRIM_END_M });
    const vide = maskTrace(points, {});
    expect(implicite).toEqual(explicite);
    expect(vide).toEqual(explicite);
  });

  it("respecte un rognage personnalisé, différent au départ et à l'arrivée", () => {
    const masked = maskTrace(trace(3000), { trimStartM: 450, trimEndM: 150 });
    expect(masked.dropped).toBe(false);
    // Aucun point n'est interpolé : on s'arrête au relevé suivant (500 m) et au
    // relevé précédent (2800 m), donc un peu au-delà de ce qui était demandé.
    expect(masked.trimmedStartM).toBeGreaterThanOrEqual(450);
    expect(masked.trimmedStartM).toBeCloseTo(500, 0);
    expect(masked.trimmedEndM).toBeGreaterThanOrEqual(150);
    expect(masked.trimmedEndM).toBeCloseTo(200, 0);
    expect(indexOf(masked.points[0])).toBe(5);
    expect(indexOf(masked.points[masked.points.length - 1])).toBe(28);
  });

  it("respecte un rognage nul explicite : la trace entière est conservée", () => {
    const points = trace(1000);
    const masked = maskTrace(points, { trimStartM: 0, trimEndM: 0 });
    expect(masked.dropped).toBe(false);
    expect(masked.points).toHaveLength(points.length);
    expect(masked.trimmedStartM).toBe(0);
    expect(masked.trimmedEndM).toBe(0);
    expect(masked.removed).toBe(0);
  });

  it("retombe sur la valeur par défaut quand le rognage demandé est absurde", () => {
    const points = trace(3000);
    const reference = maskTrace(points);
    expect(maskTrace(points, { trimStartM: -100, trimEndM: Number.NaN })).toEqual(reference);
  });

  it("n'interpole jamais de point de substitution aux bornes", () => {
    const points = trace(3000);
    const masked = maskTrace(points);
    // Chaque point publié est un relevé d'origine, champ pour champ.
    for (const published of masked.points) {
      expect(published).toEqual(points[indexOf(published)]);
    }
  });

  it("abandonne la trace quand les rognages sont plus longs qu'elle", () => {
    const points = trace(300);
    const masked = maskTrace(points);
    expect(masked.dropped).toBe(true);
    expect(masked.points).toHaveLength(0);
    expect(masked.removed).toBe(points.length);
    // Ce qui a été écarté ne dépasse jamais ce que la trace mesurait.
    expect(masked.trimmedStartM).toBe(250);
    expect(masked.trimmedEndM).toBeCloseTo(50, 1);
  });

  it("ne modifie jamais la trace d'entrée", () => {
    const points = trace(3000);
    const before = structuredClone(points);
    const masked = maskTrace(points, { zones: [zoneAt(1500, 300)] });
    masked.points[0].lat = 0;
    masked.points.length = 1;
    expect(points).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Zones privées (sections 34 à 36)                                 */
/* ------------------------------------------------------------------ */

describe("maskTrace — zones privées déclarées", () => {
  it("supprime les points tombant dans une zone au milieu de la trace", () => {
    const points = trace(3000);
    const masked = maskTrace(points, { zones: [zoneAt(1000, 150)], trimStartM: 0, trimEndM: 0 });
    // Les relevés à 900, 1000 et 1100 m sont dans la zone.
    expect(masked.removedInZones).toBe(3);
    for (const published of masked.points) {
      expect(inPrivacyZone(published, [zoneAt(1000, 150)])).toBe(false);
    }
  });

  it("ne garde que le plus long morceau contigu, jamais le premier venu", () => {
    const points = trace(3000);
    const masked = maskTrace(points, { zones: [zoneAt(1000, 150)], trimStartM: 0, trimEndM: 0 });
    // Morceaux : 0 → 800 m (9 points) et 1200 → 3000 m (19 points).
    expect(masked.points).toHaveLength(19);
    expect(indexOf(masked.points[0])).toBe(12);
    expect(indexOf(masked.points[masked.points.length - 1])).toBe(30);
    expect(masked.removed).toBe(points.length - 19);
  });

  it("ne recolle jamais deux tronçons : les points publiés sont consécutifs", () => {
    const points = trace(4000);
    const masked = maskTrace(points, { zones: [zoneAt(1500, 200), zoneAt(2500, 200)], trimStartM: 0, trimEndM: 0 });
    for (let i = 1; i < masked.points.length; i++) {
      expect(indexOf(masked.points[i])).toBe(indexOf(masked.points[i - 1]) + 1);
    }
  });

  it("compte les points supprimés par les zones séparément du reste", () => {
    const points = trace(3000);
    const masked = maskTrace(points, { zones: [zoneAt(1500, 150)] });
    expect(masked.removedInZones).toBe(3);
    // `removed` couvre tout : rognage, zones et morceau écarté.
    expect(masked.removed).toBe(points.length - masked.points.length);
    expect(masked.removed).toBeGreaterThan(masked.removedInZones);
  });

  it("abandonne la trace entièrement couverte par une zone privée", () => {
    const points = trace(2000);
    const masked = maskTrace(points, { zones: [zoneAt(1000, 5000)], trimStartM: 0, trimEndM: 0 });
    expect(masked.dropped).toBe(true);
    expect(masked.points).toHaveLength(0);
    expect(masked.removedInZones).toBe(points.length);
    expect(masked.removed).toBe(points.length);
  });

  it("protège au minimum PRIVACY_ZONE_MIN_RADIUS_M quand le rayon déclaré est nul", () => {
    const points = trace(3000);
    const masked = maskTrace(points, { zones: [zoneAt(1000, 0)], trimStartM: 0, trimEndM: 0 });
    expect(PRIVACY_ZONE_MIN_RADIUS_M).toBe(50);
    // Seul le relevé au centre est à moins de 50 m ; ses voisins, à 100 m, sont
    // conservés — le morceau retenu (le plus long) reprend dès le relevé suivant.
    expect(masked.removedInZones).toBe(1);
    expect(masked.points.some((p) => indexOf(p) === 10)).toBe(false);
    expect(indexOf(masked.points[0])).toBe(11);
  });

  it("traite un rayon négatif comme un rayon nul, pas comme une absence de zone", () => {
    const points = trace(3000);
    const nul = maskTrace(points, { zones: [zoneAt(1000, 0)], trimStartM: 0, trimEndM: 0 });
    const negatif = maskTrace(points, { zones: [zoneAt(1000, -400)], trimStartM: 0, trimEndM: 0 });
    expect(negatif).toEqual(nul);
    expect(negatif.removedInZones).toBe(1);
  });

  it("ignore une zone dont le centre est illisible", () => {
    const points = trace(2000);
    const masked = maskTrace(points, {
      zones: [{ lat: Number.NaN, lng: 9.07, radiusM: 5000 }],
      trimStartM: 0,
      trimEndM: 0,
    });
    expect(masked.removedInZones).toBe(0);
    expect(masked.points).toHaveLength(points.length);
  });

  it("ne supprime rien quand aucune zone n'est déclarée", () => {
    const points = trace(2000);
    const sansZones = maskTrace(points, { trimStartM: 0, trimEndM: 0 });
    const zonesVides = maskTrace(points, { zones: [], trimStartM: 0, trimEndM: 0 });
    expect(sansZones.removedInZones).toBe(0);
    expect(zonesVides).toEqual(sansZones);
    expect(sansZones.points).toHaveLength(points.length);
  });

  it("applique zones et rognage ensemble, et rend des distances cohérentes", () => {
    const points = trace(3000);
    const masked = maskTrace(points, { zones: [zoneAt(800, 150)] });
    expect(masked.dropped).toBe(false);
    // Le rognage écarte 0 → 250 m, la zone 650 → 950 m : le plus long morceau
    // est celui qui va de 1000 m à 2700 m.
    expect(indexOf(masked.points[0])).toBe(10);
    expect(masked.trimmedStartM).toBeCloseTo(1000, 0);
    expect(masked.trimmedEndM).toBeCloseTo(300, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Cas dégénérés : rien ne doit jeter ni produire de NaN            */
/* ------------------------------------------------------------------ */

describe("maskTrace — entrées dégénérées", () => {
  it("accepte une trace vide sans jeter", () => {
    const masked = maskTrace([]);
    expect(masked.dropped).toBe(true);
    expect(masked.points).toHaveLength(0);
    expect(masked.trimmedStartM).toBe(0);
    expect(masked.trimmedEndM).toBe(0);
    expect(masked.removed).toBe(0);
    expect(masked.removedInZones).toBe(0);
  });

  it("abandonne une trace d'un seul point sous le rognage par défaut", () => {
    const points = trace(0);
    expect(points).toHaveLength(1);
    const masked = maskTrace(points);
    expect(masked.dropped).toBe(true);
    expect(masked.removed).toBe(1);
    expect(Number.isFinite(masked.trimmedStartM)).toBe(true);
    expect(Number.isFinite(masked.trimmedEndM)).toBe(true);
  });

  it("conserve un point unique quand aucun rognage n'est demandé", () => {
    const points = trace(0);
    const masked = maskTrace(points, { trimStartM: 0, trimEndM: 0 });
    expect(masked.dropped).toBe(false);
    expect(masked.points).toHaveLength(1);
    expect(masked.trimmedStartM).toBe(0);
    expect(masked.trimmedEndM).toBe(0);
  });

  it("supporte des coordonnées identiques (distance cumulée nulle)", () => {
    const immobile: RawPoint[] = Array.from({ length: 5 }, (_, i) => ({
      lat: GROTELLE.lat,
      lng: GROTELLE.lng,
      alt: 1370,
      at: START_AT + i * STEP_MS,
      accuracy: 8,
      speed: 0,
      heading: null,
    }));
    const sansRognage = maskTrace(immobile, { trimStartM: 0, trimEndM: 0 });
    expect(sansRognage.dropped).toBe(false);
    expect(sansRognage.points).toHaveLength(5);
    expect(sansRognage.trimmedStartM).toBe(0);
    expect(sansRognage.trimmedEndM).toBe(0);
    // Avec le rognage par défaut, une trace de longueur nulle ne contribue pas.
    const defaut = maskTrace(immobile);
    expect(defaut.dropped).toBe(true);
    expect(defaut.trimmedStartM).toBe(0);
  });

  it("écarte les relevés de coordonnées illisibles et les compte", () => {
    const points = trace(2000);
    const pollue = [...points];
    pollue.splice(10, 0, { ...points[10], lat: Number.NaN, at: START_AT - STEP_MS });
    const masked = maskTrace(pollue, { trimStartM: 0, trimEndM: 0 });
    expect(masked.points).toHaveLength(points.length);
    expect(masked.removed).toBe(1);
    for (const published of masked.points) {
      expect(Number.isFinite(published.lat)).toBe(true);
      expect(Number.isFinite(published.lng)).toBe(true);
    }
  });

  it("laisse passer `accuracy`, `speed`, `heading` et `alt` nuls sans dommage", () => {
    const points = trace(2000).map((p) => ({ ...p, accuracy: null, speed: null, heading: null, alt: null }));
    const masked = maskTrace(points, { trimStartM: 0, trimEndM: 0 });
    expect(masked.dropped).toBe(false);
    expect(masked.points[0].accuracy).toBeNull();
    expect(masked.points[0].speed).toBeNull();
    expect(masked.points[0].heading).toBeNull();
    expect(masked.points[0].alt).toBeNull();
  });

  it("ne produit jamais de NaN dans les distances rendues", () => {
    const scenarios: MaskedDistances[] = [
      maskTrace([]),
      maskTrace(trace(0)),
      maskTrace(trace(300)),
      maskTrace(trace(3000)),
      maskTrace(trace(3000), { zones: [zoneAt(1500, 4000)] }),
    ];
    for (const masked of scenarios) {
      expect(Number.isFinite(masked.trimmedStartM)).toBe(true);
      expect(Number.isFinite(masked.trimmedEndM)).toBe(true);
      expect(masked.trimmedStartM).toBeGreaterThanOrEqual(0);
      expect(masked.trimmedEndM).toBeGreaterThanOrEqual(0);
    }
  });

  it("garde l'égalité « retirés = entrée − sortie » dans tous les scénarios", () => {
    const cases: readonly { points: RawPoint[]; zones: PrivacyZone[] }[] = [
      { points: trace(3000), zones: [] },
      { points: trace(3000), zones: [zoneAt(1000, 150)] },
      { points: trace(300), zones: [] },
      { points: trace(0), zones: [zoneAt(0, 100)] },
      { points: [], zones: [zoneAt(0, 100)] },
    ];
    for (const { points, zones } of cases) {
      const masked = maskTrace(points, { zones });
      expect(masked.removed).toBe(points.length - masked.points.length);
      expect(masked.dropped).toBe(masked.points.length === 0);
    }
  });
});

/** Forme minimale utilisée par le test « pas de NaN ». */
interface MaskedDistances {
  trimmedStartM: number;
  trimmedEndM: number;
}

/* ------------------------------------------------------------------ */
/* 4. K-anonymat (section 34)                                          */
/* ------------------------------------------------------------------ */

describe("isPublishable — seuil d'utilisateurs distincts", () => {
  it("publie une statistique portée par assez de contributeurs et de passages", () => {
    expect(isPublishable(stats())).toBe(true);
  });

  it("refuse de publier sous K_ANONYMITY_MIN contributeurs distincts", () => {
    expect(isPublishable(stats({ uniqueUsers: K_ANONYMITY_MIN - 1 }))).toBe(false);
  });

  it("publie exactement au seuil de K_ANONYMITY_MIN contributeurs", () => {
    expect(K_ANONYMITY_MIN).toBe(3);
    expect(isPublishable(stats({ uniqueUsers: K_ANONYMITY_MIN }))).toBe(true);
  });

  it("refuse de publier quand les passages sont trop peu nombreux", () => {
    expect(PUBLICATION_MIN_PASSAGES).toBe(STATISTICS_MIN_OBSERVATIONS);
    const maigre = stats({
      passages: { last7: 0, last30: 2, last365: PUBLICATION_MIN_PASSAGES - 1, total: PUBLICATION_MIN_PASSAGES - 1 },
    });
    expect(isPublishable(maigre)).toBe(false);
    const juste = stats({
      passages: { last7: 0, last30: 2, last365: PUBLICATION_MIN_PASSAGES, total: PUBLICATION_MIN_PASSAGES },
    });
    expect(isPublishable(juste)).toBe(true);
  });

  it("accepte un seuil personnalisé plus exigeant", () => {
    expect(isPublishable(stats({ uniqueUsers: 6 }), 10)).toBe(false);
    expect(isPublishable(stats({ uniqueUsers: 6 }), 6)).toBe(true);
  });

  it("ne laisse pas désactiver le k-anonymat par un seuil nul ou absurde", () => {
    const rare = stats({ uniqueUsers: 1 });
    expect(isPublishable(rare, 0)).toBe(false);
    expect(isPublishable(rare, -5)).toBe(false);
    expect(isPublishable(rare, Number.NaN)).toBe(false);
    expect(isPublishable(stats({ uniqueUsers: K_ANONYMITY_MIN }), 0)).toBe(true);
  });

  it("ne publie pas ce que l'agrégateur a déclaré insuffisant", () => {
    expect(isPublishable(stats({ uniqueUsers: 50, insufficientData: true }))).toBe(false);
  });

  it("ne jette pas et refuse de publier sur des comptages illisibles", () => {
    expect(isPublishable(stats({ uniqueUsers: Number.NaN }))).toBe(false);
    expect(isPublishable(stats({ passages: { last7: 0, last30: 0, last365: 0, total: Number.NaN } }))).toBe(false);
  });
});

describe("anonymitySummary — compter des personnes, pas des passages", () => {
  it("compte les contributeurs distincts et non les observations", () => {
    const observations = [{ userKey: "a" }, { userKey: "a" }, { userKey: "a" }, { userKey: "b" }, { userKey: "a" }];
    expect(anonymitySummary(observations)).toEqual({ uniqueUsers: 2, sufficient: false });
  });

  it("déclare suffisant au seuil de K_ANONYMITY_MIN contributeurs", () => {
    const observations = Array.from({ length: K_ANONYMITY_MIN }, (_, i) => ({ userKey: `user-${i}` }));
    expect(anonymitySummary(observations)).toEqual({ uniqueUsers: K_ANONYMITY_MIN, sufficient: true });
    expect(anonymitySummary(observations.slice(1)).sufficient).toBe(false);
  });

  it("ignore les pseudonymes vides, qui ne prouvent aucune diversité", () => {
    const observations = [{ userKey: "" }, { userKey: "" }, { userKey: "a" }, { userKey: "" }];
    expect(anonymitySummary(observations)).toEqual({ uniqueUsers: 1, sufficient: false });
  });

  it("accepte un lot vide sans jeter", () => {
    expect(anonymitySummary([])).toEqual({ uniqueUsers: 0, sufficient: false });
  });
});

/* ------------------------------------------------------------------ */
/* 5. Neutralisation des statistiques (section 43)                     */
/* ------------------------------------------------------------------ */

describe("redactStatistics — dire « on ne sait pas », pas « personne n'y passe »", () => {
  it("conserve l'identité du segment, l'activité et le sens", () => {
    const redacted = redactStatistics(stats({ activity: "trail", direction: "backward" }));
    expect(redacted.segmentId).toBe("melo");
    expect(redacted.activity).toBe("trail");
    expect(redacted.direction).toBe("backward");
  });

  it("neutralise tout comptage, toute durée et tout horodatage", () => {
    const redacted = redactStatistics(stats());
    expect(redacted.passages).toEqual({ last7: 0, last30: 0, last365: 0, total: 0 });
    expect(redacted.uniqueSessions).toBe(0);
    expect(redacted.uniqueUsers).toBe(0);
    expect(redacted.duration).toBeNull();
    expect(redacted.averageSpeedMs).toBeNull();
    expect(redacted.firstPassageAt).toBeNull();
    expect(redacted.lastPassageAt).toBeNull();
    expect(redacted.popularityScore).toBe(0);
    expect(redacted.trend).toBeNull();
  });

  it("déclare l'ignorance plutôt que l'absence de fréquentation", () => {
    const redacted = redactStatistics(stats({ possiblyInactive: true }));
    expect(redacted.frequentation).toBe("unknown");
    expect(redacted.insufficientData).toBe(true);
    expect(redacted.confidence).toBe(0);
    expect(redacted.possiblyInactive).toBe(false);
  });

  it("vide les distributions (activités, mois, heures)", () => {
    const redacted = redactStatistics(stats());
    expect(redacted.activityMix).toEqual({});
    expect(Object.keys(redacted.monthly)).toHaveLength(0);
    expect(Object.keys(redacted.hourly)).toHaveLength(0);
  });

  it("produit une statistique non publiable", () => {
    expect(isPublishable(redactStatistics(stats()))).toBe(false);
    expect(isPublishable(redactStatistics(stats()), 1)).toBe(false);
  });

  it("renvoie un nouvel objet sans toucher à l'original", () => {
    const original = stats();
    const before = structuredClone(original);
    const redacted = redactStatistics(original);
    expect(redacted).not.toBe(original);
    expect(original).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Conservation limitée des traces brutes (section 34)              */
/* ------------------------------------------------------------------ */

describe("rétention des traces brutes", () => {
  it("place la limite de purge à RAW_TRACE_RETENTION_DAYS par défaut", () => {
    expect(RAW_TRACE_RETENTION_DAYS).toBe(90);
    expect(retentionCutoff(START_AT)).toBe(START_AT - RAW_TRACE_RETENTION_DAYS * DAY_MS);
  });

  it("accepte une durée de conservation personnalisée", () => {
    expect(retentionCutoff(START_AT, 30)).toBe(START_AT - 30 * DAY_MS);
    expect(retentionCutoff(START_AT, 0)).toBe(START_AT);
  });

  it("retombe sur le défaut quand la durée demandée est illisible", () => {
    expect(retentionCutoff(START_AT, -10)).toBe(retentionCutoff(START_AT));
    expect(retentionCutoff(START_AT, Number.NaN)).toBe(retentionCutoff(START_AT));
  });

  it("reste exploitable quand l'instant courant est illisible", () => {
    expect(Number.isFinite(retentionCutoff(Number.NaN))).toBe(true);
  });

  it("déclare périmée une trace plus ancienne que la durée de conservation", () => {
    expect(isRawTraceExpired(START_AT - 91 * DAY_MS, START_AT)).toBe(true);
    expect(isRawTraceExpired(START_AT - 89 * DAY_MS, START_AT)).toBe(false);
  });

  it("ne purge pas une trace arrivée exactement à la limite", () => {
    expect(isRawTraceExpired(retentionCutoff(START_AT), START_AT)).toBe(false);
  });

  it("purge tout avec une durée de conservation nulle", () => {
    expect(isRawTraceExpired(START_AT - 1, START_AT, 0)).toBe(true);
    expect(isRawTraceExpired(START_AT - 1, START_AT, 30)).toBe(false);
  });

  it("considère comme périmée une trace dont l'âge est illisible", () => {
    expect(isRawTraceExpired(Number.NaN, START_AT)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 7. inPrivacyZone                                                    */
/* ------------------------------------------------------------------ */

describe("inPrivacyZone", () => {
  it("reconnaît un point situé dans la zone et un point situé dehors", () => {
    const zones = [zoneAt(1000, 200)];
    expect(inPrivacyZone(at(1100), zones)).toBe(true);
    expect(inPrivacyZone(at(1400), zones)).toBe(false);
  });

  it("teste toutes les zones déclarées, quel que soit leur ordre", () => {
    const zones = [zoneAt(500, 100), zoneAt(2000, 100)];
    expect(inPrivacyZone(at(2000), zones)).toBe(true);
    expect(inPrivacyZone(at(2000), [...zones].reverse())).toBe(true);
  });

  it("protège PRIVACY_ZONE_MIN_RADIUS_M autour d'une zone sans rayon exploitable", () => {
    expect(inPrivacyZone(at(1010), [zoneAt(1000, 0)])).toBe(true);
    expect(inPrivacyZone(at(1100), [zoneAt(1000, 0)])).toBe(false);
  });

  it("renvoie faux sans zone, et faux pour un point illisible", () => {
    expect(inPrivacyZone(at(1000), [])).toBe(false);
    expect(inPrivacyZone({ lat: Number.NaN, lng: 9.07 }, [zoneAt(1000, 5000)])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 8. Déterminisme (règle de reproductibilité)                         */
/* ------------------------------------------------------------------ */

describe("déterminisme", () => {
  it("rend exactement le même résultat pour les mêmes entrées", () => {
    const points = trace(4000);
    const zones = [zoneAt(1200, 200), zoneAt(2600, 150)];
    const premier = maskTrace(points, { zones });
    const second = maskTrace(structuredClone(points), { zones: structuredClone(zones) });
    expect(second).toEqual(premier);
  });

  it("ne dépend pas de l'ordre des zones déclarées", () => {
    const points = trace(4000);
    const zones = [zoneAt(1200, 200), zoneAt(2600, 150)];
    expect(maskTrace(points, { zones: [...zones].reverse() })).toEqual(maskTrace(points, { zones }));
  });

  it("tranche toujours de la même façon entre deux morceaux de même longueur", () => {
    const points = trace(2000);
    // La zone centrale coupe la trace en deux morceaux strictement égaux.
    const zones = [zoneAt(1000, 50)];
    const premier = maskTrace(points, { zones, trimStartM: 0, trimEndM: 0 });
    const second = maskTrace(points, { zones, trimStartM: 0, trimEndM: 0 });
    expect(premier).toEqual(second);
    // À égalité parfaite, le premier morceau l'emporte : le résultat est stable.
    expect(indexOf(premier.points[0])).toBe(0);
    expect(indexOf(premier.points[premier.points.length - 1])).toBe(9);
  });
});
