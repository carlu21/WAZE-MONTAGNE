/**
 * Apprentissage des comportements collectifs : ce que les traces disent de la
 * *manière* dont un chemin est parcouru, au-delà de sa géométrie et de sa
 * fréquentation.
 *
 * Sections du cahier des charges « moteur cartographique » couvertes ici :
 *
 *  - **27. Ralentissements systématiques** : quand la grande majorité des
 *    passages ralentit fortement au même endroit, ce n'est plus une personne
 *    fatiguée, c'est le terrain qui parle (passage rocheux, gué, pente raide).
 *    `speedSamples` produit la matière première (une vitesse rapportée à une
 *    abscisse), `detectSlowZones` en tire des zones.
 *  - **28. Demi-tours** : un demi-tour isolé ne dit rien ; des demi-tours
 *    répétés au même endroit, par des personnes différentes, signalent un
 *    obstacle (passage effondré, torrent en crue, cul-de-sac).
 *  - **29. Erreurs de navigation** : à certaines intersections, beaucoup de
 *    monde s'engage sur la mauvaise branche, fait quelques dizaines de mètres,
 *    revient et repart ailleurs. C'est un défaut de lisibilité du terrain.
 *
 * Trois principes traversent le module :
 *
 * 1. **On ne compare que le comparable.** Un traileur à 8 km/h et un
 *    randonneur à 4 km/h ne « ralentissent » pas aux mêmes vitesses : chaque
 *    vitesse est normalisée par la médiane de *son* activité sur *ce* segment
 *    avant toute comparaison (section 27).
 * 2. **La médiane plutôt que la moyenne.** Une pause photo, un lacet de
 *    chaussure ou un arrêt casse-croûte déplacent une moyenne, pas une médiane.
 * 3. **Rien sous le seuil d'anonymat.** Aucune sortie n'est produite en dessous
 *    de `K_ANONYMITY_MIN` contributeurs distincts (sections 34 à 36), même si
 *    l'appelant demande un seuil plus bas.
 *
 * **Limite assumée (section 28)** : un aller-retour *normal* — sommet, lac de
 * Melo, belvédère de Bavella — est, vu des données, exactement un demi-tour.
 * Ce module ne sait pas distinguer « j'ai atteint mon but » de « je ne peux pas
 * passer ». Les seuils (`minRate`, `minObservations`, `minUsers`) écartent le
 * bruit, pas cette ambiguïté-là : le bout d'un sentier en cul-de-sac menant à
 * un lac ressortira comme un point de demi-tour très fréquent. C'est à la
 * couche produit de croiser ce signal avec la topologie (nœud terminal, point
 * d'intérêt à proximité) avant de parler d'« obstacle ».
 *
 * Module pur et déterministe : aucune horloge (aucune notion de « maintenant »
 * n'intervient ici — les instants exploités sont ceux des données), aucun aléa,
 * aucune mutation des entrées. Coût : une passe linéaire sur les échantillons
 * ou les passages, plus un tri des tranches par segment et un tri des médianes
 * — jamais de comparaison « tous contre tous ». Les géométries de segments sont
 * mises en cache (distances cumulées calculées une seule fois par segment, pas
 * une fois par passage).
 */
import type { LngLat } from "../geo";
import { DEFAULT_SPEED_MS } from "../navigation/eta";
import { cumulativeDistances, pointAtAlong } from "../navigation/geometry";
import { nodeKey, nodePosition } from "../navigation/graph";
import type { ActivityMode, PathSegment } from "../navigation/types";
import {
  K_ANONYMITY_MIN,
  type ConfusionPoint,
  type MatchedPoint,
  type SegmentTraversal,
  type SessionPath,
  type SlowZone,
  type SpeedSample,
  type TurnaroundSpot,
} from "./types";

/* ------------------------------------------------------------------ */
/* 0. Réglages produit (seuils documentés, pas des nombres perdus)     */
/* ------------------------------------------------------------------ */

/**
 * Durée minimale (ms) d'un couple de points pour en tirer une vitesse.
 *
 * Sous 2 s, l'écart d'abscisse est dominé par le bruit du récepteur et par
 * l'incertitude des horodatages : la vitesse obtenue serait du hasard divisé
 * par du hasard.
 */
export const SPEED_SAMPLE_MIN_INTERVAL_MS = 2000;

/**
 * Déplacement minimal (m) le long du chemin pour en tirer une vitesse.
 * L'abscisse d'un point rattaché oscille de quelques mètres même immobile
 * (même ordre de grandeur que `REVERSAL_TOLERANCE_M` dans `traversals.ts`).
 *
 * Ce n'est PAS un filtre : c'est une base de mesure. Les couples plus courts
 * ne sont pas jetés, ils sont agrégés jusqu'à atteindre cette distance — sans
 * quoi on n'écarterait que les échantillons LENTS, ceux-là mêmes qu'on cherche
 * (à 0,35 m/s et un relevé toutes les 6 s, un pas vaut 2 m).
 */
