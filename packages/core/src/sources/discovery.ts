/**
 * Découverte des sources de traces existantes : préparer la recherche, lire ce
 * qu'elle ramène, et ne jamais confondre « trouvé » avec « autorisé ».
 *
 * Sections du cahier des charges « traces GPX » couvertes ici :
 *
 *  - **1. Chercher ce qui existe déjà.** `DISCOVERY_TERMS` fige les termes de
 *    recherche du cahier des charges et `buildDiscoveryQueries` les croise avec
 *    le territoire visé (nom, alias, rattachements) pour produire des requêtes
 *    ordonnées, du plus précis au plus large.
 *  - **2. Les sources institutionnelles et ouvertes d'abord.** `classifySource`
 *    devine la famille d'une source à partir de son URL et de son titre, et
 *    `DISCOVERY_SOURCE_PRIORITY` dit dans quel ordre on s'y intéresse : données
 *    ouvertes, institutions, Geotrek et OpenStreetMap avant les plateformes.
 *  - **3. Ne pas collecter chez qui ne le permet pas.** `parseRobotsTxt` et
 *    `robotsAllows` implémentent un vrai analyseur robots.txt (groupes, jokers
 *    `*` et `$`, règle la plus longue gagnante) ; `robotsCrawlDelay` ajoute un
 *    plancher de politesse. C'est une barrière, pas une formalité.
 *  - **5. Identifier une ressource sans la dupliquer.** `resourceId` dérive un
 *    identifiant stable de l'URL normalisée : relancer une campagne ne crée pas
 *    une deuxième fois la même ressource.
 *  - **16. Savoir où l'on en est.** `summarizeDiscovery` compte ce qui a été
 *    trouvé, par statut de droits et par format — et rien d'autre.
 *  - **23. Ouvrir un territoire.** `territoryPlan` énumère les huit étapes de
 *    l'assistant, dans l'ordre, en disant lesquelles ont besoin du réseau.
 *
 * Trois partis pris traversent le fichier :
 *
 * 1. **Ce module ne touche à rien.** Aucun appel réseau, aucun accès disque,
 *    aucun DOM, aucun aléa : il *prépare* des requêtes et *interprète* des
 *    textes déjà récupérés par le serveur. `gpxHints` analyse une page en
 *    texte brut, sans analyseur HTML.
 * 2. **Une heuristique se présente comme telle.** `classifySource` renvoie une
 *    `confidence` qui ne vaut jamais 1 : aucun domaine n'est « vérifié » ici,
 *    et un marqueur dans une URL ne prouve rien. La vérification des droits est
 *    un travail humain, fait ailleurs (section 5).
 * 3. **Trouver n'est pas pouvoir.** Un lien `.gpx` et une phrase
 *    « Télécharger GPX » disent qu'un fichier existe, jamais qu'on a le droit de
 *    le réutiliser. Rien dans ce fichier ne produit un statut `approved`.
 *
 * Toutes les sorties sont déterministes : les tableaux construits par produit
 * cartésien sont triés explicitement, ceux qui suivent un document (liens d'une
 * page, groupes d'un robots.txt, plans d'ouverture) conservent l'ordre du
 * document, qui ne dépend que de l'entrée.
 */
import { hashString } from "../geo";
import { decodeXml } from "../navigation/gpx";
import type { ActivityMode } from "../navigation/types";
import type {
  DiscoveredResource,
  DiscoveryQuery,
  ReuseStatus,
  SourceType,
  Territory,
  TerritoryStep,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages produit (seuils documentés, pas des nombres perdus)        */
/* ------------------------------------------------------------------ */

/** Priorité des termes qui rapportent le plus de sources exploitables. */
export const DISCOVERY_PRIORITY_CORE = 1;

/** Priorité des formulations d'intention (« télécharger », « trace »). */
export const DISCOVERY_PRIORITY_HIGH = 0.9;

/** Priorité des termes ciblant une activité précise ou un vocabulaire moins courant. */
export const DISCOVERY_PRIORITY_MEDIUM = 0.7;

/** Priorité des termes très larges : ils ramènent beaucoup de bruit. */
export const DISCOVERY_PRIORITY_BROAD = 0.5;

/** Priorité d'un terme fourni par l'appelant : utile, mais non éprouvé. */
export const DISCOVERY_CUSTOM_TERM_PRIORITY = 0.6;

/** Poids du nom du territoire : le qualificatif le plus précis dont on dispose. */
export const DISCOVERY_PLACE_WEIGHT_NAME = 1;

/**
 * Poids d'un alias (massif, vallée, sommet, refuge). Un alias est précis mais
 * parfois ambigu (« Pozzi » existe ailleurs) : il passe juste après le nom.
 */
export const DISCOVERY_PLACE_WEIGHT_ALIAS = 0.85;

/** Poids du rattachement le plus proche (le dernier parent de la chaîne). */
export const DISCOVERY_PLACE_WEIGHT_PARENT_NEAR = 0.6;

/** Poids du rattachement le plus large (« France ») : beaucoup de bruit. */
export const DISCOVERY_PLACE_WEIGHT_PARENT_FAR = 0.25;

/**
 * Nombre de requêtes produites par défaut. 40 couvre les dix termes sur les
 * quatre qualificatifs les plus précis d'un territoire : au-delà, on paie des
 * requêtes larges qui ramènent surtout du bruit.
 */
export const DISCOVERY_DEFAULT_QUERY_LIMIT = 40;

/**
 * Nombre maximal de liens rapportés par `gpxHints`. Une page d'index peut
 * aligner des milliers de fichiers : on en garde de quoi décider, pas de quoi
 * saturer la mémoire d'un lot de découverte.
 */
export const DISCOVERY_MAX_LINKS = 200;

/**
 * Nombre de caractères réellement inspectés dans une page ou un corps de texte.
 * Au-delà, on tronque : les indices utiles (liens de téléchargement, mention de
 * licence) se trouvent dans les premières centaines de milliers de caractères,
 * et une page de 20 Mo ne doit pas immobiliser un lot.
 */
export const DISCOVERY_MAX_SCANNED_CHARS = 500_000;

/** Jeton d'agent de notre collecteur, tel qu'un robots.txt le nommerait. */
export const DISCOVERY_USER_AGENT = "MountainLiveBot";

/**
 * Délai (s) minimal entre deux requêtes vers un même hôte, même quand le
 * robots.txt n'en impose aucun. On ne descend jamais sous ce plancher : un site
 * de collectivité n'a pas à payer notre impatience.
 */
export const DISCOVERY_POLITE_CRAWL_DELAY_S = 5;

/** Préfixe des identifiants de ressource produits par `resourceId`. */
export const DISCOVERY_RESOURCE_ID_PREFIX = "res_";

/** Libellé employé quand un territoire n'a ni nom ni identifiant exploitable. */
export const DISCOVERY_UNNAMED_TERRITORY = "territoire sans nom";

/**
 * Paramètres de suivi retirés de l'URL avant d'en dériver un identifiant : ils
 * varient d'un lien à l'autre sans désigner une autre ressource. Tout ce qui
 * commence par `utm_` est retiré en plus de cette liste.
 */
export const DISCOVERY_TRACKING_PARAMS: readonly string[] = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "yclid",
];

