/**
 * Droits d'usage des données collectées : la barrière juridique du module de
 * collecte. Rien n'entre dans la base sans passer par ce fichier.
 *
 * Sections du cahier des charges « traces GPX » couvertes ici :
 *
 *  - **2. Les droits d'abord.** Un bouton « Télécharger GPX » n'est pas une
 *    autorisation de réutilisation. Tant que la licence n'est pas identifiée,
 *    rien n'entre automatiquement : le statut vaut `review_required`, jamais
 *    `approved`. Il n'existe dans ce fichier aucun chemin qui transforme
 *    l'ignorance en autorisation.
 *  - **3. Reconnaître une licence.** `detectLicence` lit une mention de CGU,
 *    une balise `<copyright>` de GPX ou une URL de licence. En cas de mentions
 *    contradictoires, c'est la plus RESTRICTIVE qui l'emporte : une page qui
 *    cite trois licences ne libère pas la plus permissive.
 *  - **4. Registre des sources.** `canAutoImport` dit si une ligne du registre
 *    peut alimenter la base sans intervention : statut approuvé, licence
 *    compatible, et vérification humaine ni absente ni périmée — les CGU
 *    changent, une vérification de 2019 ne dit plus rien de 2026.
 *  - **22. Attribution.** `attributionLine` produit la mention à afficher :
 *    celle qu'impose la source si elle en impose une, sinon une mention
 *    construite (« © OpenStreetMap contributors (ODbL) »).
 *
 * Trois règles de conception, non négociables :
 *
 * 1. **Aucun défaut permissif.** Toute fonction qui doit trancher sans savoir
 *    tranche du côté fermé : `unknown` pour une licence, `review_required`
 *    pour un statut, `false` pour une importation automatique. Perdre une
 *    source exploitable est réparable ; publier une donnée qu'on n'avait pas
 *    le droit de publier ne l'est pas.
 * 2. **On dit TOUTES les raisons.** `blockers` liste l'ensemble des motifs, et
 *    non le premier rencontré : un modérateur doit voir le dossier complet
 *    pour décider une fois, pas découvrir un blocage après l'autre.
 * 3. **Module pur.** Aucun accès réseau (le `robots.txt` est lu ailleurs, son
 *    verdict arrive en paramètre), aucun accès disque, aucun aléa, aucune
 *    horloge implicite : l'instant courant est toujours un paramètre.
 *
 * Attention enfin à un piège propre à notre métier : une géométrie **recalée**
 * (lissée, découpée en segments, moyennée avec d'autres traces) EST une œuvre
 * dérivée. Une licence « sans modification » interdit donc exactement ce que
 * fait le moteur, même si le fichier est librement téléchargeable.
 */
