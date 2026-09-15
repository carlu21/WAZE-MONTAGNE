/**
 * Tests de la superposition de traces (sections 10 et 13).
 *
 * Toutes les géométries sont fabriquées ici par des helpers locaux et sont
 * manifestement fictives : « Sentier de démonstration », source `example.org`,
 * coordonnées choisies arbitrairement. Aucun test ne prétend décrire une trace
 * réelle, une plateforme existante ou une licence vérifiée.
 *
 * Quatre exigences guident ces cas : une trace parcourue à l'envers doit être
 * reconnue malgré son recouvrement parfait ; la comparaison n'est pas
 * symétrique et doit le rester ; un faisceau d'une seule source ne doit jamais
 * être présenté comme fiable ; et rien ne doit jeter, produire un NaN ou un
 * Infinity sur une entrée dégénérée.
 */
import { describe, expect, it } from "vitest";
import { METERS_PER_DEG_LAT, distanceToPolylineM, polylineLengthM, type LngLat } from "../geo";
import { CORRIDOR_MIN_SOURCES, SAME_PATH_TOLERANCE_M, type ComparableTrace, type GeometryLayer } from "./types";
import {
  COMPARE_CLUSTER_MIN_OVERLAP,
  COMPARE_CONFIDENCE_FULL_SOURCES,
  COMPARE_CONFIDENCE_WEIGHTS,
  COMPARE_CORRIDOR_ID_PREFIX,
  COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG,
  COMPARE_CORRIDOR_MAX_LATERAL_M,
  COMPARE_CORRIDOR_MIN_LENGTH_M,
  COMPARE_CORRIDOR_MIN_TRACES,
  COMPARE_DISPERSION_REFERENCE_M,
  COMPARE_DUPLICATE_MAX_MEDIAN_M,
  COMPARE_SAMPLE_M,
  COMPARE_UNCORROBORATED_CONFIDENCE_CAP,
  COMPARE_UNDATED_RECENCY,
  COMPARE_VARIANT_DEVIATION_M,
  COMPARE_VARIANT_MIN_LENGTH_M,
  buildCorridor,
  clusterTraces,
  compareTraces,
  corridorConfidence,
  deduplicate,
} from "./compare";

/* ------------------------------------------------------------------ */
/* Jeux de données locaux (tous fictifs)                               */
/* ------------------------------------------------------------------ */

/** 15 septembre 2026, midi UTC : instant de référence de tous les tests. */
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 86_400_000;

const START_LAT = 42.1;
const START_LNG = 9.05;

/** Mètres → degrés de longitude à la latitude de départ. */
function eastDeg(meters: number): number {
  return meters / (METERS_PER_DEG_LAT * Math.cos((START_LAT * Math.PI) / 180));
}

/**
 * Ligne plein nord de `points` points espacés de `stepM`, décalée de
 * `offsetEastM` vers l'est. L'espacement curviligne est respecté à 0,2 % près
 * (le rayon terrestre du haversine et `METERS_PER_DEG_LAT` ne coïncident pas
 * exactement), ce qui suffit largement à tous les seuils testés.
 */
function northLine(points: number, stepM = 10, offsetEastM = 0): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < points; i++) {
    out.push([START_LNG + eastDeg(offsetEastM), START_LAT + (i * stepM) / METERS_PER_DEG_LAT]);
  }
  return out;
}

/** Même ligne, mais les points d'indice `from`..`to` sont poussés vers l'est. */
function withDetour(line: readonly LngLat[], from: number, to: number, offsetEastM: number): LngLat[] {
  return line.map((c, i) => (i >= from && i <= to ? [c[0] + eastDeg(offsetEastM), c[1]] : [c[0], c[1]]));
}

/** Trace comparable fictive : tout est explicitement fourni, rien n'est deviné. */
function trace(id: string, coordinates: LngLat[], extra: Partial<ComparableTrace> = {}): ComparableTrace {
  return {
    id,
    coordinates,
    sourceId: extra.sourceId === undefined ? `example-org-${id}` : extra.sourceId,
    layer: extra.layer ?? "imported_gpx",
    at: extra.at === undefined ? null : extra.at,
    quality: extra.quality ?? 60,
  };
}