export const SPEED_SAMPLE_MIN_DISTANCE_M = 3;

/**
 * Durée maximale (ms) d'une base de mesure. Au-delà, on rend l'échantillon même
 * si la distance minimale n'est pas atteinte : quelqu'un qui n'a pas parcouru
 * 3 m en une minute est à l'arrêt, et c'est une information, pas un rebut.
 */
export const SPEED_SAMPLE_MAX_WINDOW_MS = 60_000;

/**
 * Vitesse (m/s) au-delà de laquelle l'échantillon est une aberration, pas une
 * mesure : 25 m/s = 90 km/h. Personne ne parcourt un sentier à cette vitesse ;
 * c'est un saut de rattachement ou un horodatage faux.
 */
export const SPEED_SAMPLE_MAX_SPEED_MS = 25;

/** Réglages par défaut de la détection des ralentissements (section 27). */
export const DEFAULT_SLOW_ZONE_OPTIONS: Required<SlowZoneOptions> = {
  /** Tranche d'abscisse : 25 m, la longueur d'un passage rocheux ou d'un gué. */
  bucketM: 25,
  /** Moitié de la vitesse de référence : en deçà, le ralentissement est franc. */
  minRatio: 0.5,
  /** Moins de 40 m : un pas de côté, pas une zone. */
  minLengthM: 40,
  /** Volume minimal pour que des médianes de tranche aient un sens. */
  minObservations: 8,
  /** Contributeurs distincts : au-dessus du seuil d'anonymat, un ralentissement doit être collectif. */
  minUsers: 4,
};

/**
 * Nombre minimal d'échantillons dans une tranche pour qu'elle pèse dans la
 * détection. Une tranche traversée par un seul échantillon ne prouve rien ;
 * elle est écartée et *coupe* la continuité de la zone (on ne relie pas deux
 * ralentissements à travers un trou de données).
 */
export const SLOW_ZONE_MIN_BUCKET_OBSERVATIONS = 2;

/**
 * Échantillons minimaux d'une activité sur un segment pour que sa médiane
 * serve de référence de normalisation. En dessous, la médiane serait celle
 * d'une seule personne : on retombe sur la vitesse type de l'activité
 * (`DEFAULT_SPEED_MS`, partagée avec l'estimation de durée).
 */
export const SLOW_ZONE_MIN_ACTIVITY_SAMPLES = 3;

/** Réglages par défaut de la détection des demi-tours (section 28). */
export const DEFAULT_TURNAROUND_OPTIONS: Required<TurnaroundOptions> = {
  /** Même tranche que les ralentissements : un demi-tour se situe à 25 m près. */
  bucketM: 25,
  /** Quatre demi-tours au même endroit : en dessous, c'est de la coïncidence. */
  minObservations: 4,
  /** Contributeurs distincts (au-dessus du seuil d'anonymat). */
  minUsers: 4,
  /** 15 % des passages qui rebroussent chemin : anormal sur un sentier de liaison. */
  minRate: 0.15,
};

/**
 * Nombre de passages pouvant s'intercaler entre l'aller et le retour d'un
 * demi-tour. 1 couvre le cas courant : on pousse quelques mètres sur le
 * segment voisin avant de renoncer et de revenir.
 */
export const TURNAROUND_MAX_INTERLEAVED = 1;

/**
 * Pause maximale (ms) entre l'aller et le retour. Au-delà de 30 min, le retour
 * n'est plus un demi-tour mais une nouvelle étape : pique-nique au lac, pause
 * au sommet, attente d'une éclaircie. C'est aussi ce qui évite de compter
 * comme « obstacle » une sortie contemplative.
 */
export const TURNAROUND_MAX_PAUSE_MS = 30 * 60_000;

/** Réglages par défaut de la détection des erreurs de navigation (section 29). */
export const DEFAULT_CONFUSION_OPTIONS: Required<ConfusionOptions> = {
  /** 300 m aller-retour : au-delà, ce n'est plus une hésitation mais une variante assumée. */
  maxDetourM: 300,
  /** 15 min : au-delà, la personne a fait autre chose (pause, observation) qu'une erreur. */
  maxDetourMs: 15 * 60_000,
  /** Quatre erreurs au même nœud avant de mettre en cause la lisibilité du terrain. */
  minObservations: 4,
  /** Contributeurs distincts (au-dessus du seuil d'anonymat). */
  minUsers: 4,
  /** 15 % des passages qui se trompent : le panneau ou le balisage manque. */
  minRate: 0.15,
};

/** Volume d'observations au-delà duquel ce critère de confiance est maximal. */
export const CONFIDENCE_FULL_OBSERVATIONS = 20;

/** Contributeurs distincts au-delà desquels ce critère de confiance est maximal. */
export const BEHAVIOUR_CONFIDENCE_FULL_USERS = 8;

/**
 * Taux au-delà duquel l'intensité du signal est jugée maximale : quand un
 * passage sur deux fait demi-tour ou se trompe, il n'y a plus de doute.
 */
export const CONFIDENCE_FULL_RATE = 0.5;

