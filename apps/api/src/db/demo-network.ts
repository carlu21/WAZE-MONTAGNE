/**
 * Réseau de chemins de DÉMONSTRATION (Corse) : les sentiers du jeu de données
 * densifiés (un sommet tous les 25 m), plus quelques embranchements dessinés à
 * la main autour des secteurs de test (Restonica, Vizzavona, Bavella, Vergio)
 * afin d'exercer le map matching aux intersections. Les vraies données
 * viennent de l'import OpenStreetMap (`pnpm geo:import-osm`).
 *
 * Ces segments sortent d'ici marqués `source: "seed"` et SANS `sourceFeatureId` :
 * ils ne correspondent à aucun objet cartographique réel. C'est ce qui permet à
 * `isSurveyed()` de les écarter, et donc à l'application de ne jamais les
 * présenter comme des sentiers relevés.
 */
import { haversineM, type LngLat, type PathKind, type PathSegment } from "@mountain-live/core";
import { splitAtSharedNodes, type RawWay } from "../services/paths";

export interface DemoTrail {
  id: string;
  name: string;
  type: "hiking" | "trail" | "mtb" | "equestrian" | "mixed";
  coords: [number, number][];
}

/** Interpole des sommets tous les `stepM` mètres en conservant les sommets d'origine. */
export function densify(coords: readonly LngLat[], stepM = 25): LngLat[] {
  if (coords.length < 2) return coords.map((c) => [c[0], c[1]] as LngLat);
  const out: LngLat[] = [[coords[0][0], coords[0][1]]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const len = haversineM({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push(k === n ? [b[0], b[1]] : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

interface Branch {
  id: string;
  name: string;
  kind: PathKind;
  coords: LngLat[];
  ford?: boolean;
  bicycle?: boolean;
  horse?: boolean;
  widthM?: number;
}

/** Embranchements : le premier point est toujours un sommet d'un sentier du jeu de données. */
const BRANCHES: Branch[] = [
  // Restonica : piste depuis le parking de Grotelle, variante vers Capitello, bergerie de Melo.
  { id: "d_piste_grotelle", name: "Piste des bergeries de Grotelle", kind: "track", widthM: 3, coords: [[9.0453, 42.2261], [9.0489, 42.2284], [9.0531, 42.2301], [9.0568, 42.2327]] },
  { id: "d_variante_capitello", name: "Variante du lac de Capitello", kind: "path", coords: [[9.0305, 42.2168], [9.0286, 42.2186], [9.0262, 42.2197], [9.0238, 42.2192]] },
  { id: "d_bergerie_melo", name: "Sentier de la bergerie de Melo", kind: "path", bicycle: false, coords: [[9.0261, 42.2139], [9.0268, 42.2116], [9.0281, 42.2094], [9.0302, 42.2079]] },
  // Vizzavona : chemin de la gare, piste forestière et gué de l'Agnone.
  { id: "d_chemin_gare", name: "Chemin de la gare de Vizzavona", kind: "footway", bicycle: false, horse: false, coords: [[9.1339, 42.1275], [9.1352, 42.1289], [9.1361, 42.1303]] },
  { id: "d_piste_foret_vizzavona", name: "Piste forestière de Vizzavona", kind: "track", widthM: 3.5, coords: [[9.1272, 42.1248], [9.1246, 42.1219], [9.1217, 42.1196], [9.1184, 42.1178]] },
  { id: "d_gue_agnone", name: "Gué de l'Agnone", kind: "path", ford: true, coords: [[9.1212, 42.1229], [9.1198, 42.1214], [9.1185, 42.1202]] },
  // Bavella : sentier des aiguilles et boucle de retour.
  { id: "d_sentier_aiguilles", name: "Sentier des aiguilles de Bavella", kind: "path", bicycle: false, coords: [[9.2318, 41.7975], [9.2321, 41.7998], [9.2331, 41.8021], [9.2349, 41.8039]] },
  { id: "d_retour_bombe", name: "Retour de la Bombe par la forêt", kind: "track", widthM: 2.5, coords: [[9.2404, 41.7994], [9.2381, 41.8012], [9.2346, 41.8018], [9.2318, 41.7975]] },
  // Vergio / Niolu : sentier du Golo depuis la boucle VTT.
  { id: "d_sentier_golo", name: "Sentier du Golo", kind: "path", bicycle: false, coords: [[8.9051, 42.3067], [8.9036, 42.3102], [8.9012, 42.3141], [8.8996, 42.3186]] },
  // Corte / Tavignano : escalier vers le village.
  { id: "d_escalier_tavignano", name: "Escalier du Tavignano", kind: "steps", bicycle: false, horse: false, coords: [[9.1497, 42.3061], [9.1507, 42.3053], [9.1516, 42.3047]] },
];

function kindForTrail(type: DemoTrail["type"]): PathKind {
  return type === "mtb" ? "track" : type === "equestrian" ? "bridleway" : "path";
}

/** Segments de démonstration (découpés aux intersections). */
export function buildDemoNetwork(trails: readonly DemoTrail[]): PathSegment[] {
  const ways: RawWay[] = trails.map((t) => ({
    id: `d_${t.id}`,
    coordinates: densify(t.coords),
    meta: { name: t.name.split(" — ")[0], kind: kindForTrail(t.type), source: "seed", bicycle: t.type !== "hiking" || t.id.startsWith("t_mare"), horse: t.type === "mixed" || t.type === "equestrian" || t.type === "mtb" },
  }));
  for (const b of BRANCHES) {
    ways.push({
      id: b.id,
      coordinates: densify(b.coords),
      meta: { name: b.name, kind: b.kind, source: "seed", ford: b.ford ?? false, bicycle: b.bicycle ?? b.kind !== "steps", horse: b.horse ?? (b.kind !== "steps" && b.kind !== "footway"), widthM: b.widthM ?? null },
    });
  }
  return splitAtSharedNodes(ways);
}
