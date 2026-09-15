/**
 * Vie privée du moteur cartographique collectif : la seule barrière entre des
 * traces personnelles et des données exploitées collectivement.
 *
 * Sections du cahier des charges couvertes ici :
 *
 *  - **34. Jamais de position personnelle.** Ce qui sort d'ici décrit un
 *    *chemin*, jamais une personne : « 43 passages cette semaine », jamais
 *    « Pierre est passé à 14 h 32 ». `redactStatistics` neutralise tout ce qui
 *    désigne QUI, QUAND ou À QUELLE VITESSE dès que le nombre de contributeurs
 *    distincts passe sous `K_ANONYMITY_MIN` ; `coarsenPoints` fait de même pour
 *    les positions exportées, ramenées à des nœuds de grille.
 *  - **35. Vie privée dès la conception, consentement explicite.**
 *    `contributionAllowed` est le point de passage unique : une activité ne
 *    nourrit le collectif que si son propriétaire l'a explicitement décidé, et
 *    un retrait (`withdrawn`) referme la porte pour tous les recalculs à venir.
 *  - **36. Ne pas conserver le domicile.** `maskTrace` écarte le début et la
 *    fin de chaque trace sur une **distance curviligne** (250 m par défaut, et
 *    non « n points » : la même poignée de relevés vaut 40 m sur une approche
 *    en montée et 2 km en descente VTT), puis supprime tout point tombant dans
 *    une zone privée déclarée. `suggestPrivacyZones` repère les lieux qui
 *    reviennent trop souvent en départ ou en arrivée — mais ne fait que les
 *    **proposer** : la zone n'existe que si l'utilisateur la valide, ce module
 *    ne la crée ni ne l'applique de lui-même (section 35).
 *
 * Trois principes de conception traversent le fichier :
 *
 * 1. **Dans le doute, on retire.** Un rognage incohérent retombe sur la valeur
 *    par défaut (jamais sur zéro), une zone déclarée sans rayon exploitable
 *    protège quand même `PRIVACY_ZONE_MIN_RADIUS_M`, un seuil d'anonymat à zéro
 *    est refusé. Perdre de la donnée collective est réparable ; publier un
 *    domicile ne l'est pas.
 * 2. **On ne fabrique jamais de géométrie de substitution.** Les points retirés
 *    disparaissent, ils ne sont pas remplacés par une position approchée (elle
 *    n'aurait ni instant, ni précision, ni réalité). Quand les suppressions
 *    coupent la trace en plusieurs morceaux, seul le plus long morceau
 *    *contigu* survit : recoller deux tronçons créerait une ligne droite
 *    fantôme qui, en plus de polluer l'apprentissage de la géométrie,
 *    trahirait précisément la zone qu'on venait de masquer.
 * 3. **Rien n'est muté.** La trace brute n'est jamais écrasée (section 5) :
 *    toutes les fonctions renvoient de nouvelles structures et laissent leurs
 *    entrées intactes.
 *
 * Module pur : pas de DOM, pas de réseau, pas d'aléa, pas d'horloge implicite.
 * Coût : linéaire sur le nombre de points (un cumul de distances et une passe),
 * et quasi linéaire pour le regroupement d'ancrages grâce à une grille — ces
 * fonctions voient passer des dizaines de milliers de points.
 */
