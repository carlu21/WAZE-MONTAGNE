/**
 * Ingestion des fichiers de trace : GPX, KML et GeoJSON → forme normalisée.
 *
 * Sections du cahier des charges « traces GPX » (docs/SOURCES_GPX.md) :
 *
 *  - **7. Importer sans rien perdre.** L'analyse extrait *tout* ce que le
 *    fichier portait : traces, segments de trace, itinéraires, waypoints,
 *    latitude, longitude, altitude, horodatage, nom, description, auteur,
 *    lien, logiciel émetteur et la mention de **copyright** — indice de
 *    licence précieux, que `detectLicence` (licence.ts) sait relire. Rien
 *    n'est écarté à cette étape, pas même une coordonnée aberrante : le
 *    fichier a le droit d'être faux, l'analyseur n'a pas le droit de mentir
 *    sur ce qu'il contenait.
 *  - **8. Normaliser.** `normalizeTrace` enchaîne VALIDATION → CLEANING →
 *    NORMALISATION → mesures. Deux règles y sont non négociables : les
 *    **coupures sont préservées** (une trace interrompue n'est jamais
 *    recollée par une ligne droite inventée, et sa longueur ne compte pas le
 *    saut) et **aucune valeur n'est fabriquée** — pas d'altitude si le
 *    fichier n'en avait pas, pas d'horodatage non plus.
 *  - **17 et 18. Import manuel et import par URL.** Le back-office accepte
 *    `.gpx`, `.kml`, `.geojson` et doit afficher distance, D+, D−, nombre de
 *    points et zone géographique **avant** toute décision : c'est exactement
 *    ce que produit `NormalizedTrace`. `traceHash` sert au même écran à dire
 *    « ce parcours est déjà dans la bibliothèque, importé d'une autre
 *    source ».
 *
 * Trois partis pris de conception :
 *
 * 1. **Analyser n'est pas juger.** `parseGpxDocument`, `parseKmlDocument` et
 *    `parseGeoJsonDocument` ne suppriment rien et ne corrigent rien. Toute
 *    décision (écarter, rapprocher, mesurer) appartient à `normalizeTrace`,
 *    qui la *compte* dans `removed` : on doit pouvoir dire au déposant
 *    combien de points ont été écartés et pourquoi.
 * 2. **Une trace est une observation** (section 24). Ce module ne conclut
 *    rien sur le terrain : il met en forme ce qu'un fichier prétend. Même la
 *    correction d'une inversion latitude/longitude reste un choix explicite
 *    (`fixSwappedCoordinates`), documenté et révocable.
 * 3. **Aucune dépendance au DOM ni à une bibliothèque XML.** L'analyse est
 *    faite par expressions régulières tolérantes : attributs dans n'importe
 *    quel ordre, espaces de noms préfixés (`<gpx:trkpt>`), CDATA, extensions
 *    inconnues, document tronqué. Un fichier malformé donne moins de données,
 *    jamais une exception.
 *
 * Module pur : pas de réseau, pas de disque, pas d'aléa, pas d'horloge
 * implicite. Coût linéaire sur la taille du fichier et sur le nombre de
 * points, hors création des expressions régulières.
 */
