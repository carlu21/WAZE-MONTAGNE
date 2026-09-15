/**
 * Tests du calculateur d'itinéraires multicritères (sections 22, 23, 39, 40, 41).
 *
 * Le terrain est celui de la haute Restonica : depuis les bergeries de
 * Grotelle, deux façons d'atteindre le même col — la rive raide et fréquentée,
 * ou la piste plus longue et déserte — et, pour le second jeu d'essai, le
 * choix entre une via ferrata directe et une route de fond de vallée deux fois
 * plus longue mais bien plus rapide. Les géométries sont construites avec
 * `offsetPoint`, les longueurs et les durées en découlent : aucune valeur
 * n'est recopiée à la main dans les assertions.
 */
import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint, type LngLat } from "../geo";
import { makeSegment } from "../navigation/graph";
import { ACTIVITY_MODES, type ActivityMode, type PathSegment } from "../navigation/types";
import { durationStats } from "./statistics";
import { TIME_CONFIDENCE_RANK, segmentProfile } from "./timing";
import {
  K_ANONYMITY_MIN,
  type RouteCriterion,
  type RouteOption,
  type RoutingSegmentInput,
  type SegmentCosts,
  type SegmentStatistics,
} from "./types";
import {
  ROUTE_CLIMB_EQUIVALENT_M,
  ROUTE_CRITERION_WEIGHTS,
  ROUTE_DEFAULT_CRITERIA,
  ROUTE_DESCENT_EQUIVALENT_M,
  ROUTE_FORD_DIFFICULTY,
  ROUTE_MAX_SNAP_M,
  ROUTE_MIN_EDGE_COST,
  ROUTE_RECOMMENDED_WEIGHTS,
  SEGMENT_COST_KEYS,
  type RoutingGraph,
  bestCostPerMeter,
  buildRoutingGraph,
  criterionWeight,
  directionProfile,
  edgeCost,
  nearestNode,
  planRoutes,
  publishableStats,
  segmentCosts,
  segmentDifficulty,
  segmentTimeEstimate,
} from "./routing";

/* ------------------------------------------------------------------ */
/* Fabriques locales                                                    */
/* ------------------------------------------------------------------ */

/** Bergeries de Grotelle, haute Restonica : origine de toutes les géométries. */
const GROTELLE = { lat: 42.2718, lng: 9.0731 };

/** Point à `distanceM` mètres de Grotelle, au cap donné. */
function at(distanceM: number, bearingDeg: number): LngLat {
  const p = offsetPoint(GROTELLE, distanceM, bearingDeg);
  return [p.lng, p.lat];
}

/** Position `{ lat, lng }` d'un sommet de géométrie. */
function pos(point: LngLat): { lat: number; lng: number } {
  return { lat: point[1], lng: point[0] };
}

/** Polyligne droite de `steps` tronçons entre deux points. */
function polyline(a: LngLat, b: LngLat, steps: number): LngLat[] {
  const out: LngLat[] = [a];
  for (let i = 1; i < steps; i++) {
    out.push([a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]);
  }
  out.push(b);
  return out;
}

type SegmentMeta = Partial<Omit<PathSegment, "id" | "coordinates" | "lengthM">>;

/** Segment droit entre deux nœuds, avec altitudes interpolées. */
function seg(
  id: string,
  from: LngLat,
  to: LngLat,
  altFrom: number,
  altTo: number,
  meta: SegmentMeta = {},
  steps = 1,
): PathSegment {
  const coordinates = polyline(from, to, steps);
  const last = coordinates.length - 1;
  const elevations = coordinates.map((_, i) => altFrom + ((altTo - altFrom) * i) / Math.max(1, last));
  return makeSegment(id, coordinates, { name: id, surface: "ground", elevations, ...meta });
}

/** Entrée de routage : le profil « sens de la géométrie » que fournirait l'API. */
function input(segment: PathSegment, statsForward: SegmentStatistics | null = null, statsBackward: SegmentStatistics | null = null): RoutingSegmentInput {
  return { segment, profile: segmentProfile(segment, "forward"), statsForward, statsBackward };
}

/** Trente durées resserrées autour de 20 min : une statistique solide. */
const REGULAR_DURATIONS = Array.from({ length: 30 }, (_, i) => 1_200_000 + (i % 5) * 20_000);