/** Extensions de fichiers de trace repérées dans une page (section 1). */
export const DISCOVERY_TRACE_EXTENSIONS: readonly string[] = ["gpx", "kml", "geojson"];

/** Formats possibles d'une ressource découverte, pour un bilan de forme stable. */
export const DISCOVERY_RESOURCE_FORMATS: readonly DiscoveredResource["format"][] = [
  "gpx",
  "kml",
  "geojson",
  "api",
  "unknown",
];

/** Statuts de réutilisation, pour un bilan de forme stable (section 16). */
export const DISCOVERY_REUSE_STATUSES: readonly ReuseStatus[] = [
  "approved",
  "review_required",
  "forbidden",
];

/* ------------------------------------------------------------------ */
/* Outils internes                                                     */
/* ------------------------------------------------------------------ */

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Minuscules, accents retirés, espaces normalisés : la forme sous laquelle on
 * compare des textes venus de sources hétérogènes (« Randonnée » = « randonnee »).
 */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Libellé nettoyé (espaces normalisés), casse d'origine conservée. */
function cleanLabel(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Comparaison de chaînes par unités de code : indépendante de la locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Tableau sûr : une entrée absente ou mal formée (donnée désérialisée, appel
 * depuis du JavaScript non typé) vaut liste vide plutôt qu'une exception.
 */
function safeArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/** Texte tronqué à la longueur inspectée, pour borner le coût d'une analyse. */
function capped(value: string): string {
  return value.length > DISCOVERY_MAX_SCANNED_CHARS ? value.slice(0, DISCOVERY_MAX_SCANNED_CHARS) : value;
}

/**
 * Marqueur cherché tel quel dans un texte replié : convient aux signatures
 * techniques distinctives (« geotrek », « /api/v2/trek », « gpx ») qui restent
 * reconnaissables même collées à d'autres mots dans un nom de domaine.
 */
function hasMarker(haystack: string, markers: readonly string[]): boolean {
  for (const marker of markers) {
    if (marker.length > 0 && haystack.includes(marker)) return true;
  }
  return false;
}

/**
 * Marqueur cherché **en mots entiers** : indispensable aux indices courts et
 * courants (« ign » ne doit pas se déclencher sur « design », « club » sur
 * « clubbing »). Le texte est supposé déjà découpé en mots et encadré d'espaces.
 */
function hasPhrase(paddedWords: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    if (phrase.length > 0 && paddedWords.includes(` ${phrase} `)) return true;
  }
  return false;
}

/** Texte replié, séparateurs remplacés par des espaces, encadré d'espaces. */
function toPaddedWords(value: string): string {
  return ` ${foldText(value.replace(/[^\p{L}\p{N}]+/gu, " "))} `;
}

/* ------------------------------------------------------------------ */
/* 1. Termes et requêtes de recherche (section 1)                      */
/* ------------------------------------------------------------------ */

/**
 * Les termes de recherche du cahier des charges (section 1), avec l'activité
 * qu'ils visent et leur priorité.
 *
 * L'ordre de ce tableau n'a pas d'importance : `buildDiscoveryQueries` trie par
 * priorité. Les termes larges (« chemin GPX ») sont conservés parce qu'ils
 * ramènent parfois la seule source d'une vallée, mais ils passent en dernier.
 */
export const DISCOVERY_TERMS: readonly {
  term: string;
  activity: ActivityMode | "all";
  priority: number;
}[] = [
  { term: "randonnée GPX", activity: "hiking", priority: DISCOVERY_PRIORITY_CORE },
  { term: "trace GPX randonnée", activity: "hiking", priority: DISCOVERY_PRIORITY_HIGH },
  { term: "télécharger GPX randonnée", activity: "hiking", priority: DISCOVERY_PRIORITY_HIGH },
  { term: "sentier GPX", activity: "all", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "itinéraire randonnée GPX", activity: "hiking", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "parcours pédestre GPX", activity: "hiking", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "trail GPX", activity: "trail", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "randonnée équestre GPX", activity: "equestrian", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "VTT GPX", activity: "mtb", priority: DISCOVERY_PRIORITY_MEDIUM },
  { term: "chemin GPX", activity: "all", priority: DISCOVERY_PRIORITY_BROAD },
];

/** Options de construction des requêtes de découverte. */
export interface DiscoveryQueryOptions {
  /**
   * Activités visées. Un terme « all » convient à toutes et reste toujours
   * retenu. Une liste vide n'exprime aucune contrainte : rien n'est filtré.
   */
  activities?: readonly (ActivityMode | "all")[];
  /**
   * Termes imposés. Un terme connu du catalogue garde son activité et sa
   * priorité ; un terme inédit est accepté avec `DISCOVERY_CUSTOM_TERM_PRIORITY`
   * et l'activité « all ». Une liste vide retombe sur le catalogue complet.
   */
  terms?: readonly string[];
  /** Employer aussi les alias du territoire (défaut : oui). */
  includeAliases?: boolean;
  /**
   * Nombre maximal de requêtes. Zéro ou négatif : aucune requête (choix
   * explicite). Valeur illisible : `DISCOVERY_DEFAULT_QUERY_LIMIT`.
   */
  limit?: number;
}