import {
  clampBBox,
  distanceToPolylineM,
  hashString,
  haversineM,
  isValidLatLng,
  polylineLengthM,
  type LngLat,
} from "../geo";
import { cumulativeDistances, pointAtAlong } from "../navigation/geometry";
import { decodeXml } from "../navigation/gpx";
import type { BBox } from "../types";
import type {
  CleaningFlag,
  NormalizedTrace,
  ParsedTrace,
  TraceMetadata,
  TracePoint,
  TraceSegment,
  TraceWaypoint,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages (seuils documentés, pas des nombres perdus)                */
/* ------------------------------------------------------------------ */

/** Formats de fichier reconnus par l'ingestion (ordre d'essai par défaut). */
export const INGEST_FORMATS: readonly TraceFormat[] = ["gpx", "kml", "geojson"];

/**
 * Extensions de fichier reconnues. `.kmz` en est volontairement absente :
 * c'est une archive compressée, que ce module pur ne sait pas ouvrir — mieux
 * vaut ne rien reconnaître que prétendre analyser un binaire.
 */
export const INGEST_EXTENSION_FORMATS: Readonly<Record<string, TraceFormat>> = {
  gpx: "gpx",
  kml: "kml",
  geojson: "geojson",
  json: "geojson",
};

/**
 * Demi-côté (degrés) de la zone considérée comme « null island ».
 *
 * 1e-4° ≈ 11 m : assez pour attraper un (0, 0) noyé dans du bruit de calcul,
 * assez peu pour ne pas condamner le golfe de Guinée — où, il est vrai, on ne
 * randonne pas beaucoup, mais un module générique n'a pas à le supposer.
 */
export const INGEST_NULL_ISLAND_TOLERANCE_DEG = 1e-4;

/**
 * Distance (m) en deçà de laquelle un point consécutif est un doublon.
 *
 * 50 cm est sous la précision de n'importe quel récepteur civil : deux points
 * plus proches que cela ne décrivent pas deux endroits. Le **premier** point
 * de la série est conservé, pas le dernier : l'arrêt reste alors lisible dans
 * les horodatages (un long écart entre deux points retenus), alors que
 * conserver le dernier effacerait l'heure d'arrivée.
 */
export const INGEST_DUPLICATE_TOLERANCE_M = 0.5;

/**
 * Écart latéral (m) minimal pour qu'un aller-retour instantané soit un pic.
 *
 * En dessous de 30 m, l'excursion reste dans l'incertitude d'un GPS sous
 * couvert forestier ou en fond de vallon : la retirer effacerait du terrain
 * réel (un lacet serré fait moins que cela).
 */
export const INGEST_SPIKE_MIN_EXCURSION_M = 30;

/**
 * Rapport (détour / corde) à partir duquel l'excursion n'est plus un chemin.
 *
 * 4 signifie : aller au point et en revenir coûte quatre fois la distance
 * entre le point précédent et le suivant. Un vrai crochet de terrain
 * (belvédère, source) dépasse rarement ce rapport sur **un seul** point ; un
 * saut de position, toujours.
 */
export const INGEST_SPIKE_RATIO = 4;

/**
 * Vitesse (m/s) au-delà de laquelle un aller-retour est impossible à pied,
 * à VTT ou à cheval. 30 m/s = 108 km/h : on ne cherche pas à détecter une
 * descente rapide, seulement un point physiquement inatteignable. N'est
 * utilisé que lorsque les deux instants encadrants sont connus.
 */
export const INGEST_SPIKE_MAX_SPEED_M_S = 30;

/**
 * Recul (ms) toléré sur un horodatage avant d'écarter le point.
 *
 * 1 s couvre les arrondis de certains enregistreurs (deux points datés à la
 * seconde près peuvent s'inverser). Au-delà, l'horodatage est faux : le point
 * est retiré et compté en `time_disorder` plutôt que réécrit — corriger une
 * date serait fabriquer une donnée. Un recul toléré reste donc visible tel
 * quel dans `times` : ce module ne lisse rien.
 */
export const INGEST_TIME_DISORDER_TOLERANCE_MS = 1000;

/**
 * Hystérésis (m) des dénivelés d'une trace importée.
 *
 * 5 m, comme pour une trace GPS enregistrée (l'altimétrie barométrique ou
 * satellitaire tremble de ±3 à 5 m au repos) — et plus que les 3 m retenus
 * pour un segment du réseau, dont le profil vient d'un modèle de terrain
 * beaucoup plus lisse (`SEGMENT_ELEVATION_HYSTERESIS_M`). Sans hystérésis,
 * une trace plate accumulerait des centaines de mètres de faux dénivelé.
 */
export const INGEST_ELEVATION_HYSTERESIS_M = 5;

/** Nombre de points en dessous duquel il n'y a plus de géométrie à normaliser. */
export const INGEST_MIN_POINTS = 2;

/**
 * Pas (m) d'échantillonnage de l'empreinte géométrique.
 *
 * 50 m : deux enregistrements du même sentier, l'un à 1 Hz, l'autre tous les
 * 20 m, tombent sur les mêmes points d'échantillonnage. Plus fin, l'empreinte
 * suivrait la fréquence d'échantillonnage du récepteur, ce qu'on cherche
 * précisément à neutraliser.
 */
export const INGEST_HASH_SAMPLE_M = 50;

/**
 * Facteur d'arrondi des coordonnées de l'empreinte : 1e5, soit ~1,1 m —
 * la même grille que `nodeKey` (navigation/graph), pour que deux traces
 * accrochées aux mêmes nœuds produisent les mêmes chiffres.
 */
export const INGEST_HASH_PRECISION = 1e5;

/** Préfixe des empreintes géométriques, pour ne jamais confondre avec un id. */
export const INGEST_HASH_PREFIX = "geo_";

/**
 * Profondeur maximale explorée dans un GeoJSON (imbrication de
 * `GeometryCollection` / `FeatureCollection`). Garde-fou contre un objet
 * cyclique fourni directement en mémoire : `JSON.parse` n'en produit pas,
 * un appelant peut en fournir un.
 */
export const INGEST_MAX_GEOJSON_DEPTH = 8;

/**
 * Ordre d'énumération des motifs de nettoyage : `removed` est ainsi
 * déterministe, y compris une fois sérialisé en JSON.
 */
export const INGEST_CLEANING_FLAGS: readonly CleaningFlag[] = [
  "out_of_bounds",
  "null_island",
  "duplicate",
  "spike",
  "time_disorder",
];

/**
 * Usage par défaut des itinéraires (`<rte>`) : ils ne servent que si le
 * fichier ne contient **aucun** point de trace. Un itinéraire est une suite
 * de points de passage saisis à la main, pas un relevé : le prendre pour une
 * observation quand un relevé existe fausserait toute la suite de la chaîne.
 */
export const INGEST_DEFAULT_ROUTE_USAGE: RouteUsage = "fallback";

/* ------------------------------------------------------------------ */
/* Types propres au module (le contrat figé est dans ./types)          */
/* ------------------------------------------------------------------ */

/** Format de fichier de trace analysable. */
export type TraceFormat = ParsedTrace["format"];

/** Indication de format fournie par l'appelant (en-tête HTTP, nom de fichier). */
export interface TraceParseHint {
  format?: TraceFormat;
  fileName?: string | null;
}

/** Place faite aux itinéraires (`<rte>`) dans la géométrie normalisée. */
export type RouteUsage = "fallback" | "always" | "never";

/** Réglages de la normalisation (section 8). Tout est optionnel et documenté. */
export interface NormalizeOptions {
  /** Distance (m) en deçà de laquelle deux points consécutifs sont un doublon. */
  duplicateToleranceM?: number;
  /** Écart latéral (m) minimal d'un pic. */
  spikeMinExcursionM?: number;
  /** Rapport détour/corde à partir duquel l'excursion est un pic. */
  spikeRatio?: number;
  /** Vitesse (m/s) au-delà de laquelle un aller-retour daté est impossible. */
  spikeMaxSpeedMS?: number;
  /** Recul (ms) toléré sur un horodatage avant de retirer le point. */
  timeDisorderToleranceMs?: number;
  /** Hystérésis (m) des dénivelés. */
  elevationHysteresisM?: number;
  /**
   * Corriger une inversion latitude/longitude manifeste (latitude hors
   * [-90, 90] alors que l'échange rend le point valide). Par défaut `true` :
   * l'erreur est systématique chez certains exportateurs. Passer `false`
   * écarte ces points au lieu de les réparer.
   */
  fixSwappedCoordinates?: boolean;
  /** Place faite aux itinéraires. */
  routeUsage?: RouteUsage;
}

/* ------------------------------------------------------------------ */
/* Analyse XML tolérante (sans DOM)                                    */
/* ------------------------------------------------------------------ */

/** Préfixe d'espace de noms optionnel (`gpx:`, `gx:`, `atom:`). */
const NS = "(?:[A-Za-z0-9_.\\-]+:)?";

/** Élément XML brut : ses attributs et son contenu. */
interface XmlElement {
  attrs: string;
  body: string;
}

/**
 * Expression d'un élément par son nom local. La forme auto-fermante
 * (`<trkpt .../>`) et la forme avec contenu sont traitées ensemble ; le
 * contenu est capturé paresseusement (aucun des éléments recherchés ici ne
 * s'imbrique dans lui-même).
 */
function elementRegex(name: string, flags: string): RegExp {
  return new RegExp(`<${NS}${name}(\\b[^>]*)?(?:/>|>([\\s\\S]*?)</${NS}${name}\\s*>)`, flags);
}

/** Tous les éléments portant ce nom local, dans l'ordre du document. */
function findElements(xml: string, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const re = elementRegex(name, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? "", body: m[2] ?? "" });
    // Un élément vide ne doit pas figer la boucle sur un index immobile.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Premier élément portant ce nom local, ou `null`. */
function firstElement(xml: string, name: string): XmlElement | null {
  const m = elementRegex(name, "i").exec(xml);
  return m === null ? null : { attrs: m[1] ?? "", body: m[2] ?? "" };
}

/** Balise ouvrante seule : sert aux documents tronqués (jamais refermés). */
function openingTag(xml: string, name: string): { attrs: string; end: number } | null {
  const m = new RegExp(`<${NS}${name}(\\b[^>]*)?>`, "i").exec(xml);
  if (m === null || m.index === undefined) return null;
  return { attrs: m[1] ?? "", end: m.index + m[0].length };
}

/** Le document contient-il un élément de ce nom (ouvert au moins) ? */
function hasTag(xml: string, name: string): boolean {
  return new RegExp(`<${NS}${name}\\b`, "i").test(xml);
}

/** Valeur d'un attribut, quel que soit l'ordre et le type de guillemets. */
function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  if (m === null) return null;
  const raw = m[1] ?? m[2] ?? "";
  const value = decodeXml(raw).trim();
  return value.length > 0 ? value : null;
}