/** Statistiques de segment complètes, modifiables champ par champ. */
function makeStats(over: Partial<SegmentStatistics> = {}): SegmentStatistics {
  return {
    segmentId: "segment",
    activity: "all",
    direction: "both",
    passages: { last7: 6, last30: 24, last365: 180, total: 240 },
    uniqueSessions: 24,
    uniqueUsers: 9,
    duration: durationStats(REGULAR_DURATIONS),
    averageSpeedMs: 1.1,
    firstPassageAt: 1_700_000_000_000,
    lastPassageAt: 1_750_000_000_000,
    popularityScore: 70,
    frequentation: "high",
    confidence: 0.8,
    insufficientData: false,
    activityMix: { hiking: 1 },
    monthly: {},
    hourly: {},
    trend: null,
    possiblyInactive: false,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Terrain 1 : le losange de la Restonica                              */
/* ------------------------------------------------------------------ */

/** Départ : les bergeries. */
const DEPART = at(0, 0);
/** Replat de la rive gauche. */
const REPLAT = at(500, 90);
/** Col, arrivée commune aux deux itinéraires. */
const COL = at(800, 90);
/** Bas de la piste forestière. */
const PISTE_BAS = at(300, 180);

const RIVE = seg("rive", DEPART, REPLAT, 1400, 1500, { kind: "path" });
const MELO = seg("melo", REPLAT, COL, 1500, 1600, { kind: "path" }, 3);
const PISTE = seg("piste", DEPART, PISTE_BAS, 1400, 1400, { kind: "track", surface: "gravel" });
const DETOUR = seg("detour", PISTE_BAS, COL, 1400, 1600, { kind: "track", surface: "gravel" });

const RIVE_M = haversineM(pos(DEPART), pos(REPLAT));
const MELO_M = haversineM(pos(REPLAT), pos(COL));
const PISTE_M = haversineM(pos(DEPART), pos(PISTE_BAS));
const DETOUR_M = haversineM(pos(PISTE_BAS), pos(COL));

/** La rive est fréquentée et chronométrée, le col fréquenté mais jamais chronométré. */
const RESTONICA: RoutingSegmentInput[] = [
  input(RIVE, makeStats({ segmentId: "rive", popularityScore: 70 }), makeStats({ segmentId: "rive", popularityScore: 70 })),
  input(
    MELO,
    makeStats({ segmentId: "melo", popularityScore: 50, duration: null, passages: { last7: 10, last30: 40, last365: 300, total: 400 } }),
    makeStats({ segmentId: "melo", popularityScore: 50, duration: null, passages: { last7: 10, last30: 40, last365: 300, total: 400 } }),
  ),
  input(PISTE),
  input(DETOUR),
];

const GRAPH = buildRoutingGraph(RESTONICA);

/* ------------------------------------------------------------------ */
/* Terrain 2 : la via ferrata contre la route de fond de vallée        */
/* ------------------------------------------------------------------ */

/** Sortie de la via ferrata et de la route : le même belvédère. */
const BELVEDERE = at(800, 90);
/** Carrefour de la route, en fond de vallée. */
const CARREFOUR = at(600, 180);

const FERRATA = seg("ferrata", DEPART, BELVEDERE, 1400, 1800, {
  kind: "via_ferrata",
  surface: "rock",
  sacScale: "difficult_alpine_hiking",
});
const ROUTE_BASSE = seg("route-basse", DEPART, CARREFOUR, 1400, 1400, { kind: "road", surface: "asphalt" });
const ROUTE_HAUTE = seg("route-haute", CARREFOUR, BELVEDERE, 1400, 1400, { kind: "road", surface: "asphalt" });

const TRAP: RoutingSegmentInput[] = [input(FERRATA), input(ROUTE_BASSE), input(ROUTE_HAUTE)];
const TRAP_GRAPH = buildRoutingGraph(TRAP);

/* ------------------------------------------------------------------ */
/* Outils de vérification                                              */
/* ------------------------------------------------------------------ */

/** Suite des tronçons empruntés, sens compris. */
function signature(option: RouteOption): string[] {
  return option.legs.map((leg) => `${leg.segmentId}/${leg.direction}`);
}

/** Coût réel d'un itinéraire, recalculé arête par arête. */
function optionCost(graph: RoutingGraph, option: RouteOption, activity: ActivityMode, weights: Record<keyof SegmentCosts, number>): number {
  let total = 0;
  for (const leg of option.legs) {
    const edge = graph.edges.find((e) => e.segmentId === leg.segmentId && e.direction === leg.direction);
    if (edge === undefined) throw new Error(`arête introuvable : ${leg.segmentId}`);
    total += edgeCost(edge.costs[activity], weights);
  }
  return total;
}

/** Coût du meilleur chemin simple, par énumération exhaustive (petits graphes). */
function bruteForceCost(graph: RoutingGraph, start: string, goal: string, activity: ActivityMode, weights: Record<keyof SegmentCosts, number>): number {
  let best = Infinity;
  const walk = (node: string, cost: number, seen: Set<string>): void => {
    if (node === goal) {
      if (cost < best) best = cost;
      return;
    }
    for (const edge of graph.adjacency.get(node) ?? []) {
      if (!edge.allowed[activity] || seen.has(edge.to)) continue;
      seen.add(edge.to);
      walk(edge.to, cost + edgeCost(edge.costs[activity], weights), seen);
      seen.delete(edge.to);
    }
  };
  walk(start, 0, new Set([start]));
  return best;
}

/** Coûts arbitraires, pour les tests unitaires de `edgeCost`. */
function costs(over: Partial<SegmentCosts> = {}): SegmentCosts {
  return { distance: 0, time: 0, difficulty: 0, popularity: 0, elevation: 0, ...over };
}

/** Poids arbitraires. */
function weights(over: Partial<Record<keyof SegmentCosts, number>> = {}): Record<keyof SegmentCosts, number> {
  return { distance: 0, time: 0, difficulty: 0, popularity: 0, elevation: 0, ...over };
}

/* ------------------------------------------------------------------ */
/* 1. Construction du graphe                                           */
/* ------------------------------------------------------------------ */

describe("buildRoutingGraph (sections 22, 41)", () => {
  it("crée deux arêtes orientées par segment, reliant les nœuds de ses extrémités", () => {
    expect(GRAPH.edges).toHaveLength(RESTONICA.length * 2);
    const rive = GRAPH.edges.filter((e) => e.segmentId === "rive");
    expect(rive.map((e) => e.direction).sort()).toEqual(["backward", "forward"]);
    const forward = rive.find((e) => e.direction === "forward");
    const backward = rive.find((e) => e.direction === "backward");
    expect(forward?.to).toBe(backward?.from);
    expect(forward?.from).toBe(backward?.to);
    expect(GRAPH.nodes.size).toBe(4);
    expect(GRAPH.adjacency.get(forward?.from ?? "")).toHaveLength(2);
  });

  it("ignore une géométrie de moins de deux points et un identifiant déjà vu", () => {
    const orphan = { ...RIVE, id: "orphan", coordinates: [DEPART] };
    const graph = buildRoutingGraph([input(RIVE), input({ ...RIVE, name: "doublon" }), input(orphan)]);
    expect(graph.segments.size).toBe(1);
    expect(graph.edges).toHaveLength(2);
    expect(graph.segments.get("rive")?.segment.name).toBe("rive");
  });

  it("n'ajoute aucune arête pour un segment bouclé sur lui-même", () => {
    const boucle = seg("boucle", DEPART, DEPART, 1400, 1400);
    const graph = buildRoutingGraph([input(boucle)]);
    expect(graph.segments.size).toBe(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.size).toBe(1);
  });

  it("échange les dénivelés entre l'aller et le retour", () => {
    const forward = GRAPH.edges.find((e) => e.segmentId === "rive" && e.direction === "forward");
    const backward = GRAPH.edges.find((e) => e.segmentId === "rive" && e.direction === "backward");
    expect(forward?.elevationGainM).toBeCloseTo(100, 0);
    expect(forward?.elevationLossM).toBe(0);
    expect(backward?.elevationGainM).toBe(forward?.elevationLossM);
    expect(backward?.elevationLossM).toBe(forward?.elevationGainM);
    expect(forward?.distanceM).toBeCloseTo(backward?.distanceM ?? -1, 3);
  });

  it("précalcule une durée par activité, plus longue à la montée qu'à la descente", () => {
    const forward = GRAPH.edges.find((e) => e.segmentId === "rive" && e.direction === "forward");
    const backward = GRAPH.edges.find((e) => e.segmentId === "rive" && e.direction === "backward");
    for (const activity of ACTIVITY_MODES) {
      expect(forward?.durations[activity].ms).toBeGreaterThan(0);
      expect(Number.isFinite(forward?.costs[activity].time ?? NaN)).toBe(true);
    }
    expect(forward?.durations.hiking.ms ?? 0).toBeGreaterThan(backward?.durations.hiking.ms ?? 0);
    expect(forward?.durations.trail.ms ?? 0).toBeLessThan(forward?.durations.hiking.ms ?? 0);
  });

  it("produit le même graphe quel que soit l'ordre des segments fournis", () => {
    const reversed = buildRoutingGraph([...RESTONICA].reverse());
    expect(reversed.edges.map((e) => `${e.segmentId}/${e.direction}`)).toEqual(
      GRAPH.edges.map((e) => `${e.segmentId}/${e.direction}`),
    );
    for (const node of GRAPH.adjacency.keys()) {
      expect(reversed.adjacency.get(node)?.map((e) => e.segmentId)).toEqual(
        GRAPH.adjacency.get(node)?.map((e) => e.segmentId),
      );
    }
  });

  it("accepte un graphe vide sans rien jeter", () => {
    const empty = buildRoutingGraph([]);
    expect(empty.edges).toHaveLength(0);
    expect(empty.nodes.size).toBe(0);
    expect(nearestNode(empty, GROTELLE)).toBeNull();
    expect(planRoutes(empty, GROTELLE, pos(COL), { activity: "hiking" })).toEqual([]);
  });

  it("reprend le profil fourni par l'appelant et en dérive le sens inverse", () => {
    const provided = { ...segmentProfile(RIVE, "forward"), elevationGainM: 250, elevationLossM: 10, averageSlope: 12 };
    const custom: RoutingSegmentInput = { segment: RIVE, profile: provided };
    expect(directionProfile(custom, "forward").elevationGainM).toBe(250);
    const reverse = directionProfile(custom, "backward");
    expect(reverse.elevationGainM).toBe(10);
    expect(reverse.elevationLossM).toBe(250);
    expect(reverse.averageSlope).toBe(-12);
    expect(reverse.maxSlope).toBe(provided.maxSlope);
  });

  it("recalcule le profil quand celui fourni est inexploitable", () => {
    const broken = { ...segmentProfile(RIVE, "forward"), distanceM: Number.NaN };
    const custom: RoutingSegmentInput = { segment: RIVE, profile: broken };
    expect(directionProfile(custom, "forward").distanceM).toBeCloseTo(RIVE_M, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Vie privée                                                        */
/* ------------------------------------------------------------------ */

describe("vie privée : seuil de k-anonymat (sections 34 à 36)", () => {
  it("publie passages et popularité au-delà du seuil d'utilisateurs distincts", () => {
    const stats = makeStats({ uniqueUsers: K_ANONYMITY_MIN });
    expect(publishableStats(stats)).toBe(stats);
    const graph = buildRoutingGraph([input(RIVE, stats, stats)]);
    const edge = graph.edges[0];
    expect(edge.passages30d).toBe(24);
    expect(edge.popularityScore).toBe(70);
  });

  it("masque passages et popularité sous le seuil", () => {
    const stats = makeStats({ uniqueUsers: K_ANONYMITY_MIN - 1 });
    expect(publishableStats(stats)).toBeNull();
    const graph = buildRoutingGraph([input(RIVE, stats, stats)]);
    const edge = graph.edges[0];
    expect(edge.passages30d).toBe(0);
    expect(edge.popularityScore).toBe(0);
    expect(segmentCosts(input(RIVE, stats, stats), "forward", "hiking").popularity).toBe(0);
  });

  it("ne mêle aucune durée observée sous le seuil", () => {
    const secret = input(RIVE, makeStats({ uniqueUsers: K_ANONYMITY_MIN - 1 }), null);
    const shared = input(RIVE, makeStats({ uniqueUsers: K_ANONYMITY_MIN }), null);
    const hidden = segmentTimeEstimate(secret, "forward", "hiking");
    const published = segmentTimeEstimate(shared, "forward", "hiking");
    expect(hidden.observedWeight).toBe(0);
    expect(hidden.observedMs).toBeNull();
    expect(hidden.confidence).toBe("very_low");
    expect(published.observedWeight).toBeGreaterThan(0);
    expect(published.ms).not.toBe(hidden.ms);
  });

  it("compte des utilisateurs distincts, jamais des passages", () => {
    const solitaire = makeStats({ uniqueUsers: 1, passages: { last7: 300, last30: 1000, last365: 4000, total: 4000 } });
    expect(publishableStats(solitaire)).toBeNull();
    const graph = buildRoutingGraph([input(RIVE, solitaire, solitaire)]);
    expect(graph.edges[0].passages30d).toBe(0);
  });

  it("traite une statistique absente ou nulle comme un segment inconnu", () => {
    expect(publishableStats(null)).toBeNull();
    expect(publishableStats(undefined)).toBeNull();
    expect(publishableStats(makeStats({ uniqueUsers: Number.NaN }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Coûts d'un segment                                               */
/* ------------------------------------------------------------------ */

describe("segmentCosts (section 39)", () => {
  it("produit cinq coûts finis et positifs", () => {
    const value = segmentCosts(RESTONICA[0], "forward", "hiking");
    for (const key of SEGMENT_COST_KEYS) {
      expect(Number.isFinite(value[key])).toBe(true);
      expect(value[key]).toBeGreaterThanOrEqual(0);
    }
    expect(value.distance).toBeCloseTo(RIVE_M, 0);
    expect(value.time).toBeGreaterThan(0);
  });

  it("coûte plus de temps à la montée qu'à la descente", () => {
    const up = segmentCosts(RESTONICA[0], "forward", "hiking");
    const down = segmentCosts(RESTONICA[0], "backward", "hiking");
    expect(up.time).toBeGreaterThan(down.time);
    expect(up.distance).toBeCloseTo(down.distance, 3);
  });

  it("convertit les dénivelés en mètres équivalents", () => {
    const profile = segmentProfile(RIVE, "forward");
    const value = segmentCosts(input(RIVE), "forward", "hiking");
    expect(value.elevation).toBeCloseTo(
      profile.elevationGainM * ROUTE_CLIMB_EQUIVALENT_M + profile.elevationLossM * ROUTE_DESCENT_EQUIVALENT_M,
      2,
    );
    const reverse = segmentCosts(input(RIVE), "backward", "hiking");
    expect(reverse.elevation).toBeCloseTo(profile.elevationGainM * ROUTE_DESCENT_EQUIVALENT_M, 2);
  });

  it("classe la difficulté du terrain, gué compris", () => {
    const sentier = segmentDifficulty(input(RIVE), "forward");
    const couloir = segmentDifficulty(input(FERRATA), "forward");
    const gue = segmentDifficulty(input(seg("gue", DEPART, REPLAT, 1400, 1500, { ford: true })), "forward");
    expect(couloir).toBeGreaterThan(sentier);
    expect(gue).toBeCloseTo(Math.min(1, sentier + ROUTE_FORD_DIFFICULTY), 4);
    expect(sentier).toBeGreaterThan(0);
    expect(couloir).toBeLessThanOrEqual(1);
  });

  it("reste fini sur une géométrie dégénérée (deux points identiques)", () => {
    const plat = input(seg("point", DEPART, DEPART, 1400, 1400));
    const value = segmentCosts(plat, "forward", "hiking");
    expect(value).toEqual({ distance: 0, time: 0, difficulty: 0, popularity: 0, elevation: 0 });
    expect(segmentDifficulty(plat, "backward")).toBeGreaterThanOrEqual(0);
  });

  it("n'attribue aucune popularité ni durée observée à un segment sans statistiques", () => {
    const value = segmentCosts(input(PISTE), "forward", "hiking");
    expect(value.popularity).toBe(0);
    expect(segmentTimeEstimate(input(PISTE), "forward", "hiking").observedWeight).toBe(0);
  });

  it("supporte des statistiques vides (durée nulle, vitesse inconnue)", () => {
    const vide = makeStats({ duration: null, averageSpeedMs: null, popularityScore: Number.NaN });
    const value = segmentCosts(input(RIVE, vide, vide), "forward", "hiking");
    for (const key of SEGMENT_COST_KEYS) expect(Number.isFinite(value[key])).toBe(true);
    expect(value.popularity).toBe(0);
  });

  it("exprime le temps en mètres équivalents : un plat neutre coûte sa propre longueur", () => {
    const plat = input(seg("plat", DEPART, REPLAT, 1400, 1400, { kind: "path", surface: "gravel" }));
    for (const activity of ["hiking", "trail", "equestrian"] as const) {
      const value = segmentCosts(plat, "forward", activity);
      expect(value.time).toBeCloseTo(value.distance, 1);
    }
  });

  it("rapporte le coût du dénivelé à l'allure de chaque activité", () => {
    const marche = segmentCosts(input(RIVE), "forward", "hiking");
    const trail = segmentCosts(input(RIVE), "forward", "trail");
    // Le temps réel du traileur est plus court…
    expect(segmentTimeEstimate(input(RIVE), "forward", "trail").ms).toBeLessThan(
      segmentTimeEstimate(input(RIVE), "forward", "hiking").ms,
    );
    // …mais rapportés à sa propre vitesse de référence, ces 100 m de montée
    // lui coûtent davantage de « mètres de plat » qu'au randonneur.
    expect(trail.time / trail.distance).toBeGreaterThan(marche.time / marche.distance);
    expect(trail.distance).toBe(marche.distance);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Pondérations et coût combiné                                     */
/* ------------------------------------------------------------------ */

describe("criterionWeight (section 40)", () => {
  it("expose les cinq clés pour chacun des six critères", () => {
    expect(ROUTE_DEFAULT_CRITERIA).toHaveLength(6);
    for (const criterion of ROUTE_DEFAULT_CRITERIA) {
      const w = criterionWeight(criterion, "hiking");
      expect(Object.keys(w).sort()).toEqual([...SEGMENT_COST_KEYS].sort());
      for (const key of SEGMENT_COST_KEYS) expect(Number.isFinite(w[key])).toBe(true);
    }
  });

  it("n'adapte à l'activité que le critère `recommended`", () => {
    expect(criterionWeight("recommended", "mtb")).toEqual(ROUTE_RECOMMENDED_WEIGHTS.mtb);
    expect(criterionWeight("recommended", "mtb")).not.toEqual(criterionWeight("recommended", "hiking"));
    expect(criterionWeight("shortest", "mtb")).toEqual(criterionWeight("shortest", "equestrian"));
    expect(criterionWeight("recommended", "equestrian").difficulty).toBeGreaterThan(
      criterionWeight("recommended", "trail").difficulty,
    );
  });

  it("garantit un coût au mètre positif : distance + min(0, popularité) ≥ 0", () => {
    for (const criterion of ROUTE_DEFAULT_CRITERIA) {
      for (const activity of ACTIVITY_MODES) {
        const w = criterionWeight(criterion, activity);
        expect(w.distance + Math.min(0, w.popularity)).toBeGreaterThanOrEqual(0);
        expect(Math.max(w.distance, w.time, w.difficulty, w.popularity, w.elevation)).toBeGreaterThan(0);
      }
    }
  });

  it("renvoie une copie : la table constante reste intacte", () => {
    const w = criterionWeight("shortest", "hiking");
    w.distance = 42;
    expect(criterionWeight("shortest", "hiking").distance).toBe(1);
    expect(ROUTE_CRITERION_WEIGHTS.shortest.distance).toBe(1);
  });

  it("définit `shortest` sur la seule distance et `fastest` sur le seul temps", () => {
    expect(criterionWeight("shortest", "hiking")).toEqual(weights({ distance: 1 }));
    expect(criterionWeight("fastest", "hiking")).toEqual(weights({ time: 1 }));
    expect(criterionWeight("quietest", "hiking").popularity).toBeGreaterThan(0);
    expect(criterionWeight("most_used", "hiking").popularity).toBeLessThan(0);
  });
});

describe("edgeCost", () => {
  it("additionne les composantes pondérées", () => {
    const value = edgeCost(costs({ distance: 100, time: 200, elevation: 50 }), weights({ distance: 1, time: 0.5, elevation: 2 }));
    expect(value).toBeCloseTo(100 + 100 + 100, 6);
  });

  it("reste strictement positif même quand un poids négatif l'emporte", () => {
    const value = edgeCost(costs({ distance: 100, popularity: 100 }), weights({ distance: 1, popularity: -5 }));
    expect(value).toBe(ROUTE_MIN_EDGE_COST);
    expect(value).toBeGreaterThan(0);
  });

  it("ignore les valeurs non finies plutôt que de renvoyer NaN", () => {
    const value = edgeCost(costs({ distance: Number.NaN, time: 100 }), weights({ distance: 1, time: 1 }));
    expect(value).toBe(100);
    expect(edgeCost(costs(), weights())).toBe(ROUTE_MIN_EDGE_COST);
  });

  it("donne un coût strictement positif à chaque arête du réseau", () => {
    for (const edge of GRAPH.edges) {
      for (const criterion of ROUTE_DEFAULT_CRITERIA) {
        for (const activity of ACTIVITY_MODES) {
          expect(edgeCost(edge.costs[activity], criterionWeight(criterion, activity))).toBeGreaterThan(0);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. Heuristique                                                       */
/* ------------------------------------------------------------------ */

describe("heuristique A* (section 41)", () => {
  it("ne dépasse jamais le coût au mètre réel d'une arête praticable", () => {
    for (const graph of [GRAPH, TRAP_GRAPH]) {
      for (const criterion of ROUTE_DEFAULT_CRITERIA) {
        for (const activity of ACTIVITY_MODES) {
          const w = criterionWeight(criterion, activity);
          const perMeter = bestCostPerMeter(graph, activity, w);
          expect(perMeter).toBeGreaterThanOrEqual(0);
          for (const edge of graph.edges) {
            if (!edge.allowed[activity]) continue;
            const span = Math.max(edge.distanceM, edge.spanM);
            if (span <= 0) continue;
            expect(perMeter).toBeLessThanOrEqual(edgeCost(edge.costs[activity], w) / span + 1e-9);
          }
        }
      }
    }
  });

  it("s'annule sur un graphe sans arête praticable", () => {
    expect(bestCostPerMeter(buildRoutingGraph([]), "hiking", criterionWeight("shortest", "hiking"))).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Planification                                                     */
/* ------------------------------------------------------------------ */

describe("planRoutes (sections 22, 23, 41)", () => {
  it("décrit entièrement l'itinéraire nominal", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    expect(route.criterion).toBe("shortest");
    expect(signature(route)).toEqual(["rive/forward", "melo/forward"]);
    expect(route.distanceM).toBe(Math.round(RIVE_M + MELO_M));
    expect(route.durationMs).toBe(route.legs.reduce((sum, leg) => sum + leg.durationMs, 0));
    expect(route.elevationGainM).toBeCloseTo(200, 0);
    expect(route.elevationLossM).toBe(0);
    expect(route.legs[0].name).toBe("rive");
    expect(route.difficulty).toBeGreaterThan(0);
    expect(route.difficulty).toBeLessThanOrEqual(1);
    expect(route.coordinates[0]).toEqual(DEPART);
    expect(route.coordinates[route.coordinates.length - 1]).toEqual(COL);
  });

  it("concatène la géométrie sans point dupliqué aux jonctions", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    expect(route.coordinates).toHaveLength(RIVE.coordinates.length + MELO.coordinates.length - 1);
    for (let i = 1; i < route.coordinates.length; i++) {
      expect(route.coordinates[i]).not.toEqual(route.coordinates[i - 1]);
    }
  });

  it("retourne la géométrie d'une arête parcourue à rebours", () => {
    const [route] = planRoutes(GRAPH, pos(COL), pos(DEPART), { activity: "hiking", criteria: ["shortest"] });
    expect(signature(route)).toEqual(["melo/backward", "rive/backward"]);
    expect(route.coordinates[0]).toEqual(COL);
    expect(route.coordinates[route.coordinates.length - 1]).toEqual(DEPART);
    expect(route.elevationGainM).toBe(0);
    expect(route.elevationLossM).toBeCloseTo(200, 0);
  });

  it("trouve le plus court chemin d'un petit graphe dont on connaît la réponse", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    const w = criterionWeight("shortest", "hiking");
    const start = nearestNode(GRAPH, pos(DEPART));
    const goal = nearestNode(GRAPH, pos(COL));
    expect(start).not.toBeNull();
    expect(goal).not.toBeNull();
    expect(route.distanceM).toBeLessThan(Math.round(PISTE_M + DETOUR_M));
    if (start !== null && goal !== null) {
      expect(optionCost(GRAPH, route, "hiking", w)).toBeCloseTo(bruteForceCost(GRAPH, start, goal, "hiking", w), 6);
    }
  });

  it("reste optimal quand le chemin le moins cher au mètre est un détour", () => {
    const fast = planRoutes(TRAP_GRAPH, pos(DEPART), pos(BELVEDERE), { activity: "hiking", criteria: ["fastest"] })[0];
    expect(signature(fast)).toEqual(["route-basse/forward", "route-haute/forward"]);
    const w = criterionWeight("fastest", "hiking");
    const start = nearestNode(TRAP_GRAPH, pos(DEPART));
    const goal = nearestNode(TRAP_GRAPH, pos(BELVEDERE));
    if (start !== null && goal !== null) {
      expect(optionCost(TRAP_GRAPH, fast, "hiking", w)).toBeCloseTo(bruteForceCost(TRAP_GRAPH, start, goal, "hiking", w), 6);
    }
    const short = planRoutes(TRAP_GRAPH, pos(DEPART), pos(BELVEDERE), { activity: "hiking", criteria: ["shortest"] })[0];
    expect(signature(short)).toEqual(["ferrata/forward"]);
    expect(short.distanceM).toBeLessThan(fast.distanceM);
    expect(short.durationMs).toBeGreaterThan(fast.durationMs);
  });

  it("vérifie l'optimalité de chaque critère contre une énumération exhaustive", () => {
    const start = nearestNode(GRAPH, pos(DEPART));
    const goal = nearestNode(GRAPH, pos(COL));
    expect(start).not.toBeNull();
    expect(goal).not.toBeNull();
    if (start === null || goal === null) return;
    for (const criterion of ROUTE_DEFAULT_CRITERIA) {
      for (const activity of ACTIVITY_MODES) {
        const w = criterionWeight(criterion, activity);
        const route = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity, criteria: [criterion] })[0];
        expect(route).toBeDefined();
        expect(optionCost(GRAPH, route, activity, w)).toBeCloseTo(bruteForceCost(GRAPH, start, goal, activity, w), 6);
      }
    }
  });

  it("préfère le sentier fréquenté avec `most_used` et l'évite avec `quietest`", () => {
    const used = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["most_used"] })[0];
    const quiet = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["quietest"] })[0];
    expect(signature(used)).toEqual(["rive/forward", "melo/forward"]);
    expect(signature(quiet)).toEqual(["piste/forward", "detour/forward"]);
    expect(quiet.popularityScore).toBe(0);
    expect(used.popularityScore).toBeGreaterThan(0);
  });

  it("évite le couloir raide avec `easiest`", () => {
    const easy = planRoutes(TRAP_GRAPH, pos(DEPART), pos(BELVEDERE), { activity: "hiking", criteria: ["easiest"] })[0];
    expect(signature(easy)).toEqual(["route-basse/forward", "route-haute/forward"]);
    const direct = planRoutes(TRAP_GRAPH, pos(DEPART), pos(BELVEDERE), { activity: "hiking", criteria: ["shortest"] })[0];
    expect(easy.difficulty).toBeLessThan(direct.difficulty);
    expect(easy.elevationGainM).toBeLessThan(direct.elevationGainM);
  });

  it("n'emprunte jamais un segment fermé administrativement", () => {
    const closed = buildRoutingGraph([
      input({ ...MELO, status: "closed" }),
      input(RIVE),
      input(PISTE),
      input(DETOUR),
    ]);
    const route = planRoutes(closed, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] })[0];
    expect(signature(route)).toEqual(["piste/forward", "detour/forward"]);
  });

  it("respecte les interdictions d'activité", () => {
    const graph = buildRoutingGraph([
      input({ ...MELO, bicycle: false }),
      input(RIVE),
      input(PISTE),
      input(DETOUR),
    ]);
    expect(signature(planRoutes(graph, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] })[0])).toEqual([
      "rive/forward",
      "melo/forward",
    ]);
    expect(signature(planRoutes(graph, pos(DEPART), pos(COL), { activity: "mtb", criteria: ["shortest"] })[0])).toEqual([
      "piste/forward",
      "detour/forward",
    ]);
  });

  it("ne renvoie rien quand aucune arête n'est praticable pour l'activité", () => {
    const stairs = buildRoutingGraph([input({ ...RIVE, kind: "steps" }), input({ ...MELO, kind: "steps" })]);
    expect(planRoutes(stairs, pos(DEPART), pos(COL), { activity: "mtb" })).toEqual([]);
    expect(planRoutes(stairs, pos(DEPART), pos(COL), { activity: "hiking" }).length).toBeGreaterThan(0);
  });

  it("ne garde qu'une option quand deux critères donnent le même tracé", () => {
    const routes = planRoutes(TRAP_GRAPH, pos(DEPART), pos(BELVEDERE), {
      activity: "hiking",
      criteria: ["shortest", "most_used"],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].criterion).toBe("shortest");
  });

  it("respecte l'ordre des critères demandés et les dédoublonne", () => {
    const routes = planRoutes(GRAPH, pos(DEPART), pos(COL), {
      activity: "hiking",
      criteria: ["quietest", "shortest", "quietest"],
    });
    expect(routes.map((r) => r.criterion)).toEqual(["quietest", "shortest"]);
  });

  it("calcule les six critères par défaut", () => {
    const routes = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking" });
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.length).toBeLessThanOrEqual(ROUTE_DEFAULT_CRITERIA.length);
    expect(routes[0].criterion).toBe("recommended");
    expect(new Set(routes.map((r) => signature(r).join("|"))).size).toBe(routes.length);
  });

  it("retient le minimum de passages le long de l'itinéraire", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    const legPassages = route.legs.map((leg) => {
      const edge = GRAPH.edges.find((e) => e.segmentId === leg.segmentId && e.direction === leg.direction);
      return edge?.passages30d ?? 0;
    });
    expect(route.passages30d).toBe(Math.min(...legPassages));
    expect(route.passages30d).toBe(24);
    expect(Math.max(...legPassages)).toBe(40);
  });

  it("pondère la difficulté par la distance de chaque tronçon", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    let weighted = 0;
    let total = 0;
    for (const leg of route.legs) {
      const edge = GRAPH.edges.find((e) => e.segmentId === leg.segmentId && e.direction === leg.direction);
      if (edge === undefined) continue;
      weighted += edge.difficulty * edge.distanceM;
      total += edge.distanceM;
    }
    expect(route.difficulty).toBeCloseTo(weighted / total, 3);
  });

  it("rapporte la part de distance réellement chronométrée", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    expect(route.observedWeight).toBeGreaterThan(0);
    expect(route.observedWeight).toBeLessThan(1);
    const desert = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["quietest"] })[0];
    expect(desert.observedWeight).toBe(0);
  });

  it("retient le niveau de confiance le plus bas rencontré", () => {
    const [route] = planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking", criteria: ["shortest"] });
    const rive = GRAPH.edges.find((e) => e.segmentId === "rive" && e.direction === "forward");
    const melo = GRAPH.edges.find((e) => e.segmentId === "melo" && e.direction === "forward");
    expect(TIME_CONFIDENCE_RANK[rive?.timeConfidence ?? "very_low"]).toBeGreaterThan(0);
    expect(melo?.timeConfidence).toBe("very_low");
    expect(route.timeConfidence).toBe("very_low");
  });

  it("n'emprunte aucune arête deux fois", () => {
    for (const route of planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking" })) {
      const used = signature(route);
      expect(new Set(used).size).toBe(used.length);
      expect(new Set(route.legs.map((leg) => leg.segmentId)).size).toBe(used.length);
    }
  });

  it("rattache le départ au nœud le plus proche dans la limite de `maxSnapM`", () => {
    expect(ROUTE_MAX_SNAP_M).toBe(2000);
    const loin = pos(at(1500, 270));
    expect(nearestNode(GRAPH, loin)).not.toBeNull();
    expect(nearestNode(GRAPH, loin, 1000)).toBeNull();
    expect(planRoutes(GRAPH, loin, pos(COL), { activity: "hiking", criteria: ["shortest"] })).toHaveLength(1);
    expect(planRoutes(GRAPH, loin, pos(COL), { activity: "hiking", criteria: ["shortest"], maxSnapM: 1000 })).toEqual([]);
  });

  it("ne propose rien quand une extrémité est hors de portée du réseau", () => {
    const ailleurs = pos(at(50_000, 0));
    expect(planRoutes(GRAPH, pos(DEPART), ailleurs, { activity: "hiking" })).toEqual([]);
    expect(planRoutes(GRAPH, ailleurs, pos(COL), { activity: "hiking" })).toEqual([]);
  });

  it("ne propose rien quand départ et arrivée se rattachent au même nœud", () => {
    expect(planRoutes(GRAPH, pos(DEPART), pos(DEPART), { activity: "hiking" })).toEqual([]);
    expect(planRoutes(GRAPH, pos(at(20, 45)), pos(DEPART), { activity: "hiking" })).toEqual([]);
  });

  it("ne propose rien entre deux composantes non reliées", () => {
    const ile = seg("ile", at(5000, 0), at(5300, 0), 100, 120);
    const graph = buildRoutingGraph([...RESTONICA, input(ile)]);
    expect(planRoutes(graph, pos(DEPART), pos(at(5300, 0)), { activity: "hiking" })).toEqual([]);
  });

  it("tolère un graphe réduit à un seul segment", () => {
    const graph = buildRoutingGraph([input(RIVE)]);
    const routes = planRoutes(graph, pos(DEPART), pos(REPLAT), { activity: "hiking" });
    expect(routes).toHaveLength(1);
    expect(signature(routes[0])).toEqual(["rive/forward"]);
    expect(routes[0].distanceM).toBe(Math.round(RIVE_M));
  });

  it("tolère des coordonnées identiques et des durées nulles", () => {
    const graph = buildRoutingGraph([input(seg("point", DEPART, DEPART, 1400, 1400)), input(RIVE)]);
    const routes = planRoutes(graph, pos(DEPART), pos(REPLAT), { activity: "hiking" });
    expect(routes).toHaveLength(1);
    expect(Number.isNaN(routes[0].durationMs)).toBe(false);
    expect(routes[0].observedWeight).toBeGreaterThanOrEqual(0);
  });

  it("donne exactement le même résultat à deux appels identiques", () => {
    const options = { activity: "hiking" as const };
    const first = planRoutes(GRAPH, pos(DEPART), pos(COL), options);
    const second = planRoutes(GRAPH, pos(DEPART), pos(COL), options);
    const otherOrder = planRoutes(buildRoutingGraph([...RESTONICA].reverse()), pos(DEPART), pos(COL), options);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(otherOrder)).toBe(JSON.stringify(first));
  });

  it("ne modifie ni le graphe ni les segments fournis", () => {
    const before = JSON.stringify(RESTONICA);
    planRoutes(GRAPH, pos(DEPART), pos(COL), { activity: "hiking" });
    expect(JSON.stringify(RESTONICA)).toBe(before);
    expect(GRAPH.edges).toHaveLength(RESTONICA.length * 2);
  });
});