import { DAY_MS } from "../time";
import {
  UNVERIFIED_RELIABILITY_CAP,
  type DataSource,
  type LicenceId,
  type LicenceTerms,
  type ReuseBlocker,
  type ReuseDecision,
  type ReuseStatus,
  type SourceStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages (seuils documentés, pas des nombres perdus)                */
/* ------------------------------------------------------------------ */

/**
 * Licence retenue quand rien n'est sûr. Ce n'est pas un défaut commode :
 * `unknown` bloque l'importation automatique (voir `reuseDecision`).
 */
export const LICENCE_DEFAULT_ID: LicenceId = "unknown";

/**
 * Version retenue pour une « Licence Ouverte » citée sans numéro.
 *
 * La v1.0 et la v2.0 accordent les mêmes droits (réutilisation commerciale,
 * redistribution, dérivés, avec attribution) : le choix n'a donc aucune
 * conséquence sur la décision. On retient la version courante, celle que
 * data.gouv.fr applique aujourd'hui.
 */
export const LICENCE_ETALAB_DEFAULT_ID: LicenceId = "etalab-2.0";

/**
 * Durée (jours) au-delà de laquelle une vérification humaine des conditions
 * d'utilisation est considérée comme périmée.
 *
 * Un an : les CGU d'une plateforme, la licence d'un jeu de données
 * territorial ou la politique d'un office de tourisme changent sans préavis,
 * et une source « vérifiée » il y a trois ans n'a plus été vérifiée du tout.
 * En dessous d'un an on ferait revérifier tout le registre chaque saison pour
 * rien ; au-delà, on importerait sur la foi d'une page qui n'existe peut-être
 * plus.
 */
export const LICENCE_RECHECK_AFTER_DAYS = 365;

/**
 * Fenêtre (caractères) explorée après une mention de licence pour y trouver un
 * numéro de version (« Licence Ouverte / Open Licence v2.0 »).
 *
 * 40 caractères couvrent la formulation longue habituelle sans aller chercher
 * un chiffre appartenant à la phrase suivante.
 */
export const LICENCE_VERSION_WINDOW_CHARS = 40;

/**
 * Étiquette employée quand une attribution est obligatoire mais que la source
 * n'a ni nom ni URL exploitables. On préfère une mention visiblement
 * incomplète — qu'un modérateur remarquera — à l'absence de mention, qui est
 * une faute vis-à-vis de la licence.
 */
export const LICENCE_UNNAMED_SOURCE = "Source non identifiée";

/** Motif ajouté à `reason` quand la source elle-même attend encore sa validation. */
export const LICENCE_SOURCE_PENDING_REASON = "la source n'est pas encore validée dans le registre";

/**
 * Rang de restriction d'une licence : plus le nombre est grand, plus la
 * licence est fermée. Sert d'arbitre quand un texte cite plusieurs licences
 * (`detectLicence`) : on retient toujours la plus fermée, car c'est celle qui
 * s'applique à l'ensemble.
 *
 * L'échelle n'est pas linéaire, elle est *ordonnée* : `proprietary` ferme
 * tout, `unknown` ne ferme rien explicitement mais interdit de conclure,
 * `cc-by-nd` tue nos géométries recalées, `nc` tue l'usage commercial, le
 * partage à l'identique contamine nos dérivés, l'attribution seule ne coûte
 * qu'une ligne d'écran. Les rangs sont tous distincts pour que l'arbitrage
 * reste déterministe.
 */
export const LICENCE_RESTRICTION_RANK: Readonly<Record<LicenceId, number>> = {
  proprietary: 100,
  unknown: 95,
  "cc-by-nd": 90,
  "cc-by-nc-sa": 85,
  "cc-by-nc": 80,
  "cc-by-sa": 50,
  odbl: 45,
  "cc-by": 30,
  "licence-ouverte-1.0": 21,
  "etalab-2.0": 20,
  cc0: 10,
  "public-domain": 5,
};

/** Tous les identifiants de licence du contrat, dans l'ordre du plus fermé au plus ouvert. */
export const LICENCE_IDS: readonly LicenceId[] = [
  "proprietary",
  "unknown",
  "cc-by-nd",
  "cc-by-nc-sa",
  "cc-by-nc",
  "cc-by-sa",
  "odbl",
  "cc-by",
  "licence-ouverte-1.0",
  "etalab-2.0",
  "cc0",
  "public-domain",
];

/* ------------------------------------------------------------------ */
/* 1. Table des licences (sections 2, 3)                               */
/* ------------------------------------------------------------------ */

/**
 * Droits réels de chaque licence du contrat. Chaque ligne dit ce qui est
 * autorisé ET ce qui ne l'est pas : c'est la seule source de vérité du
 * module, et elle est volontairement prudente.
 */
export const LICENCES: Readonly<Record<LicenceId, LicenceTerms>> = {
  /**
   * ODbL 1.0 (OpenStreetMap et dérivés). Autorisé : usage commercial,
   * redistribution, géométries dérivées. Obligatoire : citer la source ET
   * publier nos bases dérivées sous ODbL (share-alike). C'est cette dernière
   * clause, et elle seule, qui en fait une décision produit et non technique.
   */
  odbl: {
    id: "odbl",
    name: "ODbL",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: true,
    derivativesAllowed: true,
  },
  /**
   * CC0 1.0. Renonciation aux droits : tout est autorisé, y compris
   * commercialement, sans obligation d'attribution. Citer la source reste une
   * politesse utile, mais la licence ne l'impose pas.
   */
  cc0: {
    id: "cc0",
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: false,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * CC BY 4.0. Autorisé : usage commercial, redistribution, dérivés.
   * Interdit : omettre l'attribution. Aucune contamination de nos dérivés.
   */
  "cc-by": {
    id: "cc-by",
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * CC BY-SA 4.0. Comme CC BY, mais nos dérivés doivent être republiés sous la
   * même licence : exploitable, jamais silencieusement.
   */
  "cc-by-sa": {
    id: "cc-by-sa",
    name: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: true,
    derivativesAllowed: true,
  },
  /**
   * CC BY-NC 4.0. Interdit : toute réutilisation commerciale — donc la nôtre
   * dès que le service est commercial, y compris un abonnement facultatif.
   * Autorisé par ailleurs : dérivés et redistribution, avec attribution.
   */
  "cc-by-nc": {
    id: "cc-by-nc",
    name: "CC BY-NC 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    commercialReuse: false,
    redistribution: true,
    attributionRequired: true,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * CC BY-NC-SA 4.0. Cumule l'interdiction commerciale et le partage à
   * l'identique : inexploitable chez nous, et contaminant si on essayait.
   */
  "cc-by-nc-sa": {
    id: "cc-by-nc-sa",
    name: "CC BY-NC-SA 4.0",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    commercialReuse: false,
    redistribution: true,
    attributionRequired: true,
    shareAlike: true,
    derivativesAllowed: true,
  },
  /**
   * CC BY-ND 4.0. Interdit : toute œuvre dérivée. Or découper une trace en
   * segments, la lisser ou la recaler produit exactement une œuvre dérivée :
   * cette licence ferme la porte du moteur, même si le fichier est
   * téléchargeable et redistribuable tel quel.
   */
  "cc-by-nd": {
    id: "cc-by-nd",
    name: "CC BY-ND 4.0",
    url: "https://creativecommons.org/licenses/by-nd/4.0/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: false,
    derivativesAllowed: false,
  },
  /**
   * Licence Ouverte / Open Licence v2.0 (Etalab, data.gouv.fr). Très
   * permissive : usage commercial, redistribution et dérivés autorisés. Seule
   * obligation : mentionner la paternité (source et date de mise à jour).
   */
  "etalab-2.0": {
    id: "etalab-2.0",
    name: "Licence Ouverte 2.0",
    url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * Licence Ouverte v1.0. Mêmes droits que la v2.0 (commercial,
   * redistribution, dérivés, attribution obligatoire) ; seule la rédaction
   * diffère. Conservée distincte pour ne pas réécrire la licence réellement
   * lue sur la page.
   */
  "licence-ouverte-1.0": {
    id: "licence-ouverte-1.0",
    name: "Licence Ouverte 1.0",
    url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    commercialReuse: true,
    redistribution: true,
    attributionRequired: true,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * Domaine public (expiration des droits, marque du domaine public). Tout est
   * autorisé, rien n'est obligatoire. À ne retenir que sur une mention
   * explicite : « libre d'accès » n'a jamais voulu dire « domaine public ».
   */
  "public-domain": {
    id: "public-domain",
    name: "Domaine public",
    url: null,
    commercialReuse: true,
    redistribution: true,
    attributionRequired: false,
    shareAlike: false,
    derivativesAllowed: true,
  },
  /**
   * Licence propriétaire / « tous droits réservés ». Rien n'est autorisé :
   * ni usage commercial, ni redistribution, ni dérivé. Une autorisation
   * existe peut-être, mais elle se négocie hors de ce code (section 19).
   */
  proprietary: {
    id: "proprietary",
    name: "Licence propriétaire",
    url: null,
    commercialReuse: false,
    redistribution: false,
    attributionRequired: false,
    shareAlike: false,
    derivativesAllowed: false,
  },
  /**
   * Licence non identifiée. Tout est à faux, non pas parce que c'est interdit,
   * mais parce que **nous ne savons pas** : l'état correct est « à vérifier
   * par un humain », et `reuseDecision` le traite comme tel plutôt que de
   * l'annoncer comme une interdiction constatée.
   */
  unknown: {
    id: "unknown",
    name: "Licence inconnue",
    url: null,
    commercialReuse: false,
    redistribution: false,
    attributionRequired: false,
    shareAlike: false,
    derivativesAllowed: false,
  },
};

/** L'identifiant appartient-il au contrat ? (garde d'entrée pour une donnée externe) */
export function isLicenceId(value: unknown): value is LicenceId {
  return typeof value === "string" && LICENCE_IDS.some((id) => id === value);
}

/**
 * Droits d'une licence, jamais `undefined`.
 *
 * Un identifiant hors contrat (donnée ancienne, champ recopié d'une API)
 * retombe sur `unknown` : on ne devine pas, et surtout on n'autorise pas.
 */
export function licenceTerms(id: LicenceId): LicenceTerms {
  return isLicenceId(id) ? LICENCES[id] : LICENCES.unknown;
}

/**
 * La plus restrictive d'un ensemble de licences.
 *
 * Quand plusieurs licences s'appliquent à une même page, elles ne s'ajoutent
 * pas : c'est la plus fermée qui gouverne l'ensemble. Une liste vide vaut
 * `unknown` — l'absence de licence connue n'est pas une licence ouverte.
 */
export function mostRestrictiveLicence(ids: readonly LicenceId[]): LicenceId {
  let best: LicenceId = LICENCE_DEFAULT_ID;
  let bestRank = -1;
  for (const id of ids) {
    if (!isLicenceId(id)) continue;
    const rank = LICENCE_RESTRICTION_RANK[id];
    if (rank > bestRank) {
      best = id;
      bestRank = rank;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 2. Reconnaissance d'une licence dans un texte libre (section 3)     */
/* ------------------------------------------------------------------ */

/**
 * Texte ramené à une forme comparable : minuscules, accents et ligatures
 * retirés, ponctuation (y compris « © », « / », « - ») remplacée par des
 * espaces, chiffres séparés des lettres, le tout encadré d'espaces.
 *
 * « CC-BY-NC-SA 4.0 », « cc_by_nc_sa/4.0 » et
 * « creativecommons.org/licenses/by-nc-sa/4.0/ » donnent ainsi la même suite
 * de mots, et une frontière d'espace suffit ensuite à empêcher « by » de se
 * reconnaître dans « ruby ».
 */
function normaliseLicenceText(text: string): string {
  const flat = text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .trim();
  return flat.length === 0 ? "" : ` ${flat} `;
}

/** Mentions « tous droits réservés » (déjà normalisées). */
const PROPRIETARY_MARKERS: readonly string[] = [
  " droits reserves ",
  " all rights reserved ",
  " reproduction interdite ",
  " reutilisation interdite ",
];

/** Mentions d'ODbL (déjà normalisées). */
const ODBL_MARKERS: readonly string[] = [" odbl ", " open database license ", " open database licence "];

/**
 * Attributions OpenStreetMap. La mention « © OpenStreetMap contributors » est
 * en pratique la signature d'une donnée ODbL : on la traite comme telle.
 */
const ODBL_ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  / openstreetmap contributors? /,
  / contributeurs? (?:de |d |du |des )?openstreetmap /,
  / osm contributors? /,
];

/** Mentions de CC0 (déjà normalisées ; « CC0 » devient « cc 0 »). */
const CC0_MARKERS: readonly string[] = [" cc 0 ", " cc zero ", " creative commons zero ", " publicdomain zero "];

/** Mentions explicites de domaine public (déjà normalisées). */
const PUBLIC_DOMAIN_MARKERS: readonly string[] = [" domaine public ", " public domain ", " publicdomain mark "];

/** Mentions de Licence Ouverte / Etalab (déjà normalisées). */
const OPEN_LICENCE_MARKERS: readonly string[] = [
  " licence ouverte ",
  " license ouverte ",
  " open licence ",
  " open license ",
  " etalab ",
];

/** Le texte parle-t-il de Creative Commons ? (condition d'interprétation des sigles) */
const CC_CONTEXT_RE = / (?:cc|creative commons|creativecommons) /;

/**
 * Suite de sigles Creative Commons (« by », « by nc sa »…). La répétition est
 * gourmande : « by nc sa » est capturé d'un bloc, ce qui empêche
 * « CC-BY-NC-SA » d'être lu comme un « CC-BY » suivi de mots isolés.
 */
const CC_FLAG_RUN_RE = /\b(by(?: (?:nc|nd|sa))*)\b/g;

/** Sigle Creative Commons exprimé en toutes lettres (français ou anglais). */
const CC_WORD_FLAGS: readonly { readonly marker: string; readonly flag: string }[] = [
  { marker: " pas d utilisation commerciale ", flag: "nc" },
  { marker: " pas d usage commercial ", flag: "nc" },
  { marker: " utilisation non commerciale ", flag: "nc" },
  { marker: " non commercial ", flag: "nc" },
  { marker: " noncommercial ", flag: "nc" },
  { marker: " partage dans les memes conditions ", flag: "sa" },
  { marker: " share alike ", flag: "sa" },
  { marker: " sharealike ", flag: "sa" },
  { marker: " pas de modification ", flag: "nd" },
  { marker: " pas de modifications ", flag: "nd" },
  { marker: " pas d oeuvre derivee ", flag: "nd" },
  { marker: " no derivatives ", flag: "nd" },
  { marker: " noderivatives ", flag: "nd" },
  { marker: " attribution ", flag: "by" },
];

/**
 * Numéro de version lu juste après une mention de licence.
 *
 * On ne lit que 1 ou 2 : ce sont les seules versions de Licence Ouverte que
 * le contrat distingue. Absence de numéro → `null`, jamais une version
 * inventée.
 */
function versionNear(text: string, afterIndex: number): string | null {
  const window = text.slice(afterIndex, afterIndex + LICENCE_VERSION_WINDOW_CHARS);
  const match = /(?:^| )v? ?([12])(?: |$)/.exec(window);
  return match === null ? null : match[1];
}

/**
 * Licences correspondant à un jeu de sigles Creative Commons.
 *
 * « BY-NC-ND » n'existe pas dans le contrat : on émet alors **les deux**
 * restrictions repérables (`cc-by-nd` et `cc-by-nc`), et l'arbitrage par
 * restriction retiendra la plus fermée. Aucune des deux ne laisse passer la
 * donnée, ce qui est précisément le comportement attendu.
 */
function licencesFromCcFlags(flags: ReadonlySet<string>): LicenceId[] {
  const nc = flags.has("nc");
  const nd = flags.has("nd");
  const sa = flags.has("sa");
  const by = flags.has("by");
  if (!nc && !nd && !sa && !by) return [];
  if (nd) return nc ? ["cc-by-nd", "cc-by-nc"] : ["cc-by-nd"];
  if (nc && sa) return ["cc-by-nc-sa"];
  if (nc) return ["cc-by-nc"];
  if (sa) return ["cc-by-sa"];
  return ["cc-by"];
}

/** Toutes les licences repérées dans un texte déjà normalisé, sans doublon. */
function collectLicenceCandidates(text: string): LicenceId[] {
  const found: LicenceId[] = [];
  const add = (id: LicenceId): void => {
    if (!found.includes(id)) found.push(id);
  };

  for (const marker of PROPRIETARY_MARKERS) if (text.includes(marker)) add("proprietary");
  for (const marker of ODBL_MARKERS) if (text.includes(marker)) add("odbl");
  for (const pattern of ODBL_ATTRIBUTION_PATTERNS) if (pattern.test(text)) add("odbl");
  for (const marker of CC0_MARKERS) if (text.includes(marker)) add("cc0");
  for (const marker of PUBLIC_DOMAIN_MARKERS) if (text.includes(marker)) add("public-domain");

  for (const marker of OPEN_LICENCE_MARKERS) {
    const index = text.indexOf(marker);
    if (index < 0) continue;
    // On repart de l'espace final du marqueur pour que la fenêtre de version
    // commence bien par une frontière de mot.
    const version = versionNear(text, index + marker.length - 1);
    if (version === "1") add("licence-ouverte-1.0");
    else if (version === "2") add("etalab-2.0");
    else add(LICENCE_ETALAB_DEFAULT_ID);
  }

  // Les sigles « by », « nc », « sa », « nd » ne veulent rien dire hors d'un
  // contexte Creative Commons : « Trace by Jean » n'est pas une licence.
  if (CC_CONTEXT_RE.test(text)) {
    for (const match of text.matchAll(CC_FLAG_RUN_RE)) {
      const flags = new Set(match[1].split(" "));
      for (const id of licencesFromCcFlags(flags)) add(id);
    }
    const spelled = new Set<string>();
    for (const entry of CC_WORD_FLAGS) if (text.includes(entry.marker)) spelled.add(entry.flag);
    for (const id of licencesFromCcFlags(spelled)) add(id);
  }

  return found;
}

/**
 * Licence reconnue dans un texte libre : CGU, balise `<copyright>` d'un GPX,
 * pied de page, URL de licence.
 *
 * Deux garde-fous : les sigles ne sont lus que dans un contexte Creative
 * Commons, et quand plusieurs licences apparaissent c'est la plus
 * **restrictive** qui est retenue — une page qui cite une Licence Ouverte et
 * un « tous droits réservés » n'ouvre rien du tout. Rien de sûr → `unknown`,
 * c'est-à-dire « à vérifier », et non « libre ».
 */
export function detectLicence(text: string | null | undefined): LicenceId {
  if (typeof text !== "string") return LICENCE_DEFAULT_ID;
  const normalised = normaliseLicenceText(text);
  if (normalised.length === 0) return LICENCE_DEFAULT_ID;
  return mostRestrictiveLicence(collectLicenceCandidates(normalised));
}

/* ------------------------------------------------------------------ */
/* 3. Attribution (section 22)                                         */
/* ------------------------------------------------------------------ */

/** Chaîne exploitable, ou `null` : une suite d'espaces n'est pas un nom. */
function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Hôte d'une URL, sans `www.`, extrait par simple lecture de chaîne (aucune
 * résolution, aucun accès réseau). Sert de nom de repli pour une attribution.
 */
function hostOf(url: string | null | undefined): string | null {
  const raw = trimmedOrNull(url);
  if (raw === null) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(raw);
  const host = match === null ? raw.split("/")[0] : match[1];
  const cleaned = host.replace(/^www\./i, "").trim();
  return cleaned.length === 0 ? null : cleaned;
}

/** Construction commune à `attributionLine` et à `reuseDecision`. */
function buildAttribution(
  name: string | null | undefined,
  licence: LicenceId,
  attributionText: string | null | undefined,
  url: string | null | undefined,
): string | null {
  // Une mention imposée par la source prime toujours : elle est contractuelle,
  // et on l'affiche même si la licence n'exigeait rien.
  const imposed = trimmedOrNull(attributionText);
  if (imposed !== null) return imposed;

  const terms = licenceTerms(licence);
  if (!terms.attributionRequired) return null;

  const label = trimmedOrNull(name) ?? hostOf(url) ?? LICENCE_UNNAMED_SOURCE;
  const prefixed = label.startsWith("©") ? label : `© ${label}`;
  return `${prefixed} (${terms.name})`;
}

/**
 * Mention d'attribution à afficher pour une source (section 22).
 *
 * Ordre de préférence : la mention exacte exigée par la source, sinon une
 * mention construite (« © OpenStreetMap contributors (ODbL) »), et `null`
 * seulement quand la licence n'impose aucune attribution.
 */
export function attributionLine(
  source: Pick<DataSource, "name" | "licence" | "attributionText" | "url">,
): string | null {
  return buildAttribution(source.name, source.licence, source.attributionText, source.url);
}

/* ------------------------------------------------------------------ */
/* 4. Décision de réutilisation (sections 2, 5)                        */
/* ------------------------------------------------------------------ */

/** Éléments réunis avant de trancher. Tout est optionnel sauf la licence. */
export interface ReuseDecisionInput {
  licence: LicenceId;
  /** Statut de la source dans le registre, s'il est connu. */
  sourceStatus?: SourceStatus;
  /** Verdict du `robots.txt`, lu ailleurs. `undefined` = non consulté. */
  robotsAllows?: boolean;
  attributionText?: string | null;
  sourceName?: string | null;
  /** Le partage à l'identique a-t-il été accepté par une décision produit ? */
  allowShareAlike?: boolean;
}

/**
 * Ordre d'affichage des blocages, du plus dirimant au plus discutable. Fixé
 * pour que deux exécutions donnent exactement la même liste.
 */
export const LICENCE_BLOCKER_ORDER: readonly ReuseBlocker[] = [
  "source_forbidden",
  "no_commercial_reuse",
  "no_redistribution",
  "no_derivatives",
  "licence_unknown",
  "robots_disallow",
  "share_alike",
];

/** Blocages qui interdisent définitivement : aucun arbitrage humain ne les lèvera. */
export const LICENCE_FORBIDDING_BLOCKERS: readonly ReuseBlocker[] = [
  "source_forbidden",
  "no_commercial_reuse",
  "no_redistribution",
  "no_derivatives",
];

/** Formulation française de chaque blocage, réutilisée telle quelle dans `reason`. */
export const LICENCE_BLOCKER_REASONS: Readonly<Record<ReuseBlocker, string>> = {
  licence_unknown: "la licence n'a pas pu être identifiée",
  no_commercial_reuse: "la licence exclut toute réutilisation commerciale",
  no_redistribution: "la licence interdit la redistribution des données",
  no_derivatives: "la licence interdit les œuvres dérivées, or une géométrie recalée en est une",
  share_alike: "le partage à l'identique imposerait la même licence à nos données dérivées",
  robots_disallow: "le robots.txt de la source refuse la collecte automatique",
  source_forbidden: "la source est marquée interdite dans le registre",
};

/** Blocages triés selon `LICENCE_BLOCKER_ORDER` (sortie déterministe). */
function sortBlockers(blockers: ReadonlySet<ReuseBlocker>): ReuseBlocker[] {
  return LICENCE_BLOCKER_ORDER.filter((blocker) => blockers.has(blocker));
}

/** Phrase affichable au modérateur, construite à partir des motifs retenus. */
function buildReason(
  status: ReuseStatus,
  blockers: readonly ReuseBlocker[],
  terms: LicenceTerms,
  attribution: string | null,
  sourcePending: boolean,
  shareAlikeAccepted: boolean,
): string {
  const parts = blockers.map((blocker) => LICENCE_BLOCKER_REASONS[blocker]);
  if (sourcePending) parts.push(LICENCE_SOURCE_PENDING_REASON);
  if (status === "forbidden") return `Réutilisation refusée : ${parts.join(" ; ")}.`;
  if (status === "review_required") return `Vérification humaine requise : ${parts.join(" ; ")}.`;
  let sentence = `Réutilisation autorisée : ${terms.name}.`;
  if (shareAlikeAccepted) {
    sentence += " Partage à l'identique accepté : nos données dérivées devront porter la même licence.";
  }
  if (attribution !== null) sentence += ` Attribution à afficher : « ${attribution} ».`;
  return sentence;
}

/**
 * La décision unique du système : cette donnée peut-elle entrer ?
 *
 * - `forbidden` : la source est interdite, ou la licence exclut l'usage
 *   commercial, la redistribution ou les dérivés. Rien à arbitrer.
 * - `review_required` : la licence est inconnue, le `robots.txt` refuse la
 *   collecte, le partage à l'identique s'appliquerait, ou la source attend
 *   encore sa validation. Exploitable peut-être, mais c'est une décision
 *   humaine — le partage à l'identique n'est levé que par un
 *   `allowShareAlike: true` explicite.
 * - `approved` : tout est clair.
 *
 * `blockers` liste TOUS les motifs, jamais le premier seulement. Un
 * `sourceStatus: "forbidden"` l'emporte en toute circonstance, et aucune
 * combinaison d'entrées ne peut produire `approved` avec une licence
 * `unknown`.
 */
export function reuseDecision(input: ReuseDecisionInput): ReuseDecision {
  const terms = licenceTerms(input.licence);
  const blockers = new Set<ReuseBlocker>();

  if (input.sourceStatus === "forbidden") blockers.add("source_forbidden");

  if (terms.id === "unknown") {
    // Une licence inconnue n'est pas une licence interdite : on ne constate
    // aucune restriction, on constate qu'on ne sait pas. Le seul motif est
    // donc `licence_unknown`, qui appelle une vérification humaine.
    blockers.add("licence_unknown");
  } else {
    if (!terms.commercialReuse) blockers.add("no_commercial_reuse");
    if (!terms.redistribution) blockers.add("no_redistribution");
    if (!terms.derivativesAllowed) blockers.add("no_derivatives");
    if (terms.shareAlike && input.allowShareAlike !== true) blockers.add("share_alike");
  }

  if (input.robotsAllows === false) blockers.add("robots_disallow");

  const ordered = sortBlockers(blockers);
  const forbidden = ordered.some((blocker) => LICENCE_FORBIDDING_BLOCKERS.includes(blocker));
  // Une source encore en attente de validation ne produit pas de code de
  // blocage (le contrat n'en prévoit pas), mais elle interdit de conclure
  // « approuvé » : l'approbation de la source est un préalable, pas un détail.
  const sourcePending = input.sourceStatus === "review_required";
  const status: ReuseStatus = forbidden
    ? "forbidden"
    : ordered.length > 0 || sourcePending
      ? "review_required"
      : "approved";

  const attribution = buildAttribution(input.sourceName, input.licence, input.attributionText, null);
  const shareAlikeAccepted = status === "approved" && terms.shareAlike;

  return {
    status,
    blockers: ordered,
    attribution,
    reason: buildReason(status, ordered, terms, attribution, sourcePending, shareAlikeAccepted),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Registre des sources (section 4)                                 */
/* ------------------------------------------------------------------ */

/** Instant de la dernière vérification humaine, ou `null` si inexploitable. */
function lastCheckedAtMs(value: string | null): number | null {
  const raw = trimmedOrNull(value);
  if (raw === null) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * Cette source peut-elle alimenter la base **sans intervention humaine** ?
 *
 * Trois conditions cumulatives, aucune facultative :
 *
 * 1. son statut au registre est `approved` (et ni ses droits commerciaux ni
 *    ses droits de redistribution n'ont été constatés absents) ;
 * 2. sa licence passe `reuseDecision` ;
 * 3. quelqu'un a réellement lu ses conditions (`lastCheckedAt` non nul) et
 *    l'a fait il y a moins de `LICENCE_RECHECK_AFTER_DAYS` jours.
 *
 * Le partage à l'identique est accepté ici : approuver une source au registre
 * EST la décision produit que `share_alike` réclame — elle a été prise par un
 * humain, sur cette source, en connaissance de sa licence. Une licence
 * `unknown` reste bloquée quoi qu'il arrive.
 */
export function canAutoImport(source: DataSource, now: number = Date.now()): boolean {
  if (!Number.isFinite(now)) return false;
  if (source.status !== "approved") return false;
  // Constats du registre : ils ne peuvent que fermer, jamais ouvrir. `null`
  // signifie « non renseigné » et laisse la licence trancher.
  if (source.commercialReuseAllowed === false) return false;
  if (source.redistributionAllowed === false) return false;

  const decision = reuseDecision({
    licence: source.licence,
    sourceStatus: source.status,
    attributionText: source.attributionText,
    sourceName: source.name,
    allowShareAlike: true,
  });
  if (decision.status !== "approved") return false;

  const checkedAt = lastCheckedAtMs(source.lastCheckedAt);
  if (checkedAt === null) return false;
  const ageMs = now - checkedAt;
  // Date de vérification dans le futur : horloge décalée, pas une péremption.
  if (ageMs < 0) return true;
  return ageMs <= LICENCE_RECHECK_AFTER_DAYS * DAY_MS;
}

/**
 * Score de fiabilité réellement utilisable pour une source.
 *
 * Une source dont personne n'a jamais vérifié les conditions ne peut pas
 * peser autant qu'une source vérifiée, quel que soit le chiffre inscrit dans
 * le registre : le plafond `UNVERIFIED_RELIABILITY_CAP` s'applique. Le score
 * est par ailleurs ramené dans 0..100, et un chiffre illisible vaut 0 — jamais
 * une confiance par défaut.
 */
export function reliabilityCap(source: DataSource): number {
  const raw = source.reliabilityScore;
  const bounded = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  const verified = lastCheckedAtMs(source.lastCheckedAt) !== null;
  const capped = verified ? bounded : Math.min(bounded, UNVERIFIED_RELIABILITY_CAP);
  return Object.is(capped, -0) ? 0 : capped;
}
