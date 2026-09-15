/**
 * Jeu d'activités de démonstration : sans passages, le réseau vivant n'a rien
 * à raconter. Ce générateur simule des sorties réalistes sur les sentiers de
 * Corse afin que la fréquentation, les temps observés, les itinéraires et les
 * propositions du terrain soient visibles dès le premier lancement.
 *
 * Ce qui est simulé, et pourquoi :
 * - des **contributeurs distincts** (comptes de démonstration) : les
 *   statistiques comptent des utilisateurs, pas des traces ;
 * - une **saisonnalité** et des **heures de pointe** (juillet chargé, départs
 *   entre 8 h et 11 h) ;
 * - des **allures personnelles** (de 0,75× à 1,4× la médiane) et des activités
 *   variées, pour que médiane, quartiles et écarts aient un sens ;
 * - du **bruit GPS** (5 à 9 m), pour que le map matching travaille vraiment ;
 * - trois anomalies volontaires : un tracé systématiquement décalé, un
 *   raccourci hors réseau emprunté par plusieurs personnes, et un passage où
 *   tout le monde ralentit. Elles alimentent la détection de candidatures.
 *
 * Tout passe par la chaîne d'ingestion réelle (aucune écriture directe dans les
 * passages) : ce que montre la démonstration est exactement ce que produira le
 * terrain.
 */
import { eq, sql } from "drizzle-orm";
import { offsetPoint, polylineLengthM, type ActivityMode, type LngLat } from "@mountain-live/core";
import { db } from "./client";
import { activities, paths, trails, users, type PathRow } from "./schema";
import { createActivity, processActivity } from "../services/activities";
import { recomputeAll } from "../services/network-stats";
import { rebuildCandidates } from "../services/network-learning";
import { hashPassword } from "../services/password";
import { nowIso } from "../services/util";

/** Générateur pseudo-aléatoire déterministe : la démonstration est reproductible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CONTRIBUTORS = 36;
const ACTIVITY_WEIGHTS: [ActivityMode, number][] = [
  ["hiking", 0.6],
  ["trail", 0.16],
  ["mtb", 0.14],
  ["equestrian", 0.1],
];

/** Vitesses de référence (m/s) : une base crédible, l'allure personnelle module ensuite. */
const BASE_SPEED: Record<ActivityMode, number> = { hiking: 1.15, trail: 2.2, mtb: 3.1, equestrian: 1.7, other: 1.2 };

function pickActivity(rnd: () => number): ActivityMode {
  const r = rnd();
  let acc = 0;
  for (const [activity, weight] of ACTIVITY_WEIGHTS) {
    acc += weight;
    if (r <= acc) return activity;
  }
  return "hiking";
}

/** Mois tiré selon la saison : la montagne corse se marche surtout de mai à octobre. */
const MONTH_WEIGHTS = [0.02, 0.02, 0.04, 0.07, 0.11, 0.14, 0.18, 0.16, 0.12, 0.08, 0.04, 0.02];

function pickMonthOffset(rnd: () => number): number {
  const r = rnd();
  let acc = 0;
  for (let i = 0; i < MONTH_WEIGHTS.length; i++) {
    acc += MONTH_WEIGHTS[i];
    if (r <= acc) return i;
  }
  return 6;
}

interface SimulatedTrack {
  activity: ActivityMode;
  startedAt: number;
  points: { at: number; lat: number; lng: number; alt: number | null; accuracy: number; speed: number; heading: number | null }[];
}

export interface AnomalyOptions {
  /** Décalage latéral systématique (m) appliqué à toutes les traces : tracé faux. */
  lateralOffsetM?: number;
  /** Raccourci hors réseau : coupe entre deux abscisses en ligne droite. */
  shortcut?: { fromRatio: number; toRatio: number } | null;
  /** Ralentissement marqué autour d'une abscisse relative. */
  slowAt?: { ratio: number; lengthM: number; factor: number } | null;
  /** Demi-tour : la sortie s'arrête à cette abscisse relative et revient sur ses pas. */
  turnAt?: number | null;
}

