/**
 * Tests de « Randonnées autour de vous » (sections 13, 18, 19, 20, 21, 37).
 *
 * Le terrain est corse et les géométries sont construites avec `offsetPoint` :
 * la montée des bergeries de Grotelle au lac de Melo (Restonica, aller-retour),
 * le tour du Monte d'Oro (boucle), une portion de GR 20 entre deux refuges
 * (linéaire) et les aiguilles de Bavella. Aucune coordonnée n'est inventée au
 * hasard : chaque tracé est engendré à partir d'un point réel, d'un cap et
 * d'une longueur, ce qui rend les distances attendues vérifiables.
 *
 * Deux pièges sont testés pour eux-mêmes, parce que ce sont eux qui feraient
 * du mal en production :
 *
 *  1. confondre l'approche (de vous au départ) et la longueur de la randonnée ;
 *  2. transformer « on ne sait pas » en « zéro » — une fréquentation inconnue
 *     prise pour un sentier calme.
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint, polylineLengthM, type LngLat } from "../geo";
import type { LatLng } from "../types";
import {
  LOOP_TOLERANCE_M,
  NEARBY_MIN_RESULTS,
  NEARBY_RADII_M,
  type NearbySort,
  type NearbyTrail,
} from "./types";
import {
  APPROACH_UNKNOWN_LABEL,
  LENGTH_UNKNOWN_LABEL,
  NEARBY_ENRICH_SUFFIX,
  RETRACE_TOLERANCE_M,
  SHAPE_MIN_LENGTH_M,
  describeApproach,
  describeLength,
  nearbyNote,
  nearestTrailhead,
  rankNearby,
  reportHint,
  selectRadius,
  trailShape,
} from "./nearby";

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute Restonica : le départ vers le lac de Melo. */
const GROTELLE: LatLng = { lat: 42.2718, lng: 9.0731 };
/** Corte, en bas de la vallée. */
const CORTE: LatLng = { lat: 42.3061, lng: 9.1494 };
/** Col de Bavella. */
const BAVELLA: LatLng = { lat: 41.7936, lng: 9.2247 };

const toLngLat = (p: LatLng): LngLat => [p.lng, p.lat];
const at = (line: readonly LngLat[], i: number): LatLng => ({ lat: line[i][1], lng: line[i][0] });
const last = (line: readonly LngLat[]): LatLng => at(line, line.length - 1);

/** Tronçon rectiligne de `lengthM` mètres depuis `start`, au cap `brg`. */
function leg(start: LatLng, brg: number, lengthM: number, stepM = 50): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d < lengthM; d += stepM) out.push(toLngLat(offsetPoint(start, d, brg)));
  out.push(toLngLat(offsetPoint(start, lengthM, brg)));
  return out;
}

/** Enchaînement de tronçons : chaque cap repart du point atteint. */
function chain(start: LatLng, legs: readonly { brg: number; m: number }[], stepM = 50): LngLat[] {
  let cursor = start;
  const out: LngLat[] = [toLngLat(cursor)];
  for (const l of legs) {
    const part = leg(cursor, l.brg, l.m, stepM);
    for (let i = 1; i < part.length; i++) out.push(part[i]);
    cursor = last(part);
  }
  return out;
}

const reversed = (line: readonly LngLat[]): LngLat[] => line.map((c) => [c[0], c[1]] as LngLat).reverse();

/** Aller-retour : on redescend par où l'on est monté. */
function outAndBack(line: readonly LngLat[]): LngLat[] {
  return [...line.map((c) => [c[0], c[1]] as LngLat), ...reversed(line).slice(1)];
}

/** Anneau fermé de rayon `radiusM` autour d'un centre. */
function ring(center: LatLng, radiusM: number, steps = 72): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < steps; i++) out.push(toLngLat(offsetPoint(center, radiusM, (i * 360) / steps)));
  out.push(out[0]);
  return out;
}