/**
 * Texte d'un contenu XML : l'enveloppe CDATA est retirée **avant** les
 * balises (sinon la suppression des balises emporterait tout le bloc), puis
 * les entités sont décodées.
 */
function xmlText(body: string): string {
  const unwrapped = body.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeXml(unwrapped.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Texte du premier enfant portant ce nom, `null` si absent ou vide. */
function childText(xml: string, name: string): string | null {
  const el = firstElement(xml, name);
  if (el === null) return null;
  const text = xmlText(el.body);
  return text.length > 0 ? text : null;
}

/** Retire des blocs entiers, pour ne pas confondre un enfant et un petit-fils. */
function withoutElements(xml: string, names: readonly string[]): string {
  let out = xml;
  for (const name of names) out = out.replace(elementRegex(name, "gi"), " ");
  return out;
}

/** Portion précédant la première des balises citées (en-tête d'un élément). */
function headerOf(xml: string, stopTags: readonly string[]): string {
  let cut = xml.length;
  for (const tag of stopTags) {
    const m = new RegExp(`<${NS}${tag}\\b`, "i").exec(xml);
    if (m !== null && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return xml.slice(0, cut);
}

/* ------------------------------------------------------------------ */
/* Conversions élémentaires (jamais de NaN en sortie)                  */
/* ------------------------------------------------------------------ */

/** Nombre fini, ou `null`. La chaîne vide n'est pas zéro. */
function toNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Instant (ms epoch) depuis une date ISO, ou `null` si illisible. */
function toTime(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Nombre d'un enfant XML. */
function numberChild(xml: string, name: string): number | null {
  return toNumber(childText(xml, name));
}

/** Arrondi à `digits` décimales, sans `-0` en sortie. */
function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Mots-clés d'un champ libre : séparateurs usuels, doublons retirés. */
function splitKeywords(raw: string | null): string[] {
  if (raw === null) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[,;]/)) {
    const word = piece.trim();
    if (word.length > 0 && !out.includes(word)) out.push(word);
  }
  return out;
}

/** Métadonnées vides : toute absence est `null`, jamais une chaîne inventée. */
function emptyMetadata(): TraceMetadata {
  return {
    name: null,
    description: null,
    author: null,
    copyright: null,
    link: null,
    creator: null,
    time: null,
    keywords: [],
  };
}

/** Le fichier porte-t-il la moindre géométrie exploitable ? */
function hasGeometry(parsed: ParsedTrace): boolean {
  for (const track of parsed.tracks) {
    for (const segment of track.segments) if (segment.points.length > 0) return true;
  }
  for (const route of parsed.routes) if (route.points.length > 0) return true;
  return parsed.waypoints.length > 0;
}

/* ------------------------------------------------------------------ */
/* 1. GPX 1.0 / 1.1 (section 7)                                        */
/* ------------------------------------------------------------------ */

/** Points d'un conteneur GPX (`trkpt`, `rtept`), tels que le fichier les donne. */
function parseGpxPoints(xml: string, tag: string): TracePoint[] {
  const out: TracePoint[] = [];
  for (const el of findElements(xml, tag)) {
    const lat = toNumber(attr(el.attrs, "lat"));
    // `lon` est la forme GPX ; `lng` circule chez quelques exportateurs.
    const lng = toNumber(attr(el.attrs, "lon")) ?? toNumber(attr(el.attrs, "lng"));
    if (lat === null || lng === null) continue;
    // Les extensions (fréquence cardiaque, température…) peuvent porter leurs
    // propres `<time>` : on les met de côté avant de lire les nôtres.
    const body = withoutElements(el.body, ["extensions"]);
    out.push({ lat, lng, ele: numberChild(body, "ele"), at: toTime(childText(body, "time")) });
  }
  return out;
}

/** Auteur : `<author><name>` (GPX 1.1) ou texte libre (GPX 1.0). */
function parseGpxAuthor(meta: string): string | null {
  const author = firstElement(meta, "author");
  if (author === null) return null;
  const named = childText(author.body, "name");
  if (named !== null) return named;
  const text = xmlText(author.body);
  return text.length > 0 ? text : null;
}

/**
 * Mention de copyright, reconstituée depuis ses parties (`author`, `<year>`,
 * `<license>`). C'est le meilleur indice de licence d'un fichier : on
 * conserve tout ce qui s'y trouvait, à charge pour `detectLicence` de le
 * relire.
 */
function parseGpxCopyright(meta: string): string | null {
  const el = firstElement(meta, "copyright");
  if (el === null) return null;
  const parts: string[] = [];
  const author = attr(el.attrs, "author");
  if (author !== null) parts.push(author);
  const year = childText(el.body, "year");
  if (year !== null) parts.push(year);
  const licence = childText(el.body, "license");
  if (licence !== null) parts.push(licence);
  if (parts.length > 0) return parts.join(", ");
  const text = xmlText(el.body);
  return text.length > 0 ? text : null;
}

/** Lien : `<link href>` (GPX 1.1) ou `<url>` (GPX 1.0). */
function parseGpxLink(meta: string): string | null {
  const link = firstElement(meta, "link");
  if (link !== null) {
    const href = attr(link.attrs, "href");
    if (href !== null) return href;
    const text = xmlText(link.body);
    if (text.length > 0) return text;
  }
  return childText(meta, "url");
}

/**
 * Analyse GPX complète (1.0 et 1.1), là où `parseGpx` (navigation/gpx) se
 * limite à l'essentiel : plusieurs `<trk>`, plusieurs `<trkseg>` **conservés
 * séparément** (une interruption n'est pas un raccourci), `<rte>` distinct
 * des `<trk>`, `<wpt>` avec nom et description, et toutes les métadonnées —
 * dont le `<copyright>`. Tolère les espaces de noms préfixés, les CDATA, les
 * attributs en désordre, les extensions inconnues et un document tronqué.
 *
 * Renvoie `null` si le document n'est pas un GPX ou ne porte aucune géométrie.
 */
export function parseGpxDocument(xml: string): ParsedTrace | null {
  if (typeof xml !== "string" || xml.length === 0) return null;
  if (!hasTag(xml, "gpx")) return null;

  // Document tronqué : on repart de la balise ouvrante et on analyse la suite.
  const root = firstElement(xml, "gpx");
  const open = openingTag(xml, "gpx");
  const attrs = root?.attrs ?? open?.attrs ?? "";
  const body = root?.body ?? (open === null ? xml : xml.slice(open.end));

  const metaBlock = firstElement(body, "metadata")?.body ?? headerOf(body, ["trk", "rte", "wpt"]);
  // Un `<author>` porte lui aussi un `<name>` : on isole les sous-blocs avant
  // de lire le nom et la description du document.
  const metaFlat = withoutElements(metaBlock, ["author", "copyright", "link", "bounds", "extensions"]);

  const metadata: TraceMetadata = {
    name: childText(metaFlat, "name"),
    description: childText(metaFlat, "desc") ?? childText(metaFlat, "description"),
    author: parseGpxAuthor(metaBlock),
    copyright: parseGpxCopyright(metaBlock),
    link: parseGpxLink(metaBlock),
    creator: attr(attrs, "creator"),
    time: toTime(childText(metaFlat, "time")),
    keywords: splitKeywords(childText(metaFlat, "keywords")),
  };

  const tracks = findElements(body, "trk").map((trk) => {
    const head = withoutElements(headerOf(trk.body, ["trkseg", "trkpt"]), ["link", "extensions"]);
    const segments: TraceSegment[] = [];
    for (const seg of findElements(trk.body, "trkseg")) {
      const points = parseGpxPoints(seg.body, "trkpt");
      // Un `<trkseg>` vide ne dit rien : il n'ouvre pas de coupure.
      if (points.length > 0) segments.push({ points });
    }
    if (segments.length === 0) {
      // Tolérance : des `<trkpt>` posés directement sous `<trk>`.
      const loose = parseGpxPoints(trk.body, "trkpt");
      if (loose.length > 0) segments.push({ points: loose });
    }
    return {
      name: childText(head, "name"),
      description: childText(head, "desc") ?? childText(head, "cmt"),
      segments,
    };
  });

  // Document tronqué : les `</trk>` manquent, mais les points, eux, sont
  // complets. On les conserve plutôt que de perdre le fichier entier.
  if (tracks.length === 0) {
    const loose = parseGpxPoints(body, "trkpt");
    if (loose.length > 0) tracks.push({ name: null, description: null, segments: [{ points: loose }] });
  }

  const routes = findElements(body, "rte").map((rte) => {
    const head = withoutElements(headerOf(rte.body, ["rtept"]), ["link", "extensions"]);
    return { name: childText(head, "name"), points: parseGpxPoints(rte.body, "rtept") };
  });
  if (routes.length === 0) {
    const loose = parseGpxPoints(body, "rtept");
    if (loose.length > 0) routes.push({ name: null, points: loose });
  }

  const waypoints: TraceWaypoint[] = [];
  for (const el of findElements(body, "wpt")) {
    const lat = toNumber(attr(el.attrs, "lat"));
    const lng = toNumber(attr(el.attrs, "lon")) ?? toNumber(attr(el.attrs, "lng"));
    if (lat === null || lng === null) continue;
    const wptBody = withoutElements(el.body, ["extensions", "link"]);
    waypoints.push({
      lat,
      lng,
      ele: numberChild(wptBody, "ele"),
      name: childText(wptBody, "name"),
      description: childText(wptBody, "desc") ?? childText(wptBody, "cmt"),
    });
  }

  const parsed: ParsedTrace = { format: "gpx", metadata, tracks, routes, waypoints };
  return hasGeometry(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ */
/* 2. KML (section 7)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Triplets `<coordinates>` : `lng,lat[,ele]` séparés par des espaces ou des
 * retours à la ligne. **KML est en lng,lat** — l'inversion est le piège
 * classique de ce format. Les espaces autour des virgules (fréquents dans les
 * fichiers écrits à la main) sont absorbés avant le découpage.
 */
function parseKmlCoordinates(text: string): TracePoint[] {
  const cleaned = text.replace(/\s*,\s*/g, ",").trim();
  if (cleaned.length === 0) return [];
  const out: TracePoint[] = [];
  for (const token of cleaned.split(/\s+/)) {
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lng = toNumber(parts[0]);
    const lat = toNumber(parts[1]);
    if (lng === null || lat === null) continue;
    out.push({ lat, lng, ele: parts.length > 2 ? toNumber(parts[2]) : null, at: null });
  }
  return out;
}

/** Points d'un `<gx:Track>` : listes parallèles `<when>` et `<gx:coord>`. */
function parseGxTrack(body: string): TracePoint[] {
  const whens = findElements(body, "when").map((el) => toTime(xmlText(el.body)));
  const out: TracePoint[] = [];
  const coords = findElements(body, "coord");
  for (let i = 0; i < coords.length; i++) {
    // `gx:coord` sépare par des espaces (« lng lat ele ») ; certains
    // exportateurs y glissent des virgules.
    const parts = xmlText(coords[i].body).split(/[\s,]+/);
    if (parts.length < 2) continue;
    const lng = toNumber(parts[0]);
    const lat = toNumber(parts[1]);
    if (lng === null || lat === null) continue;
    out.push({
      lat,
      lng,
      ele: parts.length > 2 ? toNumber(parts[2]) : null,
      at: i < whens.length ? whens[i] : null,
    });
  }
  return out;
}

/**
 * Analyse KML : `<Placemark>` avec `<name>` / `<description>`,
 * `<LineString><coordinates>`, `<MultiGeometry>` (chaque ligne devient un
 * segment), `<Point>` en waypoint et `<gx:Track>` quand il est présent.
 *
 * Renvoie `null` si le document n'est pas un KML ou ne porte aucune géométrie.
 */
export function parseKmlDocument(xml: string): ParsedTrace | null {
  if (typeof xml !== "string" || xml.length === 0) return null;
  if (!hasTag(xml, "kml") && !hasTag(xml, "Placemark")) return null;

  const root = firstElement(xml, "kml");
  const open = openingTag(xml, "kml");
  const body = root?.body ?? (open === null ? xml : xml.slice(open.end));
  const container = firstElement(body, "Document")?.body ?? firstElement(body, "Folder")?.body ?? body;
  const head = headerOf(container, ["Placemark", "Folder", "Document"]);
  const headFlat = withoutElements(head, ["Style", "StyleMap", "Schema", "ExtendedData", "author", "link"]);

  const authorBlock = firstElement(head, "author");
  const linkBlock = firstElement(head, "link");
  const metadata: TraceMetadata = {
    name: childText(headFlat, "name"),
    description: childText(headFlat, "description"),
    author: authorBlock === null ? null : (childText(authorBlock.body, "name") ?? (xmlText(authorBlock.body) || null)),
    // KML ne normalise aucun copyright : on ne retient que ce qui est écrit.
    copyright: childText(headFlat, "copyright"),
    link: linkBlock === null ? null : (attr(linkBlock.attrs, "href") ?? childText(linkBlock.body, "href")),
    creator: null,
    time: toTime(childText(headFlat, "when")),
    keywords: [],
  };

  const tracks: ParsedTrace["tracks"] = [];
  const waypoints: TraceWaypoint[] = [];

  for (const placemark of findElements(container, "Placemark")) {
    const flat = withoutElements(placemark.body, [
      "Point",
      "LineString",
      "LinearRing",
      "MultiGeometry",
      "Polygon",
      "Track",
      "ExtendedData",
      "Style",
      "StyleMap",
    ]);
    const name = childText(flat, "name");
    const description = childText(flat, "description");

    const segments: TraceSegment[] = [];
    // `<MultiGeometry>` n'a pas besoin d'être ouvert : la recherche est à plat,
    // chaque `<LineString>` rencontrée devient un segment.
    for (const line of findElements(placemark.body, "LineString")) {
      const points = parseKmlCoordinates(childText(line.body, "coordinates") ?? "");
      if (points.length > 0) segments.push({ points });
    }
    for (const track of findElements(placemark.body, "Track")) {
      const points = parseGxTrack(track.body);
      if (points.length > 0) segments.push({ points });
    }
    if (segments.length > 0) tracks.push({ name, description, segments });

    for (const point of findElements(placemark.body, "Point")) {
      const parsedPoints = parseKmlCoordinates(childText(point.body, "coordinates") ?? "");
      if (parsedPoints.length === 0) continue;
      const first = parsedPoints[0];
      waypoints.push({ lat: first.lat, lng: first.lng, ele: first.ele, name, description });
    }
  }

  const parsed: ParsedTrace = { format: "kml", metadata, tracks, routes: [], waypoints };
  return hasGeometry(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ */
/* 3. GeoJSON (section 7)                                              */
/* ------------------------------------------------------------------ */

/** Objet JSON (ni tableau, ni null) : le seul `as` du module, et il est nécessaire. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Chaîne non vide, ou `null`. */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/** Position GeoJSON `[lng, lat]` ou `[lng, lat, ele]` (la 3e est l'altitude). */
function parseGeoJsonPosition(value: unknown, at: number | null): TracePoint | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = typeof value[0] === "number" ? value[0] : null;
  const lat = typeof value[1] === "number" ? value[1] : null;
  if (lng === null || lat === null || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const rawEle = value.length > 2 ? value[2] : null;
  const ele = typeof rawEle === "number" && Number.isFinite(rawEle) ? rawEle : null;
  return { lat, lng, ele, at };
}

/** Instant d'un `coordTimes` : date ISO ou millisecondes depuis l'époque. */
function parseGeoJsonTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return toTime(value);
  return null;
}

/**
 * Horodatages d'une ligne, depuis la convention `properties.coordTimes`
 * (produite par plusieurs convertisseurs). `index` désigne la ligne d'un
 * `MultiLineString` ; `null` pour une `LineString`. Absente ou mal formée, la
 * convention est ignorée : rien n'est fabriqué.
 */
function geoJsonCoordTimes(properties: Record<string, unknown> | null, index: number | null): unknown[] | null {
  if (properties === null) return null;
  const raw = properties.coordTimes ?? properties.coordinateProperties ?? null;
  const record = asRecord(raw);
  const list = record !== null ? record.times : raw;
  if (!Array.isArray(list)) return null;
  if (index === null) return list;
  const line = list[index];
  return Array.isArray(line) ? line : null;
}

/** Suite de positions → points, avec les horodatages disponibles. */
function parseGeoJsonLine(coords: unknown, times: unknown[] | null): TracePoint[] {
  if (!Array.isArray(coords)) return [];
  const out: TracePoint[] = [];
  for (let i = 0; i < coords.length; i++) {
    const at = times !== null && i < times.length ? parseGeoJsonTime(times[i]) : null;
    const point = parseGeoJsonPosition(coords[i], at);
    if (point !== null) out.push(point);
  }
  return out;
}

/** Accumulateur du parcours récursif d'un GeoJSON. */
interface GeoJsonSink {
  tracks: ParsedTrace["tracks"];
  waypoints: TraceWaypoint[];
}

/** Nom et description portés par `properties`. */
function geoJsonLabels(properties: Record<string, unknown> | null): {
  name: string | null;
  description: string | null;
} {
  if (properties === null) return { name: null, description: null };
  return {
    name: asText(properties.name) ?? asText(properties.title),
    description: asText(properties.description) ?? asText(properties.desc),
  };
}

/** Parcours récursif : FeatureCollection, Feature, GeometryCollection, géométries. */
function collectGeoJson(
  node: unknown,
  properties: Record<string, unknown> | null,
  sink: GeoJsonSink,
  depth: number,
): void {
  if (depth > INGEST_MAX_GEOJSON_DEPTH) return;
  const record = asRecord(node);
  if (record === null) return;
  const type = typeof record.type === "string" ? record.type : null;
  const labels = geoJsonLabels(properties);

  if (type === "FeatureCollection") {
    const features = record.features;
    if (Array.isArray(features)) {
      for (const feature of features) collectGeoJson(feature, null, sink, depth + 1);
    }
    return;
  }

  if (type === "Feature") {
    collectGeoJson(record.geometry, asRecord(record.properties), sink, depth + 1);
    return;
  }

  if (type === "GeometryCollection") {
    const geometries = record.geometries;
    if (Array.isArray(geometries)) {
      for (const geometry of geometries) collectGeoJson(geometry, properties, sink, depth + 1);
    }
    return;
  }

  if (type === "LineString") {
    const points = parseGeoJsonLine(record.coordinates, geoJsonCoordTimes(properties, null));
    if (points.length > 0) {
      sink.tracks.push({ name: labels.name, description: labels.description, segments: [{ points }] });
    }
    return;
  }

  if (type === "MultiLineString") {
    const lines = record.coordinates;
    if (!Array.isArray(lines)) return;
    const segments: TraceSegment[] = [];
    for (let i = 0; i < lines.length; i++) {
      // Chaque ligne est un segment distinct : la coupure entre deux lignes
      // est une information du fichier, pas un défaut à recoller.
      const points = parseGeoJsonLine(lines[i], geoJsonCoordTimes(properties, i));
      if (points.length > 0) segments.push({ points });
    }
    if (segments.length > 0) {
      sink.tracks.push({ name: labels.name, description: labels.description, segments });
    }
    return;
  }

  if (type === "Point") {
    const point = parseGeoJsonPosition(record.coordinates, null);
    if (point !== null) {
      sink.waypoints.push({
        lat: point.lat,
        lng: point.lng,
        ele: point.ele,
        name: labels.name,
        description: labels.description,
      });
    }
    return;
  }

  if (type === "MultiPoint") {
    const positions = record.coordinates;
    if (!Array.isArray(positions)) return;
    for (const position of positions) {
      const point = parseGeoJsonPosition(position, null);
      if (point === null) continue;
      sink.waypoints.push({
        lat: point.lat,
        lng: point.lng,
        ele: point.ele,
        name: labels.name,
        description: labels.description,
      });
    }
  }
}

/**
 * Analyse GeoJSON : `Feature`, `FeatureCollection`, `GeometryCollection` ou
 * géométrie nue. `LineString` donne un segment, `MultiLineString` un segment
 * par ligne, `Point` et `MultiPoint` des waypoints. Les positions à trois
 * composantes portent l'altitude ; `properties.coordTimes`, quand il est là,
 * donne les horodatages.
 *
 * Accepte une chaîne (analysée sans jeter) ou un objet déjà décodé. Renvoie
 * `null` si le JSON est invalide ou ne porte aucune géométrie.
 */
export function parseGeoJsonDocument(json: string | object): ParsedTrace | null {
  let root: unknown = json;
  if (typeof json === "string") {
    if (json.trim().length === 0) return null;
    try {
      root = JSON.parse(json);
    } catch {
      // Un fichier tronqué ou mal formé n'est pas une exception : c'est un
      // fichier qu'on ne sait pas lire.
      return null;
    }
  }
  const record = asRecord(root);
  if (record === null) return null;

  const sink: GeoJsonSink = { tracks: [], waypoints: [] };
  collectGeoJson(record, null, sink, 0);

  const topProperties = asRecord(record.properties);
  const labels = geoJsonLabels(topProperties);
  const metadata: TraceMetadata = {
    name: labels.name ?? asText(record.name),
    description: labels.description ?? asText(record.description),
    author: topProperties === null ? null : asText(topProperties.author),
    copyright:
      topProperties === null ? null : (asText(topProperties.copyright) ?? asText(topProperties.licence) ?? asText(topProperties.license)),
    link: topProperties === null ? null : (asText(topProperties.link) ?? asText(topProperties.url)),
    creator: topProperties === null ? null : asText(topProperties.creator),
    time: topProperties === null ? null : parseGeoJsonTime(topProperties.time),
    keywords: topProperties === null ? [] : splitKeywords(asText(topProperties.keywords)),
  };

  const parsed: ParsedTrace = {
    format: "geojson",
    metadata,
    tracks: sink.tracks,
    routes: [],
    waypoints: sink.waypoints,
  };
  return hasGeometry(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ */
/* 4. Détection de format et aiguillage (sections 17, 18)              */
/* ------------------------------------------------------------------ */

/** Format déduit d'une extension de fichier, ou `null`. */
function formatFromFileName(fileName: string | null | undefined): TraceFormat | null {
  if (typeof fileName !== "string") return null;
  const match = /\.([a-z0-9]+)\s*$/i.exec(fileName.trim());
  if (match === null) return null;
  return INGEST_EXTENSION_FORMATS[match[1].toLowerCase()] ?? null;
}

/**
 * Format probable d'un contenu, d'après sa forme puis, à défaut, d'après le
 * nom de fichier. Ne garantit pas que le fichier soit analysable : c'est une
 * *hypothèse d'aiguillage*, vérifiée ensuite par l'analyseur correspondant.
 */
export function detectTraceFormat(content: string, fileName: string | null = null): TraceFormat | null {
  if (typeof content !== "string") return null;
  const head = content.trimStart();
  if (head.length === 0) return formatFromFileName(fileName);
  if (head.startsWith("{") || head.startsWith("[")) return "geojson";
  if (hasTag(content, "gpx")) return "gpx";
  if (hasTag(content, "kml") || hasTag(content, "Placemark")) return "kml";
  if (/"type"\s*:/.test(head) && /"coordinates"\s*:/.test(head)) return "geojson";
  return formatFromFileName(fileName);
}

/** Analyseur d'un format donné. */
function parseWithFormat(content: string, format: TraceFormat): ParsedTrace | null {
  if (format === "gpx") return parseGpxDocument(content);
  if (format === "kml") return parseKmlDocument(content);
  return parseGeoJsonDocument(content);
}

/**
 * Lit un fichier de trace quel qu'en soit le format (sections 17 et 18) :
 * l'indication de l'appelant est essayée d'abord, puis le format déduit du
 * contenu, puis les autres — un fichier `.gpx` contenant en réalité du KML
 * finit donc par être lu. Renvoie `null` si aucun analyseur ne reconnaît le
 * contenu ou s'il n'y a aucune géométrie dedans.
 */
export function parseTraceFile(content: string, hint: TraceParseHint = {}): ParsedTrace | null {
  if (typeof content !== "string" || content.trim().length === 0) return null;
  const candidates: TraceFormat[] = [];
  const push = (format: TraceFormat | null): void => {
    if (format !== null && !candidates.includes(format)) candidates.push(format);
  };
  push(hint.format ?? null);
  push(formatFromFileName(hint.fileName));
  push(detectTraceFormat(content, hint.fileName ?? null));
  for (const format of INGEST_FORMATS) push(format);

  for (const format of candidates) {
    const parsed = parseWithFormat(content, format);
    if (parsed !== null) return parsed;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 5. Normalisation (section 8)                                        */
/* ------------------------------------------------------------------ */

/** Compteur de points écartés, par motif. */
type RemovedCounts = Map<CleaningFlag, number>;

/** Point retenu après validation, avec ses attributs facultatifs. */
interface KeptPoint {
  lat: number;
  lng: number;
  ele: number | null;
  at: number | null;
}

/**
 * VALIDATION d'un point isolé : coordonnées hors Terre, « null island », et
 * inversion latitude/longitude manifeste. Renvoie le point (éventuellement
 * remis à l'endroit) ou le motif de son rejet.
 */
function validatePoint(
  point: TracePoint,
  fixSwapped: boolean,
  nullIslandToleranceDeg: number,
): { kept: KeptPoint } | { flag: CleaningFlag } {
  // Un objet mal formé (champ absent, chaîne à la place d'un nombre) n'est pas
  // une exception : c'est un point qu'on ne sait pas placer.
  let lat = typeof point?.lat === "number" ? point.lat : Number.NaN;
  let lng = typeof point?.lng === "number" ? point.lng : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { flag: "out_of_bounds" };

  // Inversion manifeste : la latitude sort de [-90, 90] alors que l'échange
  // rend le point valide. On ne « devine » jamais au-delà de ce cas.
  if (!isValidLatLng({ lat, lng }) && isValidLatLng({ lat: lng, lng: lat })) {
    if (!fixSwapped) return { flag: "out_of_bounds" };
    const swapped = lat;
    lat = lng;
    lng = swapped;
  }
  if (!isValidLatLng({ lat, lng })) return { flag: "out_of_bounds" };

  const tolerance = Math.max(0, nullIslandToleranceDeg);
  if (Math.abs(lat) <= tolerance && Math.abs(lng) <= tolerance) return { flag: "null_island" };

  const ele = point.ele !== null && Number.isFinite(point.ele) ? point.ele : null;
  const at = point.at !== null && Number.isFinite(point.at) ? point.at : null;
  return { kept: { lat, lng, ele, at } };
}

/** Incrémente un compteur de nettoyage. */
function countRemoved(removed: RemovedCounts, flag: CleaningFlag): void {
  removed.set(flag, (removed.get(flag) ?? 0) + 1);
}

/**
 * CLEANING d'un pic : un point qui s'écarte franchement de la corde reliant
 * ses voisins **et** dont le détour coûte `spikeRatio` fois cette corde (ou,
 * si les instants sont connus, exige une vitesse impossible) n'est pas un
 * crochet de terrain, c'est un saut de position.
 */
function isSpike(
  previous: KeptPoint,
  current: KeptPoint,
  next: KeptPoint,
  minExcursionM: number,
  ratio: number,
  maxSpeedMS: number,
): boolean {
  const chord: LngLat[] = [
    [previous.lng, previous.lat],
    [next.lng, next.lat],
  ];
  const excursionM = distanceToPolylineM({ lat: current.lat, lng: current.lng }, chord);
  if (!Number.isFinite(excursionM) || excursionM <= minExcursionM) return false;

  const inM = haversineM(previous, current);
  const outM = haversineM(current, next);
  const chordM = haversineM(previous, next);
  // Corde nulle (aller-retour exact) : le rapport est infini par construction.
  const detourRatio = chordM > 0 ? (inM + outM) / chordM : Infinity;
  if (detourRatio >= ratio) return true;

  if (previous.at === null || current.at === null || next.at === null) return false;
  const inS = (current.at - previous.at) / 1000;
  const outS = (next.at - current.at) / 1000;
  if (inS <= 0 || outS <= 0) return false;
  return inM / inS > maxSpeedMS && outM / outS > maxSpeedMS;
}

/**
 * Chaîne complète de nettoyage d'un segment : doublons, ordre des instants,
 * puis pics. L'ordre compte — retirer les doublons d'abord évite de prendre
 * un point immobile pour un pic, et les instants sont comparés au dernier
 * point retenu de **toute** la trace, les segments d'un fichier se suivant.
 */
function cleanSegment(
  points: readonly TracePoint[],
  opts: Required<Omit<NormalizeOptions, "routeUsage">>,
  removed: RemovedCounts,
  lastTime: { value: number | null },
): KeptPoint[] {
  const kept: KeptPoint[] = [];
  for (const raw of points) {
    const checked = validatePoint(raw, opts.fixSwappedCoordinates, INGEST_NULL_ISLAND_TOLERANCE_DEG);
    if ("flag" in checked) {
      countRemoved(removed, checked.flag);
      continue;
    }
    const point = checked.kept;

    const previous = kept.length > 0 ? kept[kept.length - 1] : null;
    if (previous !== null && haversineM(previous, point) <= opts.duplicateToleranceM) {
      countRemoved(removed, "duplicate");
      continue;
    }
    if (
      point.at !== null &&
      lastTime.value !== null &&
      lastTime.value - point.at > opts.timeDisorderToleranceMs
    ) {
      countRemoved(removed, "time_disorder");
      continue;
    }
    if (point.at !== null) lastTime.value = point.at;
    kept.push(point);
  }

  if (kept.length < 3) return kept;
  const withoutSpikes: KeptPoint[] = [kept[0]];
  for (let i = 1; i < kept.length - 1; i++) {
    const previous = withoutSpikes[withoutSpikes.length - 1];
    if (isSpike(previous, kept[i], kept[i + 1], opts.spikeMinExcursionM, opts.spikeRatio, opts.spikeMaxSpeedMS)) {
      countRemoved(removed, "spike");
      continue;
    }
    withoutSpikes.push(kept[i]);
  }
  withoutSpikes.push(kept[kept.length - 1]);
  return withoutSpikes;
}

/** Dénivelés d'une suite d'altitudes, avec hystérésis contre le bruit. */
function elevationRelief(elevations: readonly number[], hysteresisM: number): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  if (elevations.length === 0) return { gain, loss };
  const threshold = Math.max(0, hysteresisM);
  let reference = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - reference;
    if (delta > threshold) {
      gain += delta;
      reference = elevations[i];
    } else if (-delta > threshold) {
      loss += -delta;
      reference = elevations[i];
    }
  }
  return { gain, loss };
}

/** Emprise des coordonnées retenues. */
function boundsOf(coordinates: readonly LngLat[]): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coordinates) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(west)) return { west: 0, south: 0, east: 0, north: 0 };
  return clampBBox({ west, south, east, north });
}

/** Découpe une suite de coordonnées en portions continues, d'après `breaks`. */
function continuousRuns<T>(items: readonly T[], breaks: readonly number[]): T[][] {
  const runs: T[][] = [];
  let start = 0;
  for (const index of breaks) {
    if (index > start) runs.push(items.slice(start, index));
    start = index;
  }
  if (items.length > start) runs.push(items.slice(start));
  return runs;
}

/**
 * Chaîne de la section 8 : VALIDATION → CLEANING → NORMALISATION → mesures.
 *
 * Les segments du fichier sont concaténés **en conservant les coupures**
 * (`breaks` porte l'indice du premier point de chaque reprise) : aucune ligne
 * droite n'est inventée pour recoller une interruption, et ni la longueur ni
 * les dénivelés ne franchissent un saut. Les altitudes et les horodatages ne
 * sont rendus que si **tous** les points retenus en portaient : une série
 * partielle obligerait à interpoler, donc à fabriquer.
 *
 * Renvoie `null` s'il reste moins de `INGEST_MIN_POINTS` points.
 */
export function normalizeTrace(parsed: ParsedTrace, opts: NormalizeOptions = {}): NormalizedTrace | null {
  const settings: Required<Omit<NormalizeOptions, "routeUsage">> = {
    duplicateToleranceM: opts.duplicateToleranceM ?? INGEST_DUPLICATE_TOLERANCE_M,
    spikeMinExcursionM: opts.spikeMinExcursionM ?? INGEST_SPIKE_MIN_EXCURSION_M,
    spikeRatio: opts.spikeRatio ?? INGEST_SPIKE_RATIO,
    spikeMaxSpeedMS: opts.spikeMaxSpeedMS ?? INGEST_SPIKE_MAX_SPEED_M_S,
    timeDisorderToleranceMs: opts.timeDisorderToleranceMs ?? INGEST_TIME_DISORDER_TOLERANCE_MS,
    elevationHysteresisM: opts.elevationHysteresisM ?? INGEST_ELEVATION_HYSTERESIS_M,
    fixSwappedCoordinates: opts.fixSwappedCoordinates ?? true,
  };
  const routeUsage = opts.routeUsage ?? INGEST_DEFAULT_ROUTE_USAGE;

  // Segments du fichier, dans l'ordre : traces d'abord, itinéraires ensuite et
  // seulement si la politique retenue les accepte.
  // Les tableaux sont vérifiés à chaque niveau : une trace reconstruite depuis
  // un stockage peut avoir perdu un champ, ce n'est pas une raison pour jeter.
  const sources: TracePoint[][] = [];
  for (const track of Array.isArray(parsed?.tracks) ? parsed.tracks : []) {
    for (const segment of Array.isArray(track?.segments) ? track.segments : []) {
      const points = Array.isArray(segment?.points) ? segment.points : [];
      if (points.length > 0) sources.push(points);
    }
  }
  if (routeUsage === "always" || (routeUsage === "fallback" && sources.length === 0)) {
    for (const route of Array.isArray(parsed?.routes) ? parsed.routes : []) {
      const points = Array.isArray(route?.points) ? route.points : [];
      if (points.length > 0) sources.push(points);
    }
  }

  const removed: RemovedCounts = new Map();
  const lastTime: { value: number | null } = { value: null };
  const coordinates: LngLat[] = [];
  const elevations: (number | null)[] = [];
  const times: (number | null)[] = [];
  const breaks: number[] = [];
  let segments = 0;

  for (const points of sources) {
    const kept = cleanSegment(points, settings, removed, lastTime);
    if (kept.length === 0) continue;
    // La coupure est l'indice du premier point de la reprise : elle sépare
    // deux portions continues, elle n'en crée aucune.
    if (coordinates.length > 0) breaks.push(coordinates.length);
    segments++;
    for (const point of kept) {
      coordinates.push([point.lng, point.lat]);
      elevations.push(point.ele);
      times.push(point.at);
    }
  }

  if (coordinates.length < INGEST_MIN_POINTS) return null;

  const hasAllElevations = elevations.every((value) => value !== null);
  const hasAllTimes = times.every((value) => value !== null);
  const keptElevations: number[] | null = hasAllElevations
    ? elevations.map((value) => (value === null ? 0 : value))
    : null;
  const keptTimes: number[] | null = hasAllTimes ? times.map((value) => (value === null ? 0 : value)) : null;

  let lengthM = 0;
  let gain = 0;
  let loss = 0;
  const coordinateRuns = continuousRuns(coordinates, breaks);
  const elevationRuns = keptElevations === null ? null : continuousRuns(keptElevations, breaks);
  for (let i = 0; i < coordinateRuns.length; i++) {
    lengthM += polylineLengthM(coordinateRuns[i]);
    if (elevationRuns !== null) {
      const relief = elevationRelief(elevationRuns[i], settings.elevationHysteresisM);
      gain += relief.gain;
      loss += relief.loss;
    }
  }

  const removedCounts: Partial<Record<CleaningFlag, number>> = {};
  for (const flag of INGEST_CLEANING_FLAGS) {
    const count = removed.get(flag) ?? 0;
    if (count > 0) removedCounts[flag] = count;
  }

  return {
    coordinates,
    elevations: keptElevations,
    times: keptTimes,
    lengthM: roundTo(lengthM, 1),
    elevationGainM: keptElevations === null ? null : roundTo(gain, 1),
    elevationLossM: keptElevations === null ? null : roundTo(loss, 1),
    bbox: boundsOf(coordinates),
    removed: removedCounts,
    segments,
    breaks,
  };
}

/* ------------------------------------------------------------------ */
/* 6. Empreinte géométrique (section 17 : « déjà importée ? »)         */
/* ------------------------------------------------------------------ */

/** Coordonnée arrondie à la grille de l'empreinte, sans `-0`. */
function hashCoordinate(value: number): number {
  const rounded = Math.round(value * INGEST_HASH_PRECISION) / INGEST_HASH_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Échantillonne une portion continue tous les `INGEST_HASH_SAMPLE_M` mètres,
 * extrémités comprises. Coût : un appel à `pointAtAlong` par échantillon,
 * soit ~20 échantillons par kilomètre — négligeable devant l'analyse du
 * fichier lui-même.
 */
function sampleRun(run: readonly LngLat[]): string[] {
  if (run.length === 0) return [];
  const format = (lng: number, lat: number): string => `${hashCoordinate(lng)},${hashCoordinate(lat)}`;
  if (run.length === 1) return [format(run[0][0], run[0][1])];
  const cumulative = cumulativeDistances(run);
  const total = cumulative[cumulative.length - 1];
  const out: string[] = [format(run[0][0], run[0][1])];
  for (let along = INGEST_HASH_SAMPLE_M; along < total; along += INGEST_HASH_SAMPLE_M) {
    const point = pointAtAlong(run, cumulative, along);
    out.push(format(point.lng, point.lat));
  }
  const last = run[run.length - 1];
  out.push(format(last[0], last[1]));
  return out;
}

/** Entier 32 bits en hexadécimal fixe : une empreinte de longueur stable. */
function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * Empreinte géométrique déterministe d'une trace normalisée (section 17).
 *
 * Elle sert à répondre à « ce parcours n'a-t-il pas déjà été importé depuis
 * une autre source ? », pas à identifier un fichier : deux enregistrements du
 * même sentier à des fréquences différentes donnent la même empreinte, parce
 * que la géométrie est rééchantillonnée à pas fixe et arrondie à ~1,1 m. Le
 * sens de parcours est neutralisé (on retient la forme canonique la plus
 * petite) : un aller et son retour sont le même passage. Les interruptions ne
 * comptent pas : c'est le chemin suivi qui est décrit, pas la façon dont
 * l'enregistrement a été coupé.
 *
 * Deux passages FNV-1a (64 bits en tout) : suffisant pour dédoublonner une
 * bibliothèque, jamais présenté comme une empreinte cryptographique.
 */
export function traceHash(trace: NormalizedTrace): string {
  const coordinates = Array.isArray(trace.coordinates) ? trace.coordinates : [];
  const breaks = Array.isArray(trace.breaks) ? trace.breaks : [];
  const runs = continuousRuns(coordinates, breaks);

  // Le sens est neutralisé en échantillonnant aussi la géométrie retournée :
  // retourner la trace échange simplement les deux chaînes, donc le minimum
  // des deux ne bouge pas. (Retourner la liste de jetons ne suffirait pas :
  // l'échantillonnage est ancré sur le début du parcours.)
  const forward = runs.flatMap((run) => sampleRun(run)).join(";");
  const backward = [...runs]
    .reverse()
    .map((run) => [...run].reverse())
    .flatMap((run) => sampleRun(run))
    .join(";");
  const canonical = forward <= backward ? forward : backward;
  return `${INGEST_HASH_PREFIX}${hex8(hashString(canonical))}${hex8(hashString(`${canonical.length}|${canonical}|ml`))}`;
}
