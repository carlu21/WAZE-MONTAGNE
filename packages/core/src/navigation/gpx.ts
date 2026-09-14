/**
 * GPX 1.1 (sections 16 et 17) : analyse tolérante (trk / rte / wpt) sans
 * dépendance DOM — utilisable dans le navigateur comme dans Node — et export.
 */
import type { LngLat } from "../geo";
import { buildRoute } from "./route";
import type { NavRoute, TrackPoint } from "./types";

export interface GpxWaypoint {
  lat: number;
  lng: number;
  name: string | null;
  ele: number | null;
}

export interface GpxParseResult {
  name: string | null;
  /** Points de la trace (tous segments concaténés) ou de la route. */
  points: { lat: number; lng: number; ele: number | null; time: number | null }[];
  waypoints: GpxWaypoint[];
}

const ATTR = (tag: string, name: string): number | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
};

const CHILD = (body: string, name: string): string | null => {
  const m = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
};

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

export function encodeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function collectPoints(xml: string, tag: string): GpxParseResult["points"] {
  const out: GpxParseResult["points"] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = ATTR(m[1], "lat");
    const lon = ATTR(m[1], "lon");
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const body = m[2] ?? "";
    const eleRaw = CHILD(body, "ele");
    const timeRaw = CHILD(body, "time");
    const ele = eleRaw !== null && Number.isFinite(Number(eleRaw)) ? Number(eleRaw) : null;
    const time = timeRaw ? Date.parse(timeRaw) : NaN;
    out.push({ lat, lng: lon, ele, time: Number.isFinite(time) ? time : null });
  }
  return out;
}

/** Analyse un GPX : trace (`trkpt`) sinon route (`rtept`) ; waypoints à part. Renvoie null si vide. */
export function parseGpx(xml: string): GpxParseResult | null {
  if (typeof xml !== "string" || !/<gpx\b/i.test(xml)) return null;
  let points = collectPoints(xml, "trkpt");
  if (points.length === 0) points = collectPoints(xml, "rtept");
  const waypoints: GpxWaypoint[] = [];
  const re = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = ATTR(m[1], "lat");
    const lon = ATTR(m[1], "lon");
    if (lat === null || lon === null) continue;
    const body = m[2] ?? "";
    const eleRaw = CHILD(body, "ele");
    waypoints.push({ lat, lng: lon, name: CHILD(body, "name"), ele: eleRaw !== null && Number.isFinite(Number(eleRaw)) ? Number(eleRaw) : null });
  }
  if (points.length === 0 && waypoints.length === 0) return null;
  const trk = xml.match(/<trk\b[^>]*>([\s\S]*?)<\/trk>/i)?.[1] ?? xml.match(/<rte\b[^>]*>([\s\S]*?)<\/rte>/i)?.[1] ?? null;
  const name = (trk ? CHILD(trk.split(/<trkseg|<rtept/i)[0], "name") : null) ?? CHILD(xml.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i)?.[1] ?? "", "name");
  return { name: name || null, points, waypoints };
}

/** Itinéraire de navigation depuis un GPX (null si moins de deux points). */
export function routeFromGpx(xml: string, id: string, fallbackName = "Trace GPX"): NavRoute | null {
  const parsed = parseGpx(xml);
  if (!parsed || parsed.points.length < 2) return null;
  const coordinates: LngLat[] = parsed.points.map((p) => [p.lng, p.lat]);
  const elevations = parsed.points.some((p) => p.ele !== null) ? parsed.points.map((p) => p.ele) : null;
  return buildRoute({ id, name: parsed.name ?? fallbackName, coordinates, elevations, source: "gpx" });
}

export interface BuildGpxInput {
  name: string;
  description?: string | null;
  points: readonly TrackPoint[];
  creator?: string;
}

/** Sérialise une trace en GPX 1.1 (trk / trkseg / trkpt avec ele et time). */
export function buildGpx(input: BuildGpxInput): string {
  const creator = encodeXml(input.creator ?? "Mountain Live");
  const name = encodeXml(input.name);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata><name>${name}</name>${input.points[0] ? `<time>${new Date(input.points[0].at).toISOString()}</time>` : ""}</metadata>`,
    "  <trk>",
    `    <name>${name}</name>`,
  ];
  if (input.description) lines.push(`    <desc>${encodeXml(input.description)}</desc>`);
  lines.push("    <trkseg>");
  for (const p of input.points) {
    const ele = p.alt !== null && Number.isFinite(p.alt) ? `<ele>${p.alt.toFixed(1)}</ele>` : "";
    lines.push(`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${ele}<time>${new Date(p.at).toISOString()}</time></trkpt>`);
  }
  lines.push("    </trkseg>", "  </trk>", "</gpx>", "");
  return lines.join("\n");
}