/**
 * Poids des trois critères de fiabilité (section 26), somme = 1. Le volume et
 * la diversité dominent : dix observations d'une même personne n'apprennent
 * pas grand-chose de plus qu'une seule.
 */
export const BEHAVIOUR_CONFIDENCE_WEIGHTS = {
  observations: 0.4,
  users: 0.35,
  strength: 0.25,
} as const;

/* ------------------------------------------------------------------ */
/* 1. Outils internes                                                  */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Option numérique strictement positive, sinon le défaut. */
function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Seuil de comptage : entier ≥ 1. */
function countOption(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.ceil(positive(value, fallback)));
}

/** Option exprimée en fraction : dans ]0, 1], sinon le défaut. */
function ratioOption(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

/** Médiane interpolée, valeurs non finies ignorées. Tableau vide → 0. */
function median(values: readonly number[]): number {
  const clean: number[] = [];
  for (const v of values) if (Number.isFinite(v)) clean.push(v);
  if (clean.length === 0) return 0;
  clean.sort((a, b) => a - b);
  const mid = (clean.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? clean[lo] : (clean[lo] + clean[hi]) / 2;
}

/**
 * Fiabilité 0..1 d'une observation collective : volume, diversité des
 * contributeurs, intensité du signal (`strength`, déjà ramenée dans [0, 1]).
 */
function behaviourConfidence(observations: number, users: number, strength: number): number {
  const w = BEHAVIOUR_CONFIDENCE_WEIGHTS;
  const score =
    w.observations * clamp01(observations / CONFIDENCE_FULL_OBSERVATIONS) +
    w.users * clamp01(users / BEHAVIOUR_CONFIDENCE_FULL_USERS) +
    w.strength * clamp01(strength);
  return round(clamp01(score), 3);
}

/** Géométrie d'un segment préparée une fois pour toutes (cumuls, nœuds). */
interface SegmentGeometry {
  line: readonly LngLat[];
  cumulative: readonly number[];
  /** Longueur géométrique réelle (m), qui peut différer du `lengthM` arrondi du segment. */
  lengthM: number;
  startNode: string;
  endNode: string;
}

/**
 * Géométrie d'un segment, calculée à la demande et mémorisée : les distances
 * cumulées d'un segment sont calculées une fois, pas une fois par passage.
 * `null` = segment inconnu ou inexploitable (moins de deux points, longueur nulle).
 */
function geometryOf(
  cache: Map<string, SegmentGeometry | null>,
  segments: ReadonlyMap<string, PathSegment>,
  id: string,
): SegmentGeometry | null {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const seg = segments.get(id);
  if (!seg || seg.coordinates.length < 2) {
    cache.set(id, null);
    return null;
  }
  const cumulative = cumulativeDistances(seg.coordinates);
  const lengthM = cumulative[cumulative.length - 1];
  if (!(lengthM > 0)) {
    cache.set(id, null);
    return null;
  }
  const geo: SegmentGeometry = {
    line: seg.coordinates,
    cumulative,
    lengthM,
    startNode: nodeKey(seg.coordinates[0]),
    endNode: nodeKey(seg.coordinates[seg.coordinates.length - 1]),
  };
  cache.set(id, geo);
  return geo;
}

/**
 * Passages d'une sortie remis dans l'ordre chronologique (copie : l'entrée
 * n'est jamais mutée). Les départages successifs garantissent un résultat
 * identique quel que soit l'ordre d'arrivée des données.
 */
function orderTraversals(traversals: readonly SegmentTraversal[]): SegmentTraversal[] {
  return [...traversals].sort(
    (a, b) => a.enteredAt - b.enteredAt || a.exitedAt - b.exitedAt || (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0),
  );
}

/** Nœud par lequel le passage entre sur le segment. */
function entryNode(t: SegmentTraversal, geo: SegmentGeometry): string {
  return t.direction === "forward" ? geo.startNode : geo.endNode;
}

/** Nœud par lequel le passage quitte le segment. */
function exitNode(t: SegmentTraversal, geo: SegmentGeometry): string {
  return t.direction === "forward" ? geo.endNode : geo.startNode;
}

/** Distance réellement parcourue sur le segment, repliée sur la couverture si absente. */
function traversalDistanceM(t: SegmentTraversal, geo: SegmentGeometry): number {
  if (Number.isFinite(t.distanceM) && t.distanceM > 0) return t.distanceM;
  return clamp01(t.coverage) * geo.lengthM;
}

/* ------------------------------------------------------------------ */
/* 2. Ralentissements systématiques (section 27)                       */
/* ------------------------------------------------------------------ */

/**
 * Vitesses observées le long d'un segment, à partir d'une trace rattachée.
 *
 * La vitesse est mesurée *le long du chemin* (différence d'abscisse
 * curviligne) et non à vol d'oiseau : c'est la seule qui soit comparable d'un
 * passage à l'autre, quelle que soit la cadence du récepteur. Chaque
 * échantillon est rapporté au milieu du couple (abscisse et instant) : la
 * vitesse mesurée entre deux points ne s'applique ni à l'un ni à l'autre, mais
 * à ce qui les sépare.
 *
 * La base de mesure n'est pas le couple de points consécutifs mais une FENÊTRE
 * glissante non recouvrante : on avance tant que le déplacement n'atteint pas
 * `SPEED_SAMPLE_MIN_DISTANCE_M` (et au plus `SPEED_SAMPLE_MAX_WINDOW_MS`), puis
 * on rend un échantillon. Une cadence rapide donne donc une base plus longue
 * dans les portions lentes — exactement là où la vitesse instantanée ne serait
 * que du bruit —, et les fenêtres ne se recouvrent pas, pour que les médianes
 * de tranche portent sur des observations indépendantes.
 *
 * Sont ignorés : les points non rattachés, les fenêtres à cheval sur deux
 * segments, celles trop courtes en temps (`SPEED_SAMPLE_MIN_INTERVAL_MS`) et
 * les vitesses aberrantes (`SPEED_SAMPLE_MAX_SPEED_MS`).
 *
 * Les points sont pris dans l'ordre reçu (celui de la trace) ; une fenêtre à
 * rebours du temps est écartée par le seuil de durée.
 */
export function speedSamples(
  matched: readonly MatchedPoint[],
  meta: { activity: ActivityMode; userKey: string },
): SpeedSample[] {
  const out: SpeedSample[] = [];
  let i = 0;
  while (i < matched.length - 1) {
    const a = matched[i];
    const segmentId = a.segmentId;
    if (segmentId === null || !Number.isFinite(a.at) || !Number.isFinite(a.along)) {
      i += 1;
      continue;
    }
    // Fenêtre : on avance jusqu'à disposer d'une base de mesure exploitable.
    let j = i + 1;
    let end = -1;
    while (j < matched.length) {
      const b = matched[j];
      if (b.segmentId !== segmentId || !Number.isFinite(b.at) || !Number.isFinite(b.along)) break;
      end = j;
      const dtMs = b.at - a.at;
      if (Math.abs(b.along - a.along) >= SPEED_SAMPLE_MIN_DISTANCE_M || dtMs >= SPEED_SAMPLE_MAX_WINDOW_MS) break;
      j += 1;
    }
    if (end === -1) {
      i += 1;
      continue;
    }
    const b = matched[end];
    const dtMs = b.at - a.at;
    const dM = Math.abs(b.along - a.along);
    const speedMs = dtMs > 0 ? dM / (dtMs / 1000) : Number.POSITIVE_INFINITY;
    if (dtMs >= SPEED_SAMPLE_MIN_INTERVAL_MS && speedMs <= SPEED_SAMPLE_MAX_SPEED_MS) {
      out.push({
        segmentId,
        along: round((a.along + b.along) / 2, 2),
        speedMs: round(speedMs, 4),
        activity: meta.activity,
        userKey: meta.userKey,
        at: Math.round((a.at + b.at) / 2),
      });
    }
    // Fenêtres non recouvrantes : la suivante repart de la fin de celle-ci.
    i = end;
  }
  return out;
}

export interface SlowZoneOptions {
  /** Largeur (m) des tranches d'abscisse. Défaut 25. */
  bucketM?: number;
  /** Rapport à la référence sous lequel une tranche est « lente ». Défaut 0,5. */
  minRatio?: number;
  /** Longueur minimale (m) d'une zone. Défaut 40. */
  minLengthM?: number;
  /** Échantillons minimaux dans la zone. Défaut 8. */
  minObservations?: number;
  /** Contributeurs distincts minimaux (jamais sous `K_ANONYMITY_MIN`). Défaut 4. */
  minUsers?: number;
}

/** Agrégat d'une tranche d'abscisse d'un segment. */
interface SpeedBucket {
  /** Vitesses brutes (m/s), pour la valeur affichable. */
  speeds: number[];
  /** Vitesses normalisées par l'activité, pour la comparaison. */
  norms: number[];
  users: Set<string>;
}

/**
 * Zones de ralentissement systématique (section 27).
 *
 * Méthode : les vitesses sont normalisées par la médiane de leur activité sur
 * le segment (un randonneur et un vététiste ne ralentissent pas aux mêmes
 * vitesses, mais tous deux ralentissent *par rapport à leur propre allure*),
 * puis regroupées par tranche d'abscisse. Une tranche est lente quand sa
 * médiane normalisée tombe sous `minRatio` fois la médiane normalisée du
 * segment. Les tranches lentes *contiguës* forment une zone, retenue si elle
 * est assez longue, assez observée et assez collective.
 *
 * Le `ratio` et la `referenceSpeedMs` publiés sont ensuite recalculés contre le
 * *reste du segment* (hors zone), conformément au contrat : c'est la
 * comparaison qui a un sens pour l'utilisateur (« on y va deux fois moins vite
 * qu'avant et après »). Attention : quand plusieurs activités se mélangent,
 * `ratio` n'est pas le quotient de `speedMs` par `referenceSpeedMs` — ces deux
 * vitesses sont des médianes brutes (toutes activités confondues) tandis que le
 * rapport, lui, est calculé sur les vitesses normalisées, seule comparaison
 * légitime.
 *
 * Conséquence utile : un segment *uniformément* lent ne produit aucune zone —
 * sa médiane est alors celle de la « zone » elle-même. C'est voulu : un sentier
 * globalement pénible est décrit par son temps de parcours, pas par une alerte.
 *
 * Les bornes sont celles des tranches (multiples de `bucketM`) : `toAlong` peut
 * dépasser de moins d'une tranche la fin réelle du segment.
 *
 * Coût : linéaire en nombre d'échantillons, plus un tri par tranche.
 */
export function detectSlowZones(samples: readonly SpeedSample[], opts: SlowZoneOptions = {}): SlowZone[] {
  const bucketM = positive(opts.bucketM, DEFAULT_SLOW_ZONE_OPTIONS.bucketM);
  const minRatio = ratioOption(opts.minRatio, DEFAULT_SLOW_ZONE_OPTIONS.minRatio);
  const minLengthM = positive(opts.minLengthM, DEFAULT_SLOW_ZONE_OPTIONS.minLengthM);
  const minObservations = countOption(opts.minObservations, DEFAULT_SLOW_ZONE_OPTIONS.minObservations);
  const minUsers = Math.max(K_ANONYMITY_MIN, countOption(opts.minUsers, DEFAULT_SLOW_ZONE_OPTIONS.minUsers));

  // Regroupement par segment (une passe linéaire, pas de tri global).
  const bySegment = new Map<string, SpeedSample[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.speedMs) || s.speedMs <= 0) continue;
    if (!Number.isFinite(s.along) || s.along < 0) continue;
    const list = bySegment.get(s.segmentId);
    if (list) list.push(s);
    else bySegment.set(s.segmentId, [s]);
  }

  const zones: SlowZone[] = [];
  for (const [segmentId, list] of bySegment) {
    // 1. Référence par activité : médiane de l'activité sur ce segment, ou
    //    vitesse type de l'activité quand elle est trop peu représentée.
    const perActivity = new Map<ActivityMode, number[]>();
    for (const s of list) {
      const speeds = perActivity.get(s.activity);
      if (speeds) speeds.push(s.speedMs);
      else perActivity.set(s.activity, [s.speedMs]);
    }
    const reference = new Map<ActivityMode, number>();
    for (const [activity, speeds] of perActivity) {
      const m = speeds.length >= SLOW_ZONE_MIN_ACTIVITY_SAMPLES ? median(speeds) : 0;
      reference.set(activity, m > 0 ? m : DEFAULT_SPEED_MS[activity]);
    }

    // 2. Tranches d'abscisse.
    const buckets = new Map<number, SpeedBucket>();
    const segmentNorms: number[] = [];
    for (const s of list) {
      const ref = reference.get(s.activity);
      if (ref === undefined || ref <= 0) continue;
      const norm = s.speedMs / ref;
      segmentNorms.push(norm);
      const index = Math.floor(s.along / bucketM);
      const bucket = buckets.get(index);
      if (bucket) {
        bucket.speeds.push(s.speedMs);
        bucket.norms.push(norm);
        bucket.users.add(s.userKey);
      } else {
        buckets.set(index, { speeds: [s.speedMs], norms: [norm], users: new Set([s.userKey]) });
      }
    }
    const segmentNorm = median(segmentNorms);
    if (!(segmentNorm > 0)) continue;

    // 3. Suites de tranches lentes contiguës. Une tranche sous-observée est
    //    écartée *et* coupe la suite : on ne relie pas deux ralentissements à
    //    travers un trou de données.
    const entries = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    const runs: (readonly [number, SpeedBucket])[][] = [];
    let run: (readonly [number, SpeedBucket])[] = [];
    let previousIndex = Number.NEGATIVE_INFINITY;
    for (const [index, bucket] of entries) {
      const slow =
        bucket.norms.length >= SLOW_ZONE_MIN_BUCKET_OBSERVATIONS && median(bucket.norms) / segmentNorm < minRatio;
      if (slow && (run.length === 0 || index === previousIndex + 1)) {
        run.push([index, bucket]);
      } else {
        if (run.length > 0) runs.push(run);
        run = slow ? [[index, bucket]] : [];
      }
      previousIndex = index;
    }
    if (run.length > 0) runs.push(run);

    // 4. Qualification de chaque suite.
    for (const candidate of runs) {
      const first = candidate[0][0];
      const last = candidate[candidate.length - 1][0];
      if ((last - first + 1) * bucketM < minLengthM) continue;

      const zoneSpeeds: number[] = [];
      const zoneNorms: number[] = [];
      const users = new Set<string>();
      for (const [, bucket] of candidate) {
        zoneSpeeds.push(...bucket.speeds);
        zoneNorms.push(...bucket.norms);
        for (const u of bucket.users) users.add(u);
      }
      if (zoneSpeeds.length < minObservations || users.size < minUsers) continue;

      // Référence = le reste du segment (y compris ses tranches sous-observées :
      // elles ne prouvent pas un ralentissement, mais elles renseignent l'allure).
      const restSpeeds: number[] = [];
      const restNorms: number[] = [];
      for (const [index, bucket] of entries) {
        if (index >= first && index <= last) continue;
        restSpeeds.push(...bucket.speeds);
        restNorms.push(...bucket.norms);
      }
      const referenceNorm = restNorms.length > 0 ? median(restNorms) : segmentNorm;
      if (!(referenceNorm > 0)) continue;
      const ratio = median(zoneNorms) / referenceNorm;
      // Le seuil est revérifié contre cette référence resserrée : tout ce qui
      // sort d'ici respecte `ratio < minRatio`.
      if (!(ratio < minRatio)) continue;

      zones.push({
        segmentId,
        fromAlong: round(first * bucketM, 2),
        toAlong: round((last + 1) * bucketM, 2),
        speedMs: round(median(zoneSpeeds), 4),
        referenceSpeedMs: round(restSpeeds.length > 0 ? median(restSpeeds) : median(zoneSpeeds), 4),
        ratio: round(ratio, 3),
        observations: zoneSpeeds.length,
        uniqueUsers: users.size,
        confidence: behaviourConfidence(zoneSpeeds.length, users.size, 1 - clamp01(ratio)),
      });
    }
  }

  // Ordre stable : par segment, puis par abscisse.
  return zones.sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : a.fromAlong - b.fromAlong));
}