/**
 * Simule une sortie le long d'une géométrie : échantillonnage temporel régulier,
 * bruit GPS, allure personnelle, pauses occasionnelles.
 */
export function simulateTrack(
  coordinates: readonly LngLat[],
  opts: {
    activity: ActivityMode;
    startedAt: number;
    paceFactor: number;
    reverse: boolean;
    accuracyM: number;
    rnd: () => number;
    anomalies?: AnomalyOptions;
  },
): SimulatedTrack {
  const line = opts.reverse ? [...coordinates].reverse() : [...coordinates];
  const total = polylineLengthM(line);
  const speed = BASE_SPEED[opts.activity] * opts.paceFactor;
  const stepSeconds = 6;
  const points: SimulatedTrack["points"] = [];
  const anomalies = opts.anomalies ?? {};

  // Abscisses cumulées de la ligne suivie.
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + polylineLengthM([line[i - 1], line[i]]));
  }

  const positionAt = (along: number): { lat: number; lng: number } => {
    const clamped = Math.max(0, Math.min(total, along));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < clamped) i++;
    const segLen = cum[i + 1] - cum[i];
    const t = segLen > 0 ? (clamped - cum[i]) / segLen : 0;
    return { lng: line[i][0] + (line[i + 1][0] - line[i][0]) * t, lat: line[i][1] + (line[i + 1][1] - line[i][1]) * t };
  };

  // Demi-tour : la sortie monte jusqu'à `turnAt`, puis redescend par le même
  // chemin. C'est la matière première de la section 28 — un belvédère, un pas
  // infranchissable ou une barre rocheuse se lisent dans les demi-tours.
  const turnAlong = anomalies.turnAt ? Math.max(50, Math.min(total, anomalies.turnAt * total)) : null;
  const farthest = turnAlong ?? total;

  let along = 0;
  let at = opts.startedAt;
  let back = false;
  let guard = 0;
  while (guard++ < 40_000) {
    if (!back && along >= farthest) {
      if (turnAlong === null) break;
      back = true;
    }
    if (back && along <= 0) break;
    const ratio = Math.min(1, Math.max(0, along / total));
    let stepSpeed = speed;
    if (anomalies.slowAt && Math.abs(ratio - anomalies.slowAt.ratio) * total < anomalies.slowAt.lengthM / 2) {
      stepSpeed = speed * anomalies.slowAt.factor;
    }
    // Pause occasionnelle (photo, gourde) : un récepteur ne s'arrête pas de
    // relever pendant une pause, il répète la même position. C'est ce que le
    // moteur doit savoir ignorer — et non un trou dans la trace, qui
    // signifierait tout autre chose (perte de signal, extinction de l'appareil).
    if (opts.rnd() < 0.01) {
      const paused = positionAt(along);
      const pauseSteps = 8 + Math.floor(opts.rnd() * 20);
      for (let i = 0; i < pauseSteps; i++) {
        points.push({
          at,
          lat: paused.lat + (opts.rnd() - 0.5) * 0.00002,
          lng: paused.lng + (opts.rnd() - 0.5) * 0.00002,
          alt: null,
          accuracy: opts.accuracyM,
          speed: 0,
          heading: null,
        });
        at += stepSeconds * 1000;
      }
    }
    const base = positionAt(along);
    let position = base;

    // Raccourci hors réseau : ligne droite entre deux abscisses.
    if (anomalies.shortcut && ratio >= anomalies.shortcut.fromRatio && ratio <= anomalies.shortcut.toRatio) {
      const a = positionAt(anomalies.shortcut.fromRatio * total);
      const b = positionAt(anomalies.shortcut.toRatio * total);
      const t = (ratio - anomalies.shortcut.fromRatio) / Math.max(0.001, anomalies.shortcut.toRatio - anomalies.shortcut.fromRatio);
      // Le raccourci s'écarte franchement du sentier (arc vers le côté).
      const straight = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      const bulge = Math.sin(t * Math.PI) * 130;
      position = offsetPoint(straight, bulge, 90);
    } else if (anomalies.lateralOffsetM) {
      const ahead = positionAt(along + 15);
      const bearing = (Math.atan2(ahead.lng - base.lng, ahead.lat - base.lat) * 180) / Math.PI;
      position = offsetPoint(base, anomalies.lateralOffsetM, bearing + 90);
    }

    // Bruit GPS : direction et amplitude tirées, amplitude proche de la précision annoncée.
    const noisy = offsetPoint(position, opts.accuracyM * 0.7 * opts.rnd(), opts.rnd() * 360);
    points.push({
      at,
      lat: noisy.lat,
      lng: noisy.lng,
      alt: null,
      accuracy: Math.round(opts.accuracyM + opts.rnd() * 4),
      speed: Math.round(stepSpeed * 100) / 100,
      heading: null,
    });
    along += (back ? -1 : 1) * stepSpeed * stepSeconds;
    at += stepSeconds * 1000;
  }
  return { activity: opts.activity, startedAt: opts.startedAt, points };
}