/** Montée Grotelle → lac de Melo, puis retour par le même sentier. */
const MELO_UP = leg(GROTELLE, 160, 1900);
const MELO_OUT_AND_BACK = outAndBack(MELO_UP);
/** Portion de GR 20 : d'un refuge à l'autre, on n'y revient pas. */
const GR20 = chain(BAVELLA, [
  { brg: 20, m: 3000 },
  { brg: 350, m: 2500 },
  { brg: 15, m: 2000 },
]);
/** Tour du Monte d'Oro : boucle de 5 km environ. */
const LOOP = ring({ lat: 42.2417, lng: 9.1053 }, 800);

/* ------------------------------------------------------------------ */
/* Fabrique d'itinéraires pour les tris                                */
/* ------------------------------------------------------------------ */

function trail(over: Partial<NearbyTrail> & { id: string }): NearbyTrail {
  const base: NearbyTrail = {
    id: over.id,
    name: `Itinéraire ${over.id}`,
    activity: "hiking",
    difficulty: "moderate",
    shape: "linear",
    approachM: 1000,
    lengthM: 5000,
    durationMs: 2 * 3_600_000,
    durationObserved: false,
    // Par défaut : une vraie randonnée OSM navigable. Les tests qui veulent une
    // donnée de démonstration le disent explicitement.
    source: "osm",
    drawable: true,
    navigable: true,
    partial: false,
    elevationGainM: 400,
    elevationLossM: null,
    trailhead: { point: GROTELLE, distanceM: 1000, end: "start" },
    frequentation: null,
    passagesToday: null,
    popularityScore: 0,
    activeReports: 0,
    reportHint: null,
  };
  const merged: NearbyTrail = { ...base, ...over };
  // Le départ porte la même approche que l'itinéraire : les fixtures ne
  // doivent pas elles-mêmes confondre les deux distances.
  return { ...merged, trailhead: { ...merged.trailhead, distanceM: merged.approachM } };
}

const ids = (trails: readonly NearbyTrail[]): string[] => trails.map((t) => t.id);

/* ------------------------------------------------------------------ */
/* 1. Forme du tracé (section 37)                                      */
/* ------------------------------------------------------------------ */

