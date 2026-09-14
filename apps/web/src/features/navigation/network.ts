/**
 * Chargement du réseau de chemins autour de l'utilisateur (sections 10 et 15).
 *
 * Le territoire est découpé en cellules de 0,05° (~5 km) ; chaque cellule est
 * demandée à l'API une fois (`GET /paths?bbox`), mise en cache dans IndexedDB
 * (`pathCells`) et ajoutée au graphe incrémental. Hors connexion, les cellules
 * en cache et les zones téléchargées (bundle) alimentent le graphe.
 */
import { addSegments, createPathGraph, inBBox, pointsAlongLine, type BBox, type LatLng, type NavRoute, type PathGraph, type PathSegment } from "@mountain-live/core";
import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { useUiStore } from "@/store/ui";

export const PATH_CELL_DEG = 0.05;
/** Durée de validité d'une cellule en cache (7 jours) — au-delà, rafraîchie quand le réseau est là. */
export const CELL_TTL_MS = 7 * 24 * 3600_000;

export function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / PATH_CELL_DEG)}:${Math.floor(lat / PATH_CELL_DEG)}`;
}

export function cellBBox(key: string): BBox {
  const [x, y] = key.split(":").map(Number);
  return { west: x * PATH_CELL_DEG, south: y * PATH_CELL_DEG, east: (x + 1) * PATH_CELL_DEG, north: (y + 1) * PATH_CELL_DEG };
}

/** Cellules dont l'emprise croise le disque `radiusM` autour de `p`. */
export function cellsAround(p: LatLng, radiusM = 2500): string[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));
  const out: string[] = [];
  const x0 = Math.floor((p.lng - dLng) / PATH_CELL_DEG);
  const x1 = Math.floor((p.lng + dLng) / PATH_CELL_DEG);
  const y0 = Math.floor((p.lat - dLat) / PATH_CELL_DEG);
  const y1 = Math.floor((p.lat + dLat) / PATH_CELL_DEG);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}:${y}`);
  return out;
}

/** Cellules traversées par un itinéraire (échantillonnage tous les 1 500 m). */
export function cellsAlongRoute(route: NavRoute, maxCells = 60): string[] {
  const seen = new Set<string>();
  for (const p of pointsAlongLine(route.coordinates, 1500)) {
    for (const c of cellsAround(p, 800)) seen.add(c);
    if (seen.size >= maxCells) break;
  }
  return [...seen];
}

async function readCache(key: string): Promise<{ paths: PathSegment[]; fresh: boolean } | null> {
  try {
    const cell = await db.pathCells.get(key);
    if (!cell) return null;
    return { paths: cell.paths, fresh: Date.now() - cell.fetchedAt < CELL_TTL_MS };
  } catch {
    return null;
  }
}

async function readZones(box: BBox): Promise<PathSegment[]> {
  try {
    const zones = await db.zones.toArray();
    const out: PathSegment[] = [];
    for (const z of zones) {
      if (z.bbox.west > box.east || z.bbox.east < box.west || z.bbox.south > box.north || z.bbox.north < box.south) continue;
      for (const p of z.paths ?? []) {
        const c = p.coordinates[0];
        if (c && inBBox({ lng: c[0], lat: c[1] }, box)) out.push(p);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export class NetworkLoader {
  readonly graph: PathGraph = createPathGraph();
  private readonly loaded = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private listeners = new Set<(graph: PathGraph) => void>();
  /** Chargements en cours (indicateur). */
  get loading(): boolean {
    return this.pending.size > 0;
  }

  onChange(fn: (graph: PathGraph) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.graph);
  }

  /** Charge les cellules manquantes autour d'une position. Résout `true` si le graphe a changé. */
  async ensureAround(p: LatLng, radiusM = 2500): Promise<boolean> {
    const results = await Promise.all(cellsAround(p, radiusM).map((k) => this.ensureCell(k)));
    return results.some(Boolean);
  }

  async ensureRoute(route: NavRoute): Promise<boolean> {
    const results = await Promise.all(cellsAlongRoute(route).map((k) => this.ensureCell(k)));
    return results.some(Boolean);
  }

  ensureCell(key: string): Promise<boolean> {
    if (this.loaded.has(key)) return Promise.resolve(false);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const task = this.loadCell(key)
      .then((segments) => {
        this.loaded.add(key);
        const added = addSegments(this.graph, segments);
        if (added > 0) this.notify();
        return added > 0;
      })
      .catch(() => false)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async loadCell(key: string): Promise<PathSegment[]> {
    const box = cellBBox(key);
    const cached = await readCache(key);
    const online = useUiStore.getState().online;
    if (cached && (cached.fresh || !online)) return cached.paths;
    if (online) {
      try {
        const res = await api.paths(box);
        try {
          await db.pathCells.put({ id: key, fetchedAt: Date.now(), paths: res.paths });
        } catch {
          /* cache facultatif */
        }
        return res.paths;
      } catch {
        if (cached) return cached.paths;
      }
    }
    // Hors connexion sans cellule en cache : zones téléchargées.
    return readZones(box);
  }

  /** Segments proches d'un itinéraire (gués, fermetures) : un échantillon tous les 100 m. */
  segmentsAlong(route: NavRoute, radiusM = 40): PathSegment[] {
    const out = new Map<string, PathSegment>();
    const box = (p: LatLng): BBox => ({ west: p.lng - 0.0006, east: p.lng + 0.0006, south: p.lat - 0.0005, north: p.lat + 0.0005 });
    for (const p of pointsAlongLine(route.coordinates, 100)) {
      const b = box(p);
      for (const [id, seg] of this.graph.segments) {
        if (out.has(id)) continue;
        const bb = this.graph.bboxes.get(id);
        if (!bb || bb.west > b.east || bb.east < b.west || bb.south > b.north || bb.north < b.south) continue;
        if (seg.ford || seg.status === "closed") out.set(id, seg);
      }
    }
    void radiusM;
    return [...out.values()];
  }
}
