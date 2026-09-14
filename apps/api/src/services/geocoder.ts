/**
 * Géocodeur en ligne de repli (section 22 : « rechercher n'importe quel lieu-dit ») :
 * API de géocodage de la Géoplateforme IGN (données BD TOPO / BAN, licence ouverte).
 * Les résultats sont mémorisés dans la table `areas` (identifiants stables `g_…`) :
 * ils deviennent consultables (/areas/:id) et trouvables localement ensuite.
 */
import type { AreaType } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { areas } from "../db/schema";
import { normalizeText } from "./util";

export interface GeocodedPlace {
  id: string;
  name: string;
  nameNormalized: string;
  type: AreaType;
  lat: number;
  lng: number;
  elevation: number | null;
  description: string | null;
  commune: string | null;
}

interface Feature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

function first(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  return null;
}
function all(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}

/** Type de lieu déduit des catégories IGN (index poi) ou du type d'adresse (index address). */
export function areaTypeForCategories(categories: readonly string[], addressType: string | null): AreaType | null {
  const c = categories.map((x) => normalizeText(x)).join(" | ");
  if (addressType === "municipality") return "commune";
  if (addressType === "locality") return "hamlet";
  if (addressType === "street" || addressType === "housenumber") return null;
  if (/commune|municipalit|ville\b|village/.test(c)) return "commune";
  if (/lieu-dit|lieu dit|hameau|quartier|ecart|habit/.test(c)) return "hamlet";
  if (/\bcol\b|\bpas\b|breche|\bport\b/.test(c)) return "pass";
  if (/sommet|crete|\bpic\b|piton|aiguille|\bmont\b|\bdome\b|rocher|pointe|punta|cime/.test(c)) return "summit";
  if (/refuge|abri|cabane|gite|bergerie/.test(c)) return "refuge";
  if (/\blac\b|etang|lagune|retenue|reservoir/.test(c)) return "lake";
  if (/source|fontaine|resurgence|cascade|chute/.test(c)) return "spring";
  if (/massif|montagne|chaine/.test(c)) return "massif";
  if (/sentier|chemin|itineraire|\bgr\b/.test(c)) return "trail";
  if (c.length > 0) return "place";
  return null;
}

/** Identifiant stable dérivé du nom et de la position (arrondie à ~10 m). */
export function geocodedId(name: string, lat: number, lng: number): string {
  const key = `${normalizeText(name)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `g_${h.toString(16).padStart(8, "0")}`;
}

/** Convertit une entité GeoJSON du géocodeur en lieu ; null si elle n'est pas un lieu (adresse, rue…). */
export function mapGeocoderFeature(f: Feature): GeocodedPlace | null {
  const p = f.properties ?? {};
  const coords = f.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = (first(p.toponym) ?? first(p.name) ?? first(p.label) ?? "").trim();
  if (!name) return null;
  const addressType = typeof p.type === "string" ? p.type : null;
  const type = areaTypeForCategories(all(p.category), addressType);
  if (!type) return null;
  const city = first(p.city) ?? first(p.municipality);
  const postcode = first(p.postcode);
  const category = first(p.category);
  const context = typeof p.context === "string" ? p.context : null;
  const parts = [category ? category.charAt(0).toUpperCase() + category.slice(1) : null, city && city !== name ? `${city}${postcode ? ` (${postcode})` : ""}` : context].filter(Boolean);
  return {
    id: geocodedId(name, lat, lng),
    name,
    nameNormalized: normalizeText([name, city ?? ""].join(" ")),
    type,
    lat,
    lng,
    elevation: null,
    description: parts.length ? `${parts.join(" · ")} · Source : IGN` : "Source : IGN",
    commune: city && normalizeText(city) !== normalizeText(name) ? city : null,
  };
}

/** Interroge le géocodeur ; jamais d'exception (liste vide en cas d'échec ou de délai dépassé). */
export async function geocodeOnline(query: string, opts: { lat?: number; lng?: number; limit?: number } = {}): Promise<GeocodedPlace[]> {
  if (!config.geocoder.enabled || typeof fetch !== "function") return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const results = new Map<string, GeocodedPlace>();
  const indexes = ["poi", "address"] as const;
  await Promise.all(
    indexes.map(async (index) => {
      const url = new URL(config.geocoder.url);
      url.searchParams.set("q", q);
      url.searchParams.set("index", index);
      url.searchParams.set("limit", String(opts.limit ?? 10));
      if (index === "address") url.searchParams.set("type", "municipality");
      if (opts.lat != null && opts.lng != null) {
        url.searchParams.set("lat", String(opts.lat));
        url.searchParams.set("lon", String(opts.lng));
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), config.geocoder.timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "MountainLive/0.1 (pilote)" } });
        if (!res.ok) return;
        const json = (await res.json()) as { features?: Feature[] };
        for (const f of json.features ?? []) {
          const place = mapGeocoderFeature(f);
          if (place && !results.has(place.id)) results.set(place.id, place);
        }
      } catch {
        /* réseau indisponible, délai dépassé ou réponse invalide : repli silencieux */
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const list = [...results.values()];
  rememberPlaces(list);
  return list;
}

/** Mémorise les lieux géocodés dans la base (identifiants stables) pour les fiches et recherches suivantes. */
export function rememberPlaces(places: readonly GeocodedPlace[]): void {
  if (places.length === 0) return;
  try {
    db.transaction((tx) => {
      for (const p of places) {
        tx.insert(areas)
          .values({ id: p.id, name: p.name, nameNormalized: p.nameNormalized, type: p.type, lat: p.lat, lng: p.lng, bbox: null, elevation: p.elevation, description: p.description, commune: p.commune })
          .onConflictDoNothing()
          .run();
      }
    });
  } catch {
    /* la mémorisation est un confort, jamais bloquante */
  }
}