/** Terme retenu pour la construction des requêtes. */
interface ResolvedTerm {
  term: string;
  activity: ActivityMode | "all";
  priority: number;
}

/** Qualificatif géographique retenu, avec son poids de spécificité. */
interface PlaceCandidate {
  place: string;
  weight: number;
}

/** Limite demandée, ramenée à une valeur exploitable. */
function resolveLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DISCOVERY_DEFAULT_QUERY_LIMIT;
  return requested <= 0 ? 0 : Math.floor(requested);
}

/** Termes retenus : catalogue ou liste imposée, puis filtre d'activité. */
function resolveTerms(opts: DiscoveryQueryOptions): ResolvedTerm[] {
  const requested = opts.terms;
  let base: ResolvedTerm[];
  if (requested && requested.length > 0) {
    base = [];
    const seen = new Set<string>();
    for (const raw of requested) {
      const term = cleanLabel(raw);
      if (term.length === 0) continue;
      const key = foldText(term);
      if (seen.has(key)) continue;
      seen.add(key);
      const known = DISCOVERY_TERMS.find((candidate) => foldText(candidate.term) === key);
      base.push(
        known
          ? { term: known.term, activity: known.activity, priority: known.priority }
          : { term, activity: "all", priority: DISCOVERY_CUSTOM_TERM_PRIORITY },
      );
    }
  } else {
    base = DISCOVERY_TERMS.map((t) => ({ term: t.term, activity: t.activity, priority: t.priority }));
  }
  const activities = opts.activities;
  if (!activities || activities.length === 0) return base;
  return base.filter((t) => t.activity === "all" || activities.includes(t.activity));
}

/**
 * Qualificatifs géographiques du territoire, du plus précis au plus large.
 *
 * Un alias est qualifié par le nom du territoire quand il ne le contient pas
 * déjà : « Pozzi » seul désigne trop d'endroits, « Pozzi Bastelica » un seul.
 * Les parents sont pondérés par leur rang : `parents` va du plus large au plus
 * précis, donc le dernier pèse `DISCOVERY_PLACE_WEIGHT_PARENT_NEAR`.
 */
function placeCandidates(territory: Territory, includeAliases: boolean): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  const name = cleanLabel(territory.name);
  if (name.length > 0) out.push({ place: name, weight: DISCOVERY_PLACE_WEIGHT_NAME });

  if (includeAliases) {
    const foldedName = foldText(name);
    for (const rawAlias of safeArray(territory.aliases)) {
      const alias = cleanLabel(rawAlias);
      if (alias.length === 0) continue;
      const needsQualifier = foldedName.length > 0 && !foldText(alias).includes(foldedName);
      out.push({
        place: needsQualifier ? `${alias} ${name}` : alias,
        weight: DISCOVERY_PLACE_WEIGHT_ALIAS,
      });
    }
  }

  const parents = safeArray(territory.parents)
    .map(cleanLabel)
    .filter((p) => p.length > 0);
  const span = DISCOVERY_PLACE_WEIGHT_PARENT_NEAR - DISCOVERY_PLACE_WEIGHT_PARENT_FAR;
  for (let i = 0; i < parents.length; i++) {
    const ratio = parents.length <= 1 ? 1 : i / (parents.length - 1);
    out.push({ place: parents[i], weight: DISCOVERY_PLACE_WEIGHT_PARENT_FAR + span * ratio });
  }
  return out;
}

/**
 * Requêtes de recherche pour un territoire : produit des termes par les
 * qualificatifs géographiques, dédoublonné, trié et borné (section 1).
 *
 * L'ordre est celui de l'exploration : priorité décroissante d'abord (donc les
 * requêtes les plus spécifiques, « randonnée GPX Pozzi Bastelica », avant les
 * plus larges, « randonnée GPX Corse »), puis ordre alphabétique de la requête
 * pour que deux exécutions donnent exactement la même liste. Deux qualificatifs
 * identiques (alias répété, alias égal au nom, parent égal au nom) ne produisent
 * qu'une requête, celle de plus forte priorité.
 *
 * Rien n'est propre à un territoire donné : un territoire sans alias, sans
 * parent ou sans nom ne fait pas échouer la construction, il produit moins de
 * requêtes — éventuellement aucune.
 */
