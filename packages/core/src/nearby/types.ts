/**
 * « Randonnées autour de vous » — contrat partagé.
 *
 * L'idée directrice de l'écran d'accueil (sections 34 et 35 du cahier des
 * charges « Waze de la montagne ») : l'utilisateur ne cherche pas une
 * randonnée, **elle vient à lui**. L'application comprend immédiatement où il
 * est et ce qu'il peut faire autour de lui.
 *
 * Deux règles que tout ce module fait respecter :
 *
 * 1. **Deux distances, jamais confondues** (section 19). L'approche — de vous
 *    au départ — et la longueur de la randonnée sont deux nombres différents,
 *    portés par deux champs différents, affichés différemment. « À 4 km de
 *    vous » n'est pas « randonnée de 9,8 km ».
 * 2. **Le silence n'est pas une absence** (sections 20 et 21). Une fréquentation
 *    inconnue vaut `null`, jamais zéro : nous ne savons pas encore, ce qui ne
 *    veut pas dire que personne n'y passe.
 */
import type { LatLng } from "../types";
import type { ActivityMode, TrailSource } from "../navigation/types";
import type { FrequentationLevel } from "../network/types";

/** Forme d'un itinéraire (section 37) : elle change la façon de le lire. */
export type TrailShape =
  | "loop" // boucle : on revient au départ
  | "out_and_back" // aller-retour : la distance annoncée compte les deux sens
  | "linear"; // itinéraire linéaire : l'arrivée est ailleurs

/** Critères de classement de la liste (section 13). */
export type NearbySort =
  | "closest" // défaut : départ le plus proche de moi
  | "popular"
  | "easiest"
  | "shortest"
  | "quietest";

/** Difficulté, alignée sur celle des itinéraires de la base. */
export type TrailDifficulty = "easy" | "moderate" | "hard" | "expert";

/**
 * Point de départ retenu pour un itinéraire. Quand plusieurs existent, c'est
 * le plus proche de l'utilisateur qui est proposé (section 37).
 */
export interface Trailhead {
  point: LatLng;
  /** Distance à vol d'oiseau entre l'utilisateur et ce départ (m). */
  distanceM: number;
  /** Extrémité de la géométrie retenue : début ou fin. */
  end: "start" | "finish";
}

/**
 * Une randonnée telle qu'elle apparaît sur l'écran d'accueil.
 *
 * `approachM` et `lengthM` sont les deux distances de la section 19 ; leurs
 * noms sont volontairement dissemblables pour qu'une confusion se voie.
 */
export interface NearbyTrail {
  id: string;
  name: string;
  activity: ActivityMode | "mixed";
  difficulty: TrailDifficulty;
  shape: TrailShape;

  /** DISTANCE 1 — de vous au départ (m). « À 4,2 km de vous ». */
  approachM: number;
  /** DISTANCE 2 — longueur de la randonnée (m). « Randonnée de 9,4 km ». */
  lengthM: number;

  /** Durée de marche estimée (ms). */
  durationMs: number;
  /** Vrai quand la durée vient de passages réellement observés (section 25 du moteur). */
  durationObserved: boolean;

  elevationGainM: number;
  elevationLossM: number | null;

  /** Départ retenu (le plus proche). */
  trailhead: Trailhead;

  /** Fréquentation récente, `null` tant qu'on ne sait pas (section 21). */
  frequentation: FrequentationLevel | null;
  /** Passages du jour, `null` si inconnu — jamais 0 par défaut. */
  passagesToday: number | null;
  /**
   * Popularité 0..100, `null` tant qu'aucun segment publiable ne la porte.
   * Nullable pour la même raison que le reste : un itinéraire dont on ne sait
   * rien ne doit pas être indistinguable d'un itinéraire mesuré à zéro — le
   * classement « plus populaires » s'en trouverait faussé.
   */
  popularityScore: number | null;

  /** Signalements actifs sur l'itinéraire (section 20). */
  /**
   * Provenance de l'itinéraire. `seed` = démonstration : la fiche le dit, et
   * l'application ne propose pas de la suivre.
   */
  source: TrailSource | null;
  /** Le tracé décrit un chemin réel et peut être dessiné. */
  drawable: boolean;
  /** Un guidage peut être lancé dessus (couverture du réseau suffisante). */
  navigable: boolean;
  /** Dessinable mais incomplètement rattaché : « Tracé partiellement vérifié ». */
  partial: boolean;
  activeReports: number;
  /** Phrase courte prête à afficher (« Battue signalée »), ou null. */
  reportHint: string | null;
}

/** Réponse de la recherche de proximité : elle dit aussi ce qu'elle a cherché. */
export interface NearbyResult {
  trails: NearbyTrail[];
  /** Rayon finalement retenu (m) après élargissement éventuel (section 18). */
  radiusM: number;
  /** Le rayon a-t-il dû être élargi faute de résultats ? */
  widened: boolean;
  sort: NearbySort;
  /** Phrase prête à afficher quand il n'y a rien, ou null. */
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* Seuils partagés                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rayons successifs (m) de la recherche adaptative (section 18) : on commence
 * serré, on n'élargit que si la zone est pauvre en itinéraires. Chercher large
 * d'emblée noierait une vallée dense sous des départs à 40 km.
 */
export const NEARBY_RADII_M: readonly number[] = [10_000, 25_000, 50_000];

/** En dessous de ce nombre de résultats, on élargit au rayon suivant. */
export const NEARBY_MIN_RESULTS = 5;

/** Nombre maximal d'itinéraires renvoyés. */
export const NEARBY_MAX_RESULTS = 30;

/** Nombre de cartes présentées d'emblée sous la barre de recherche. */
export const NEARBY_PREVIEW_COUNT = 5;

/** Écart (m) sous lequel les deux extrémités d'un tracé sont le même point : c'est une boucle. */
export const LOOP_TOLERANCE_M = 150;
