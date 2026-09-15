/**
 * Tests de la qualité des relevés (sections 4 et 6).
 *
 * Les géométries sont construites avec `offsetPoint` depuis des lieux réels de
 * Corse (Restonica, Bavella, GR 20) : les distances et les vitesses des
 * scénarios sont donc celles du terrain, pas des coordonnées inventées.
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint } from "../geo";
import { ACTIVITY_MODES } from "../navigation/types";
import type { RawPoint } from "./types";
import {
  MAX_SPEED_MS,
  MIN_USABLE_QUALITY,
  UNKNOWN_ACCURACY_QUALITY,
  scoreTrace,
  traceQuality,
  usablePoints,
} from "./quality";

/** Bergeries de Grotelle, haute Restonica. */
const GROTELLE = { lat: 42.2718, lng: 9.0731 };
/** Aiguilles de Bavella. */
const BAVELLA = { lat: 41.7961, lng: 9.2247 };

const T0 = 1_700_000_000_000;

/** Vitesses de référence (m/s) : marche 4 km/h, marche soutenue 5 km/h, trail 8, VTT 12. */
const WALK_MS = 4000 / 3600;
const BRISK_MS = 5000 / 3600;

function raw(p: { lat: number; lng: number }, at: number, extra: Partial<RawPoint> = {}): RawPoint {
  return { lat: p.lat, lng: p.lng, alt: null, at, accuracy: 8, speed: null, heading: null, ...extra };
}

/** Trace rectiligne : `count` relevés au cap `brg`, à `speedMs`, tous les `intervalMs`. */
function straight(
  start: { lat: number; lng: number },
  brg: number,
  count: number,
  speedMs: number,
  intervalMs: number,
  extra: Partial<RawPoint> = {},
): RawPoint[] {
  const stepM = speedMs * (intervalMs / 1000);
  const out: RawPoint[] = [];
  for (let i = 0; i < count; i++) out.push(raw(offsetPoint(start, i * stepM, brg), T0 + i * intervalMs, extra));
  return out;
}

/** Trace de référence du cahier des charges : marcheur à 5 km/h, un relevé projeté à 120 m. */
function traceAvecTeleport(): { trace: RawPoint[]; index: number } {
  const base = straight(GROTELLE, 90, 9, BRISK_MS, 10_000);
  const index = 4;
  const trace = [...base];
  // Le relevé part à 120 m au nord du sentier puis revient au relevé suivant.
  trace[index] = raw(offsetPoint(base[index], 120, 0), base[index].at);
  return { trace, index };
}

describe("plafonds de vitesse", () => {
  it("classe les activités et laisse passer une descente VTT à 12 m/s", () => {
    expect(MAX_SPEED_MS.hiking).toBeLessThan(MAX_SPEED_MS.trail);
    expect(MAX_SPEED_MS.trail).toBeLessThan(MAX_SPEED_MS.equestrian);
    expect(MAX_SPEED_MS.equestrian).toBeLessThan(MAX_SPEED_MS.mtb);
    expect(MAX_SPEED_MS.mtb).toBeGreaterThan(12);
    expect(ACTIVITY_MODES.every((mode) => Number.isFinite(MAX_SPEED_MS[mode]))).toBe(true);
  });
});

describe("scoreTrace — trace saine", () => {
  it("laisse intacte une marche régulière en Restonica", () => {
    const scored = scoreTrace(straight(GROTELLE, 90, 12, WALK_MS, 10_000), "hiking");
    expect(scored).toHaveLength(12);
    expect(scored.every((p) => p.flags.length === 0)).toBe(true);
    expect(scored.every((p) => p.quality === 4)).toBe(true); // précision annoncée 8 m → « bon »
    expect(scored[0].stepM).toBeNull();
    expect(scored[0].observedSpeedMs).toBeNull();
    expect(scored[1].stepM).toBeCloseTo(11.1, 1);
    expect(scored[1].observedSpeedMs).toBeCloseTo(WALK_MS, 2);
    expect(usablePoints(scored)).toHaveLength(12);
  });

  it("ne casse pas un lacet enregistré toutes les minutes (mode économie)", () => {
    // Montée du GR 20 : 70 m de montée, demi-tour du lacet, retour presque au départ.
    const trace = [
      raw(BAVELLA, T0),
      raw(offsetPoint(BAVELLA, 70, 20), T0 + 60_000),
      raw(offsetPoint(BAVELLA, 6, 20), T0 + 120_000),
    ];
    const scored = scoreTrace(trace, "hiking");
    // L'aller-retour est faisable à pied en deux minutes : aucun indice cinématique.
    expect(scored[1].flags).toHaveLength(0);
    expect(scored[1].quality).toBe(4);
  });
});