import { METERS_PER_DEG_LAT, haversineM, isValidLatLng, snapToGrid, type LngLat } from "../geo";
import type { LatLng } from "../types";
import { cumulativeDistances } from "../navigation/geometry";
import { DAY_MS } from "../time";
import { STATISTICS_MIN_OBSERVATIONS } from "./statistics";
import {
  K_ANONYMITY_MIN,
  RAW_TRACE_RETENTION_DAYS,
  type ContributionStatus,
  type PrivacyZone,
  type SegmentStatistics,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages produit (seuils documentés, pas des nombres perdus)        */
/* ------------------------------------------------------------------ */

/**
 * Distance (m) écartée au **départ** de chaque trace contribuée (section 36).
 *
 * 250 m est le compromis retenu : assez pour qu'un départ ne désigne plus un
 * bâtiment (domicile, gîte, parking privé), assez peu pour ne pas amputer
 * l'information utile sur des sentiers dont beaucoup font moins de 2 km. La
 * mesure est curviligne : elle vaut la même chose quelle que soit la fréquence
 * d'échantillonnage du récepteur.
 */
export const TRACE_TRIM_START_M = 250;

/**
 * Distance (m) écartée à l'**arrivée**. Le retour est aussi parlant que le
 * départ, et sur une boucle les deux extrémités sont au même endroit : rogner
 * un seul côté ne protégerait rien.
 */
export const TRACE_TRIM_END_M = 250;

/**
 * Nombre de passages en dessous duquel une statistique n'est pas publiée, en
 * plus du seuil d'utilisateurs distincts.
 *
 * Trois personnes peuvent avoir produit trois passages : le k-anonymat est
 * respecté, mais la statistique ne dit rien de fiable et ses valeurs extrêmes
 * (« 42 min ») désignent encore des sorties précises. On s'aligne sur le seuil
 * de l'agrégateur, pour qu'une même donnée ne soit pas jugée exploitable ici
 * et insuffisante là-bas.
 */
export const PUBLICATION_MIN_PASSAGES = STATISTICS_MIN_OBSERVATIONS;

/**
 * Rayon (m) protégé au minimum autour d'une zone déclarée sans rayon
 * exploitable (zéro, négatif, illisible). Une zone déclarée exprime une
 * intention : on ne la réduit jamais à « aucune protection ».
 */
export const PRIVACY_ZONE_MIN_RADIUS_M = 50;

/**
 * Rayon (m) de regroupement des ancrages pour proposer une zone privée.
 *
 * 200 m couvre la dispersion d'un point de départ réel : première accroche GPS
 * capricieuse en ville ou sous couvert, place de stationnement différente d'un
 * jour à l'autre, démarrage de l'enregistrement quelques dizaines de mètres
 * après la porte. Plus large, on fusionnerait le domicile avec le départ de
 * sentier voisin ; plus étroit, on manquerait le regroupement.
 */
export const ZONE_SUGGESTION_RADIUS_M = 200;

/**
 * Nombre d'occurrences à partir duquel un lieu est proposé comme zone privée.
 *
 * Deux fois, c'est un sentier qu'on aime ; trois fois, c'est une habitude, et
 * une habitude qui se voit en départ *et* en arrivée désigne le plus souvent
 * un domicile. Le seuil reste bas : la proposition est soumise à
 * l'utilisateur, une suggestion superflue ne coûte qu'un refus.
 */
export const ZONE_SUGGESTION_MIN_OCCURRENCES = 3;

/* ------------------------------------------------------------------ */
/* Outils internes                                                     */
/* ------------------------------------------------------------------ */

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Distance demandée, ramenée à une valeur exploitable. `0` est un choix
 * explicite (re-traitement d'une trace déjà masquée) et il est respecté ; une
 * valeur négative ou illisible retombe sur le défaut, jamais sur zéro.
 */
function resolveDistance(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  return Number.isFinite(requested) && requested >= 0 ? requested : fallback;
}

/**
 * Seuil de comptage demandé. Un seuil illisible ou inférieur à 1 retombe sur
 * le défaut : on ne désactive pas une protection en passant zéro.
 */
function resolveCount(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  return Number.isFinite(requested) && requested >= 1 ? Math.ceil(requested) : fallback;
}

/** Zone privée ramenée à des valeurs exploitables (voir `effectiveZones`). */
interface EffectiveZone {
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * Zones réellement applicables. Un centre illisible (hors de la Terre, NaN) est
 * ignoré : il ne désigne aucun lieu à protéger. Un rayon absent ou absurde est
 * en revanche *relevé* à `PRIVACY_ZONE_MIN_RADIUS_M` — voir la constante.
 */
function effectiveZones(zones: readonly PrivacyZone[] | undefined): EffectiveZone[] {
  if (zones === undefined) return [];
  const out: EffectiveZone[] = [];
  for (const zone of zones) {
    if (!isValidLatLng(zone)) continue;
    const declared = zone.radiusM;
    const radiusM =
      Number.isFinite(declared) && declared > PRIVACY_ZONE_MIN_RADIUS_M ? declared : PRIVACY_ZONE_MIN_RADIUS_M;
    out.push({ lat: zone.lat, lng: zone.lng, radiusM });
  }
  return out;
}

/** Appartenance à l'une des zones déjà normalisées (boucle interne du masquage). */
function insideEffectiveZones(point: LatLng, zones: readonly EffectiveZone[]): boolean {
  for (const zone of zones) {
    if (haversineM(point, zone) <= zone.radiusM) return true;
  }
  return false;
}

/**
 * Le point tombe-t-il dans l'une des zones privées déclarées ?
 *
 * Bord inclus (à `radiusM` exactement, le point est dans la zone), rayon relevé
 * à `PRIVACY_ZONE_MIN_RADIUS_M`, zone au centre illisible ignorée. Un point de
 * coordonnées illisibles n'est dans aucune zone : il n'est nulle part, et le
 * masquage l'écarte de toute façon.
 */
export function inPrivacyZone(point: { lat: number; lng: number }, zones: readonly PrivacyZone[]): boolean {
  if (!isValidLatLng(point)) return false;
  return insideEffectiveZones(point, effectiveZones(zones));
}

/* ------------------------------------------------------------------ */
/* 1. Consentement (section 35)                                        */
/* ------------------------------------------------------------------ */

/**
 * Cette activité peut-elle nourrir le collectif ?
 *
 * Seul `contributed` ouvre la porte : `private` (l'activité reste à son
 * propriétaire) et `withdrawn` (contribution retirée, donc à retirer aussi de
 * tous les recalculs) la ferment. La comparaison est volontairement positive :
 * un statut ajouté demain au contrat sera refusé par défaut, ce qui est le bon
 * sens de l'erreur.
 */
export function contributionAllowed(status: ContributionStatus): boolean {
  return status === "contributed";
}

/* ------------------------------------------------------------------ */
/* 2. K-anonymat (section 34)                                          */
/* ------------------------------------------------------------------ */

/**
 * Le seuil d'anonymat est-il atteint ?
 *
 * On compte des contributeurs **distincts**, jamais des passages : quarante
 * passages d'une même personne restent une personne, et publier sur cette base
 * reviendrait à publier son emploi du temps. Un comptage illisible vaut zéro,
 * et un seuil demandé inférieur à 1 retombe sur `K_ANONYMITY_MIN` : on ne
 * débranche pas le k-anonymat en passant `0`.
 */
export function isPublishable(
  stats: Pick<SegmentStatistics, "uniqueUsers" | "passages" | "insufficientData">,
  min: number = K_ANONYMITY_MIN,
): boolean {
  const threshold = resolveCount(min, K_ANONYMITY_MIN);
  const users = stats.uniqueUsers;
  const passages = stats.passages?.total;
  if (!Number.isFinite(users) || !Number.isFinite(passages)) return false;
  if (stats.insufficientData) return false;
  return users >= threshold && passages >= PUBLICATION_MIN_PASSAGES;
}

/**
 * Version publiable d'une statistique qui ne franchit pas le seuil d'anonymat.
 *
 * Au-dessus du seuil, la statistique est renvoyée telle quelle (l'objet
 * lui-même : rien à masquer, rien à copier). En dessous, on renvoie une copie
 * dont tout ce qui pourrait désigner un individu a disparu :
 *
 *  - QUI  : `uniqueUsers`, `uniqueSessions`, `activityMix` (« 100 % VTT » avec
 *           deux contributeurs, c'est la pratique de deux personnes) ;
 *  - QUAND: `firstPassageAt`, `lastPassageAt` — un horodatage exact *est* la
 *           position d'une personne à un instant donné, que ce soit le premier
 *           ou le dernier — ainsi que `monthly` et `hourly`, dont une seule
 *           case remplie dessine un emploi du temps ;
 *  - VITE : `duration` et `averageSpeedMs`, qui redonne la durée par simple
 *           division.
 *
 * Ce qui survit — `segmentId`, `activity`, `direction` et les comptages de
 * passages — décrit le chemin, pas les gens : c'est exactement le « 43
 * passages cette semaine » de la section 34. Les indices *conclusifs*
 * (`popularityScore`, `frequentation`, `trend`, `possiblyInactive`,
 * `confidence`) sont neutralisés et `insufficientData` passe à vrai : sous le
 * seuil, on ne conclut rien — ni « très fréquenté », ni « probablement
 * abandonné ». Ce n'est pas « zéro passage », c'est « nous ne savons pas », et
 * l'interface affichera « Données communautaires insuffisantes ».
 */
export function redactStatistics(stats: SegmentStatistics): SegmentStatistics {
  return {
    segmentId: stats.segmentId,
    activity: stats.activity,
    direction: stats.direction,
    passages: { last7: 0, last30: 0, last365: 0, total: 0 },
    uniqueSessions: 0,
    uniqueUsers: 0,
    duration: null,
    averageSpeedMs: null,
    firstPassageAt: null,
    lastPassageAt: null,
    popularityScore: 0,
    frequentation: "unknown",
    confidence: 0,
    insufficientData: true,
    activityMix: {},
    monthly: {},
    hourly: {},
    trend: null,
    possiblyInactive: false,
  };
}

/**
 * Diversité d'un lot d'observations : combien de personnes distinctes, et
 * est-ce assez pour publier quoi que ce soit (section 34) ?
 *
 * On compte des `userKey` distincts et non vides : un pseudonyme absent ne
 * prouve aucune diversité, et deux pseudonymes absents n'en prouvent pas deux.
 */
export function anonymitySummary(
  observations: readonly { userKey: string }[],
  min: number = K_ANONYMITY_MIN,
): { uniqueUsers: number; sufficient: boolean } {
  const threshold = resolveCount(min, K_ANONYMITY_MIN);
  const keys = new Set<string>();
  for (const o of observations) if (o.userKey) keys.add(o.userKey);
  return { uniqueUsers: keys.size, sufficient: keys.size >= threshold };
}

/* ------------------------------------------------------------------ */
/* Conservation limitée des traces brutes (section 34)                 */
/* ------------------------------------------------------------------ */

/**
 * Instant (ms epoch) avant lequel une trace brute n'a plus à être conservée.
 *
 * Une durée de `0` est un choix explicite (« ne rien garder ») et elle est
 * respectée ; une durée négative ou illisible retombe sur le défaut, jamais
 * sur « pour toujours ». Un instant courant illisible est ramené à 0 pour que
 * la borne reste un nombre exploitable.
 */
export function retentionCutoff(now: number = Date.now(), days: number = RAW_TRACE_RETENTION_DAYS): number {
  const reference = Number.isFinite(now) ? now : 0;
  const kept = Number.isFinite(days) && days >= 0 ? days : RAW_TRACE_RETENTION_DAYS;
  return reference - kept * DAY_MS;
}

/**
 * La trace brute d'une activité terminée à `endedAt` a-t-elle dépassé la durée
 * de conservation ? Une date illisible est traitée comme périmée : dans le
 * doute, on purge (une trace brute perdue est réparable, une trace conservée
 * sans raison ne l'est pas).
 */
export function isRawTraceExpired(
  endedAt: number,
  now: number = Date.now(),
  days: number = RAW_TRACE_RETENTION_DAYS,
): boolean {
  if (!Number.isFinite(endedAt)) return true;
  return endedAt < retentionCutoff(now, days);
}

/* ------------------------------------------------------------------ */
/* 3. Masquage des extrémités et des zones privées (section 36)        */
/* ------------------------------------------------------------------ */

/** Réglages du masquage ; tout est optionnel, les défauts sont les constantes ci-dessus. */
export interface MaskOptions {
  /** Zones déclarées par l'utilisateur (domicile, lieu sensible). */
  zones?: readonly PrivacyZone[];
  /** Distance curviligne (m) écartée au départ. Défaut : `TRACE_TRIM_START_M`. */
  trimStartM?: number;
  /** Distance curviligne (m) écartée à l'arrivée. Défaut : `TRACE_TRIM_END_M`. */
  trimEndM?: number;
}

/** Résultat du masquage : la trace publiable et le compte rendu de ce qui a été retiré. */
export interface MaskResult<T> {
  /** Portion publiable (copies des relevés d'origine), vide si `dropped`. */
  points: T[];
  /** Distance (m) entre le vrai départ et le premier point publié. */
  trimmedStartM: number;
  /** Distance (m) entre le dernier point publié et la vraie arrivée. */
  trimmedEndM: number;
  /** Points écartés, toutes causes confondues : `points.length` d'entrée moins celui de sortie. */
  removed: number;
  /** Parmi eux, ceux supprimés parce qu'ils tombaient dans une zone privée. */
  removedInZones: number;
  /** Vrai quand la trace ne contribue pas du tout : `points` est alors vide. */
  dropped: boolean;
}

/**
 * Masque une trace avant toute exploitation collective (section 36).
 *
 * Quatre opérations, dans cet ordre :
 *
 * 1. **Relevés illisibles écartés** : une coordonnée hors de la Terre ne peut
 *    être ni mesurée ni masquée, donc elle ne sort pas.
 * 2. **Rognage curviligne des deux extrémités** : on conserve le premier point
 *    situé à au moins `trimStartM` du départ et le dernier situé à au moins
 *    `trimEndM` de l'arrivée. Aucun point de substitution n'est interpolé aux
 *    bornes : la distance réellement écartée est donc *au moins* celle
 *    demandée, et elle est rendue telle quelle dans `trimmedStartM` /
 *    `trimmedEndM`. Le rognage est une distance, pas un nombre de relevés :
 *    la même poignée de points vaut 40 m sur une approche en montée et 2 km en
 *    descente VTT.
 * 3. **Zones privées** : chaque point tombant dans une zone est supprimé, ce
 *    qui peut couper la trace ; seul le plus long morceau **contigu** survit.
 *    Recoller deux tronçons créerait une ligne droite fantôme qui, en plus de
 *    polluer l'apprentissage de la géométrie, trahirait précisément la zone
 *    qu'on venait de masquer. À égalité de longueur, le premier morceau
 *    l'emporte : le résultat reste déterministe.
 * 4. **Verdict** : `dropped` vaut exactement « il ne reste plus rien ».
 *
 * La trace d'entrée n'est ni modifiée, ni réordonnée ; les points publiés en
 * sont des copies, pour qu'un appelant qui les retouche ne puisse pas
 * corrompre la trace brute conservée par ailleurs (section 5).
 */
export function maskTrace<T extends { lat: number; lng: number }>(
  points: readonly T[],
  opts: MaskOptions = {},
): MaskResult<T> {
  const trimStartM = resolveDistance(opts.trimStartM, TRACE_TRIM_START_M);
  const trimEndM = resolveDistance(opts.trimEndM, TRACE_TRIM_END_M);
  const zones = effectiveZones(opts.zones);

  const usable: T[] = [];
  for (const point of points) if (isValidLatLng(point)) usable.push(point);
  if (usable.length === 0) {
    return { points: [], trimmedStartM: 0, trimmedEndM: 0, removed: points.length, removedInZones: 0, dropped: true };
  }

  // Cumul des distances : une seule passe, réutilisée pour le rognage, le choix
  // du morceau le plus long et les distances rendues.
  const cumulative = cumulativeDistances(usable.map((p) => [p.lng, p.lat] as LngLat));
  const lengthM = cumulative[cumulative.length - 1];

  /** Trace entièrement écartée : on rend tout de même ce qui a été rogné. */
  const abandoned = (removedInZones: number): MaskResult<T> => {
    const startM = Math.min(trimStartM, lengthM);
    return {
      points: [],
      trimmedStartM: round(startM, 1),
      trimmedEndM: round(Math.max(0, lengthM - startM), 1),
      removed: points.length,
      removedInZones,
      dropped: true,
    };
  };

  let startIdx = -1;
  for (let i = 0; i < usable.length; i++) {
    if (cumulative[i] >= trimStartM) {
      startIdx = i;
      break;
    }
  }
  let endIdx = -1;
  const lastAllowedAlong = lengthM - trimEndM;
  for (let i = usable.length - 1; i >= 0; i--) {
    if (cumulative[i] <= lastAllowedAlong) {
      endIdx = i;
      break;
    }
  }
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return abandoned(0);

  // Zones privées : on découpe la fenêtre conservée en morceaux contigus.
  let removedInZones = 0;
  let best: { from: number; to: number } | null = null;
  let current: { from: number; to: number } | null = null;
  for (let i = startIdx; i <= endIdx; i++) {
    if (zones.length > 0 && insideEffectiveZones(usable[i], zones)) {
      removedInZones += 1;
      current = null;
      continue;
    }
    if (current === null) current = { from: i, to: i };
    else current.to = i;
    const longer =
      best === null ||
      cumulative[current.to] - cumulative[current.from] > cumulative[best.to] - cumulative[best.from] ||
      (cumulative[current.to] - cumulative[current.from] === cumulative[best.to] - cumulative[best.from] &&
        current.to - current.from > best.to - best.from);
    if (longer) best = { from: current.from, to: current.to };
  }
  if (best === null) return abandoned(removedInZones);

  const kept: T[] = [];
  for (let i = best.from; i <= best.to; i++) kept.push({ ...usable[i] });
  return {
    points: kept,
    trimmedStartM: round(cumulative[best.from], 1),
    trimmedEndM: round(Math.max(0, lengthM - cumulative[best.to]), 1),
    removed: points.length - kept.length,
    removedInZones,
    dropped: false,
  };
}

/* ------------------------------------------------------------------ */

/** Réglages du regroupement d'ancrages. */
export interface ZoneSuggestionOptions {
  /** Rayon (m) de regroupement et rayon des zones proposées. Défaut : `ZONE_SUGGESTION_RADIUS_M`. */
  radiusM?: number;
  /** Occurrences minimales pour proposer une zone. Défaut : `ZONE_SUGGESTION_MIN_OCCURRENCES`. */
  minOccurrences?: number;
}

/**
 * Propose des zones privées à partir des ancrages d'un utilisateur (départs et
 * arrivées de ses activités).
 *
 * Un lieu qui revient au moins `minOccurrences` fois dans un rayon `radiusM`
 * est très probablement un domicile, un lieu de travail ou celui d'un proche :
 * il est **proposé**, avec le centre du groupe et le rayon de regroupement.
 * C'est une suggestion soumise à l'utilisateur — ce module ne crée aucune zone
 * et n'en applique aucune d'office (section 35) ; `maskTrace` ne connaît que
 * les zones qu'on lui passe.
 *
 * Algorithme : grille au pas du rayon, puis agglomération gloutonne autour des
 * ancrages les plus entourés. La grille évite le balayage quadratique — tout
 * voisin à moins de `radiusM` se trouve forcément dans l'une des neuf cellules
 * adjacentes — et le tri (densité décroissante, puis latitude, puis longitude)
 * rend le résultat strictement déterministe, y compris à égalité parfaite.
 * Le coût reste linéaire tant que les ancrages sont dispersés ; il ne redevient
 * quadratique qu'à l'intérieur d'un groupe déjà serré, c'est-à-dire là où l'on
 * veut précisément regarder de près.
 */
export function suggestPrivacyZones(
  anchors: readonly LatLng[],
  opts: ZoneSuggestionOptions = {},
): PrivacyZone[] {
  const declaredRadius = opts.radiusM;
  const radiusM =
    declaredRadius === undefined || !Number.isFinite(declaredRadius) || declaredRadius <= 0
      ? ZONE_SUGGESTION_RADIUS_M
      : declaredRadius;
  const minOccurrences = resolveCount(opts.minOccurrences, ZONE_SUGGESTION_MIN_OCCURRENCES);

  const usable: LatLng[] = [];
  for (const anchor of anchors) if (isValidLatLng(anchor)) usable.push({ lat: anchor.lat, lng: anchor.lng });
  if (usable.length < minOccurrences) return [];

  // Pas de grille : un rayon en latitude, un rayon en longitude à la latitude
  // de référence (la première ancre). À l'échelle d'un massif, le cosinus varie
  // de bien moins que la tolérance du regroupement.
  const stepLat = radiusM / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos(toRad(usable[0].lat)));
  const stepLng = radiusM / (METERS_PER_DEG_LAT * cosLat);

  const cells = new Map<string, number[]>();
  const cellRow = (p: LatLng): number => Math.floor(p.lat / stepLat);
  const cellCol = (p: LatLng): number => Math.floor(p.lng / stepLng);
  for (let i = 0; i < usable.length; i++) {
    const key = `${cellRow(usable[i])}:${cellCol(usable[i])}`;
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [i]);
    else bucket.push(i);
  }

  /** Indices des ancrages à moins de `radiusM` de l'ancrage `i`, lui compris. */
  const neighboursOf = (i: number): number[] => {
    const center = usable[i];
    const row = cellRow(center);
    const col = cellCol(center);
    const found: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const bucket = cells.get(`${row + dr}:${col + dc}`);
        if (bucket === undefined) continue;
        for (const j of bucket) {
          if (haversineM(center, usable[j]) <= radiusM) found.push(j);
        }
      }
    }
    // Les cellules sont parcourues dans un ordre fixe, mais les indices d'un
    // même voisinage doivent être croissants pour que le centre calculé ne
    // dépende pas de la disposition de la grille.
    found.sort((a, b) => a - b);
    return found;
  };

  const density = new Array<number>(usable.length);
  for (let i = 0; i < usable.length; i++) density[i] = neighboursOf(i).length;

  const order = usable.map((_, i) => i);
  order.sort(
    (a, b) =>
      density[b] - density[a] ||
      usable[a].lat - usable[b].lat ||
      usable[a].lng - usable[b].lng ||
      a - b,
  );

  const taken = new Array<boolean>(usable.length).fill(false);
  const clusters: { lat: number; lng: number; size: number }[] = [];
  for (const seed of order) {
    if (taken[seed]) continue;
    const members = neighboursOf(seed).filter((j) => !taken[j]);
    if (members.length < minOccurrences) continue;
    let sumLat = 0;
    let sumLng = 0;
    for (const j of members) {
      taken[j] = true;
      sumLat += usable[j].lat;
      sumLng += usable[j].lng;
    }
    clusters.push({ lat: sumLat / members.length, lng: sumLng / members.length, size: members.length });
  }

  clusters.sort((a, b) => b.size - a.size || a.lat - b.lat || a.lng - b.lng);
  // 6 décimales ≈ 11 cm : bien assez pour un centre de zone, et cela évite de
  // traîner les artefacts flottants de la moyenne jusque dans la base.
  return clusters.map((c) => ({ lat: round(c.lat, 6), lng: round(c.lng, 6), radiusM }));
}

