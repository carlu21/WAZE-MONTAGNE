/**
 * Tests des temps de parcours (sections 13, 14, 16, 24, 25, 26, 41).
 *
 * Les géométries reproduisent des configurations corses réelles et sont toutes
 * construites avec `offsetPoint` depuis un point de départ unique : les sommets
 * sont donc rigoureusement alignés sur un même grand cercle, et la longueur
 * mesurée par le moteur vaut exactement la longueur demandée. Les altitudes
 * sont posées en fonction de l'abscisse, ce qui rend les pentes vérifiables à
 * la main.
 *
 * Repères utilisés :
 *  - Restonica : parking de Grotelle → lac de Melo, ~1,9 km pour 300 m de D+,
 *    dalles rocheuses (T2). Les panneaux annoncent 1 h à 1 h 30.
 *  - GR 20 : liaison roulante de 4 km, marche 4 km/h → 1 h pile.
 *  - Bavella : descente raide (-30 %) où la pente coûte du temps au lieu d'en
 *    faire gagner.
 */
import { describe, expect, it } from "vitest";
import { offsetPoint, type LngLat } from "../geo";
import type { LatLng } from "../types";
import { DEFAULT_SPEED_MS } from "../navigation/eta";
import { makeSegment } from "../navigation/graph";
import type { PathSegment } from "../navigation/types";
import type { DurationStats, TimeConfidence } from "./types";
import {
  CONFIDENCE_MIN_SAMPLES,
  DEFAULT_MIN_SAMPLES_FOR_OBSERVED,
  MAX_PLAUSIBLE_SLOPE_PCT,
  PERSONAL_FACTOR_MAX_DEVIATION,
  TIME_CONFIDENCE_RANK,
  describeEstimate,
  estimateTime,
  formatTimeConfidence,
  personalPaceFactor,
  roundEstimateMs,
  segmentProfile,
  steepDescentSeverity,
  theoreticalTimeMs,
  timeConfidence,
} from "./timing";

/* ------------------------------------------------------------------ */
/* Fabriques de géométrie                                              */
/* ------------------------------------------------------------------ */

/** Parking de Grotelle (haute Restonica). */
const GROTELLE: LatLng = { lat: 42.2727, lng: 9.0728 };
/** Cap de l'axe : la vallée monte vers le nord-est. */
const AXE_BRG = 40;
const MINUTE = 60_000;

/**
 * Ligne droite de `lengthM` mètres, un sommet tous les `stepM`, avec les
 * altitudes données par `altAt(abscisse)`.
 */
function lineWithAltitudes(
  lengthM: number,
  altAt: (d: number) => number,
  stepM = 50,
  start: LatLng = GROTELLE,
  brg = AXE_BRG,
): { coords: LngLat[]; elevations: number[] } {
  const coords: LngLat[] = [];
  const elevations: number[] = [];
  for (let d = 0; d < lengthM - 1e-6; d += stepM) {
    const p = offsetPoint(start, d, brg);
    coords.push([p.lng, p.lat]);
    elevations.push(altAt(d));
  }
  const end = offsetPoint(start, lengthM, brg);
  coords.push([end.lng, end.lat]);
  elevations.push(altAt(lengthM));
  return { coords, elevations };
}

/** Segment à pente constante : `gainM` peut être négatif (descente). */
function slopedSegment(
  id: string,
  lengthM: number,
  gainM: number,
  meta: Partial<Omit<PathSegment, "id" | "coordinates" | "lengthM">> = {},
): PathSegment {
  const baseAlt = 1400;
  const { coords, elevations } = lineWithAltitudes(lengthM, (d) => baseAlt + (gainM * d) / lengthM);
  return makeSegment(id, coords, { ...meta, elevations });
}