describe("scoreTrace — téléport (section 6)", () => {
  it("isole le relevé à 120 m sans dégrader ses voisins", () => {
    const { trace, index } = traceAvecTeleport();
    const scored = scoreTrace(trace, "hiking");

    expect(scored[index].flags).toContain("teleport");
    expect(scored[index].quality).toBe(0);
    expect(scored[index].stepM).toBeCloseTo(120.8, 0);

    // Les voisins restent parfaitement exploitables.
    expect(scored[index - 1].flags).toHaveLength(0);
    expect(scored[index - 1].quality).toBe(4);
    expect(scored[index + 1].flags).toHaveLength(0);
    expect(scored[index + 1].quality).toBe(4);
    // Le point suivant est mesuré depuis le dernier point retenu, pas depuis l'aberration.
    expect(scored[index + 1].stepM).toBeCloseTo(2 * BRISK_MS * 10, 0);
    expect(scored[index + 1].observedSpeedMs).toBeCloseTo(BRISK_MS, 2);

    expect(usablePoints(scored)).toHaveLength(8);
  });

  it("avec un facteur trop permissif, l'aberration contamine son voisin", () => {
    const { trace, index } = traceAvecTeleport();
    const scored = scoreTrace(trace, "hiking", { teleportFactor: 40 });
    expect(scored[index].flags).not.toContain("teleport");
    // D'où l'intérêt du critère : sans lui, le relevé suivant hérite d'une vitesse absurde.
    expect(scored[index + 1].flags).toContain("speed");
    expect(scored[index + 1].quality).toBeLessThan(MIN_USABLE_QUALITY);
  });

  it("ne voit pas de téléport dans une descente VTT rectiligne à 12 m/s", () => {
    const descent = straight(BAVELLA, 200, 10, 12, 5000, { accuracy: 5 });
    const scored = scoreTrace(descent, "mtb");
    expect(scored.every((p) => p.flags.length === 0)).toBe(true);
    expect(scored.every((p) => p.quality === 5)).toBe(true);
    expect(usablePoints(scored)).toHaveLength(10);

    // La même trace en « marche » : vitesse implausible, mais un seul indice.
    const asHiking = scoreTrace(descent, "hiking");
    expect(asHiking[3].flags).toEqual(["speed"]);
    expect(asHiking[3].quality).toBe(3);
  });
});

describe("scoreTrace — précision annoncée (section 4)", () => {
  it("applique l'échelle de précision et ne suppose jamais une précision parfaite", () => {
    const ladder: readonly (readonly [number | null, number])[] = [
      [3, 5],
      [5, 5],
      [8, 4],
      [10, 4],
      [15, 3],
      [20, 3],
      [30, 2],
      [35, 2],
      [50, 1],
      [60, 1],
      [90, 0],
      [null, UNKNOWN_ACCURACY_QUALITY],
    ];
    for (const [accuracy, expected] of ladder) {
      const scored = scoreTrace([raw(GROTELLE, T0, { accuracy })], "hiking");
      expect(scored[0].quality, `précision ${accuracy}`).toBe(expected);
    }
    expect(scoreTrace([raw(GROTELLE, T0, { accuracy: 90 })], "hiking")[0].flags).toContain("accuracy");
    expect(scoreTrace([raw(GROTELLE, T0, { accuracy: null })], "hiking")[0].flags).toHaveLength(0);
  });

  it("maxAccuracyM ne peut que durcir le plafond", () => {
    const point = [raw(GROTELLE, T0, { accuracy: 30 })];
    expect(scoreTrace(point, "hiking", { maxAccuracyM: 20 })[0].quality).toBe(0);
    expect(scoreTrace(point, "hiking", { maxAccuracyM: 20 })[0].flags).toContain("accuracy");
    // Un plafond plus laxiste est ignoré : au-delà de 60 m, la position ne veut rien dire.
    expect(scoreTrace([raw(GROTELLE, T0, { accuracy: 90 })], "hiking", { maxAccuracyM: 200 })[0].quality).toBe(0);
  });
});

