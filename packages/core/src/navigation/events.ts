/**
 * Événements devant l'utilisateur (sections 11 à 13) : signalements, alertes
 * officielles, points d'eau, fortes pentes, gués et fermetures projetés sur
 * l'itinéraire ; logique directionnelle (devant / derrière) ; paliers d'alerte
 * selon la distance et la gravité.
 */
import { SUBTYPE_BY_ID } from "../taxonomy";
import type { LatLng, OfficialAlert, Report, ReportSubtype, WaterPoint } from "../types";
import { bearing, formatDistance, haversineM } from "../geo";
import { fr, interpolate } from "../i18n";
import { headingDiff, pointInRing, projectOnPolyline } from "./geometry";
import type { NavRoute, PathSegment } from "./types";

export type EventKind = "report" | "official" | "water" | "slope" | "ford" | "closed";
export type EventSeverity = "high" | "medium" | "low";

export interface RouteEvent {
  key: string;
  kind: EventKind;
  /** Abscisse (m) sur l'itinéraire, ou distance à vol d'oiseau en mode libre. */
  along: number;
  position: LatLng;
  label: string;
  severity: EventSeverity;
  /** Écart latéral (m) par rapport à l'itinéraire. */
  lateralM: number;
  reportId?: string;
  alertId?: string;
  subtype?: ReportSubtype;
  /** Position floutée (espèce sensible) : distance approximative. */
  approximate?: boolean;
}

const HIGH_SUBTYPES = new Set<ReportSubtype>(["battue", "hunting", "guard_dogs", "aggressive_animal", "path_closed", "path_impassable", "access_restriction", "collapsed_path"]);
const LOW_CATEGORIES = new Set<Report["category"]>(["water", "crowd"]);
const VISIBLE_STATUS = new Set<Report["status"]>(["active", "confirmed", "probably_resolved", "disputed"]);

/** Gravité d'un signalement pour les alertes (section 13). */
export function reportSeverity(r: Pick<Report, "category" | "subtype" | "dangerLevel">): EventSeverity {
  if (r.category === "danger" || HIGH_SUBTYPES.has(r.subtype)) return "high";
  if (r.dangerLevel === "critical" || r.dangerLevel === "high") return "high";
  if (LOW_CATEGORIES.has(r.category) || r.subtype === "pastoral_activity" || r.subtype === "signage_issue") return "low";
  return "medium";
}

export function reportLabel(r: Pick<Report, "subtype">): string {
  return SUBTYPE_BY_ID[r.subtype]?.label ?? r.subtype;
}

export function isReportCurrent(r: Pick<Report, "status" | "expiresAt" | "endsAt" | "startsAt">, now: number): boolean {
  if (!VISIBLE_STATUS.has(r.status)) return false;
  if (new Date(r.expiresAt).getTime() <= now) return false;
  if (r.endsAt && new Date(r.endsAt).getTime() <= now) return false;
  return true;
}

export interface CollectEventsInput {
  reports?: readonly Report[];
  officialAlerts?: readonly OfficialAlert[];
  waterPoints?: readonly WaterPoint[];
  /** Segments du réseau (gués, fermetures) proches de l'itinéraire. */
  segments?: readonly PathSegment[];
  /** Largeur du couloir (m) autour de l'itinéraire pour les signalements. Défaut 40. */
  corridorM?: number;
  now?: number;
}

/** Pente (%) minimale d'une « forte pente » et longueur d'analyse (m). */
export const STEEP_GRADE = 25;
const STEEP_WINDOW_M = 100;

function alertSeverity(a: OfficialAlert): EventSeverity {
  return a.severity === "critical" || a.severity === "high" ? "high" : a.severity === "moderate" ? "medium" : "low";
}