/* ------------------------------------------------------------------ */
/* 3. Demi-tours (section 28)                                          */
/* ------------------------------------------------------------------ */

export interface TurnaroundOptions {
  /** Largeur (m) des tranches d'abscisse. Défaut 25. */
  bucketM?: number;
  /** Demi-tours minimaux au même endroit. Défaut 4. */
  minObservations?: number;
  /** Contributeurs distincts minimaux (jamais sous `K_ANONYMITY_MIN`). Défaut 4. */
  minUsers?: number;
  /** Part minimale des passages du segment faisant demi-tour ici. Défaut 0,15. */
  minRate?: number;
}

/** Agrégat d'un point de demi-tour (une tranche d'abscisse d'un segment). */
interface TurnaroundBucket {
  segmentId: string;
  alongs: number[];
  users: Set<string>;
}

/**
 * Abscisse extrême atteinte avant de rebrousser chemin.
 *
 * Un passage ne porte pas ses abscisses, seulement sa couverture. L'hypothèse
 * — vraie dans le cas courant — est que la personne est entrée sur le segment
 * par une de ses extrémités : en « forward » elle est entrée à 0 et a poussé
 * jusqu'à `coverage × longueur`, en « backward » elle est entrée par la fin et
 * est descendue jusqu'à `(1 − coverage) × longueur`. On retient la plus grande
 * des deux couvertures (aller et retour) pour ne pas sous-estimer le point
 * atteint quand le retour s'interrompt avant l'extrémité.
 */