export function buildDiscoveryQueries(
  territory: Territory,
  opts: DiscoveryQueryOptions = {},
): DiscoveryQuery[] {
  const limit = resolveLimit(opts.limit);
  if (limit === 0) return [];

  const terms = resolveTerms(opts);
  const places = placeCandidates(territory, opts.includeAliases !== false);
  if (terms.length === 0 || places.length === 0) return [];

  // Dédoublonnage par requête repliée : on garde la variante la mieux classée.
  const byQuery = new Map<string, DiscoveryQuery>();
  for (const term of terms) {
    for (const place of places) {
      const query = `${term.term} ${place.place}`;
      const key = foldText(query);
      const candidate: DiscoveryQuery = {
        query,
        term: term.term,
        place: place.place,
        activity: term.activity,
        priority: round(term.priority * place.weight, 4),
      };
      const existing = byQuery.get(key);
      if (!existing || candidate.priority > existing.priority) byQuery.set(key, candidate);
    }
  }

  const out = [...byQuery.values()];
  out.sort((a, b) => b.priority - a.priority || compareStrings(a.query, b.query));
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* 2. Classement heuristique d'une source (section 2)                  */
/* ------------------------------------------------------------------ */

/**
 * Ordre d'intérêt des familles de sources (section 2) : les données ouvertes et
 * les institutions d'abord, parce que leurs conditions de réutilisation sont
 * publiées et vérifiables ; les plateformes en dernier, parce que leurs
 * conditions interdisent le plus souvent la reprise des traces.
 */
export const DISCOVERY_SOURCE_PRIORITY: Record<SourceType, number> = {
  open_data: 1,
  institutional: 0.95,
  geotrek: 0.9,
  osm: 0.85,
  partner_api: 0.6,
  club: 0.45,
  platform: 0.35,
  user_upload: 0.2,
};

/**
 * Confiance d'un classement appuyé sur une signature technique sans ambiguïté
 * (domaine en `.gouv.fr`, chemin d'API Geotrek). Jamais 1 : une URL décrit un
 * serveur, pas des droits.
 */
export const DISCOVERY_CONFIDENCE_CERTAIN = 0.9;

/** Confiance d'un classement appuyé sur un indice dans le domaine ou le chemin. */
export const DISCOVERY_CONFIDENCE_LIKELY = 0.65;

/** Confiance d'un classement appuyé seulement sur le titre ou le texte de la page. */
export const DISCOVERY_CONFIDENCE_WEAK = 0.4;

/** Confiance d'un classement sans aucun indice : c'est un « je ne sais pas ». */
export const DISCOVERY_CONFIDENCE_NONE = 0.05;

/**
 * Indices d'une source institutionnelle : administration, collectivité,
 * gestionnaire d'espace naturel (section 2).
 *
 * Cherchés **en mots entiers** dans le domaine, le chemin, le titre : ce sont
 * des mots courts et courants, un test de sous-chaîne classerait « design » en
 * institution. Aucun de ces indices ne vaut vérification : il oriente la revue
 * humaine, il ne la remplace pas.
 */
export const INSTITUTIONAL_HINTS: readonly string[] = [
  "gouv",
  "prefecture",
  "departement",
  "departementale",
  "conseil departemental",
  "conseil regional",
  "region",
  "mairie",
  "commune",
  "communaute de communes",
  "communaute d agglomeration",
  "agglomeration",
  "syndicat mixte",
  "office de tourisme",
  "parc national",
  "parc naturel",
  "parc naturel regional",
  "pnr",
  "reserve naturelle",
  "conservatoire",
  "collectivite",
  "onf",
  "ign",
];

/** Indices d'un portail de données ouvertes (catalogue, jeu de données, API). */
export const DISCOVERY_OPEN_DATA_HINTS: readonly string[] = [
  "data.gouv.fr",
  "datagouv",
  "opendata",
  "open data",
  "donnees ouvertes",
  "data ouverte",
  "opendatasoft",
  "ckan",
  "dataset",
  "jeu de donnees",
  "catalogue de donnees",
  "geocatalogue",
  "geoserver",
];

/** Indices d'une instance Geotrek (API publique documentée). */
export const DISCOVERY_GEOTREK_HINTS: readonly string[] = [
  "geotrek",
  "/api/v2/trek",
  "/api/v2/touristiccontent",
  "/api/trekking",
];

/** Indices d'une source OpenStreetMap (données brutes ou service dérivé). */
export const DISCOVERY_OSM_HINTS: readonly string[] = [
  "openstreetmap",
  "overpass",
  "/api/interpreter",
  "osm.org",
  "geofabrik",
  ".osm.pbf",
];

/** Indices d'un club, d'une fédération ou d'une association. */
export const DISCOVERY_CLUB_HINTS: readonly string[] = [
  "club",
  "federation",
  "association",
  "asso",
  "amicale",
  "comite",
  "ligue",
];

/** Indices d'une plateforme de randonnée, de trail, de VTT ou d'équitation. */
export const DISCOVERY_PLATFORM_HINTS: readonly string[] = [
  "rando",
  "randonnee",
  "trail",
  "vtt",
  "gpx",
  "trace",
  "topo",
  "itineraire",
  "sentier",
  "balade",
  "circuit",
  "parcours",
  "outdoor",
  "hiking",
  "cyclo",
  "bike",
];

/** Classement heuristique d'une source : famille, ordre d'intérêt, confiance. */
export interface SourceClassification {
  type: SourceType;
  /** Ordre d'intérêt de la famille (`DISCOVERY_SOURCE_PRIORITY`), 0..1. */
  priority: number;
  /** Confiance dans le classement lui-même, 0..1, jamais 1. */
  confidence: number;
}

/** URL analysée, ou `null` si elle est illisible. */
function parseUrl(raw: string): URL | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Classement assemblé à partir d'une famille et d'une confiance. */
function classification(type: SourceType, confidence: number): SourceClassification {
  return { type, priority: DISCOVERY_SOURCE_PRIORITY[type], confidence };
}

/**
 * Devine la famille d'une source à partir de son URL, éventuellement de son
 * titre et de son texte (section 2).
 *
 * C'est une **heuristique**, et rien d'autre : elle lit des marqueurs
 * (`data.gouv.fr`, `/api/v2/trek`, « parc national », `openstreetmap`) dont
 * aucun n'établit ni l'identité ni les droits de la source. La `confidence`
 * renvoyée dit à quel point le marqueur est distinctif ; elle ne dépasse jamais
 * `DISCOVERY_CONFIDENCE_CERTAIN`.
 *
 * Ordre d'examen : données ouvertes, Geotrek, OpenStreetMap, institution, club,
 * plateforme — d'abord sur l'URL (indices forts), puis sur le titre et le texte
 * (indices faibles). Sans aucun indice, la réponse est `platform` avec une
 * confiance quasi nulle : c'est l'hypothèse la moins permissive en matière de
 * droits, pas une conclusion. `partner_api` et `user_upload` ne sortent jamais
 * d'ici : ils viennent du registre, pas d'une devinette.
 */
export function classifySource(
  url: string,
  hints: { title?: string | null; body?: string | null } = {},
): SourceClassification {
  const parsed = parseUrl(url);

  if (parsed) {
    const host = parsed.hostname.toLowerCase();
    // Séparateurs de mots neutralisés, « / » et « . » conservés : les chemins
    // d'API restent reconnaissables et « donnees-ouvertes » devient une phrase.
    const raw = foldText(`${host}${parsed.pathname}${parsed.search}`.replace(/[-_+]/g, " "));
    const words = toPaddedWords(`${host} ${parsed.pathname} ${parsed.search}`);

    if (host === "data.gouv.fr" || host.endsWith(".data.gouv.fr")) {
      return classification("open_data", DISCOVERY_CONFIDENCE_CERTAIN);
    }
    if (hasMarker(raw, DISCOVERY_OPEN_DATA_HINTS)) {
      return classification("open_data", DISCOVERY_CONFIDENCE_LIKELY);
    }
    if (hasMarker(raw, DISCOVERY_GEOTREK_HINTS)) {
      const strong = raw.includes("/api/v2/trek") || raw.includes("/api/trekking");
      return classification("geotrek", strong ? DISCOVERY_CONFIDENCE_CERTAIN : DISCOVERY_CONFIDENCE_LIKELY);
    }
    if (hasMarker(raw, DISCOVERY_OSM_HINTS)) {
      const strong = host.includes("openstreetmap") || host.includes("overpass");
      return classification("osm", strong ? DISCOVERY_CONFIDENCE_CERTAIN : DISCOVERY_CONFIDENCE_LIKELY);
    }
    if (host === "gouv.fr" || host.endsWith(".gouv.fr")) {
      return classification("institutional", DISCOVERY_CONFIDENCE_CERTAIN);
    }
    if (hasPhrase(words, INSTITUTIONAL_HINTS)) {
      return classification("institutional", DISCOVERY_CONFIDENCE_LIKELY);
    }
    if (hasPhrase(words, DISCOVERY_CLUB_HINTS)) {
      return classification("club", DISCOVERY_CONFIDENCE_LIKELY);
    }
    if (hasMarker(raw, DISCOVERY_PLATFORM_HINTS)) {
      return classification("platform", DISCOVERY_CONFIDENCE_LIKELY);
    }
  }

  const title = cleanLabel(hints.title);
  const body = capped(cleanLabel(hints.body));
  if (title.length > 0 || body.length > 0) {
    const text = foldText(`${title} ${body}`);
    const textWords = toPaddedWords(`${title} ${body}`);
    if (hasMarker(text, DISCOVERY_OPEN_DATA_HINTS)) {
      return classification("open_data", DISCOVERY_CONFIDENCE_WEAK);
    }
    if (hasMarker(text, DISCOVERY_GEOTREK_HINTS)) {
      return classification("geotrek", DISCOVERY_CONFIDENCE_WEAK);
    }
    if (hasMarker(text, DISCOVERY_OSM_HINTS)) {
      return classification("osm", DISCOVERY_CONFIDENCE_WEAK);
    }
    if (hasPhrase(textWords, INSTITUTIONAL_HINTS)) {
      return classification("institutional", DISCOVERY_CONFIDENCE_WEAK);
    }
    if (hasPhrase(textWords, DISCOVERY_CLUB_HINTS)) {
      return classification("club", DISCOVERY_CONFIDENCE_WEAK);
    }
    if (hasMarker(text, DISCOVERY_PLATFORM_HINTS)) {
      return classification("platform", DISCOVERY_CONFIDENCE_WEAK);
    }
  }

  return classification("platform", DISCOVERY_CONFIDENCE_NONE);
}

/* ------------------------------------------------------------------ */
/* 3. Indices laissés par une page (section 1)                         */
/* ------------------------------------------------------------------ */

/** Formulations annonçant un fichier de trace téléchargeable. */
export const DISCOVERY_GPX_PHRASES: readonly string[] = [
  "telecharger gpx",
  "telecharger le gpx",
  "telecharger la trace",
  "telecharger l itineraire",
  "telecharger le fichier",
  "download gpx",
  "export gpx",
  "exporter gpx",
  "exporter en gpx",
  "gpx download",
  "fichier gpx",
  "format gpx",
  "trace gpx",
];

/** Formulations annonçant un accès programmatique aux données. */
export const DISCOVERY_API_PHRASES: readonly string[] = [
  "api gpx",
  "gpx api",
  "api rest",
  "api publique",
  "api ouverte",
  "documentation api",
  "web service",
  "/api/",
  "api v2",
  "endpoint",
];

/** Formulations signalant une mention de licence ou de conditions d'usage. */
export const DISCOVERY_LICENCE_PHRASES: readonly string[] = [
  "licence",
  "license",
  "creative commons",
  "cc by",
  "cc0",
  "odbl",
  "open database license",
  "licence ouverte",
  "etalab",
  "domaine public",
  "droits d usage",
  "droits de reutilisation",
  "conditions d utilisation",
  "conditions generales",
  "mentions legales",
  "copyright",
  "tous droits reserves",
];

/** Ce qu'une page laisse voir d'un fichier de trace, sans rien promettre. */
export interface GpxPageHints {
  /**
   * Liens vers un fichier `.gpx`, `.kml` ou `.geojson`, **tels quels** : un lien
   * relatif reste relatif, la résolution d'URL appartient à l'appelant. Ordre
   * d'apparition dans la page, doublons exacts retirés.
   */
  links: string[];
  mentionsGpx: boolean;
  mentionsApi: boolean;
  mentionsLicence: boolean;
}

/**
 * Expression des liens de trace, construite depuis `DISCOVERY_TRACE_EXTENSIONS`.
 *
 * Avant l'extension, « = » est exclu pour ne pas avaler le `href=` d'un attribut
 * non quoté ; après le « ? », il est autorisé, sans quoi une URL à paramètres
 * serait tronquée au premier « = ».
 */
function traceLinkPattern(): RegExp {
  const extensions = DISCOVERY_TRACE_EXTENSIONS.join("|");
  return new RegExp(
    `[^\\s"'<>()\\[\\]{},;=]+\\.(?:${extensions})(?![a-z0-9])(?:\\?[^\\s"'<>()\\[\\]{},;]*)?`,
    "gi",
  );
}

/**
 * Indices de traces dans une page déjà récupérée (section 1).
 *
 * Analyse **textuelle** et volontairement tolérante : pas de DOM, pas
 * d'analyseur HTML, donc rien ne casse sur un document malformé, tronqué ou qui
 * n'est pas du HTML. Les entités XML sont décodées avant la recherche pour que
 * `trace.gpx?a=1&amp;b=2` ressorte entier.
 *
 * Attention au contresens que ce module refuse de commettre : `mentionsGpx` et
 * un lien `.gpx` disent qu'un fichier existe, **jamais** qu'on a le droit de le
 * réutiliser (section 3). `mentionsLicence` signale seulement qu'une licence est
 * évoquée quelque part — elle reste à lire.
 */
export function gpxHints(html: string): GpxPageHints {
  const empty: GpxPageHints = {
    links: [],
    mentionsGpx: false,
    mentionsApi: false,
    mentionsLicence: false,
  };
  if (typeof html !== "string" || html.length === 0) return empty;

  const source = decodeXml(capped(html).replace(/&nbsp;/gi, " "));

  const links: string[] = [];
  const seen = new Set<string>();
  const pattern = traceLinkPattern();
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null && links.length < DISCOVERY_MAX_LINKS) {
    const link = match[0];
    if (!seen.has(link)) {
      seen.add(link);
      links.push(link);
    }
    match = pattern.exec(source);
  }

  // Texte replié : balises remplacées par des espaces, accents retirés.
  const text = foldText(
    source
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
  // Les formulations d'API et de licence peuvent aussi n'exister que dans une
  // URL (« /api/ ») : on cherche donc aussi dans la source repliée.
  const foldedSource = foldText(source);

  const gpxLinkPresent = links.some((link) => /\.gpx(?![a-z0-9])/i.test(link));

  return {
    links,
    mentionsGpx: gpxLinkPresent || hasMarker(text, DISCOVERY_GPX_PHRASES),
    mentionsApi: hasMarker(text, DISCOVERY_API_PHRASES) || hasMarker(foldedSource, DISCOVERY_API_PHRASES),
    mentionsLicence: hasMarker(text, DISCOVERY_LICENCE_PHRASES),
  };
}

/* ------------------------------------------------------------------ */
/* 4. robots.txt (section 3)                                           */
/* ------------------------------------------------------------------ */

/** Une directive `Allow` ou `Disallow` d'un groupe robots.txt. */
export interface RobotsRule {
  /** `true` pour `Allow`, `false` pour `Disallow`. */
  allow: boolean;
  /** Motif tel qu'écrit dans le fichier (jokers `*` et `$` conservés). */
  path: string;
}

/** Groupe robots.txt : un ou plusieurs agents, et les règles qui les visent. */
export interface RobotsGroup {
  /** Agents du groupe, repliés en minuscules (« * » compris). */
  agents: string[];
  rules: RobotsRule[];
  /** `Crawl-delay` déclaré pour ce groupe, en secondes. */
  crawlDelay: number | null;
}

/** Contenu exploitable d'un robots.txt. */
export interface RobotsRules {
  /** Groupes dans l'ordre du fichier. */
  groups: RobotsGroup[];
  /** `Crawl-delay` du groupe générique `*`, en secondes, si déclaré. */
  crawlDelay: number | null;
  /** URL de sitemap déclarées, telles quelles, dans l'ordre du fichier. */
  sitemaps: string[];
}

/** robots.txt vide : tout est permis, faute de règle connue. */
function emptyRobots(): RobotsRules {
  return { groups: [], crawlDelay: null, sitemaps: [] };
}

/**
 * Analyse un robots.txt (section 3).
 *
 * Gère ce que l'on rencontre réellement : BOM, fins de ligne mêlées,
 * commentaires `#` en fin de ligne, champs en casse quelconque, groupes à
 * plusieurs `User-agent` consécutifs, `Crawl-delay`, `Sitemap`, champs inconnus
 * (ignorés sans rompre le groupe courant). Un `Disallow:` vide n'enregistre
 * aucune règle : il signifie « tout est autorisé ».
 *
 * Deux choix prudents : des directives apparaissant **avant** tout `User-agent`
 * sont rattachées à un groupe `*` implicite (les ignorer reviendrait à s'ouvrir
 * un accès que le fichier refusait), et un fichier vide ou illisible donne une
 * structure vide — que `robotsAllows` traduit en « tout autorisé », la seule
 * lecture correcte d'une absence de robots.txt.
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const rules = emptyRobots();
  if (typeof text !== "string" || text.length === 0) return rules;

  const lines = capped(text).replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let current: RobotsGroup | null = null;
  // Un `User-agent` qui suit un autre `User-agent` complète le même groupe ;
  // celui qui suit une règle en ouvre un nouveau.
  let acceptingAgents = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const field = foldText(line.slice(0, separator)).replace(/[\s_]/g, "-");
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent" || field === "useragent") {
      const agent = foldText(value);
      if (agent.length === 0) continue;
      if (current && acceptingAgents) {
        if (!current.agents.includes(agent)) current.agents.push(agent);
      } else {
        current = { agents: [agent], rules: [], crawlDelay: null };
        rules.groups.push(current);
        acceptingAgents = true;
      }
      continue;
    }

    if (field === "sitemap") {
      if (value.length > 0) rules.sitemaps.push(value);
      continue;
    }

    if (field === "allow" || field === "disallow" || field === "crawl-delay") {
      if (!current) {
        current = { agents: ["*"], rules: [], crawlDelay: null };
        rules.groups.push(current);
      }
      acceptingAgents = false;
      if (field === "crawl-delay") {
        const delay = Number(value.replace(",", "."));
        if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
      } else if (value.length > 0) {
        current.rules.push({ allow: field === "allow", path: value });
      }
      continue;
    }
    // Champ inconnu (« host », « clean-param », faute de frappe) : ignoré.
  }

  for (const group of rules.groups) {
    if (group.crawlDelay !== null && group.agents.includes("*")) {
      rules.crawlDelay = rules.crawlDelay === null ? group.crawlDelay : Math.max(rules.crawlDelay, group.crawlDelay);
    }
  }
  return rules;
}

/** Jeton d'agent comparable : minuscules, sans numéro de version. */
function agentToken(userAgent: string): string {
  return foldText(typeof userAgent === "string" ? userAgent : "").split("/")[0].trim();
}

/**
 * Groupes applicables à un agent : tous ceux qui le nomment explicitement, et à
 * défaut tous ceux qui portent `*`. Plusieurs blocs peuvent viser le même agent :
 * on les cumule, pour ne perdre aucune interdiction.
 */
function selectGroups(rules: RobotsRules, userAgent: string): RobotsGroup[] {
  const groups = safeArray(rules.groups);
  const token = agentToken(userAgent);
  const exact = token.length > 0 ? groups.filter((g) => g.agents.includes(token)) : [];
  if (exact.length > 0) return exact;
  return groups.filter((g) => g.agents.includes("*"));
}

/** Chemin comparable : une URL complète est réduite à son chemin et sa requête. */
function robotsPath(path: string): string {
  const value = typeof path === "string" ? path.trim() : "";
  if (value.length === 0) return "/";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const parsed = parseUrl(value);
    if (parsed) return `${parsed.pathname}${parsed.search}`;
  }
  return value.startsWith("/") ? value : `/${value}`;
}