describe("scoreTrace — immobilité et doublons", () => {
  it("marque l'immobilité sans dégrader la qualité du point", () => {
    // Pause aux bergeries : le récepteur tourne autour de la même position.
    const rest: RawPoint[] = [];
    for (let i = 0; i < 5; i++) rest.push(raw(offsetPoint(GROTELLE, 0.4, i * 90), T0 + i * 30_000));
    const scored = scoreTrace(rest, "hiking");
    expect(scored[1].flags).toEqual(["still"]);
    expect(scored[1].quality).toBe(4);
    expect(scored[2].observedSpeedMs).not.toBeNull();
    expect(scored[2].observedSpeedMs ?? 1).toBeLessThan(0.3);
    // Un point à l'arrêt reste un point juste : il n'est pas exclu par le score.
    expect(usablePoints(scored)).toHaveLength(5);
  });

  it("écarte un doublon et repart du dernier point retenu", () => {
    const at1 = T0 + 10_000;
    const trace = [
      raw(GROTELLE, T0),
      raw(offsetPoint(GROTELLE, 12, 90), at1),
      raw(offsetPoint(GROTELLE, 12, 90), at1), // même position, même instant
      raw(offsetPoint(GROTELLE, 24, 90), T0 + 20_000),
    ];
    const scored = scoreTrace(trace, "hiking");
    expect(scored[2].flags).toEqual(["duplicate"]);
    expect(scored[2].quality).toBe(0);
    expect(usablePoints(scored)).toHaveLength(3);
    expect(scored[3].stepM).toBeCloseTo(12, 1);
    expect(scored[3].observedSpeedMs).toBeCloseTo(1.2, 2);
  });
});

describe("scoreTrace — cinématique", () => {
  it("détecte une accélération impossible sans crier à la vitesse excessive", () => {
    const trace = [
      raw(BAVELLA, T0, { accuracy: 5 }),
      raw(offsetPoint(BAVELLA, 20, 180), T0 + 10_000, { accuracy: 5 }), // 2 m/s
      raw(offsetPoint(BAVELLA, 32, 180), T0 + 11_000, { accuracy: 5 }), // 12 m/s en 1 s
      raw(offsetPoint(BAVELLA, 52, 180), T0 + 21_000, { accuracy: 5 }), // retour à 2 m/s
    ];
    const scored = scoreTrace(trace, "mtb");
    expect(scored[2].flags).toEqual(["acceleration"]);
    expect(scored[2].observedSpeedMs).toBeCloseTo(12, 1);
    expect(scored[2].quality).toBe(4); // un seul indice : le point reste exploitable
    expect(scored[3].flags).toHaveLength(0);
    // Le seuil est un réglage : à 0,5 m/s², la décélération de fin devient suspecte.
    expect(scoreTrace(trace, "mtb", { maxAccelMs2: 0.5 })[3].flags).toContain("acceleration");
  });

  it("signale un demi-tour instantané à vitesse élevée, mais pas au pas du marcheur", () => {
    const vtt = [
      raw(BAVELLA, T0, { accuracy: 5 }),
      raw(offsetPoint(BAVELLA, 120, 180), T0 + 10_000, { accuracy: 5 }),
      raw(BAVELLA, T0 + 20_000, { accuracy: 5 }),
    ];
    const scoredVtt = scoreTrace(vtt, "mtb");
    expect(scoredVtt[1].flags).toEqual(["heading"]);
    expect(scoredVtt[1].flags).not.toContain("teleport"); // 12 m/s : l'aller-retour est faisable
    expect(scoredVtt[1].quality).toBe(4);

    const marche = [
      raw(BAVELLA, T0),
      raw(offsetPoint(BAVELLA, 12, 180), T0 + 10_000),
      raw(BAVELLA, T0 + 20_000),
    ];
    expect(scoreTrace(marche, "hiking")[1].flags).toHaveLength(0);
  });
});