/** Événements d'un itinéraire, triés par abscisse. */
export function collectRouteEvents(route: NavRoute, input: CollectEventsInput): RouteEvent[] {
  const now = input.now ?? Date.now();
  const corridor = input.corridorM ?? 40;
  const out: RouteEvent[] = [];
  const line = route.coordinates;
  const cum = route.cumulative;
  if (line.length < 2) return out;

  for (const r of input.reports ?? []) {
    if (!isReportCurrent(r, now)) continue;
    const proj = projectOnPolyline(r, line, cum);
    if (!proj) continue;
    const limit = r.blurred ? 450 : corridor;
    if (proj.distanceM > limit) continue;
    out.push({ key: `report:${r.id}`, kind: "report", along: proj.along, position: proj.snapped, label: reportLabel(r), severity: reportSeverity(r), lateralM: Math.round(proj.distanceM), reportId: r.id, subtype: r.subtype, approximate: r.blurred || undefined });
  }

  for (const a of input.officialAlerts ?? []) {
    if (a.endsAt && new Date(a.endsAt).getTime() <= now) continue;
    if (new Date(a.startsAt).getTime() > now + 48 * 3600_000) continue;
    let along: number | null = null;
    let position: LatLng | null = null;
    let lateral = 0;
    if (a.geometry.type === "Polygon" && a.geometry.coordinates[0]?.length >= 4) {
      const ring = a.geometry.coordinates[0];
      // Première abscisse où l'itinéraire entre dans la zone (échantillonnage tous les 50 m).
      for (let s = 0; s <= route.lengthM; s += 50) {
        const p = pointAt(route, s);
        if (pointInRing(p, ring)) {
          along = s;
          position = p;
          break;
        }
      }
    }
    if (along === null) {
      const c = { lat: a.centroidLat, lng: a.centroidLng };
      const proj = projectOnPolyline(c, line, cum);
      if (!proj || proj.distanceM > 300) continue;
      along = proj.along;
      position = proj.snapped;
      lateral = Math.round(proj.distanceM);
    }
    out.push({ key: `alert:${a.id}`, kind: "official", along, position: position!, label: a.title, severity: alertSeverity(a), lateralM: lateral, alertId: a.id });
  }

  for (const w of input.waterPoints ?? []) {
    const proj = projectOnPolyline(w, line, cum);
    if (!proj || proj.distanceM > 60) continue;
    const label = w.lastState === "dry" ? `${w.name} (signalée sèche)` : w.name;
    out.push({ key: `water:${w.id}`, kind: "water", along: proj.along, position: proj.snapped, label, severity: "low", lateralM: Math.round(proj.distanceM) });
  }

  for (const seg of input.segments ?? []) {
    if (!seg.ford && seg.status !== "closed") continue;
    const mid = seg.coordinates[Math.floor(seg.coordinates.length / 2)];
    const proj = projectOnPolyline({ lng: mid[0], lat: mid[1] }, line, cum);
    if (!proj || proj.distanceM > 30) continue;
    if (seg.ford) out.push({ key: `ford:${seg.id}`, kind: "ford", along: proj.along, position: proj.snapped, label: fr.navigation.events.ford, severity: "medium", lateralM: Math.round(proj.distanceM) });
    if (seg.status === "closed") out.push({ key: `closed:${seg.id}`, kind: "closed", along: proj.along, position: proj.snapped, label: fr.navigation.events.closed, severity: "high", lateralM: Math.round(proj.distanceM) });
  }

  if (route.elevations) {
    let lastSteepEnd = -Infinity;
    for (let i = 0; i < line.length - 1; i++) {
      const e0 = route.elevations[i];
      if (e0 === null) continue;
      let j = i + 1;
      while (j < line.length - 1 && cum[j] - cum[i] < STEEP_WINDOW_M) j++;
      const e1 = route.elevations[j];
      const run = cum[j] - cum[i];
      if (e1 === null || run < STEEP_WINDOW_M * 0.5) continue;
      const grade = (Math.abs(e1 - e0) / run) * 100;
      if (grade >= STEEP_GRADE && cum[i] > lastSteepEnd) {
        out.push({ key: `slope:${i}`, kind: "slope", along: cum[i], position: { lng: line[i][0], lat: line[i][1] }, label: fr.navigation.events.slope, severity: "medium", lateralM: 0 });
        lastSteepEnd = cum[j] + 200;
      }
    }
  }

  return out.sort((a, b) => a.along - b.along);
}

function pointAt(route: NavRoute, along: number): LatLng {
  const { coordinates: line, cumulative } = route;
  let i = 0;
  while (i < cumulative.length - 2 && cumulative[i + 1] < along) i++;
  const segLen = cumulative[i + 1] - cumulative[i];
  const t = segLen > 0 ? Math.min(1, Math.max(0, (along - cumulative[i]) / segLen)) : 0;
  return { lng: line[i][0] + (line[i + 1][0] - line[i][0]) * t, lat: line[i][1] + (line[i + 1][1] - line[i][1]) * t };
}

/* ------------------------------------------------------------------ */
/* Mode libre : logique directionnelle (section 12)                     */
/* ------------------------------------------------------------------ */

export interface FreeEventsInput extends CollectEventsInput {
  /** Rayon de prise en compte (m). Défaut 1 000. */
  radiusM?: number;
  /** Demi-angle (degrés) du cône « devant moi ». Défaut 60. */
  coneDeg?: number;
  /** Distance (m) en deçà de laquelle tout est considéré devant. Défaut 50. */
  immediateM?: number;
}

/**
 * Événements « devant soi » sans itinéraire : dans le cône de déplacement (ou
 * à proximité immédiate). Sans cap connu, seule la proximité (150 m) compte.
 * `along` vaut la distance à vol d'oiseau, pour réutiliser les paliers.
 */