describe("trailShape", () => {
  it("reconnaît une boucle : on revient à son point de départ", () => {
    expect(haversineM(at(LOOP, 0), last(LOOP))).toBeLessThan(LOOP_TOLERANCE_M);
    expect(trailShape(LOOP)).toBe("loop");
  });

  it("reconnaît un aller-retour : la seconde moitié suit la première à l'envers", () => {
    expect(trailShape(MELO_OUT_AND_BACK)).toBe("out_and_back");
  });

  it("ne prend pas un aller-retour pour une boucle, bien que ses extrémités coïncident", () => {
    expect(haversineM(at(MELO_OUT_AND_BACK, 0), last(MELO_OUT_AND_BACK))).toBeLessThan(1);
    expect(trailShape(MELO_OUT_AND_BACK)).not.toBe("loop");
  });

  it("reconnaît un itinéraire linéaire : l'arrivée est ailleurs", () => {
    expect(trailShape(GR20)).toBe("linear");
  });

  it("tolère le décalage entre la trace de montée et celle de descente", () => {
    const drifted = [
      ...MELO_UP.map((c) => [c[0], c[1]] as LngLat),
      ...reversed(MELO_UP)
        .slice(1)
        .map((c) => toLngLat(offsetPoint({ lat: c[1], lng: c[0] }, RETRACE_TOLERANCE_M / 3, 90))),
    ];
    expect(trailShape(drifted)).toBe("out_and_back");
  });

  it("ne confond pas deux sentiers parallèles distincts avec un aller-retour", () => {
    const parallel = chain(GROTELLE, [
      { brg: 160, m: 2000 },
      { brg: 250, m: 300 },
      { brg: 340, m: 2000 },
      { brg: 70, m: 300 },
    ]);
    expect(trailShape(parallel)).not.toBe("out_and_back");
  });

  it("accepte une boucle qui ne se referme pas exactement (sous la tolérance)", () => {
    const almost = LOOP.slice(0, LOOP.length - 2);
    const gap = haversineM(at(almost, 0), last(almost));
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(LOOP_TOLERANCE_M);
    expect(trailShape(almost)).toBe("loop");
  });

  it("au-delà de la tolérance, l'écart entre les extrémités fait un itinéraire linéaire", () => {
    const open = LOOP.slice(0, LOOP.length - 4);
    expect(haversineM(at(open, 0), last(open))).toBeGreaterThan(LOOP_TOLERANCE_M);
    expect(trailShape(open)).toBe("linear");
  });

  it("ne lit aucune forme dans un tracé trop court pour en avoir une", () => {
    const tiny = outAndBack(leg(GROTELLE, 160, 100, 10));
    expect(polylineLengthM(tiny)).toBeLessThan(SHAPE_MIN_LENGTH_M);
    expect(trailShape(tiny)).toBe("linear");
  });

  it("rend « linear » sur un tracé vide", () => {
    expect(trailShape([])).toBe("linear");
  });

  it("rend « linear » sur un tracé d'un seul point", () => {
    expect(trailShape([toLngLat(GROTELLE)])).toBe("linear");
  });

  it("ne prend pas deux points identiques pour une boucle", () => {
    expect(trailShape([toLngLat(GROTELLE), toLngLat(GROTELLE)])).toBe("linear");
  });

  it("ignore les sommets non exploitables plutôt que de produire une forme au hasard", () => {
    const polluted: LngLat[] = [[Number.NaN, Number.NaN], ...MELO_OUT_AND_BACK, [200, 100]];
    expect(trailShape(polluted)).toBe("out_and_back");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Point de départ le plus proche (section 37)                      */
/* ------------------------------------------------------------------ */

describe("nearestTrailhead", () => {
  it("retient l'extrémité la plus proche quand l'utilisateur est près du début", () => {
    const head = nearestTrailhead(BAVELLA, GR20);
    expect(head).not.toBeNull();
    expect(head?.end).toBe("start");
    expect(head?.point.lat).toBeCloseTo(BAVELLA.lat, 4);
  });

  it("retient l'autre extrémité quand l'utilisateur est près de l'arrivée", () => {
    const finish = last(GR20);
    const user = offsetPoint(finish, 300, 90);
    const head = nearestTrailhead(user, GR20);
    expect(head?.end).toBe("finish");
    expect(head?.point.lat).toBeCloseTo(finish.lat, 6);
  });

  it("des deux départs possibles, choisit vraiment le plus proche", () => {
    const start = at(GR20, 0);
    const finish = last(GR20);
    const user = offsetPoint(finish, 1200, 180);
    const head = nearestTrailhead(user, GR20);
    expect(haversineM(user, finish)).toBeLessThan(haversineM(user, start));
    expect(head?.end).toBe("finish");
  });

  it("mesure l'approche à vol d'oiseau, arrondie au mètre", () => {
    const user = offsetPoint(GROTELLE, 4200, 45);
    const head = nearestTrailhead(user, MELO_OUT_AND_BACK);
    expect(head?.distanceM).toBe(Math.round(haversineM(user, GROTELLE)));
    expect(head?.distanceM).toBeGreaterThan(4150);
    expect(head?.distanceM).toBeLessThan(4250);
  });

  it("à égalité parfaite, retient le début du tracé (résultat déterministe)", () => {
    // Un aller-retour a ses deux extrémités au même endroit : l'égalité est
    // exacte, pas approchée — c'est bien la règle de départage qui tranche.
    const start = at(MELO_OUT_AND_BACK, 0);
    const finish = last(MELO_OUT_AND_BACK);
    expect(finish).toEqual(start);
    expect(nearestTrailhead(CORTE, MELO_OUT_AND_BACK)?.end).toBe("start");
  });

  it("rend null sur un tracé vide", () => {
    expect(nearestTrailhead(CORTE, [])).toBeNull();
  });

  it("rend null quand aucun sommet n'est exploitable", () => {
    expect(nearestTrailhead(CORTE, [[Number.NaN, Number.NaN]])).toBeNull();
  });

  it("rend null sur une position utilisateur invalide", () => {
    expect(nearestTrailhead({ lat: Number.NaN, lng: 9.1 }, GR20)).toBeNull();
  });

  it("garde un départ sur un tracé réduit à un seul point", () => {
    const head = nearestTrailhead(CORTE, [toLngLat(GROTELLE)]);
    expect(head?.end).toBe("start");
    expect(head?.distanceM).toBe(Math.round(haversineM(CORTE, GROTELLE)));
  });

  it("rend null sur deux points identiques seulement si l'utilisateur est invalide", () => {
    const line: LngLat[] = [toLngLat(GROTELLE), toLngLat(GROTELLE)];
    expect(nearestTrailhead(CORTE, line)?.end).toBe("start");
    expect(nearestTrailhead({ lat: 91, lng: 9 }, line)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Rayon adaptatif (section 18)                                     */
/* ------------------------------------------------------------------ */

describe("selectRadius", () => {
  /** Compteur qui enregistre les rayons interrogés. */
  function counter(byRadius: (radiusM: number) => number): {
    countAt: (radiusM: number) => number;
    calls: number[];
  } {
    const calls: number[] = [];
    return {
      calls,
      countAt: (radiusM: number) => {
        calls.push(radiusM);
        return byRadius(radiusM);
      },
    };
  }

  it("garde le plus petit rayon quand la vallée est assez dense", () => {
    const { countAt, calls } = counter(() => 12);
    expect(selectRadius(countAt)).toEqual({ radiusM: NEARBY_RADII_M[0], widened: false });
    expect(calls).toEqual([NEARBY_RADII_M[0]]);
  });

  it("élargit au rayon suivant quand les résultats sont trop rares", () => {
    const { countAt } = counter((r) => (r >= NEARBY_RADII_M[1] ? 8 : 1));
    expect(selectRadius(countAt)).toEqual({ radiusM: NEARBY_RADII_M[1], widened: true });
  });

  it("retient le dernier rayon même s'il ne suffit pas", () => {
    const { countAt, calls } = counter(() => 1);
    expect(selectRadius(countAt)).toEqual({
      radiusM: NEARBY_RADII_M[NEARBY_RADII_M.length - 1],
      widened: true,
    });
    expect(calls).toEqual([...NEARBY_RADII_M]);
  });

  it("n'interroge la base qu'une fois par rayon, et s'arrête dès que ça suffit", () => {
    const { countAt, calls } = counter((r) => (r >= NEARBY_RADII_M[1] ? NEARBY_MIN_RESULTS : 0));
    selectRadius(countAt);
    expect(calls).toEqual([NEARBY_RADII_M[0], NEARBY_RADII_M[1]]);
  });

  it("le seuil est atteint dès l'égalité avec minResults", () => {
    const { countAt } = counter(() => NEARBY_MIN_RESULTS);
    expect(selectRadius(countAt).widened).toBe(false);
  });

  it("accepte des rayons et un seuil imposés", () => {
    const { countAt, calls } = counter((r) => (r >= 5000 ? 3 : 0));
    expect(selectRadius(countAt, { radii: [2000, 5000], minResults: 2 })).toEqual({
      radiusM: 5000,
      widened: true,
    });
    expect(calls).toEqual([2000, 5000]);
  });

  it("un rayon unique qui ne suffit pas n'est pas un élargissement", () => {
    const { countAt } = counter(() => 0);
    expect(selectRadius(countAt, { radii: [8000] })).toEqual({ radiusM: 8000, widened: false });
  });

  it("remet les rayons dans l'ordre croissant et les dédoublonne", () => {
    const { countAt, calls } = counter(() => 0);
    selectRadius(countAt, { radii: [30000, 5000, 5000, 12000] });
    expect(calls).toEqual([5000, 12000, 30000]);
  });

  it("ignore les rayons absurdes et retombe sur les rayons par défaut si tout l'est", () => {
    const { countAt, calls } = counter(() => 99);
    expect(selectRadius(countAt, { radii: [0, -1, Number.NaN] }).radiusM).toBe(NEARBY_RADII_M[0]);
    expect(calls).toEqual([NEARBY_RADII_M[0]]);
  });

  it("traite un comptage non exploitable comme une absence de résultat", () => {
    const { countAt, calls } = counter(() => Number.NaN);
    expect(selectRadius(countAt).radiusM).toBe(NEARBY_RADII_M[NEARBY_RADII_M.length - 1]);
    expect(calls).toEqual([...NEARBY_RADII_M]);
  });

  it("un seuil nul se contente du premier rayon", () => {
    const { countAt, calls } = counter(() => 0);
    expect(selectRadius(countAt, { minResults: 0 })).toEqual({
      radiusM: NEARBY_RADII_M[0],
      widened: false,
    });
    expect(calls).toEqual([NEARBY_RADII_M[0]]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Classement de la liste (section 13)                              */
/* ------------------------------------------------------------------ */

describe("rankNearby", () => {
  it("classe par approche croissante avec « closest »", () => {
    const list = [
      trail({ id: "c", approachM: 9000 }),
      trail({ id: "a", approachM: 800 }),
      trail({ id: "b", approachM: 4200 }),
    ];
    expect(ids(rankNearby(list, "closest"))).toEqual(["a", "b", "c"]);
  });

  it("classe par popularité décroissante avec « popular »", () => {
    const list = [
      trail({ id: "a", popularityScore: 12 }),
      trail({ id: "b", popularityScore: 88 }),
      trail({ id: "c", popularityScore: 45 }),
    ];
    expect(ids(rankNearby(list, "popular"))).toEqual(["b", "c", "a"]);
  });

  it("classe par difficulté croissante avec « easiest »", () => {
    const list = [
      trail({ id: "expert", difficulty: "expert" }),
      trail({ id: "facile", difficulty: "easy" }),
      trail({ id: "difficile", difficulty: "hard" }),
      trail({ id: "moyen", difficulty: "moderate" }),
    ];
    expect(ids(rankNearby(list, "easiest"))).toEqual(["facile", "moyen", "difficile", "expert"]);
  });

  it("à difficulté égale, « easiest » départage par dénivelé puis par longueur", () => {
    const list = [
      trail({ id: "long", difficulty: "moderate", elevationGainM: 300, lengthM: 14000 }),
      trail({ id: "raide", difficulty: "moderate", elevationGainM: 900, lengthM: 6000 }),
      trail({ id: "court", difficulty: "moderate", elevationGainM: 300, lengthM: 6000 }),
    ];
    expect(ids(rankNearby(list, "easiest"))).toEqual(["court", "long", "raide"]);
  });

  it("classe par longueur de randonnée croissante avec « shortest »", () => {
    const list = [
      trail({ id: "a", lengthM: 18000 }),
      trail({ id: "b", lengthM: 4000 }),
      trail({ id: "c", lengthM: 9500 }),
    ];
    expect(ids(rankNearby(list, "shortest"))).toEqual(["b", "c", "a"]);
  });

  it("« shortest » trie sur la LONGUEUR et jamais sur l'approche", () => {
    // Jeu conçu pour que les deux ordres soient inconciliables : la randonnée
    // la plus courte est celle dont le départ est le plus loin.
    const list = [
      trail({ id: "melo", approachM: 1000, lengthM: 20000 }),
      trail({ id: "bavella", approachM: 9000, lengthM: 3000 }),
      trail({ id: "oro", approachM: 5000, lengthM: 12000 }),
    ];
    expect(ids(rankNearby(list, "shortest"))).toEqual(["bavella", "oro", "melo"]);
    expect(ids(rankNearby(list, "closest"))).toEqual(["melo", "oro", "bavella"]);
    expect(ids(rankNearby(list, "shortest"))).not.toEqual(ids(rankNearby(list, "closest")));
  });

  it("classe par fréquentation croissante avec « quietest »", () => {
    const list = [
      trail({ id: "tres_frequente", frequentation: "very_high" }),
      trail({ id: "calme", frequentation: "very_low" }),
      trail({ id: "modere", frequentation: "moderate" }),
      trail({ id: "peu", frequentation: "low" }),
    ];
    expect(ids(rankNearby(list, "quietest"))).toEqual(["calme", "peu", "modere", "tres_frequente"]);
  });

  it("une fréquentation inconnue (null) ne passe jamais pour un sentier calme", () => {
    const list = [
      trail({ id: "inconnu", frequentation: null, approachM: 100 }),
      trail({ id: "calme", frequentation: "very_low", approachM: 9000 }),
    ];
    expect(ids(rankNearby(list, "quietest"))).toEqual(["calme", "inconnu"]);
  });

  it("une fréquentation « unknown » ne passe pas davantage pour un sentier calme", () => {
    const list = [
      trail({ id: "inconnu", frequentation: "unknown", approachM: 100 }),
      trail({ id: "frequente", frequentation: "very_high", approachM: 9000 }),
    ];
    expect(ids(rankNearby(list, "quietest"))).toEqual(["frequente", "inconnu"]);
  });

  it("null et « unknown » disent la même chose et se départagent comme le reste", () => {
    const list = [
      trail({ id: "z_null", frequentation: null, approachM: 2000 }),
      trail({ id: "a_unknown", frequentation: "unknown", approachM: 1000 }),
    ];
    expect(ids(rankNearby(list, "quietest"))).toEqual(["a_unknown", "z_null"]);
  });

  it("départage par approche puis par identifiant, quel que soit le critère", () => {
    const list = [
      trail({ id: "b", popularityScore: 50, approachM: 3000 }),
      trail({ id: "a", popularityScore: 50, approachM: 3000 }),
      trail({ id: "c", popularityScore: 50, approachM: 1000 }),
    ];
    expect(ids(rankNearby(list, "popular"))).toEqual(["c", "a", "b"]);
  });

  it("donne le même classement quel que soit l'ordre d'arrivée des itinéraires", () => {
    const base = [
      trail({ id: "a", popularityScore: 50, approachM: 2000 }),
      trail({ id: "b", popularityScore: 50, approachM: 2000 }),
      trail({ id: "c", popularityScore: 50, approachM: 2000 }),
      trail({ id: "d", popularityScore: 50, approachM: 2000 }),
    ];
    const shuffled = [base[2], base[0], base[3], base[1]];
    for (const sort of ["closest", "popular", "easiest", "shortest", "quietest"] satisfies NearbySort[]) {
      expect(ids(rankNearby(shuffled, sort))).toEqual(ids(rankNearby(base, sort)));
      expect(ids(rankNearby(shuffled, sort))).toEqual(["a", "b", "c", "d"]);
    }
  });

  it("deux appels successifs rendent exactement la même liste", () => {
    const list = [
      trail({ id: "oro", approachM: 4000, lengthM: 9000 }),
      trail({ id: "melo", approachM: 4000, lengthM: 9000 }),
      trail({ id: "bavella", approachM: 4000, lengthM: 9000 }),
    ];
    expect(ids(rankNearby(list, "shortest"))).toEqual(ids(rankNearby(list, "shortest")));
  });

  it("ne modifie jamais le tableau reçu", () => {
    const list = [trail({ id: "c", approachM: 9000 }), trail({ id: "a", approachM: 100 })];
    const before = ids(list);
    const ranked = rankNearby(list, "closest");
    expect(ids(list)).toEqual(before);
    expect(ranked).not.toBe(list);
  });

  it("rend une liste vide sur une entrée vide", () => {
    expect(rankNearby([], "closest")).toEqual([]);
  });

  it("garde un itinéraire unique tel quel", () => {
    const only = [trail({ id: "melo" })];
    expect(ids(rankNearby(only, "quietest"))).toEqual(["melo"]);
  });

  it("relègue en fin de liste une valeur de tri non mesurable", () => {
    const list = [
      trail({ id: "casse", lengthM: Number.NaN }),
      trail({ id: "melo", lengthM: 12000 }),
    ];
    expect(ids(rankNearby(list, "shortest"))).toEqual(["melo", "casse"]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Les deux distances (section 19)                                  */
/* ------------------------------------------------------------------ */

describe("describeApproach et describeLength", () => {
  it("dit l'approche en s'adressant à l'utilisateur", () => {
    expect(describeApproach(4200)).toBe("À 4,2 km de vous");
  });

  it("dit la longueur en parlant de la randonnée", () => {
    expect(describeLength(9400)).toBe("Randonnée de 9,4 km");
  });

  it("produit deux phrases distinctes pour une même valeur", () => {
    expect(describeApproach(6000)).not.toBe(describeLength(6000));
    expect(describeApproach(6000)).toContain("de vous");
    expect(describeLength(6000)).toContain("Randonnée");
  });

  it("n'emploie jamais le vocabulaire de l'autre distance", () => {
    expect(describeApproach(4200)).not.toContain("Randonnée");
    expect(describeLength(9400)).not.toContain("de vous");
  });

  it("formate les courtes approches en mètres", () => {
    expect(describeApproach(320)).toBe("À 320 m de vous");
  });

  it("dit une distance inconnue plutôt que zéro", () => {
    expect(describeApproach(Number.NaN)).toBe(APPROACH_UNKNOWN_LABEL);
    expect(describeApproach(Number.POSITIVE_INFINITY)).toBe(APPROACH_UNKNOWN_LABEL);
    expect(describeApproach(-10)).toBe(APPROACH_UNKNOWN_LABEL);
  });

  it("dit une longueur inconnue plutôt qu'une randonnée de zéro mètre", () => {
    expect(describeLength(0)).toBe(LENGTH_UNKNOWN_LABEL);
    expect(describeLength(Number.NaN)).toBe(LENGTH_UNKNOWN_LABEL);
  });

  it("accepte une approche nulle : on est au départ", () => {
    expect(describeApproach(0)).toBe("À 0 m de vous");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Note de rareté (section 21)                                      */
/* ------------------------------------------------------------------ */

describe("nearbyNote", () => {
  it("dit l'absence de résultat sans laisser croire qu'il n'y a rien à marcher", () => {
    expect(nearbyNote(0, 50000, true)).toBe(
      `Aucun itinéraire connu dans un rayon de 50 km — ${NEARBY_ENRICH_SUFFIX}`,
    );
  });

  it("dit l'élargissement du rayon quand il a fallu chercher plus loin", () => {
    const note = nearbyNote(6, 50000, true);
    expect(note).toBe("Peu d'itinéraires à proximité : la recherche a été élargie à 50 km.");
  });

  it("signale le petit nombre de résultats même sans élargissement", () => {
    expect(nearbyNote(2, 10000, false)).toBe(
      `Seulement 2 itinéraires connus dans un rayon de 10 km — ${NEARBY_ENRICH_SUFFIX}`,
    );
  });

  it("accorde la phrase au singulier", () => {
    expect(nearbyNote(1, 10000, false)).toBe(
      `Seulement 1 itinéraire connu dans un rayon de 10 km — ${NEARBY_ENRICH_SUFFIX}`,
    );
  });

  it("ne dit rien quand la liste est fournie", () => {
    expect(nearbyNote(NEARBY_MIN_RESULTS, 10000, false)).toBeNull();
    expect(nearbyNote(30, 10000, false)).toBeNull();
  });

  it("reste lisible quand le rayon n'est pas exploitable", () => {
    const note = nearbyNote(0, Number.NaN, false);
    expect(note).toBe(`Aucun itinéraire connu ici — ${NEARBY_ENRICH_SUFFIX}`);
    expect(note).not.toContain("—  ");
  });

  it("traite un décompte absurde comme une absence de résultat", () => {
    expect(nearbyNote(Number.NaN, 25000, false)).toContain("Aucun itinéraire connu");
  });
});

/* ------------------------------------------------------------------ */
/* 7. Alerte des signalements actifs (section 20)                      */
/* ------------------------------------------------------------------ */

describe("reportHint", () => {
  it("ne dit rien quand il n'y a aucun signalement", () => {
    expect(reportHint([])).toBeNull();
  });

  it("nomme une battue avec le libellé de la taxonomie", () => {
    expect(reportHint([{ category: "activity", subtype: "battue" }])).toBe("Battue signalée");
  });

  it("accorde au masculin pluriel les chiens de protection", () => {
    expect(reportHint([{ category: "animals", subtype: "guard_dogs" }])).toBe(
      "Chiens de protection signalés",
    );
  });

  it("accorde au masculin singulier un éboulement", () => {
    expect(reportHint([{ category: "danger", subtype: "rockfall" }])).toBe("Éboulement signalé");
  });

  it("accorde au féminin une source sèche", () => {
    expect(reportHint([{ category: "water", subtype: "spring_dry" }])).toBe("Source sèche signalée");
  });

  it("accorde au pluriel des travaux", () => {
    expect(reportHint([{ category: "path", subtype: "works" }])).toBe("Travaux signalés");
  });

  it("nomme encore le signalement quand plusieurs sont du même genre", () => {
    expect(
      reportHint([
        { category: "activity", subtype: "battue" },
        { category: "activity", subtype: "battue" },
        { category: "activity", subtype: "battue" },
      ]),
    ).toBe("Battue signalée");
  });

  it("compte les signalements dès qu'ils sont de genres différents", () => {
    expect(
      reportHint([
        { category: "activity", subtype: "battue" },
        { category: "animals", subtype: "herd" },
      ]),
    ).toBe("2 signalements");
  });

  it("n'invente aucun libellé pour un sous-type qu'il ne connaît pas", () => {
    expect(reportHint([{ category: "danger", subtype: "meteorite" }])).toBe("1 signalement");
  });

  it("compte sans nommer un signalement sans sous-type", () => {
    expect(reportHint([{ category: "danger" }])).toBe("1 signalement");
    expect(reportHint([{ category: "danger", subtype: null }])).toBe("1 signalement");
  });

  it("compte tous les signalements, y compris ceux qu'il ne sait pas nommer", () => {
    expect(
      reportHint([
        { category: "activity", subtype: "battue" },
        { category: "danger", subtype: null },
      ]),
    ).toBe("2 signalements");
  });
});

/* ------------------------------------------------------------------ */
/* 8. Les deux distances de bout en bout (section 19)                  */
/* ------------------------------------------------------------------ */

describe("approche et longueur de bout en bout", () => {
  it("l'approche vient de l'utilisateur, la longueur vient du tracé", () => {
    const user = offsetPoint(GROTELLE, 4200, 30);
    const head = nearestTrailhead(user, MELO_OUT_AND_BACK);
    const lengthM = polylineLengthM(MELO_OUT_AND_BACK);

    expect(head).not.toBeNull();
    // Deux nombres bien distincts : ~4,2 km d'approche, ~3,8 km de randonnée.
    expect(head?.distanceM).toBeGreaterThan(4100);
    expect(lengthM).toBeGreaterThan(3700);
    expect(head?.distanceM).not.toBe(Math.round(lengthM));

    const card = trail({
      id: "melo",
      approachM: head?.distanceM ?? 0,
      lengthM: Math.round(lengthM),
      shape: trailShape(MELO_OUT_AND_BACK),
    });
    expect(card.shape).toBe("out_and_back");
    expect(describeApproach(card.approachM)).toContain("de vous");
    expect(describeLength(card.lengthM)).toContain("Randonnée");
    expect(describeApproach(card.approachM)).not.toBe(describeLength(card.lengthM));
  });
});

describe("priorité aux données réelles (section 29)", () => {
  it("place une vraie randonnée devant une démonstration, même plus proche", () => {
    const demo = trail({ id: "demo", approachM: 100, source: "seed", drawable: false, navigable: false });
    const real = trail({ id: "reel", approachM: 9000, source: "osm" });
    expect(rankNearby([demo, real], "closest").map((t) => t.id)).toEqual(["reel", "demo"]);
  });

  it("place une randonnée navigable devant une seulement affichable", () => {
    const partiel = trail({ id: "partiel", approachM: 100, navigable: false, partial: true });
    const complet = trail({ id: "complet", approachM: 4000 });
    expect(rankNearby([partiel, complet], "closest").map((t) => t.id)).toEqual(["complet", "partiel"]);
  });

  it("conserve le critère demandé entre données de même qualité", () => {
    const proche = trail({ id: "proche", approachM: 300 });
    const loin = trail({ id: "loin", approachM: 8000 });
    expect(rankNearby([loin, proche], "closest").map((t) => t.id)).toEqual(["proche", "loin"]);
  });
});