function turnaroundAlong(outbound: SegmentTraversal, back: SegmentTraversal, geo: SegmentGeometry): number {
  const coverage = Math.max(clamp01(outbound.coverage), clamp01(back.coverage));
  const reached = coverage * geo.lengthM;
  return outbound.direction === "forward" ? reached : geo.lengthM - reached;
}

/**
 * Points de demi-tour collectifs (section 28).
 *
 * Dans une sortie, un demi-tour est un même segment parcouru dans un sens puis
 * dans l'autre, de façon consécutive ou quasi consécutive
 * (`TURNAROUND_MAX_INTERLEAVED` passages intercalés au plus,
 * `TURNAROUND_MAX_PAUSE_MS` de pause au plus). Chaque couple est consommé : un
 * aller-retour ne compte qu'une fois, même si la sortie en enchaîne plusieurs.
 *
 * Le taux rapporte les demi-tours d'une tranche au nombre *total* de passages
 * du segment observés dans les sessions fournies. Un demi-tour consomme deux
 * passages de ce segment (l'aller et le retour) : le dénominateur est donc
 * légèrement gonflé sur les segments à demi-tours, ce qui rend le taux
 * conservateur — on préfère taire un signal que d'en inventer un.
 *
 * Rappel de la limite documentée en tête de fichier : un aller-retour *normal*
 * (lac, sommet, belvédère) produit exactement le même motif qu'un obstacle.
 *
 * Coût : linéaire en nombre de passages ; la géométrie de chaque segment n'est
 * préparée qu'une fois.
 */