/** Motif robots.txt converti en expression : `*` joker, `$` fin de chemin. */
function robotsPatternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Spécificité d'un motif : sa longueur, `$` final non compté. */
function patternSpecificity(pattern: string): number {
  return pattern.endsWith("$") ? pattern.length - 1 : pattern.length;
}

/**
 * Ce chemin est-il ouvert à notre collecteur ? (section 3)
 *
 * Règles appliquées, dans cet ordre : le groupe nommant exactement l'agent
 * l'emporte sur le groupe `*` ; parmi les règles du ou des groupes retenus, la
 * plus longue gagne ; à longueur égale, `Allow` gagne (lecture usuelle du
 * standard) ; aucune règle applicable — fichier vide, agent non visé,
 * `Disallow:` vide — vaut autorisation.
 *
 * Cette fonction dit ce que le site **permet de collecter**. Elle ne dit rien
 * des droits de réutilisation, qui se lisent dans la licence (section 2) : un
 * robots.txt permissif n'a jamais rendu une donnée réutilisable.
 */
export function robotsAllows(
  rules: RobotsRules,
  path: string,
  userAgent: string = DISCOVERY_USER_AGENT,
): boolean {
  if (!rules || safeArray(rules.groups).length === 0) return true;
  const target = robotsPath(path);
  let best: { allow: boolean; specificity: number } | null = null;

  for (const group of selectGroups(rules, userAgent)) {
    for (const rule of group.rules) {
      if (rule.path.length === 0) continue;
      if (!robotsPatternToRegex(rule.path).test(target)) continue;
      const specificity = patternSpecificity(rule.path);
      if (
        !best ||
        specificity > best.specificity ||
        (specificity === best.specificity && rule.allow && !best.allow)
      ) {
        best = { allow: rule.allow, specificity };
      }
    }
  }
  return best ? best.allow : true;
}