describe("scoreTrace — cas limites", () => {
  it("accepte une trace vide, un point isolé et des données aberrantes", () => {
    expect(scoreTrace([], "hiking")).toEqual([]);

    const single = scoreTrace([raw(GROTELLE, T0)], "trail");
    expect(single).toHaveLength(1);
    expect(single[0].flags).toHaveLength(0);
    expect(single[0].stepM).toBeNull();
    expect(single[0].observedSpeedMs).toBeNull();
    expect(single[0].quality).toBe(4);

    const broken: RawPoint[] = [
      raw(GROTELLE, T0, { accuracy: -5 }), // précision absurde → incertitude inconnue
      { lat: Number.NaN, lng: 9.07, alt: null, at: T0 + 10_000, accuracy: 8, speed: null, heading: null },
      raw(offsetPoint(GROTELLE, 120, 90), T0), // 120 m en un temps nul
    ];
    const scored = scoreTrace(broken, "hiking");
    expect(scored[0].quality).toBe(UNKNOWN_ACCURACY_QUALITY);
    expect(scored[1].quality).toBe(0);
    expect(scored[1].flags).toContain("outlier");
    expect(scored[2].flags).toContain("speed");
    expect(scored[2].observedSpeedMs).toBeNull();
    expect(scored.every((p) => Number.isInteger(p.quality))).toBe(true);
  });

  it("ne modifie pas son entrée et reste déterministe", () => {
    const input = straight(GROTELLE, 45, 6, 1.2, 10_000);
    const snapshot = JSON.stringify(input);
    const first = scoreTrace(input, "hiking");
    const second = scoreTrace(input, "hiking");
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(second).toEqual(first);
    expect(haversineM(input[0], first[0])).toBe(0);
  });
});

describe("usablePoints", () => {
  it("filtre sur le score, avec un seuil réglable", () => {
    const mixed = scoreTrace(
      [
        raw(GROTELLE, T0, { accuracy: 3 }),
        raw(offsetPoint(GROTELLE, 12, 90), T0 + 10_000, { accuracy: 25 }),
      ],
      "hiking",
    );
    expect(mixed.map((p) => p.quality)).toEqual([5, 2]);
    expect(usablePoints(mixed)).toHaveLength(1);
    expect(usablePoints(mixed, 5)).toHaveLength(1);
    expect(usablePoints(mixed, 0)).toHaveLength(2);
  });
});

describe("traceQuality", () => {
  it("résume une trace comportant un téléport", () => {
    const { trace } = traceAvecTeleport();
    const bilan = traceQuality(scoreTrace(trace, "hiking"));
    expect(bilan.total).toBe(9);
    expect(bilan.usable).toBe(8);
    expect(bilan.medianAccuracyM).toBe(8);
    expect(bilan.averageQuality).toBeCloseTo(3.56, 2); // (8 × 4 + 0) / 9
    expect(bilan.flagged.teleport).toBe(1);
    expect(bilan.flagged.speed).toBe(0);
    expect(bilan.flagged.still).toBe(0);
  });

  it("préfère la médiane de précision à la moyenne et supporte la trace vide", () => {
    // Trois relevés propres, un relevé catastrophique en gorge : la médiane tient.
    const trace = [
      raw(GROTELLE, T0, { accuracy: 6 }),
      raw(offsetPoint(GROTELLE, 12, 90), T0 + 10_000, { accuracy: 8 }),
      raw(offsetPoint(GROTELLE, 24, 90), T0 + 20_000, { accuracy: 10 }),
      raw(offsetPoint(GROTELLE, 36, 90), T0 + 30_000, { accuracy: 120 }),
    ];
    const bilan = traceQuality(scoreTrace(trace, "hiking"));
    expect(bilan.medianAccuracyM).toBe(9);
    expect(bilan.usable).toBe(3);
    expect(bilan.flagged.accuracy).toBe(1);

    const vide = traceQuality([]);
    expect(vide.total).toBe(0);
    expect(vide.usable).toBe(0);
    expect(vide.medianAccuracyM).toBeNull();
    expect(vide.averageQuality).toBe(0);
    expect(vide.flagged.outlier).toBe(0);
  });
});
