/**
 * Utilitaires géographiques purs (WGS84).
 *
 * Conventions : `LatLng` = { lat, lng } ; les polylignes suivent l'ordre GeoJSON
 * `[lng, lat]`. Les distances sont en mètres. Les approximations planes locales
 * (projection équirectangulaire) sont valables pour des rayons < 100 km, ce qui
 * couvre largement un massif ou un itinéraire.
 */
import type { BBox, LatLng } from "./types";

export const EARTH_RADIUS_M = 6371000;
/** Longueur d'un degré de latitude (m). */
export const METERS_PER_DEG_LAT = 111320;
/** Taille d'une cellule de présence agrégée (~1 km). */
export const PRESENCE_CELL_DEG = 0.01;
/** Grille d'arrondi des positions floutées (~550 m). */
export const BLUR_GRID_DEG = 0.005;

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Arrondi à 1e-9° (≈ 0,1 mm) : supprime les artefacts flottants des bbox calculées. */
const round9 = (v: number): number => Math.round(v * 1e9) / 1e9;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** Cap initial de `a` vers `b`, en degrés dans [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return deg === 360 ? 0 : deg;
}

export function isValidLatLng(p: unknown): p is LatLng {
  if (typeof p !== "object" || p === null) return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function inBBox(p: LatLng, b: BBox): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

/** `inner` est-elle entièrement contenue dans `outer` ? */
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.west <= inner.west &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.north >= inner.north
  );
}

/**
 * Ramène une bbox dans les bornes WGS84 et remet ses côtés dans l'ordre
 * (sud ≤ nord, ouest ≤ est). Les bbox traversant l'antiméridien ne sont pas gérées.
 */
export function clampBBox(b: BBox): BBox {
  const south = clamp(Math.min(b.south, b.north), -90, 90);
  const north = clamp(Math.max(b.south, b.north), -90, 90);
  const west = clamp(Math.min(b.west, b.east), -180, 180);
  const east = clamp(Math.max(b.west, b.east), -180, 180);
  return { west, south, east, north };
}

export function bboxCenter(b: BBox): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** Bbox carrée (en mètres) autour d'un centre. */
export function bboxFromCenter(center: LatLng, radiusM: number): BBox {
  const r = Math.max(0, radiusM);
  const dLat = r / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos(toRad(center.lat)));
  const dLng = r / (METERS_PER_DEG_LAT * cosLat);
  return clampBBox({
    west: round9(center.lng - dLng),
    south: round9(center.lat - dLat),
    east: round9(center.lng + dLng),
    north: round9(center.lat + dLat),
  });
}

/** Agrandit (facteur > 1) ou réduit (< 1) une bbox autour de son centre. */
export function expandBBox(b: BBox, factor: number): BBox {
  const f = Number.isFinite(factor) ? Math.max(0, factor) : 1;
  const c = bboxCenter(b);
  const halfW = (Math.abs(b.east - b.west) / 2) * f;
  const halfH = (Math.abs(b.north - b.south) / 2) * f;
  return clampBBox({
    west: round9(c.lng - halfW),
    south: round9(c.lat - halfH),
    east: round9(c.lng + halfW),
    north: round9(c.lat + halfH),
  });
}

/** Arrondi fixe sans « -0.00 ». */
function fixed(v: number, digits: number): string {
  const r = Number(v.toFixed(digits));
  return (Object.is(r, -0) ? 0 : r).toFixed(digits);
}

/** Cellule de présence ~1 km (arrondi 0,01°), ex. « 42.25:9.05 ». */
export function presenceCell(p: LatLng): string {
  return `${fixed(p.lat, 2)}:${fixed(p.lng, 2)}`;
}

/** Centre d'une cellule de présence, ou null si l'identifiant est malformé. */
export function cellCenter(cell: string): LatLng | null {
  const parts = cell.split(":");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  const p = { lat, lng };
  return parts[0].trim() !== "" && parts[1].trim() !== "" && isValidLatLng(p) ? p : null;
}

/** « 320 m », « 1,2 km », « 12 km ». Valeurs non finies → « — ». */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "—";
  const v = Math.max(0, m);
  const rounded = v === 0 ? 0 : Math.max(10, Math.round(v / 10) * 10);
  if (rounded < 1000) return `${rounded} m`;
  if (v < 10000) {
    const km = (v / 1000).toFixed(1).replace(".", ",").replace(/,0$/, "");
    return `${km} km`;
  }
  return `${Math.round(v / 1000)} km`;
}