/**
 * Délai (s) à respecter entre deux requêtes vers cet hôte.
 *
 * Le délai déclaré pour l'agent (ou, à défaut, pour `*`) est retenu, et jamais
 * en dessous de `DISCOVERY_POLITE_CRAWL_DELAY_S` : un site qui ne demande rien
 * n'autorise pas pour autant une rafale. Un délai plus long que le nôtre est
 * respecté tel quel.
 */
export function robotsCrawlDelay(
  rules: RobotsRules,
  userAgent: string = DISCOVERY_USER_AGENT,
): number {
  let declared = 0;
  if (rules) {
    for (const group of selectGroups(rules, userAgent)) {
      if (group.crawlDelay !== null && Number.isFinite(group.crawlDelay)) {
        declared = Math.max(declared, group.crawlDelay);
      }
    }
  }
  return Math.max(declared, DISCOVERY_POLITE_CRAWL_DELAY_S);
}

/* ------------------------------------------------------------------ */
/* 5. Identité d'une ressource (section 5)                             */
/* ------------------------------------------------------------------ */

/**
 * Forme normalisée d'une URL, base de l'identifiant de ressource.
 *
 * Schéma et hôte en minuscules, `www.` retiré, fragment retiré, paramètres de
 * suivi (`utm_*` et `DISCOVERY_TRACKING_PARAMS`) retirés, paramètres restants
 * triés, barre oblique finale supprimée sauf à la racine. Le chemin garde sa
 * casse : sur la plupart des serveurs, `/Trace.gpx` et `/trace.gpx` sont deux
 * fichiers différents. Une URL illisible est renvoyée simplement nettoyée, pour
 * que deux écritures identiques donnent quand même le même identifiant.
 */