export function collectFreeEvents(position: LatLng, heading: number | null, input: FreeEventsInput): RouteEvent[] {
  const now = input.now ?? Date.now();
  const radius = input.radiusM ?? 1000;
  const cone = input.coneDeg ?? 60;
  const immediate = input.immediateM ?? 50;
  const out: RouteEvent[] = [];
  const ahead = (p: LatLng, d: number): boolean => {
    if (d <= immediate) return true;
    if (heading === null) return d <= 150;
    return headingDiff(heading, bearing(position, p)) <= cone;
  };
  for (const r of input.reports ?? []) {
    if (!isReportCurrent(r, now)) continue;
    const d = haversineM(position, r);
    if (d > radius || !ahead(r, d)) continue;
    out.push({ key: `report:${r.id}`, kind: "report", along: d, position: { lat: r.lat, lng: r.lng }, label: reportLabel(r), severity: reportSeverity(r), lateralM: 0, reportId: r.id, subtype: r.subtype, approximate: r.blurred || undefined });
  }
  for (const a of input.officialAlerts ?? []) {
    if (a.endsAt && new Date(a.endsAt).getTime() <= now) continue;
    const c = { lat: a.centroidLat, lng: a.centroidLng };
    const inside = a.geometry.type === "Polygon" && a.geometry.coordinates[0] ? pointInRing(position, a.geometry.coordinates[0]) : false;
    const d = inside ? 0 : haversineM(position, c);
    if (d > radius * 2 || (!inside && !ahead(c, d))) continue;
    out.push({ key: `alert:${a.id}`, kind: "official", along: d, position: c, label: a.title, severity: alertSeverity(a), lateralM: 0, alertId: a.id });
  }
  for (const w of input.waterPoints ?? []) {
    const d = haversineM(position, w);
    if (d > Math.min(radius, 400) || !ahead(w, d)) continue;
    out.push({ key: `water:${w.id}`, kind: "water", along: d, position: { lat: w.lat, lng: w.lng }, label: w.lastState === "dry" ? `${w.name} (signalée sèche)` : w.name, severity: "low", lateralM: 0 });
  }
  return out.sort((a, b) => a.along - b.along);
}

/* ------------------------------------------------------------------ */
/* Paliers d'alerte (section 13)                                        */
/* ------------------------------------------------------------------ */

/** Seuils (m) décroissants par gravité : le dernier palier est « immédiat ». */
export const ESCALATION: Record<EventSeverity, readonly number[]> = {
  high: [1000, 500, 200, 50],
  medium: [500, 200, 50],
  low: [300],
};
/** Une battue ou une chasse est annoncée plus tôt. */
export const ESCALATION_HUNTING: readonly number[] = [1500, 800, 300, 100];

export function thresholdsFor(e: Pick<RouteEvent, "severity" | "subtype" | "kind">): readonly number[] {
  if (e.subtype === "battue" || e.subtype === "hunting") return ESCALATION_HUNTING;
  if (e.kind === "official" && e.severity === "high") return ESCALATION_HUNTING;
  return ESCALATION[e.severity];
}

export type AlertTone = "info" | "warning" | "danger";

export interface AheadAlert {
  key: string;
  event: RouteEvent;
  /** Palier 1..n (n = immédiat). */
  level: number;
  /** Nombre total de paliers pour cet événement. */
  levels: number;
  distanceM: number;
  message: string;
  tone: AlertTone;
  /** Alerte sonore / vibration justifiée (jamais pour une source ou une info discrète). */
  sound: boolean;
}

export function alertMessage(e: RouteEvent, level: number, levels: number, distanceM: number): string {
  const E = fr.navigation.events;
  const distance = formatDistance(distanceM);
  const label = e.approximate ? `${e.label} (${E.approximate})` : e.label;
  if (e.kind === "official") return interpolate(E.officialIn, { label, distance });
  if (e.severity === "low" || e.kind === "water") return interpolate(E.infoIn, { label, distance });
  if (level >= levels && distanceM <= 60) return interpolate(E.reportNow, { label });
  if (level === 1 && levels > 2) return interpolate(E.reportFar, { label, distance });
  return interpolate(E.reportIn, { label, distance });
}

/**
 * Alertes à émettre maintenant : pour chaque événement devant soi (abscisse
 * ≥ position − 20 m), le palier atteint ; seules les montées de palier
 * (par rapport à `announced`) sont renvoyées, triées par distance.
 */
export function computeAheadAlerts(events: readonly RouteEvent[], along: number, announced: ReadonlyMap<string, number>, behindToleranceM = 20): AheadAlert[] {
  const out: AheadAlert[] = [];
  for (const e of events) {
    const distanceM = Math.round(e.along - along);
    if (distanceM < -behindToleranceM) continue;
    const thresholds = thresholdsFor(e);
    let level = 0;
    for (const t of thresholds) if (Math.max(0, distanceM) <= t) level++;
    if (level === 0) continue;
    const prev = announced.get(e.key) ?? 0;
    if (level <= prev) continue;
    const levels = thresholds.length;
    const tone: AlertTone = e.severity === "low" ? "info" : level >= levels ? "danger" : level === 1 && levels > 2 ? "info" : "warning";
    out.push({ key: e.key, event: e, level, levels, distanceM: Math.max(0, distanceM), message: alertMessage(e, level, levels, Math.max(0, distanceM)), tone, sound: e.severity !== "low" && (level >= 2 || levels <= 2) });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** Prochain événement devant soi (bandeau « prochain événement »). */
export function nextEventAhead(events: readonly RouteEvent[], along: number, maxDistanceM = 2000): { event: RouteEvent; distanceM: number } | null {
  for (const e of events) {
    const d = e.along - along;
    if (d < -10) continue;
    if (d > maxDistanceM) break;
    return { event: e, distanceM: Math.max(0, Math.round(d)) };
  }
  return null;
}