/* ------------------------------------------------------------------ */
/* 5. Dégradation volontaire des positions (section 34)                */
/* ------------------------------------------------------------------ */

/**
 * Ramène des positions sur une grille de `gridM` mètres et fusionne les points
 * consécutifs devenus identiques.
 *
 * Sert aux exports et aux visualisations agrégées : une carte de chaleur, un
 * tracé de fréquentation ou un fichier téléchargé n'ont aucun besoin de la
 * précision métrique, et cette précision-là est exactement ce qui permettrait
 * de reconnaître une sortie individuelle. Après passage, une position n'est
 * plus qu'un nœud de grille : il est impossible de remonter à la position
 * exacte, même en connaissant l'algorithme.
 *
 * Le pas est converti en degrés à la latitude de la première position
 * exploitable, et cette même latitude sert pour toute la série : une grille qui
 * changerait de maille en cours de route ne serait plus une grille, et les
 * points consécutifs ne se fusionneraient plus. Un `gridM` nul, négatif ou
 * illisible rend les positions inchangées (seuls les relevés illisibles sont
 * écartés) : dégrader « au hasard » serait pire que ne rien faire.
 *
 * Coût linéaire, une seule passe : cette fonction voit passer des traces
 * entières.
 */
export function coarsenPoints<T extends { lat: number; lng: number }>(
  points: readonly T[],
  gridM: number,
): T[] {
  const usable: T[] = [];
  for (const point of points) if (isValidLatLng(point)) usable.push(point);
  if (usable.length === 0) return [];
  if (!Number.isFinite(gridM) || gridM <= 0) return [...usable];

  const stepLat = gridM / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos(toRad(usable[0].lat)));
  const stepLng = gridM / (METERS_PER_DEG_LAT * cosLat);

  const out: T[] = [];
  let lastLat = Number.NaN;
  let lastLng = Number.NaN;
  for (const point of usable) {
    // `snapToGrid` travaille avec un pas unique : on l'applique une fois par
    // axe, avec le pas correspondant, pour obtenir des mailles carrées au sol.
    const lat = snapToGrid({ lat: point.lat, lng: 0 }, stepLat).lat;
    const lng = snapToGrid({ lat: 0, lng: point.lng }, stepLng).lng;
    if (lat === lastLat && lng === lastLng) continue;
    lastLat = lat;
    lastLng = lng;
    out.push(Object.assign({}, point, { lat, lng }));
  }
  return out;
}