export function normalizeResourceUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return typeof url === "string" ? url.trim() : "";

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";

  const params: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    const folded = key.toLowerCase();
    if (folded.startsWith("utm_") || DISCOVERY_TRACKING_PARAMS.includes(folded)) return;
    params.push([key, value]);
  });
  params.sort((a, b) => compareStrings(a[0], b[0]) || compareStrings(a[1], b[1]));
  const search =
    params.length > 0 ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";

  let path = parsed.pathname.length > 0 ? parsed.pathname : "/";
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (path.length === 0) path = "/";

  return `${parsed.protocol.toLowerCase()}//${host}${port}${path}${search}`;
}

/**
 * Identifiant déterministe et stable d'une ressource (section 5).
 *
 * Deux URL équivalentes (majuscules de domaine, `www.`, ancre, `utm_source`,
 * barre oblique finale) donnent le même identifiant : relancer une campagne de
 * découverte ne recrée pas les mêmes ressources. Deux empreintes de 32 bits
 * sont combinées pour rendre les collisions négligeables à l'échelle d'un
 * catalogue de sources.
 */
export function resourceId(url: string): string {
  const normalized = normalizeResourceUrl(url);
  const h1 = hashString(normalized).toString(16).padStart(8, "0");
  const h2 = hashString(`${normalized.length}:${normalized}`).toString(16).padStart(8, "0");
  return `${DISCOVERY_RESOURCE_ID_PREFIX}${h1}${h2}`;
}