/** Statistiques de durée synthétiques (l'agrégateur en produit de semblables). */
function stats(count: number, medianMs: number, spread = 0.2): DurationStats {
  return {
    count,
    averageMs: Math.round(medianMs * (1 + spread / 4)),
    medianMs,
    p25Ms: Math.round(medianMs * (1 - spread / 2)),
    p75Ms: Math.round(medianMs * (1 + spread / 2)),
    spread,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Profil physique (section 16)                                     */
/* ------------------------------------------------------------------ */

describe("segmentProfile", () => {
  const melo = slopedSegment("melo", 1900, 300, { name: "Sentier du lac de Melo", surface: "rock", sacScale: "mountain_hiking" });

  it("mesure la distance sur la géométrie, pas sur la longueur déclarée", () => {
    const profile = segmentProfile(melo);
    expect(profile.distanceM).toBeGreaterThan(1899);
    expect(profile.distanceM).toBeLessThan(1901);
  });

  it("calcule D+, D- et la pente moyenne signée d'une montée régulière", () => {
    const profile = segmentProfile(melo);
    expect(profile.elevationGainM).toBeCloseTo(300, 0);
    expect(profile.elevationLossM).toBe(0);
    // 300 m sur 1900 m = 15,8 %.
    expect(profile.averageSlope).toBeCloseTo(15.79, 1);
    expect(profile.maxSlope).toBeCloseTo(15.79, 1);
  });

  it("échange D+ et D- et inverse la pente en sens inverse", () => {
    const aller = segmentProfile(melo, "forward");
    const retour = segmentProfile(melo, "backward");
    expect(retour.elevationGainM).toBe(aller.elevationLossM);
    expect(retour.elevationLossM).toBe(aller.elevationGainM);
    expect(retour.averageSlope).toBeCloseTo(-aller.averageSlope, 6);
    // La pente maximale du contrat est absolue : le sens ne la change pas.
    expect(retour.maxSlope).toBe(aller.maxSlope);
    expect(retour.distanceM).toBe(aller.distanceM);
  });

  it("compte les deux versants d'un col sans les compenser", () => {
    const { coords, elevations } = lineWithAltitudes(1000, (d) => 1400 + (d <= 500 ? d * 0.2 : (1000 - d) * 0.2));
    const col = makeSegment("col", coords, { elevations });
    const profile = segmentProfile(col);
    expect(profile.elevationGainM).toBeCloseTo(100, 0);
    expect(profile.elevationLossM).toBeCloseTo(100, 0);
    // Départ et arrivée à la même altitude : la pente moyenne est nulle,
    // alors que la pente maximale vaut bien 20 %.
    expect(profile.averageSlope).toBeCloseTo(0, 1);
    expect(profile.maxSlope).toBeCloseTo(20, 1);
  });

  it("n'invente aucun dénivelé quand les altitudes manquent ou sont désalignées", () => {
    const { coords } = lineWithAltitudes(800, () => 0);
    const sansAlt = makeSegment("sans-alt", coords);
    const nu = segmentProfile(sansAlt);
    expect(nu.distanceM).toBeGreaterThan(799);
    expect(nu.elevationGainM).toBe(0);
    expect(nu.elevationLossM).toBe(0);
    expect(nu.averageSlope).toBe(0);
    expect(nu.maxSlope).toBe(0);

    const desaligne = makeSegment("desaligne", coords, { elevations: [1400, 1500] });
    expect(segmentProfile(desaligne).elevationGainM).toBe(0);
  });

  it("refuse les pentes absurdes issues de sommets trop rapprochés", () => {
    // Trois sommets : 0 m, 4 m, 54 m, avec +30 m d'altitude sur les 4 premiers
    // mètres (erreur de MNT). Sans base minimale, la pente vaudrait 750 %.
    const p0 = GROTELLE;
    const p1 = offsetPoint(GROTELLE, 4, AXE_BRG);
    const p2 = offsetPoint(GROTELLE, 54, AXE_BRG);
    const seg = makeSegment("mnt-bruite", [[p0.lng, p0.lat], [p1.lng, p1.lat], [p2.lng, p2.lat]], {
      elevations: [1000, 1030, 1035],
    });
    const profile = segmentProfile(seg);
    expect(profile.maxSlope).toBeLessThan(100);
    expect(profile.maxSlope).toBeCloseTo(64.8, 0);
  });

  it("borne les pentes physiquement impossibles", () => {
    const { coords, elevations } = lineWithAltitudes(20, (d) => 1400 + d * 3, 20);
    const falaise = makeSegment("falaise", coords, { elevations });
    const profile = segmentProfile(falaise);
    expect(profile.maxSlope).toBe(MAX_PLAUSIBLE_SLOPE_PCT);
    expect(profile.averageSlope).toBe(MAX_PLAUSIBLE_SLOPE_PCT);
  });

  it("traite les segments dégénérés sans planter", () => {
    const vide: PathSegment = {
      id: "vide",
      name: null,
      kind: "path",
      surface: null,
      sacScale: null,
      widthM: null,
      foot: true,
      bicycle: true,
      horse: true,
      ford: false,
      status: null,
      coordinates: [],
      elevations: null,
      lengthM: 0,
      source: "local",
      sourceFeatureId: null,
    };
    const profileVide = segmentProfile(vide);
    expect(profileVide.distanceM).toBe(0);
    expect(theoreticalTimeMs(profileVide, "hiking")).toBe(0);

    // Un import incomplet (un seul sommet) garde au moins sa longueur déclarée.
    const unPoint: PathSegment = { ...vide, id: "un-point", coordinates: [[GROTELLE.lng, GROTELLE.lat]], lengthM: 800 };
    expect(segmentProfile(unPoint).distanceM).toBe(800);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Temps théorique (section 14)                                     */
/* ------------------------------------------------------------------ */

describe("theoreticalTimeMs", () => {
  const liaisonPlate = segmentProfile(slopedSegment("gr20-liaison", 4000, 0));

  it("retrouve la vitesse de référence sur le plat", () => {
    // 4 km à 4 km/h = 1 h pile, sans majoration de terrain.
    expect(theoreticalTimeMs(liaisonPlate, "hiking")).toBe(3600 * 1000);
    expect(theoreticalTimeMs(liaisonPlate, "trail")).toBe(1800 * 1000);
    expect(theoreticalTimeMs(liaisonPlate, "mtb")).toBe(1200 * 1000);
  });

  it("classe les activités de la plus lente à la plus rapide", () => {
    const hiking = theoreticalTimeMs(liaisonPlate, "hiking");
    const equestrian = theoreticalTimeMs(liaisonPlate, "equestrian");
    const trail = theoreticalTimeMs(liaisonPlate, "trail");
    const mtb = theoreticalTimeMs(liaisonPlate, "mtb");
    expect(hiking).toBeGreaterThan(equestrian);
    expect(equestrian).toBeGreaterThan(trail);
    expect(trail).toBeGreaterThan(mtb);
    // Cohérence avec le moteur de navigation : le plat suit DEFAULT_SPEED_MS.
    expect(mtb).toBe(Math.round((liaisonPlate.distanceM / DEFAULT_SPEED_MS.mtb) * 1000));
  });

  it("applique la majoration de Naismith à la montée", () => {
    // 1 km + 300 m de D+ à pied : 900 s de plat + 300 × 6 s = 45 min.
    const montee = segmentProfile(slopedSegment("montee", 1000, 300));
    expect(theoreticalTimeMs(montee, "hiking")).toBe(2700 * 1000);
  });

  it("pénalise une descente raide mais pas une descente douce", () => {
    const raide = segmentProfile(slopedSegment("bavella-raide", 1000, -300));
    const douce = segmentProfile(slopedSegment("bavella-douce", 1000, -100));
    // -30 % : sévérité 0,5 → 300 m × 3,6 s × 0,5 = 540 s en plus des 900 s de plat.
    expect(theoreticalTimeMs(raide, "hiking")).toBe(1440 * 1000);
    // -10 % : la descente reste gratuite.
    expect(theoreticalTimeMs(douce, "hiking")).toBe(900 * 1000);
    expect(theoreticalTimeMs(raide, "hiking")).toBeGreaterThan(theoreticalTimeMs(douce, "hiking"));
  });

  it("garde la descente plus rapide que la montée équivalente", () => {
    const melo = slopedSegment("melo", 1900, 300, { surface: "rock", sacScale: "mountain_hiking" });
    const montee = theoreticalTimeMs(segmentProfile(melo, "forward"), "hiking");
    const descente = theoreticalTimeMs(segmentProfile(melo, "backward"), "hiking");
    expect(descente).toBeLessThan(montee);
    expect(descente).toBeGreaterThan(montee * 0.3);
  });

  it("gradue la sévérité de la pénalité de descente", () => {
    expect(steepDescentSeverity(0)).toBe(0);
    expect(steepDescentSeverity(-19)).toBe(0);
    expect(steepDescentSeverity(-30)).toBeCloseTo(0.5, 6);
    expect(steepDescentSeverity(-40)).toBe(1);
    expect(steepDescentSeverity(-80)).toBe(1);
    expect(steepDescentSeverity(Number.NaN)).toBe(0);
  });

  it("ralentit sur le rocher, le pierrier et la boue", () => {
    const base = segmentProfile(slopedSegment("s-base", 1000, 0));
    const temps = (surface: string): number =>
      theoreticalTimeMs(segmentProfile(slopedSegment(`s-${surface}`, 1000, 0, { surface })), "hiking");
    expect(temps("rock")).toBeGreaterThan(temps("gravel"));
    expect(temps("scree")).toBeGreaterThan(temps("ground"));
    expect(temps("mud")).toBeGreaterThan(temps("paved"));
    // Un revêtement inconnu ne pénalise pas : on ne punit pas l'absence de donnée.
    expect(temps("surface_jamais_vue")).toBe(theoreticalTimeMs(base, "hiking"));
  });

  it("ralentit avec la difficulté alpine (sac_scale)", () => {
    const temps = (sacScale: string | null): number =>
      theoreticalTimeMs(segmentProfile(slopedSegment(`t-${sacScale}`, 1000, 0, { sacScale })), "hiking");
    expect(temps("hiking")).toBe(temps(null));
    expect(temps("mountain_hiking")).toBeGreaterThan(temps("hiking"));
    expect(temps("demanding_mountain_hiking")).toBeGreaterThan(temps("mountain_hiking"));
    expect(temps("alpine_hiking")).toBeGreaterThan(temps("demanding_mountain_hiking"));
  });

  it("rend les escaliers et la via ferrata prohibitifs à VTT et à cheval", () => {
    const escaliers = segmentProfile(slopedSegment("escaliers", 1000, 0, { kind: "steps" }));
    const sentier = segmentProfile(slopedSegment("sentier", 1000, 0, { kind: "path" }));
    // Vélo sur l'épaule : plus lent qu'un marcheur sur les mêmes marches.
    expect(theoreticalTimeMs(escaliers, "mtb")).toBeGreaterThan(theoreticalTimeMs(escaliers, "hiking"));
    expect(theoreticalTimeMs(escaliers, "mtb")).toBeGreaterThan(theoreticalTimeMs(sentier, "mtb") * 3);
    expect(theoreticalTimeMs(escaliers, "equestrian")).toBeGreaterThan(theoreticalTimeMs(sentier, "equestrian") * 4);

    const ferrata = segmentProfile(slopedSegment("ferrata", 1000, 0, { kind: "via_ferrata" }));
    expect(theoreticalTimeMs(ferrata, "hiking")).toBeGreaterThan(theoreticalTimeMs(sentier, "hiking") * 2);
  });

  it("donne un temps réaliste sur la montée du lac de Melo", () => {
    const melo = slopedSegment("melo", 1900, 300, { surface: "rock", sacScale: "mountain_hiking" });
    const ms = theoreticalTimeMs(segmentProfile(melo), "hiking");
    // Les panneaux de la Restonica annoncent 1 h à 1 h 30 : l'estimation doit
    // tomber dans cette fourchette élargie, jamais à 30 min ni à 3 h.
    expect(ms).toBeGreaterThan(70 * MINUTE);
    expect(ms).toBeLessThan(110 * MINUTE);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Théorique → observé (section 25) et rythme personnel (24)         */
/* ------------------------------------------------------------------ */

describe("estimateTime", () => {
  const THEORIQUE = 3_600_000;
  const OBSERVE = 4_800_000;

  it("reste purement théorique sans observation", () => {
    const estimate = estimateTime({ theoreticalMs: THEORIQUE, observed: null });
    expect(estimate.ms).toBe(THEORIQUE);
    expect(estimate.observedWeight).toBe(0);
    expect(estimate.observedMs).toBeNull();
    expect(estimate.samples).toBe(0);
    expect(estimate.personalFactor).toBeNull();
    expect(estimate.confidence).toBe("very_low");
  });

  it("donne un poids croissant aux observations", () => {
    const un = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(1, OBSERVE) });
    const cinq = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(5, OBSERVE) });
    const cinquante = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(50, OBSERVE) });
    expect(un.observedWeight).toBeCloseTo(1 / 6, 3);
    expect(cinq.observedWeight).toBeCloseTo(0.5, 6);
    expect(cinquante.observedWeight).toBeCloseTo(50 / 55, 3);
    // 5 passages : exactement à mi-chemin entre théorique et médiane observée.
    expect(cinq.ms).toBe((THEORIQUE + OBSERVE) / 2);
    expect(un.ms).toBeLessThan(cinq.ms);
    expect(cinq.ms).toBeLessThan(cinquante.ms);
    // Avec 50 passages, l'estimation colle à l'observation.
    expect(Math.abs(cinquante.ms - OBSERVE)).toBeLessThan(Math.abs(cinquante.ms - THEORIQUE));
    expect(cinquante.observedMs).toBe(OBSERVE);
    expect(cinquante.samples).toBe(50);
  });

  it("respecte un seuil d'observations personnalisé", () => {
    const estimate = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(1, OBSERVE), minSamplesForObserved: 1 });
    expect(estimate.observedWeight).toBeCloseTo(0.5, 6);
    // Un seuil absurde retombe sur le défaut documenté.
    const invalide = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(5, OBSERVE), minSamplesForObserved: 0 });
    expect(invalide.observedWeight).toBeCloseTo(5 / (5 + DEFAULT_MIN_SAMPLES_FOR_OBSERVED), 6);
  });

  it("applique le rythme personnel après le mélange, borné", () => {
    const rapide = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(5, OBSERVE), personalFactor: 0.85 });
    expect(rapide.personalFactor).toBe(0.85);
    expect(rapide.ms).toBe(Math.round(((THEORIQUE + OBSERVE) / 2) * 0.85));

    const absurde = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(5, OBSERVE), personalFactor: 3 });
    expect(absurde.personalFactor).toBe(1 + PERSONAL_FACTOR_MAX_DEVIATION);

    for (const invalide of [0, -1, Number.NaN, null, undefined]) {
      const estimate = estimateTime({ theoreticalMs: THEORIQUE, observed: null, personalFactor: invalide });
      expect(estimate.personalFactor).toBeNull();
      expect(estimate.ms).toBe(THEORIQUE);
    }
  });

  it("ignore des statistiques vides ou incohérentes", () => {
    const zero = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(0, OBSERVE) });
    expect(zero.samples).toBe(0);
    expect(zero.ms).toBe(THEORIQUE);
    const medianeNulle = estimateTime({ theoreticalMs: THEORIQUE, observed: stats(20, 0) });
    expect(medianeNulle.observedMs).toBeNull();
    expect(medianeNulle.confidence).toBe("very_low");
    // Théorique non exploitable : 0 plutôt qu'un NaN qui contaminerait l'ETA.
    expect(estimateTime({ theoreticalMs: Number.NaN, observed: null }).ms).toBe(0);
  });
});