export function detectTurnarounds(
  sessions: readonly SessionPath[],
  segments: ReadonlyMap<string, PathSegment>,
  opts: TurnaroundOptions = {},
): TurnaroundSpot[] {
  const bucketM = positive(opts.bucketM, DEFAULT_TURNAROUND_OPTIONS.bucketM);
  const minObservations = countOption(opts.minObservations, DEFAULT_TURNAROUND_OPTIONS.minObservations);
  const minUsers = Math.max(K_ANONYMITY_MIN, countOption(opts.minUsers, DEFAULT_TURNAROUND_OPTIONS.minUsers));
  const minRate = ratioOption(opts.minRate, DEFAULT_TURNAROUND_OPTIONS.minRate);

  const cache = new Map<string, SegmentGeometry | null>();
  /** Passages observés par segment : dénominateur du taux. */
  const passages = new Map<string, number>();
  /** `segmentId + "#" + tranche` → agrégat. */
  const spots = new Map<string, TurnaroundBucket>();

  for (const session of sessions) {
    const ordered = orderTraversals(session.traversals);
    for (const t of ordered) passages.set(t.segmentId, (passages.get(t.segmentId) ?? 0) + 1);

    let i = 0;
    while (i < ordered.length - 1) {
      const outbound = ordered[i];
      const limit = Math.min(ordered.length - 1, i + 1 + TURNAROUND_MAX_INTERLEAVED);
      let pairedAt = -1;
      for (let j = i + 1; j <= limit; j++) {
        const back = ordered[j];
        if (back.segmentId !== outbound.segmentId || back.direction === outbound.direction) continue;
        const pauseMs = back.enteredAt - outbound.exitedAt;
        if (!Number.isFinite(pauseMs) || pauseMs < 0 || pauseMs > TURNAROUND_MAX_PAUSE_MS) continue;
        pairedAt = j;
        break;
      }
      if (pairedAt < 0) {
        i++;
        continue;
      }
      const back = ordered[pairedAt];
      const geo = geometryOf(cache, segments, outbound.segmentId);
      if (geo) {
        const along = turnaroundAlong(outbound, back, geo);
        const key = `${outbound.segmentId}#${Math.floor(along / bucketM)}`;
        const spot = spots.get(key);
        if (spot) {
          spot.alongs.push(along);
          spot.users.add(session.userKey);
        } else {
          spots.set(key, { segmentId: outbound.segmentId, alongs: [along], users: new Set([session.userKey]) });
        }
      }
      // Le couple est consommé : le retour ne peut pas servir d'aller au couple suivant.
      i = pairedAt + 1;
    }
  }

  const out: TurnaroundSpot[] = [];
  for (const spot of spots.values()) {
    const observations = spot.alongs.length;
    const uniqueUsers = spot.users.size;
    if (observations < minObservations || uniqueUsers < minUsers) continue;
    const total = passages.get(spot.segmentId) ?? 0;
    if (total <= 0) continue;
    const rate = observations / total;
    if (rate < minRate) continue;
    const geo = geometryOf(cache, segments, spot.segmentId);
    if (!geo) continue;
    // Médiane des abscisses atteintes plutôt que centre de tranche : le point
    // affiché est celui où l'on s'arrête vraiment.
    const along = median(spot.alongs);
    const position = pointAtAlong(geo.line, geo.cumulative, along);
    out.push({
      segmentId: spot.segmentId,
      along: round(along, 1),
      lat: round(position.lat, 6),
      lng: round(position.lng, 6),
      observations,
      uniqueUsers,
      rate: round(rate, 3),
      confidence: behaviourConfidence(observations, uniqueUsers, rate / CONFIDENCE_FULL_RATE),
    });
  }

  // Ordre stable : par segment, puis par abscisse.
  return out.sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : a.along - b.along));
}