/** Trois traces parallèles d'un même « Sentier de démonstration », 1 km. */
function demoBeam(): ComparableTrace[] {
  return [
    trace("t-centre", northLine(101, 10, 0), { sourceId: "src-parc", quality: 90 }),
    trace("t-est", northLine(101, 10, 20), { sourceId: "src-club", quality: 80 }),
    trace("t-loin", northLine(101, 10, 40), { sourceId: "src-osm", quality: 70, layer: "osm" }),
  ];
}

/* ------------------------------------------------------------------ */
/* 1. compareTraces : recouvrement, écarts, sens, variantes            */
/* ------------------------------------------------------------------ */

describe("compareTraces", () => {
  it("rend un recouvrement total et des écarts nuls pour deux traces identiques", () => {
    const line = northLine(51);
    const result = compareTraces(trace("a", line), trace("b", line.map((c) => [c[0], c[1]])));
    expect(result.a).toBe("a");
    expect(result.b).toBe("b");
    expect(result.overlap).toBe(1);
    expect(result.medianDeviationM).toBe(0);
    expect(result.maxDeviationM).toBe(0);
    expect(result.sameDirection).toBe(true);
    expect(result.variants).toEqual([]);
  });

  it("reconnaît une trace parcourue à l'envers : recouvrement parfait, sens opposé", () => {
    const line = northLine(51);
    const reversed = [...line].reverse();
    const result = compareTraces(trace("aller", line), trace("retour", reversed));
    expect(result.overlap).toBe(1);
    expect(result.sameDirection).toBe(false);
    // Et l'inverse est vrai aussi : le sens est une relation, pas un attribut.
    expect(compareTraces(trace("retour", reversed), trace("aller", line)).sameDirection).toBe(false);
  });

  it("n'est pas symétrique : une trace incluse recouvre tout, l'inverse non", () => {
    const longue = northLine(101);
    const courte = longue.slice(0, 21);
    const inclusion = compareTraces(trace("courte", courte), trace("longue", longue));
    const contenant = compareTraces(trace("longue", longue), trace("courte", courte));
    expect(inclusion.overlap).toBe(1);
    expect(contenant.overlap).toBeLessThan(0.4);
    expect(contenant.overlap).toBeGreaterThan(0);
    expect(inclusion.overlap).toBeGreaterThan(contenant.overlap);
  });

  it("signale une portion franchement écartée comme variante, en abscisses sur A", () => {
    const base = northLine(101);
    const detour = withDetour(base, 40, 60, 120);
    const result = compareTraces(trace("variante", detour), trace("base", base));
    expect(result.variants).toHaveLength(1);
    const variant = result.variants[0];
    expect(variant.fromM).toBeGreaterThan(300);
    expect(variant.toM).toBeGreaterThan(variant.fromM + COMPARE_VARIANT_MIN_LENGTH_M);
    expect(variant.maxDeviationM).toBeGreaterThan(COMPARE_VARIANT_DEVIATION_M);
    expect(variant.maxDeviationM).toBeLessThan(130);
    expect(result.overlap).toBeGreaterThan(0.4);
    expect(result.overlap).toBeLessThan(1);
  });

  it("ne signale pas un pas de côté plus court que COMPARE_VARIANT_MIN_LENGTH_M", () => {
    const base = northLine(101);
    const ecart = withDetour(base, 50, 50, 60);
    const result = compareTraces(trace("ecart", ecart), trace("base", base));
    // L'écart est bien mesuré...
    expect(result.maxDeviationM).toBeGreaterThan(COMPARE_VARIANT_DEVIATION_M);
    // ... mais trop court pour être présenté comme une variante.
    expect(result.variants).toEqual([]);
  });

  it("abaisse le seuil de longueur des variantes à la demande (variantMinLengthM)", () => {
    const base = northLine(101);
    const ecart = withDetour(base, 50, 50, 60);
    const result = compareTraces(trace("ecart", ecart), trace("base", base), { variantMinLengthM: 5 });
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
  });

  it("rend un recouvrement nul pour deux traces séparées de plus que la tolérance", () => {
    const result = compareTraces(trace("a", northLine(51)), trace("b", northLine(51, 10, 40)));
    expect(result.overlap).toBe(0);
    expect(result.medianDeviationM).toBeGreaterThan(SAME_PATH_TOLERANCE_M);
    // 40 m : ce n'est plus le même passage, ce n'est pas encore une variante.
    expect(result.variants).toEqual([]);
  });

  it("élargit la tolérance à la demande (toleranceM)", () => {
    const a = trace("a", northLine(51));
    const b = trace("b", northLine(51, 10, 40));
    expect(compareTraces(a, b).overlap).toBe(0);
    expect(compareTraces(a, b, { toleranceM: 60 }).overlap).toBe(1);
  });

  it("retombe sur le pas par défaut quand sampleM est absurde", () => {
    const a = trace("a", northLine(51));
    const b = trace("b", northLine(51, 10, 5));
    const defaut = compareTraces(a, b);
    expect(compareTraces(a, b, { sampleM: 0 })).toEqual(defaut);
    expect(compareTraces(a, b, { sampleM: Number.NaN })).toEqual(defaut);
    expect(compareTraces(a, b, { sampleM: COMPARE_SAMPLE_M })).toEqual(defaut);
  });

  it("plafonne le nombre d'échantillons au lieu d'exploser (COMPARE_MAX_SAMPLES)", () => {
    const line = northLine(51);
    // Sans plafond, un pas d'un millimètre demanderait 500 000 projections.
    const result = compareTraces(trace("a", line), trace("b", line), { sampleM: 0.001 });
    expect(result.overlap).toBe(1);
    expect(Number.isFinite(result.maxDeviationM)).toBe(true);
  });

  it("ne conclut à aucune inversion quand rien ne permet de juger le sens", () => {
    // Traversée perpendiculaire : quasiment aucun échantillon ne suit l'autre trace.
    const nord = northLine(51);
    const est: LngLat[] = [];
    for (let i = 0; i < 21; i++) est.push([START_LNG + eastDeg(-100 + i * 10), START_LAT + 250 / METERS_PER_DEG_LAT]);
    const result = compareTraces(trace("est", est), trace("nord", nord));
    expect(result.overlap).toBeLessThan(0.5);
    expect(result.sameDirection).toBe(true);
  });

  it("ne jette pas et ne rend aucun Infinity sur des entrées dégénérées", () => {
    const line = northLine(51);
    const vide = compareTraces(trace("vide", []), trace("b", line));
    expect(vide).toEqual({
      a: "vide",
      b: "b",
      overlap: 0,
      medianDeviationM: 0,
      maxDeviationM: 0,
      sameDirection: true,
      variants: [],
    });
    const contreVide = compareTraces(trace("a", line), trace("vide", []));
    expect(contreVide.overlap).toBe(0);
    expect(Number.isFinite(contreVide.maxDeviationM)).toBe(true);
    expect(compareTraces(trace("vide1", []), trace("vide2", [])).overlap).toBe(0);
  });

  it("accepte une trace d'un seul point et des coordonnées toutes identiques", () => {
    const line = northLine(51);
    const unique = compareTraces(trace("point", [line[0]]), trace("ligne", line));
    expect(unique.overlap).toBe(1);
    expect(unique.sameDirection).toBe(true);
    const immobile: LngLat[] = [line[0], line[0], line[0]];
    const surPlace = compareTraces(trace("immobile", immobile), trace("ligne", line));
    expect(surPlace.overlap).toBe(1);
    expect(Number.isNaN(surPlace.medianDeviationM)).toBe(false);
    const loin = compareTraces(trace("immobile", immobile), trace("autre", northLine(51, 10, 400)));
    expect(loin.overlap).toBe(0);
    expect(Number.isFinite(loin.maxDeviationM)).toBe(true);
  });

  it("compare deux traces de deux points", () => {
    const a: LngLat[] = [northLine(51)[0], northLine(51)[50]];
    const b: LngLat[] = [northLine(51, 10, 5)[0], northLine(51, 10, 5)[50]];
    const result = compareTraces(trace("a", a), trace("b", b));
    expect(result.overlap).toBe(1);
    expect(result.medianDeviationM).toBeGreaterThan(0);
    expect(result.medianDeviationM).toBeLessThan(SAME_PATH_TOLERANCE_M);
    expect(result.sameDirection).toBe(true);
  });

  it("écarte les points illisibles au lieu de rendre un NaN", () => {
    const line = northLine(51);
    const sale: LngLat[] = [[Number.NaN, 42], ...line, [9.05, 200]];
    const result = compareTraces(trace("sale", sale), trace("propre", line));
    expect(result.overlap).toBe(1);
    expect(Number.isFinite(result.medianDeviationM)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. clusterTraces : regrouper ce qui décrit le même passage          */
/* ------------------------------------------------------------------ */

describe("clusterTraces", () => {
  it("regroupe deux traces du même parcours et isole la trace lointaine", () => {
    const groups = clusterTraces([
      trace("b", northLine(51, 10, 5)),
      trace("a", northLine(51)),
      trace("z-ailleurs", northLine(51, 10, 2000)),
    ]);
    expect(groups).toEqual([["a", "b"], ["z-ailleurs"]]);
  });

  it("regroupe une trace et son parcours inverse", () => {
    const line = northLine(51);
    const groups = clusterTraces([trace("aller", line), trace("retour", [...line].reverse())]);
    expect(groups).toEqual([["aller", "retour"]]);
  });

  it("ne regroupe pas une trace simplement incluse dans une autre", () => {
    const longue = northLine(101);
    const groups = clusterTraces([trace("courte", longue.slice(0, 21)), trace("longue", longue)]);
    expect(groups).toEqual([["courte"], ["longue"]]);
  });

  it("regroupe l'inclusion si l'appelant abaisse le recouvrement exigé", () => {
    const longue = northLine(101);
    const groups = clusterTraces([trace("courte", longue.slice(0, 21)), trace("longue", longue)], {
      minOverlap: 0.2,
    });
    expect(groups).toEqual([["courte", "longue"]]);
    // Une part nulle serait un contournement du seuil : elle retombe au défaut.
    expect(clusterTraces([trace("courte", longue.slice(0, 21)), trace("longue", longue)], { minOverlap: 0 })).toEqual([
      ["courte"],
      ["longue"],
    ]);
    expect(COMPARE_CLUSTER_MIN_OVERLAP).toBeGreaterThan(0.2);
  });

  it("rend des groupes triés, indépendants de l'ordre d'entrée", () => {
    const traces = [
      trace("c", northLine(51, 10, 2000)),
      trace("a", northLine(51)),
      trace("b", northLine(51, 10, 5)),
    ];
    const direct = clusterTraces(traces);
    const melange = clusterTraces([traces[1], traces[2], traces[0]].reverse());
    expect(direct).toEqual(melange);
    expect(direct).toEqual([["a", "b"], ["c"]]);
  });

  it("garde chaque identifiant exactement une fois, même sans géométrie", () => {
    const groups = clusterTraces([trace("vide", []), trace("a", northLine(51)), trace("a", northLine(51))]);
    expect(groups.flat().sort()).toEqual(["a", "vide"]);
  });

  it("rend un tableau vide sur une entrée vide", () => {
    expect(clusterTraces([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. buildCorridor : la ligne centrale d'un faisceau                  */
/* ------------------------------------------------------------------ */

describe("buildCorridor", () => {
  it("construit une ligne centrale à la médiane latérale de trois sources", () => {
    const corridor = buildCorridor(demoBeam(), { now: NOW });
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.traceIds).toEqual(["t-centre", "t-est", "t-loin"]);
    expect(corridor.uniqueSources).toBe(3);
    expect(corridor.lengthM).toBeGreaterThan(900);
    expect(corridor.dispersionM).toBeGreaterThan(15);
    expect(corridor.dispersionM).toBeLessThan(25);
    // La ligne centrale suit la trace médiane (décalée de 20 m), pas la référence.
    const milieuMedian = { lng: northLine(101, 10, 20)[50][0], lat: northLine(101, 10, 20)[50][1] };
    expect(distanceToPolylineM(milieuMedian, corridor.coordinates)).toBeLessThan(5);
    const milieuReference = { lng: northLine(101)[50][0], lat: northLine(101)[50][1] };
    expect(distanceToPolylineM(milieuReference, corridor.coordinates)).toBeGreaterThan(10);
  });

  it("ne rend jamais confiant un faisceau d'une seule source", () => {
    const corridor = buildCorridor(
      [
        trace("t-1", northLine(101), { sourceId: "src-unique", quality: 90 }),
        trace("t-2", northLine(101, 10, 20), { sourceId: "src-unique", quality: 80 }),
        trace("t-3", northLine(101, 10, 10), { sourceId: "src-unique", quality: 70 }),
      ],
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.uniqueSources).toBe(1);
    expect(corridor.uniqueSources).toBeLessThan(CORRIDOR_MIN_SOURCES);
    expect(corridor.confidence).toBeLessThanOrEqual(COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
  });

  it("ne compte pas une origine non déclarée comme une source", () => {
    const corridor = buildCorridor(
      [
        trace("t-1", northLine(101), { sourceId: null, quality: 90 }),
        trace("t-2", northLine(101, 10, 20), { sourceId: null, quality: 80 }),
      ],
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.uniqueSources).toBe(0);
    expect(corridor.confidence).toBeLessThanOrEqual(COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
  });

  it("devient plus confiant avec trois sources distinctes qu'avec une seule", () => {
    const troisSources = buildCorridor(demoBeam(), { now: NOW });
    const uneSource = buildCorridor(
      demoBeam().map((t) => ({ ...t, sourceId: "src-unique" })),
      { now: NOW },
    );
    expect(troisSources).not.toBeNull();
    expect(uneSource).not.toBeNull();
    if (!troisSources || !uneSource) return;
    expect(troisSources.confidence).toBeGreaterThan(COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
    expect(troisSources.confidence).toBeGreaterThan(uneSource.confidence);
  });

  it("réaligne une trace parcourue à l'envers avant de moyenner", () => {
    const beam = demoBeam();
    const inverse = beam.map((t) => (t.id === "t-est" ? { ...t, coordinates: [...t.coordinates].reverse() } : t));
    const direct = buildCorridor(beam, { now: NOW });
    const melange = buildCorridor(inverse, { now: NOW });
    expect(direct).not.toBeNull();
    expect(melange).not.toBeNull();
    if (!direct || !melange) return;
    expect(melange.traceIds).toEqual(direct.traceIds);
    expect(Math.abs(melange.lengthM - direct.lengthM)).toBeLessThan(5);
    expect(Math.abs(melange.dispersionM - direct.dispersionM)).toBeLessThan(2);
  });

  it("écarte du faisceau une trace plus éloignée que COMPARE_CORRIDOR_MAX_LATERAL_M", () => {
    const corridor = buildCorridor(
      [
        trace("t-centre", northLine(101), { sourceId: "src-parc", quality: 90 }),
        trace("t-proche", northLine(101, 10, 20), { sourceId: "src-club", quality: 80 }),
        trace("t-parallele", northLine(101, 10, COMPARE_CORRIDOR_MAX_LATERAL_M + 20), {
          sourceId: "src-autre",
          quality: 10,
        }),
      ],
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.traceIds).toEqual(["t-centre", "t-proche"]);
    expect(corridor.uniqueSources).toBe(2);
  });

  it("rend null quand le faisceau est trop maigre", () => {
    expect(buildCorridor([], { now: NOW })).toBeNull();
    expect(buildCorridor([trace("seule", northLine(101))], { now: NOW })).toBeNull();
    expect(COMPARE_CORRIDOR_MIN_TRACES).toBe(2);
    // Deux traces trop courtes pour décrire un passage.
    const courte = northLine(3, 10);
    expect(buildCorridor([trace("a", courte), trace("b", courte)], { now: NOW })).toBeNull();
    // Deux traces sans géométrie exploitable.
    expect(buildCorridor([trace("a", []), trace("b", [])], { now: NOW })).toBeNull();
    const immobile: LngLat[] = [northLine(2)[0], northLine(2)[0]];
    expect(buildCorridor([trace("a", immobile), trace("b", immobile)], { now: NOW })).toBeNull();
  });

  it("rend null quand deux traces ne font que se croiser", () => {
    // À l'intersection, les deux traces se frôlent : sans le garde-fou d'axe
    // (COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG), le croisement fabriquerait un faisceau.
    const nord = northLine(101);
    const est: LngLat[] = [];
    for (let i = 0; i < 41; i++) est.push([START_LNG + eastDeg(-200 + i * 10), START_LAT + 500 / METERS_PER_DEG_LAT]);
    expect(COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG).toBeLessThan(90);
    expect(buildCorridor([trace("nord", nord), trace("est", est)], { now: NOW })).toBeNull();
  });

  it("garde dans le faisceau une trace qui rejoint le corridor en biais", () => {
    // 20° d'écart : c'est le même chemin mal relevé, pas une traversée.
    const oblique: LngLat[] = [];
    for (let i = 0; i <= 100; i++) {
      const northM = i * 10;
      oblique.push([START_LNG + eastDeg(northM * Math.tan((20 * Math.PI) / 180) * 0.05), START_LAT + northM / METERS_PER_DEG_LAT]);
    }
    const corridor = buildCorridor(
      [
        trace("t-droite", northLine(101), { sourceId: "src-a", quality: 90 }),
        trace("t-oblique", oblique, { sourceId: "src-b", quality: 60 }),
      ],
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.traceIds).toEqual(["t-droite", "t-oblique"]);
  });

  it("construit un corridor à partir de traces de deux points", () => {
    const a: LngLat[] = [northLine(51)[0], northLine(51)[50]];
    const b: LngLat[] = [northLine(51, 10, 20)[0], northLine(51, 10, 20)[50]];
    const corridor = buildCorridor(
      [trace("a", a, { sourceId: "src-a", quality: 80 }), trace("b", b, { sourceId: "src-b", quality: 70 })],
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    if (!corridor) return;
    expect(corridor.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(corridor.lengthM).toBeGreaterThan(COMPARE_CORRIDOR_MIN_LENGTH_M);
    expect(polylineLengthM(corridor.coordinates)).toBeGreaterThan(400);
  });

  it("dérive un identifiant de la géométrie, pas des identifiants de traces", () => {
    const beam = demoBeam();
    const corridor = buildCorridor(beam, { now: NOW });
    const renomme = buildCorridor(
      beam.map((t) => ({ ...t, id: `autre-${t.id}` })),
      { now: NOW },
    );
    expect(corridor).not.toBeNull();
    expect(renomme).not.toBeNull();
    if (!corridor || !renomme) return;
    expect(corridor.id.startsWith(COMPARE_CORRIDOR_ID_PREFIX)).toBe(true);
    expect(renomme.id).toBe(corridor.id);
    const ailleurs = buildCorridor(
      demoBeam().map((t) => ({
        ...t,
        coordinates: t.coordinates.map((c) => [c[0] + 0.5, c[1]] as LngLat),
      })),
      { now: NOW },
    );
    expect(ailleurs).not.toBeNull();
    if (!ailleurs) return;
    expect(ailleurs.id).not.toBe(corridor.id);
  });

  it("accepte un pas d'échantillonnage plus large sans changer la nature du résultat", () => {
    const fin = buildCorridor(demoBeam(), { now: NOW });
    const large = buildCorridor(demoBeam(), { now: NOW, corridorStepM: 100 });
    expect(fin).not.toBeNull();
    expect(large).not.toBeNull();
    if (!fin || !large) return;
    expect(large.traceIds).toEqual(fin.traceIds);
    expect(Math.abs(large.lengthM - fin.lengthM)).toBeLessThan(20);
  });

  it("ne dépend pas de l'ordre d'entrée des traces", () => {
    const direct = buildCorridor(demoBeam(), { now: NOW });
    const inverse = buildCorridor([...demoBeam()].reverse(), { now: NOW });
    expect(JSON.stringify(inverse)).toBe(JSON.stringify(direct));
  });
});

/* ------------------------------------------------------------------ */
/* 4. corridorConfidence                                               */
/* ------------------------------------------------------------------ */

describe("corridorConfidence", () => {
  const base = {
    uniqueSources: 3,
    traces: 3,
    dispersionM: 5,
    layers: ["imported_gpx"] as GeometryLayer[],
    lastSeenAt: NOW,
  };

  it("croît avec le nombre de sources distinctes", () => {
    const deux = corridorConfidence({ ...base, uniqueSources: 2, traces: 4 }, NOW);
    const quatre = corridorConfidence({ ...base, uniqueSources: 4, traces: 4 }, NOW);
    expect(quatre).toBeGreaterThan(deux);
    // Au-delà de COMPARE_CONFIDENCE_FULL_SOURCES, le terme est saturé.
    const beaucoup = corridorConfidence(
      { ...base, uniqueSources: COMPARE_CONFIDENCE_FULL_SOURCES + 10, traces: 20 },
      NOW,
    );
    const plafond = corridorConfidence(
      { ...base, uniqueSources: COMPARE_CONFIDENCE_FULL_SOURCES, traces: 20 },
      NOW,
    );
    expect(beaucoup).toBe(plafond);
  });

  it("plafonne tant que CORRIDOR_MIN_SOURCES n'est pas atteint", () => {
    const uneSource = corridorConfidence(
      {
        uniqueSources: 1,
        traces: 20,
        dispersionM: 0,
        layers: ["official", "osm", "imported_gpx", "community", "observed"],
        lastSeenAt: NOW,
      },
      NOW,
    );
    expect(uneSource).toBeLessThanOrEqual(COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
    const deuxSources = corridorConfidence(
      {
        uniqueSources: CORRIDOR_MIN_SOURCES,
        traces: 20,
        dispersionM: 0,
        layers: ["official", "osm", "imported_gpx"],
        lastSeenAt: NOW,
      },
      NOW,
    );
    expect(deuxSources).toBeGreaterThan(COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
  });

  it("décroît avec la dispersion latérale", () => {
    const serre = corridorConfidence({ ...base, dispersionM: 0 }, NOW);
    const large = corridorConfidence({ ...base, dispersionM: COMPARE_DISPERSION_REFERENCE_M }, NOW);
    expect(serre).toBeGreaterThan(large);
    // Au-delà de la référence, le terme de précision est déjà nul.
    expect(corridorConfidence({ ...base, dispersionM: COMPARE_DISPERSION_REFERENCE_M * 4 }, NOW)).toBe(large);
    expect(serre - large).toBeCloseTo(COMPARE_CONFIDENCE_WEIGHTS.precision, 2);
  });

  it("décroît avec l'âge de la dernière attestation", () => {
    const recent = corridorConfidence({ ...base, lastSeenAt: NOW - DAY }, NOW);
    const ancien = corridorConfidence({ ...base, lastSeenAt: NOW - 3650 * DAY }, NOW);
    expect(recent).toBeGreaterThan(ancien);
  });

  it("traite une date inconnue comme neutre, ni bonus ni pénalité", () => {
    const inconnu = corridorConfidence({ ...base, lastSeenAt: null }, NOW);
    const frais = corridorConfidence({ ...base, lastSeenAt: NOW }, NOW);
    const vieux = corridorConfidence({ ...base, lastSeenAt: NOW - 3650 * DAY }, NOW);
    expect(inconnu).toBeLessThan(frais);
    expect(inconnu).toBeGreaterThan(vieux);
    expect(frais - inconnu).toBeCloseTo(COMPARE_CONFIDENCE_WEIGHTS.recency * (1 - COMPARE_UNDATED_RECENCY), 2);
  });

  it("croît avec la diversité des couches", () => {
    const uneCouche = corridorConfidence({ ...base, layers: ["imported_gpx"] }, NOW);
    const troisCouches = corridorConfidence({ ...base, layers: ["official", "osm", "imported_gpx"] }, NOW);
    expect(troisCouches).toBeGreaterThan(uneCouche);
    // Les doublons de couche ne comptent qu'une fois.
    expect(corridorConfidence({ ...base, layers: ["osm", "osm", "osm"] }, NOW)).toBe(
      corridorConfidence({ ...base, layers: ["osm"] }, NOW),
    );
  });

  it("reste entre 0 et 1 sur des entrées incohérentes", () => {
    expect(corridorConfidence({ uniqueSources: 0, traces: 0, dispersionM: 0, layers: [] }, NOW)).toBe(0);
    const absurde = corridorConfidence(
      {
        uniqueSources: Number.NaN,
        traces: Number.POSITIVE_INFINITY,
        dispersionM: Number.NaN,
        layers: [],
        lastSeenAt: Number.NaN,
      },
      Number.NaN,
    );
    expect(Number.isFinite(absurde)).toBe(true);
    expect(absurde).toBeGreaterThanOrEqual(0);
    expect(absurde).toBeLessThanOrEqual(1);
    // Plus de sources que de traces : l'excédent est ignoré, pas récompensé.
    expect(corridorConfidence({ ...base, uniqueSources: 99, traces: 1 }, NOW)).toBeLessThanOrEqual(
      COMPARE_UNCORROBORATED_CONFIDENCE_CAP,
    );
    expect(corridorConfidence({ ...base, dispersionM: -50 }, NOW)).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* 5. deduplicate : la même trace récupérée deux fois                  */
/* ------------------------------------------------------------------ */

describe("deduplicate", () => {
  it("garde la meilleure copie et note de qui l'autre est le doublon", () => {
    const line = northLine(101);
    const result = deduplicate([
      trace("copie-b", line.map((c) => [c[0], c[1]]), { sourceId: "src-b", quality: 50 }),
      trace("copie-a", line, { sourceId: "src-a", quality: 90 }),
    ]);
    expect(result.keep).toEqual(["copie-a"]);
    expect(result.duplicates).toEqual({ "copie-b": "copie-a" });
  });

  it("reconnaît une copie rediffusée à l'envers", () => {
    const line = northLine(101);
    const result = deduplicate([
      trace("origine", line, { quality: 80 }),
      trace("rediffusion", [...line].reverse(), { quality: 40 }),
    ]);
    expect(result.keep).toEqual(["origine"]);
    expect(result.duplicates).toEqual({ rediffusion: "origine" });
  });

  it("ne confond pas deux relevés indépendants du même sentier", () => {
    const result = deduplicate([
      trace("releve-1", northLine(101), { quality: 80 }),
      trace("releve-2", northLine(101, 10, COMPARE_DUPLICATE_MAX_MEDIAN_M * 3), { quality: 70 }),
    ]);
    expect(result.keep).toEqual(["releve-1", "releve-2"]);
    expect(result.duplicates).toEqual({});
  });

  it("ne déclare pas doublon une trace seulement incluse dans une autre", () => {
    const longue = northLine(101);
    const result = deduplicate([trace("courte", longue.slice(0, 21)), trace("longue", longue)]);
    expect(result.keep).toEqual(["courte", "longue"]);
    expect(result.duplicates).toEqual({});
  });

  it("rassemble trois copies sous une seule trace conservée", () => {
    const line = northLine(101);
    const result = deduplicate([
      trace("c", line.map((c) => [c[0], c[1]]), { quality: 10 }),
      trace("a", line.map((c) => [c[0], c[1]]), { quality: 90 }),
      trace("b", line.map((c) => [c[0], c[1]]), { quality: 50 }),
    ]);
    expect(result.keep).toEqual(["a"]);
    expect(result.duplicates).toEqual({ b: "a", c: "a" });
    // Les clés sont insérées dans l'ordre croissant : la sortie JSON est stable.
    expect(Object.keys(result.duplicates)).toEqual(["b", "c"]);
  });

  it("conserve les traces sans géométrie exploitable plutôt que de les déclarer doublons", () => {
    const result = deduplicate([trace("vide-1", []), trace("vide-2", []), trace("ligne", northLine(101))]);
    expect(result.keep).toEqual(["ligne", "vide-1", "vide-2"]);
    expect(result.duplicates).toEqual({});
  });

  it("ne dépend pas de l'ordre d'entrée", () => {
    const line = northLine(101);
    const traces = [
      trace("a", line.map((c) => [c[0], c[1]]), { quality: 90 }),
      trace("b", line.map((c) => [c[0], c[1]]), { quality: 50 }),
      trace("z", northLine(101, 10, 2000), { quality: 70 }),
    ];
    const direct = deduplicate(traces);
    const melange = deduplicate([traces[2], traces[1], traces[0]]);
    expect(JSON.stringify(melange)).toBe(JSON.stringify(direct));
  });

  it("rend une sortie vide sur une entrée vide", () => {
    expect(deduplicate([])).toEqual({ keep: [], duplicates: {} });
  });
});

/* ------------------------------------------------------------------ */
/* 6. Déterminisme d'ensemble                                          */
/* ------------------------------------------------------------------ */

describe("déterminisme", () => {
  it("rend deux fois exactement le même résultat pour la même entrée", () => {
    const beam = demoBeam();
    const detour = trace("t-detour", withDetour(northLine(101), 40, 60, 120), {
      sourceId: "src-club",
      quality: 40,
    });
    const traces = [...beam, detour];
    const run = (): string =>
      JSON.stringify({
        comparaison: compareTraces(traces[0], traces[3], { now: NOW }),
        groupes: clusterTraces(traces, { now: NOW }),
        corridor: buildCorridor(traces, { now: NOW }),
        doublons: deduplicate(traces, { now: NOW }),
      });
    expect(run()).toBe(run());
  });

  it("ne dépend d'aucune horloge implicite", () => {
    const beam = demoBeam().map((t) => ({ ...t, at: NOW - 30 * DAY }));
    const a = buildCorridor(beam, { now: NOW });
    const b = buildCorridor(beam, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plusTard = buildCorridor(beam, { now: NOW + 3650 * DAY });
    expect(a).not.toBeNull();
    expect(plusTard).not.toBeNull();
    if (!a || !plusTard) return;
    // Seule la confiance bouge avec le temps : la géométrie, elle, est un fait mesuré.
    expect(plusTard.coordinates).toEqual(a.coordinates);
    expect(plusTard.confidence).toBeLessThan(a.confidence);
  });
});