describe("personalPaceFactor", () => {
  /** `count` sorties où l'utilisateur met `ratio` × le temps de la communauté. */
  const serie = (count: number, ratio: number): { observedMs: number; referenceMs: number }[] =>
    Array.from({ length: count }, (_, i) => ({ observedMs: (2400_000 + i * 60_000) * ratio, referenceMs: 2400_000 + i * 60_000 }));

  it("mesure un traileur plus rapide que la communauté", () => {
    const result = personalPaceFactor(serie(6, 0.75));
    expect(result).not.toBeNull();
    expect(result?.factor).toBeCloseTo(0.75, 3);
    expect(result?.samples).toBe(6);
  });

  it("refuse de conclure sous le nombre minimal de segments", () => {
    expect(personalPaceFactor([])).toBeNull();
    expect(personalPaceFactor(serie(4, 0.8))).toBeNull();
    expect(personalPaceFactor(serie(3, 0.8), { minSamples: 2 })?.factor).toBeCloseTo(0.8, 3);
  });

  it("écarte les sorties aberrantes sans les compter comme échantillons", () => {
    // Une sortie « pique-nique au lac » : 12 fois le temps de référence.
    const avecAberration = [...serie(5, 0.8), { observedMs: 12 * 3600_000, referenceMs: 3600_000 }];
    const result = personalPaceFactor(avecAberration);
    expect(result?.samples).toBe(5);
    expect(result?.factor).toBeCloseTo(0.8, 3);
    // Durées nulles ou négatives : ignorées, pas de division par zéro.
    expect(personalPaceFactor([...serie(5, 0.8), { observedMs: 0, referenceMs: 0 }])?.samples).toBe(5);
  });

  it("borne le facteur pour qu'une série atypique ne dérègle pas tout", () => {
    expect(personalPaceFactor(serie(6, 2.5))?.factor).toBe(1 + PERSONAL_FACTOR_MAX_DEVIATION);
    expect(personalPaceFactor(serie(6, 0.3))?.factor).toBe(1 - PERSONAL_FACTOR_MAX_DEVIATION);
    expect(personalPaceFactor(serie(6, 0.75), { maxDeviation: 0.1 })?.factor).toBeCloseTo(0.9, 3);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Confiance et restitution (sections 26 et 41)                     */
/* ------------------------------------------------------------------ */

describe("timeConfidence", () => {
  const H2 = 7_200_000;

  it("ne donne aucune confiance sous trois passages", () => {
    expect(timeConfidence(null)).toBe("very_low");
    expect(timeConfidence(stats(1, H2, 0))).toBe("very_low");
    expect(timeConfidence(stats(CONFIDENCE_MIN_SAMPLES - 1, H2, 0))).toBe("very_low");
  });

  it("plafonne la confiance d'un tout petit échantillon, même parfaitement groupé", () => {
    expect(timeConfidence(stats(4, H2, 0))).toBe("low");
    expect(timeConfidence(stats(8, H2, 0))).toBe("medium");
  });

  it("croît avec le nombre de passages", () => {
    const niveaux = [3, 5, 10, 25, 60, 486].map((n) => TIME_CONFIDENCE_RANK[timeConfidence(stats(n, H2, 0.15))]);
    for (let i = 1; i < niveaux.length; i++) {
      expect(niveaux[i]).toBeGreaterThanOrEqual(niveaux[i - 1]);
    }
    expect(timeConfidence(stats(486, H2, 0.2))).toBe("very_high");
  });

  it("refuse la confiance quand les durées sont dispersées, même avec des centaines de passages", () => {
    // IQR = 1,4 × médiane : entre 1 h et 3 h selon les personnes.
    expect(timeConfidence(stats(120, H2, 1.4))).toBe("very_low");
    expect(timeConfidence(stats(120, H2, 0.6))).toBe("medium");
    expect(TIME_CONFIDENCE_RANK[timeConfidence(stats(120, H2, 0.6))]).toBeLessThan(
      TIME_CONFIDENCE_RANK[timeConfidence(stats(120, H2, 0.1))],
    );
    // Dispersion inconnue : traitée comme la pire, jamais comme parfaite.
    expect(timeConfidence({ ...stats(120, H2, 0), spread: Number.NaN })).toBe("very_low");
  });
});

describe("restitution", () => {
  it("nomme les niveaux de confiance en français", () => {
    const attendus: Record<TimeConfidence, string> = {
      very_low: "Très faible",
      low: "Faible",
      medium: "Moyenne",
      high: "Élevée",
      very_high: "Très élevée",
    };
    for (const [level, label] of Object.entries(attendus) as [TimeConfidence, string][]) {
      expect(formatTimeConfidence(level)).toBe(label);
    }
  });

  it("décrit une estimation solide à la minute près", () => {
    const estimate = estimateTime({ theoreticalMs: 8_100_000, observed: stats(486, 8_100_000, 0.2) });
    expect(describeEstimate(estimate)).toBe("2 h 15, basé sur 486 passages, confiance très élevée");
  });

  it("n'affiche jamais une durée précise sur trois passages (section 26)", () => {
    // 2 h 14 min 10 s observées sur 3 passages : affichées au quart d'heure près.
    const estimate = estimateTime({ theoreticalMs: 8_050_000, observed: stats(3, 8_050_000, 0.1) });
    expect(estimate.confidence).toBe("low");
    expect(describeEstimate(estimate)).toBe("2 h 10, basé sur 3 passages, confiance faible");
    expect(describeEstimate(estimate)).not.toContain("2 h 14");
  });

  it("dit quand la durée ne vient pas du terrain, et accorde le singulier", () => {
    const theorique = estimateTime({ theoreticalMs: 3_600_000, observed: null });
    expect(describeEstimate(theorique)).toBe("1 h, estimation théorique, confiance très faible");
    const unPassage = estimateTime({ theoreticalMs: 3_600_000, observed: stats(1, 3_600_000, 0) });
    expect(describeEstimate(unPassage)).toContain("basé sur 1 passage,");
  });

  it("n'arrondit pas une courte liaison à un quart d'heure", () => {
    expect(roundEstimateMs(240_000, "very_low")).toBe(240_000);
    expect(roundEstimateMs(8_050_000, "low")).toBe(7_800_000);
    expect(roundEstimateMs(8_050_000, "very_high")).toBe(8_040_000);
    expect(roundEstimateMs(0, "medium")).toBe(0);
    expect(roundEstimateMs(Number.NaN, "high")).toBe(0);
  });
});