/* ------------------------------------------------------------------ */
/* 4. Erreurs de navigation (section 29)                               */
/* ------------------------------------------------------------------ */

export interface ConfusionOptions {
  /** Longueur maximale (m) de l'aller-retour sur la mauvaise branche. Défaut 300. */
  maxDetourM?: number;
  /** Durée maximale (ms) de cet aller-retour. Défaut 15 min. */
  maxDetourMs?: number;
  /** Erreurs minimales au même nœud. Défaut 4. */
  minObservations?: number;
  /** Contributeurs distincts minimaux (jamais sous `K_ANONYMITY_MIN`). Défaut 4. */
  minUsers?: number;
  /** Part minimale des passages par le nœud suivis d'une erreur. Défaut 0,15. */
  minRate?: number;
}

/** Agrégat d'un nœud où les usagers se trompent. */
interface ConfusionBucket {
  users: Set<string>;
  observations: number;
  /** Segment emprunté par erreur → nombre de fois. */
  wrong: Map<string, number>;
}

/**
 * Intersections où les usagers se trompent puis reviennent (section 29).
 *
 * Motif recherché dans une sortie : la personne arrive à un nœud N par un
 * segment, s'engage sur un segment B issu de N, revient à N par ce même
 * segment B (aller-retour court en distance et en temps), puis repart par un
 * *autre* segment. Les quatre passages doivent se suivre : c'est cette
 * séquence — et pas un simple aller-retour — qui distingue une erreur
 * d'orientation d'un détour volontaire.
 *
 * Le segment de repart peut être celui d'arrivée : la personne a essayé la
 * mauvaise branche puis a renoncé et fait demi-tour. C'est encore une erreur
 * d'orientation au même nœud.
 *
 * Dénominateur du taux : le nombre d'*arrivées* à ce nœud (passages dont le
 * nœud de sortie est N), toutes sessions confondues. Une erreur produit deux
 * arrivées (celle d'origine et le retour de la mauvaise branche), ce qui gonfle
 * légèrement le dénominateur des nœuds trompeurs : le taux publié est donc
 * conservateur.
 *
 * Coût : linéaire en nombre de passages ; les nœuds sont dérivés une seule fois
 * par segment (`nodeKey`), la position vient de `nodePosition`.
 */