/** Hachage FNV-1a 32 bits, déterministe et sans dépendance. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Déplace un point de `distanceM` mètres dans la direction `bearingDeg`. */
export function offsetPoint(p: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * Floutage déterministe d'une position (espèces sensibles, section 8).
 *
 * La confidentialité vient de la grille : le point affiché est toujours un
 * nœud de la grille de 0,005° (~550 m), donc la position exacte n'est jamais
 * déductible, même en connaissant l'algorithme et le `seed`. Le `seed`
 * (id du signalement) détermine un angle et une distance de décalage
 * (40 à 90 % du rayon) ; le nœud retenu est celui, parmi les nœuds situés à
 * moins de `radiusM` de la position réelle, le plus proche de ce point cible.
 * Résultat : déterministe, à moins de `radiusM` de la position réelle et
 * différent selon le seed dès que le rayon dépasse le pas de la grille.
 * Si aucun nœud n'est dans le rayon (rayon < ~400 m), le nœud le plus proche
 * est renvoyé. Les candidats sont limités à ±20 cellules (~11 km).
 */
export function blurLocation(lat: number, lng: number, seed: string, radiusM = 400): LatLng {
  const origin = { lat, lng };
  const G = BLUR_GRID_DEG;
  const h = hashString(seed);
  const angle = ((h & 0xffff) / 0x10000) * 360;
  const u = (h >>> 16) / 0x10000;
  const r = Math.max(0, radiusM);
  const target = offsetPoint(origin, r * (0.4 + 0.5 * u), angle);

  const nearest = snapToGrid(origin, G);
  const cosLat = Math.max(0.01, Math.cos(toRad(lat)));
  const nLat = Math.min(20, Math.ceil(r / (METERS_PER_DEG_LAT * G)) + 1);
  const nLng = Math.min(20, Math.ceil(r / (METERS_PER_DEG_LAT * cosLat * G)) + 1);

  let best: LatLng | null = null;
  let bestD = Infinity;
  for (let i = -nLat; i <= nLat; i++) {
    for (let j = -nLng; j <= nLng; j++) {
      const c = snapToGrid({ lat: nearest.lat + i * G, lng: nearest.lng + j * G }, G);
      if (haversineM(origin, c) >= r) continue;
      const d = haversineM(target, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best ?? nearest;
}

/** Arrondit une position sur une grille en degrés. */
export function snapToGrid(p: LatLng, stepDeg: number): LatLng {
  const round = (v: number): number => {
    const r = Math.round(v / stepDeg) * stepDeg;
    // Évite les artefacts flottants (0.30000000000000004) et le -0.
    const cleaned = Number(r.toFixed(6));
    return Object.is(cleaned, -0) ? 0 : cleaned;
  };
  return { lat: clamp(round(p.lat), -90, 90), lng: clamp(round(p.lng), -180, 180) };
}

export type LngLat = [lng: number, lat: number];

/** Projection plane locale (m) autour d'un point de référence. */
function toLocalXY(ref: LatLng, lngLat: LngLat): { x: number; y: number } {
  const cosLat = Math.cos(toRad(ref.lat));
  return {
    x: (lngLat[0] - ref.lng) * METERS_PER_DEG_LAT * cosLat,
    y: (lngLat[1] - ref.lat) * METERS_PER_DEG_LAT,
  };
}

/**
 * Distance (m) d'un point à une polyligne `[lng, lat][]` (itinéraire, section 13).
 * Ligne vide → `Infinity`.
 */
export function distanceToPolylineM(point: LatLng, line: readonly LngLat[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(point, { lng: line[0][0], lat: line[0][1] });
  let best = Infinity;
  const pts = line.map((c) => toLocalXY(point, c));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    // Projection du point (origine locale) sur le segment [a, b].
    const t = len2 === 0 ? 0 : clamp((-a.x * dx - a.y * dy) / len2, 0, 1);
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) best = d;
  }
  return best;
}

/** Longueur totale (m) d'une polyligne `[lng, lat][]`. */
export function polylineLengthM(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    total += haversineM({ lng: line[i][0], lat: line[i][1] }, { lng: line[i + 1][0], lat: line[i + 1][1] });
  }
  return total;
}

/**
 * Échantillonne une polyligne tous les `stepM` mètres (premier et dernier
 * points toujours inclus). Utile pour les alertes d'itinéraire et les profils.
 */
export function pointsAlongLine(line: readonly LngLat[], stepM: number): LatLng[] {
  if (line.length === 0) return [];
  const first = { lng: line[0][0], lat: line[0][1] };
  if (line.length === 1 || !Number.isFinite(stepM) || stepM <= 0) return [first];
  const out: LatLng[] = [first];
  let carry = 0; // distance restant à parcourir avant le prochain point
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lng: line[i][0], lat: line[i][1] };
    const b = { lng: line[i + 1][0], lat: line[i + 1][1] };
    const segLen = haversineM(a, b);
    if (segLen === 0) continue;
    const brg = bearing(a, b);
    let pos = stepM - carry;
    while (pos < segLen) {
      out.push(offsetPoint(a, pos, brg));
      pos += stepM;
    }
    carry = segLen - (pos - stepM);
  }
  const last = { lng: line[line.length - 1][0], lat: line[line.length - 1][1] };
  const prev = out[out.length - 1];
  if (haversineM(prev, last) > 1) out.push(last);
  return out;
}