/** Comptes de démonstration servant de contributeurs distincts. */
function ensureContributors(count: number): string[] {
  const existing = db.select({ id: users.id }).from(users).where(sql`${users.email} LIKE 'contrib%@mountain-live.demo'`).all();
  if (existing.length >= count) return existing.slice(0, count).map((u) => u.id);
  // Un seul hachage, réutilisé : les comptes de démonstration n'ont pas vocation à être sûrs.
  const passwordHash = hashPassword("demo1234");
  const now = nowIso();
  const ids = existing.map((u) => u.id);
  db.transaction((tx) => {
    for (let i = existing.length; i < count; i++) {
      const id = `u_contrib_${String(i + 1).padStart(2, "0")}`;
      tx.insert(users)
        .values({
          id,
          email: `contrib${String(i + 1).padStart(2, "0")}@mountain-live.demo`,
          passwordHash,
          pseudo: `Contributeur ${i + 1}`,
          avatarUrl: null,
          practices: ["hiker"],
          region: "Corse",
          role: "user",
          reputationScore: 0,
          reliabilityLevel: 1,
          reportsCount: 0,
          confirmationsCount: 0,
          badges: [],
          consentGivenAt: now,
          suspendedUntil: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      // Pas de préférences enregistrées : les valeurs par défaut suffisent à un compte de démonstration.
      ids.push(id);
    }
  });
  return ids;
}

export interface SeedActivitiesResult {
  contributors: number;
  activities: number;
  traversals: number;
  statistics: number;
  candidates: number;
}

/** Peuple le réseau vivant à partir des segments de démonstration. */
export function seedActivities(now = Date.now(), perTrail = 32): SeedActivitiesResult {
  const rnd = lcg(20260915);
  const contributors = ensureContributors(CONTRIBUTORS);
  if (contributors.length === 0) return { contributors: 0, activities: 0, traversals: 0, statistics: 0, candidates: 0 };

  // Les sentiers de démonstration servent de support : on suit leur géométrie.
  const demoTrails = db.select().from(trails).all().filter((t) => t.geometry.type === "LineString" && t.geometry.coordinates.length >= 4);
  let created = 0;
  let traversals = 0;

  demoTrails.forEach((trail, trailIndex) => {
    const coordinates = (trail.geometry.type === "LineString" ? trail.geometry.coordinates : []) as LngLat[];
    if (coordinates.length < 4) return;
    // Anomalies volontaires, réparties sur trois sentiers différents.
    // Une anomalie ne s'apprend que si elle tombe AU MÊME ENDROIT d'une sortie
    // à l'autre : elles sont donc portées par des sentiers courts, parcourus en
    // entier (les longs itinéraires ne sont simulés que sur une portion, dont
    // l'abscisse relative change à chaque sortie).
    const anomalies: AnomalyOptions = {
      lateralOffsetM: trailIndex === 2 ? 9 : 0,
      shortcut: trailIndex === 4 ? { fromRatio: 0.35, toRatio: 0.6 } : null,
      slowAt: trailIndex === 3 ? { ratio: 0.45, lengthM: 150, factor: 0.3 } : null,
    };
    // Les grands itinéraires sont moins parcourus en entier que les boucles
    // courtes : ce sont ces dernières qui portent l'essentiel de la
    // fréquentation réelle, et donc l'essentiel de ce que le réseau apprend.
    const count = Math.max(6, Math.round(perTrail * (trail.distanceKm > 40 ? 0.3 : trail.distanceKm > 15 ? 0.5 : 1.8)));

    for (let i = 0; i < count; i++) {
      const userId = contributors[Math.floor(rnd() * contributors.length)];
      const activity = pickActivity(rnd);
      const monthsAgo = pickMonthOffset(rnd);
      const start = new Date(now - monthsAgo * 30 * 86_400_000 - Math.floor(rnd() * 28) * 86_400_000);
      start.setHours(8 + Math.floor(rnd() * 4), Math.floor(rnd() * 60), 0, 0);
      // Un long itinéraire n'est simulé que sur une portion : personne ne fait le GR 20 d'un trait.
      const portion = trail.distanceKm > 15 ? 0.25 + rnd() * 0.25 : 1;
      const slice = coordinates.slice(0, Math.max(4, Math.round(coordinates.length * portion)));
      // Demi-tour : une sortie sur deux du sentier de la Bombe s'arrête au
      // belvédère et redescend. Elle part forcément du pied du sentier — sans
      // quoi le « même endroit » d'une sortie à l'autre n'en serait plus un, et
      // l'engagement collectif se diluerait entre deux lieux symétriques.
      const demiTour = trailIndex === 3 && rnd() < 0.55;
      const track = simulateTrack(slice, {
        activity,
        startedAt: start.getTime(),
        paceFactor: 0.75 + rnd() * 0.65,
        reverse: !demiTour && rnd() < 0.4,
        accuracyM: 5 + rnd() * 4,
        rnd,
        anomalies: demiTour ? { ...anomalies, turnAt: 0.62 } : anomalies,
      });
      if (track.points.length < 20) continue;
      const { row, points } = createActivity(
        {
          activityType: activity,
          source: "recorded",
          name: null,
          startedAt: new Date(track.points[0].at).toISOString(),
          endedAt: new Date(track.points[track.points.length - 1].at).toISOString(),
          contribute: true,
          clientId: null,
          points: track.points,
        },
        userId,
      );
      const result = processActivity(row, points);
      traversals += result.traversals;
      created += 1;
    }
  });

  const statistics = recomputeAll(now);
  const candidates = rebuildCandidates(now);
  return { contributors: contributors.length, activities: created, traversals, statistics, candidates: candidates.created + candidates.updated };
}

/** Efface les activités de démonstration (contributeurs simulés). */
export function clearSeededActivities(): number {
  const ids = db.select({ id: users.id }).from(users).where(sql`${users.email} LIKE 'contrib%@mountain-live.demo'`).all().map((u) => u.id);
  if (ids.length === 0) return 0;
  let removed = 0;
  for (const id of ids) {
    const rows = db.select({ id: activities.id }).from(activities).where(eq(activities.userId, id)).all();
    removed += rows.length;
    db.delete(activities).where(eq(activities.userId, id)).run();
  }
  db.update(paths).set({ passageCount: 0, popularityScore: 0, lastPassageAt: null }).run();
  return removed;
}

export type { PathRow };