export function detectConfusionPoints(
  sessions: readonly SessionPath[],
  segments: ReadonlyMap<string, PathSegment>,
  opts: ConfusionOptions = {},
): ConfusionPoint[] {
  const maxDetourM = positive(opts.maxDetourM, DEFAULT_CONFUSION_OPTIONS.maxDetourM);
  const maxDetourMs = positive(opts.maxDetourMs, DEFAULT_CONFUSION_OPTIONS.maxDetourMs);
  const minObservations = countOption(opts.minObservations, DEFAULT_CONFUSION_OPTIONS.minObservations);
  const minUsers = Math.max(K_ANONYMITY_MIN, countOption(opts.minUsers, DEFAULT_CONFUSION_OPTIONS.minUsers));
  const minRate = ratioOption(opts.minRate, DEFAULT_CONFUSION_OPTIONS.minRate);

  const cache = new Map<string, SegmentGeometry | null>();
  /** Arrivées par nœud : dénominateur du taux. */
  const arrivals = new Map<string, number>();
  const nodes = new Map<string, ConfusionBucket>();

  for (const session of sessions) {
    const ordered = orderTraversals(session.traversals);
    const geometries: (SegmentGeometry | null)[] = ordered.map((t) => geometryOf(cache, segments, t.segmentId));

    for (let k = 0; k < ordered.length; k++) {
      const geo = geometries[k];
      if (!geo) continue;
      const key = exitNode(ordered[k], geo);
      arrivals.set(key, (arrivals.get(key) ?? 0) + 1);
    }

    // Motif : [arrivée] [mauvaise branche] [retour] [repart ailleurs].
    for (let k = 1; k + 2 < ordered.length; k++) {
      const arrival = ordered[k - 1];
      const wrongWay = ordered[k];
      const back = ordered[k + 1];
      const resume = ordered[k + 2];
      if (back.segmentId !== wrongWay.segmentId || back.direction === wrongWay.direction) continue;
      if (resume.segmentId === wrongWay.segmentId) continue;

      const arrivalGeo = geometries[k - 1];
      const wrongGeo = geometries[k];
      const resumeGeo = geometries[k + 2];
      if (!arrivalGeo || !wrongGeo || !resumeGeo) continue;

      const node = entryNode(wrongWay, wrongGeo);
      if (exitNode(arrival, arrivalGeo) !== node) continue;
      if (entryNode(resume, resumeGeo) !== node) continue;

      const detourM = traversalDistanceM(wrongWay, wrongGeo) + traversalDistanceM(back, wrongGeo);
      if (!Number.isFinite(detourM) || detourM > maxDetourM) continue;
      const detourMs = back.exitedAt - wrongWay.enteredAt;
      if (!Number.isFinite(detourMs) || detourMs < 0 || detourMs > maxDetourMs) continue;

      const bucket = nodes.get(node);
      if (bucket) {
        bucket.observations++;
        bucket.users.add(session.userKey);
        bucket.wrong.set(wrongWay.segmentId, (bucket.wrong.get(wrongWay.segmentId) ?? 0) + 1);
      } else {
        nodes.set(node, {
          observations: 1,
          users: new Set([session.userKey]),
          wrong: new Map([[wrongWay.segmentId, 1]]),
        });
      }
    }
  }

  const out: ConfusionPoint[] = [];
  for (const [key, bucket] of nodes) {
    const uniqueUsers = bucket.users.size;
    if (bucket.observations < minObservations || uniqueUsers < minUsers) continue;
    const total = arrivals.get(key) ?? 0;
    if (total <= 0) continue;
    const rate = bucket.observations / total;
    if (rate < minRate) continue;
    const position = nodePosition(key);
    // Du plus fréquent au moins fréquent, l'identifiant départageant les ex æquo.
    const wrongSegmentIds = [...bucket.wrong.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id]) => id);
    out.push({
      nodeKey: key,
      lat: round(position.lat, 6),
      lng: round(position.lng, 6),
      observations: bucket.observations,
      uniqueUsers,
      rate: round(rate, 3),
      wrongSegmentIds,
      confidence: behaviourConfidence(bucket.observations, uniqueUsers, rate / CONFIDENCE_FULL_RATE),
    });
  }

  // Les nœuds les plus trompeurs d'abord ; l'identifiant départage.
  return out.sort(
    (a, b) => b.rate - a.rate || b.observations - a.observations || (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0),
  );
}
