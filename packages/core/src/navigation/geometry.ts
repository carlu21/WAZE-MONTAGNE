/**
 * Géométrie de navigation : projection avec abscisse curviligne, caps, cumuls.
 * Approximation plane locale (équirectangulaire), valable à l'échelle d'un massif.
 */
import type { LatLng } from "../types";
import { METERS_PER_DEG_LAT, bearing, haversineM, type LngLat } from "../geo";
import type { Projection } from "./types";

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Écart angulaire signé de `from` vers `to`, dans (-180, 180]. */
export function headingDelta(from: number, to: number): number {
  let d = ((to - from) % 360) + 360;
  d %= 360;
  return d > 180 ? d - 360 : d;
}

/** Écart absolu entre deux caps, dans [0, 180]. */
export function headingDiff(a: number, b: number): number {
  return Math.abs(headingDelta(a, b));
}

/** Écart entre un cap et l'axe d'un segment parcourable dans les deux sens, dans [0, 90]. */
export function axisDiff(heading: number, segmentBearing: number): number {
  const d = headingDiff(heading, segmentBearing);
  return Math.min(d, 180 - d);
}

/** Distances cumulées (m) le long d'une polyligne. */
export function cumulativeDistances(line: readonly LngLat[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    out.push(out[i - 1] + haversineM({ lng: line[i - 1][0], lat: line[i - 1][1] }, { lng: line[i][0], lat: line[i][1] }));
  }
  return out;
}

/**
 * Projette `point` sur la polyligne et renvoie la meilleure position, avec
 * abscisse curviligne. `cumulative` peut être fourni pour éviter le recalcul ;
 * `range` limite la recherche aux segments [from, to] (fenêtre de progression).
 */
export function projectOnPolyline(
  point: LatLng,
  line: readonly LngLat[],
  cumulative?: readonly number[],
  range?: { from: number; to: number },
): Projection | null {
  if (line.length === 0) return null;
  if (line.length === 1) {
    const p = { lng: line[0][0], lat: line[0][1] };
    return { distanceM: haversineM(point, p), index: 0, t: 0, snapped: p, along: 0, segmentBearing: 0 };
  }
  const cosLat = Math.cos(toRad(point.lat));
  const kx = METERS_PER_DEG_LAT * cosLat;
  const ky = METERS_PER_DEG_LAT;
  const from = Math.max(0, range?.from ?? 0);
  const to = Math.min(line.length - 2, range?.to ?? line.length - 2);
  let best: Projection | null = null;
  for (let i = from; i <= to; i++) {
    const ax = (line[i][0] - point.lng) * kx;
    const ay = (line[i][1] - point.lat) * ky;
    const bx = (line[i + 1][0] - point.lng) * kx;
    const by = (line[i + 1][1] - point.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (-ax * dx - ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (!best || d < best.distanceM) {
      const snapped = { lng: point.lng + px / kx, lat: point.lat + py / ky };
      const segLen = cumulative ? cumulative[i + 1] - cumulative[i] : Math.sqrt(len2);
      const base = cumulative ? cumulative[i] : 0;
      best = {
        distanceM: d,
        index: i,
        t,
        snapped,
        along: base + t * segLen,
        segmentBearing: bearing({ lng: line[i][0], lat: line[i][1] }, { lng: line[i + 1][0], lat: line[i + 1][1] }),
      };
    }
  }
  if (best && !cumulative) {
    // Abscisse exacte quand les cumuls ne sont pas fournis.
    const cum = cumulativeDistances(line);
    best.along = cum[best.index] + best.t * (cum[best.index + 1] - cum[best.index]);
  }
  return best;
}

/** Point situé à l'abscisse `along` (m) sur la polyligne (bornée aux extrémités). */
export function pointAtAlong(line: readonly LngLat[], cumulative: readonly number[], along: number): LatLng {
  if (line.length === 0) return { lat: 0, lng: 0 };
  const total = cumulative[cumulative.length - 1];
  if (along <= 0 || line.length === 1) return { lng: line[0][0], lat: line[0][1] };
  if (along >= total) return { lng: line[line.length - 1][0], lat: line[line.length - 1][1] };
  let i = 0;
  while (i < cumulative.length - 2 && cumulative[i + 1] < along) i++;
  const segLen = cumulative[i + 1] - cumulative[i];
  const t = segLen > 0 ? (along - cumulative[i]) / segLen : 0;
  return { lng: line[i][0] + (line[i + 1][0] - line[i][0]) * t, lat: line[i][1] + (line[i + 1][1] - line[i][1]) * t };
}

/**
 * Cap moyen de la polyligne entre les abscisses `fromAlong` et `toAlong`
 * (cap du vecteur reliant les deux points : robuste au bruit des petits segments).
 */
export function bearingBetweenAlong(line: readonly LngLat[], cumulative: readonly number[], fromAlong: number, toAlong: number): number {
  const a = pointAtAlong(line, cumulative, fromAlong);
  const b = pointAtAlong(line, cumulative, toAlong);
  return bearing(a, b);
}

/** Sous-polyligne entre deux abscisses (m), extrémités interpolées incluses. */
export function sliceAlong(line: readonly LngLat[], cumulative: readonly number[], fromAlong: number, toAlong: number): LngLat[] {
  if (line.length < 2) return line.map((c) => [c[0], c[1]] as LngLat);
  const total = cumulative[cumulative.length - 1];
  const a = Math.max(0, Math.min(total, fromAlong));
  const b = Math.max(0, Math.min(total, toAlong));
  if (b <= a) {
    const p = pointAtAlong(line, cumulative, a);
    return [[p.lng, p.lat]];
  }
  const start = pointAtAlong(line, cumulative, a);
  const out: LngLat[] = [[start.lng, start.lat]];
  for (let i = 0; i < line.length; i++) {
    if (cumulative[i] > a && cumulative[i] < b) out.push([line[i][0], line[i][1]]);
  }
  const end = pointAtAlong(line, cumulative, b);
  out.push([end.lng, end.lat]);
  return out;
}

/** Douglas-Peucker sur des points `{lat,lng}` (tolérance en mètres). */
export function simplifyPoints<T extends LatLng>(points: readonly T[], toleranceM: number): T[] {
  if (points.length <= 2 || toleranceM <= 0) return [...points];
  const ref = points[0];
  const cosLat = Math.cos(toRad(ref.lat));
  const xy = points.map((p) => ({ x: (p.lng - ref.lng) * METERS_PER_DEG_LAT * cosLat, y: (p.lat - ref.lat) * METERS_PER_DEG_LAT }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = xy[s].x;
    const ay = xy[s].y;
    const dx = xy[e].x - ax;
    const dy = xy[e].y - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const px = xy[i].x - ax;
      const py = xy[i].y - ay;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > toleranceM && maxI > 0) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Test point dans polygone (anneau extérieur uniquement, `[lng, lat]`). */
export function pointInRing(p: LatLng, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