/* ------------------------------------------------------------------ */
/* 6. Ouverture d'un territoire (section 23)                           */
/* ------------------------------------------------------------------ */

/**
 * Les huit étapes de l'ouverture d'un territoire (section 23), dans l'ordre.
 *
 * Les quatre premières vont chercher de la donnée dehors ; les quatre dernières
 * travaillent sur ce qui a été ramené, et n'ont besoin de personne.
 */
export const DISCOVERY_PLAN_STEPS: readonly {
  key: TerritoryStep["key"];
  label: string;
  detail: string;
  requiresNetwork: boolean;
}[] = [
  {
    key: "osm_network",
    label: "Réseau OpenStreetMap",
    detail:
      "Récupérer les chemins et les relations d'itinéraires d'OpenStreetMap sur l'emprise, puis les découper en segments : c'est le squelette du réseau, sous licence ODbL (partage à l'identique).",
    requiresNetwork: true,
  },
  {
    key: "open_data",
    label: "Données ouvertes",
    detail:
      "Chercher les jeux de données de sentiers publiés par les collectivités et les gestionnaires, et lire leur licence AVANT tout téléchargement.",
    requiresNetwork: true,
  },
  {
    key: "geotrek",
    label: "Instances Geotrek",
    detail:
      "Interroger les API Geotrek publiques couvrant le territoire : itinéraires décrits par leur gestionnaire, avec descriptif et conditions d'usage.",
    requiresNetwork: true,
  },
  {
    key: "gpx_search",
    label: "Recherche de traces GPX",
    detail:
      "Lancer les requêtes préparées par buildDiscoveryQueries, vérifier le robots.txt de chaque site puis ses droits de réutilisation : sans licence identifiée, la ressource attend une décision humaine.",
    requiresNetwork: true,
  },
  {
    key: "compare",
    label: "Comparaison des sources",
    detail:
      "Superposer les géométries obtenues : ce que plusieurs sources indépendantes confirment, ce sur quoi elles divergent, et ce qui n'est attesté qu'une fois.",
    requiresNetwork: false,
  },
  {
    key: "build_graph",
    label: "Construction du graphe",
    detail:
      "Rattacher les traces aux segments, créer les nœuds d'intersection et conserver la provenance de chaque géométrie : un GPX reste une observation, il n'écrase rien.",
    requiresNetwork: false,
  },
  {
    key: "coverage_gaps",
    label: "Trous de couverture",
    detail:
      "Repérer les zones sans donnée et les chemins attestés par une seule source : la liste de ce qui reste à vérifier sur le terrain.",
    requiresNetwork: false,
  },
  {
    key: "community",
    label: "Ouverture aux contributions",
    detail:
      "Ouvrir le territoire aux passages et aux signalements des utilisateurs, qui confirmeront, corrigeront ou infirmeront ce qui a été importé.",
    requiresNetwork: false,
  },
];

/**
 * Plan d'ouverture d'un territoire (section 23) : les huit étapes numérotées,
 * chacune rappelant le périmètre visé.
 *
 * Un territoire sans nom, sans pays ou sans emprise ne fait pas échouer le plan :
 * le détail dit alors ce qui manque, plutôt que d'inventer un périmètre.
 */
export function territoryPlan(territory: Territory): TerritoryStep[] {
  const label = cleanLabel(territory.name) || cleanLabel(territory.id) || DISCOVERY_UNNAMED_TERRITORY;
  const country = cleanLabel(territory.country);
  const extent = territory.bbox ? "emprise connue" : "emprise à définir";
  const scope = `Périmètre : ${label}${country.length > 0 ? ` (${country})` : ""}, ${extent}.`;

  return DISCOVERY_PLAN_STEPS.map((step, index) => ({
    order: index + 1,
    key: step.key,
    label: step.label,
    detail: `${step.detail} ${scope}`,
    requiresNetwork: step.requiresNetwork,
  }));
}

/* ------------------------------------------------------------------ */
/* 7. Bilan d'une campagne (section 16)                                */
/* ------------------------------------------------------------------ */

/** Bilan d'une campagne de découverte (section 16). */
export interface DiscoverySummary {
  total: number;
  byStatus: Record<ReuseStatus, number>;
  byFormat: Record<string, number>;
  /** Ressources pour lesquelles un fichier GPX a été **constaté**, pas supposé. */
  withGpx: number;
}

/**
 * Compte les ressources découvertes, par statut de droits et par format
 * (section 16).
 *
 * Cette fonction ne fait que compter ce qu'on lui donne : aucun total estimé,
 * aucune extrapolation, aucune ressource inventée. Les compteurs portent
 * toujours toutes les clés connues, à zéro le cas échéant, pour que l'absence se
 * lise comme un zéro et non comme une clé manquante. Un statut ou un format
 * inattendu (donnée abîmée) est rangé respectivement dans `review_required` et
 * `unknown` : l'inconnu ne devient jamais `approved`.
 */
export function summarizeDiscovery(resources: readonly DiscoveredResource[]): DiscoverySummary {
  const byStatus: Record<ReuseStatus, number> = { approved: 0, review_required: 0, forbidden: 0 };
  const byFormat: Record<string, number> = {};
  for (const format of DISCOVERY_RESOURCE_FORMATS) byFormat[format] = 0;

  let total = 0;
  let withGpx = 0;
  for (const resource of safeArray(resources)) {
    if (!resource || typeof resource !== "object") continue;
    total++;
    const status = DISCOVERY_REUSE_STATUSES.includes(resource.status)
      ? resource.status
      : "review_required";
    byStatus[status]++;
    const format = DISCOVERY_RESOURCE_FORMATS.includes(resource.format) ? resource.format : "unknown";
    byFormat[format]++;
    if (resource.hasGpxFile === true) withGpx++;
  }
  return { total, byStatus, byFormat, withGpx };
}
