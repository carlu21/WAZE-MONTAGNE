/**
 * Tests de la découverte des sources de traces (sections 1, 2, 3, 5, 16, 23).
 *
 * Toutes les données sont **fabriquées** : les territoires servent de décor, les
 * URL emploient les domaines réservés à la documentation (`example.org`,
 * `example.com`) ou des noms manifestement fictifs, et les pages HTML sont
 * écrites ici. Aucun site réel n'est présenté comme vérifié, aucune trace n'est
 * attribuée à une plateforme existante : le module produit des hypothèses, ces
 * tests vérifient les hypothèses, pas la réalité d'un service tiers.
 */
import { describe, expect, it } from "vitest";
import type { BBox } from "../types";
import type { DiscoveredResource, ReuseStatus, Territory } from "./types";
import {
  DISCOVERY_CONFIDENCE_CERTAIN,
  DISCOVERY_CONFIDENCE_LIKELY,
  DISCOVERY_CONFIDENCE_NONE,
  DISCOVERY_CONFIDENCE_WEAK,
  DISCOVERY_CUSTOM_TERM_PRIORITY,
  DISCOVERY_DEFAULT_QUERY_LIMIT,
  DISCOVERY_MAX_LINKS,
  DISCOVERY_PLACE_WEIGHT_ALIAS,
  DISCOVERY_PLACE_WEIGHT_NAME,
  DISCOVERY_PLACE_WEIGHT_PARENT_FAR,
  DISCOVERY_PLACE_WEIGHT_PARENT_NEAR,
  DISCOVERY_PLAN_STEPS,
  DISCOVERY_POLITE_CRAWL_DELAY_S,
  DISCOVERY_PRIORITY_BROAD,
  DISCOVERY_PRIORITY_CORE,
  DISCOVERY_PRIORITY_HIGH,
  DISCOVERY_PRIORITY_MEDIUM,
  DISCOVERY_RESOURCE_ID_PREFIX,
  DISCOVERY_SOURCE_PRIORITY,
  DISCOVERY_TERMS,
  DISCOVERY_UNNAMED_TERRITORY,
  DISCOVERY_USER_AGENT,
  INSTITUTIONAL_HINTS,
  buildDiscoveryQueries,
  classifySource,
  gpxHints,
  normalizeResourceUrl,
  parseRobotsTxt,
  resourceId,
  robotsAllows,
  robotsCrawlDelay,
  summarizeDiscovery,
  territoryPlan,
} from "./discovery";

/* ------------------------------------------------------------------ */
/* Jeux de données locaux                                              */
/* ------------------------------------------------------------------ */

/** Emprise quelconque : seule sa présence compte pour le plan d'ouverture. */
const BBOX: BBox = { west: 8.9, south: 41.9, east: 9.2, north: 42.1 };

/** Territoire de démonstration : un nom, deux alias, trois rattachements. */
function territory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: "demo-bastelica",
    name: "Bastelica",
    country: "FR",
    parents: ["France", "Corse", "Corse-du-Sud"],
    bbox: BBOX,
    aliases: ["Pozzi", "Val d'Ese"],
    ...overrides,
  };
}

/** Ressource découverte fictive, tous les champs renseignés. */
function resource(overrides: Partial<DiscoveredResource> = {}): DiscoveredResource {
  return {
    id: "res_demo",
    url: "https://example.org/sentier-de-demonstration",
    title: "Sentier de démonstration",
    sourceId: null,
    territory: "demo-bastelica",
    activity: "hiking",
    discoveredAt: 1_700_000_000_000,
    hasGpxFile: false,
    format: "unknown",
    licence: "unknown",
    status: "review_required",
    reason: "Licence non identifiée",
    ...overrides,
  };
}

/** Requête produite pour un libellé donné, ou `undefined` si absente. */
const queryNamed = (queries: readonly { query: string }[], q: string): boolean =>
  queries.some((candidate) => candidate.query === q);

/* ------------------------------------------------------------------ */
/* 1. Termes et requêtes (section 1)                                   */
/* ------------------------------------------------------------------ */

describe("DISCOVERY_TERMS", () => {
  it("fige les dix termes du cahier des charges, dans leur orthographe exacte", () => {
    expect(DISCOVERY_TERMS.map((t) => t.term)).toEqual([
      "randonnée GPX",
      "trace GPX randonnée",
      "télécharger GPX randonnée",
      "sentier GPX",
      "itinéraire randonnée GPX",
      "parcours pédestre GPX",
      "trail GPX",
      "randonnée équestre GPX",
      "VTT GPX",
      "chemin GPX",
    ]);
  });

  it("associe chaque terme d'activité à son mode, et les termes larges à « all »", () => {
    const byTerm = new Map(DISCOVERY_TERMS.map((t) => [t.term, t.activity]));
    expect(byTerm.get("VTT GPX")).toBe("mtb");
    expect(byTerm.get("trail GPX")).toBe("trail");
    expect(byTerm.get("randonnée équestre GPX")).toBe("equestrian");
    expect(byTerm.get("randonnée GPX")).toBe("hiking");
    expect(byTerm.get("chemin GPX")).toBe("all");
    expect(byTerm.get("sentier GPX")).toBe("all");
  });

  it("n'emploie que les priorités déclarées, toutes comprises entre 0 et 1", () => {
    const allowed = [
      DISCOVERY_PRIORITY_CORE,
      DISCOVERY_PRIORITY_HIGH,
      DISCOVERY_PRIORITY_MEDIUM,
      DISCOVERY_PRIORITY_BROAD,
    ];
    for (const term of DISCOVERY_TERMS) {
      expect(allowed).toContain(term.priority);
      expect(term.priority).toBeGreaterThan(0);
      expect(term.priority).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildDiscoveryQueries", () => {
  it("croise les termes avec le nom, les alias et les parents du territoire", () => {
    const queries = buildDiscoveryQueries(territory(), { limit: 200 });
    expect(queryNamed(queries, "randonnée GPX Bastelica")).toBe(true);
    expect(queryNamed(queries, "randonnée GPX Pozzi Bastelica")).toBe(true);
    expect(queryNamed(queries, "randonnée GPX Corse")).toBe(true);
    expect(queries).toHaveLength(DISCOVERY_TERMS.length * 6);
  });

  it("place la requête la plus spécifique en tête et la plus large en queue", () => {
    const queries = buildDiscoveryQueries(territory(), { limit: 200 });
    expect(queries[0].query).toBe("randonnée GPX Bastelica");
    expect(queries[0].priority).toBe(DISCOVERY_PRIORITY_CORE * DISCOVERY_PLACE_WEIGHT_NAME);
    const last = queries[queries.length - 1];
    expect(last.place).toBe("France");
    expect(last.priority).toBe(
      Number((DISCOVERY_PRIORITY_BROAD * DISCOVERY_PLACE_WEIGHT_PARENT_FAR).toFixed(4)),
    );
  });

  it("classe un alias au-dessus du rattachement le plus proche", () => {
    const queries = buildDiscoveryQueries(territory(), { limit: 200 });
    const alias = queries.find((q) => q.place === "Pozzi Bastelica");
    const parent = queries.find((q) => q.place === "Corse-du-Sud");
    expect(alias?.priority).toBe(DISCOVERY_PRIORITY_CORE * DISCOVERY_PLACE_WEIGHT_ALIAS);
    expect(parent?.priority).toBe(DISCOVERY_PRIORITY_CORE * DISCOVERY_PLACE_WEIGHT_PARENT_NEAR);
    expect(alias?.priority).toBeGreaterThan(parent?.priority ?? 1);
  });

  it("trie par priorité décroissante, puis par requête, sans exception", () => {
    const queries = buildDiscoveryQueries(territory(), { limit: 200 });
    for (let i = 1; i < queries.length; i++) {
      const before = queries[i - 1];
      const current = queries[i];
      expect(before.priority).toBeGreaterThanOrEqual(current.priority);
      if (before.priority === current.priority) {
        expect(before.query < current.query).toBe(true);
      }
    }
  });

  it("qualifie un alias par le nom du territoire, sauf s'il le contient déjà", () => {
    const queries = buildDiscoveryQueries(
      territory({ aliases: ["Pozzi", "plateau de Bastelica"] }),
      { terms: ["randonnée GPX"], limit: 50 },
    );
    expect(queryNamed(queries, "randonnée GPX Pozzi Bastelica")).toBe(true);
    expect(queryNamed(queries, "randonnée GPX plateau de Bastelica")).toBe(true);
  });

  it("borne le nombre de requêtes à `limit`", () => {
    expect(buildDiscoveryQueries(territory(), { limit: 5 })).toHaveLength(5);
  });

  it("ne produit aucune requête avec une limite à 0", () => {
    expect(buildDiscoveryQueries(territory(), { limit: 0 })).toEqual([]);
  });

  it("traite une limite négative comme « aucune requête », et une limite illisible comme le défaut", () => {
    expect(buildDiscoveryQueries(territory(), { limit: -3 })).toEqual([]);
    expect(buildDiscoveryQueries(territory(), { limit: Number.NaN })).toHaveLength(
      DISCOVERY_DEFAULT_QUERY_LIMIT,
    );
  });

  it("applique la limite par défaut quand elle n'est pas précisée", () => {
    expect(buildDiscoveryQueries(territory())).toHaveLength(DISCOVERY_DEFAULT_QUERY_LIMIT);
  });

  it("fonctionne sur un territoire sans alias ni parent", () => {
    const queries = buildDiscoveryQueries(
      territory({ aliases: [], parents: [], name: "Val d'Anniviers", id: "demo-anniviers", country: "CH" }),
      { limit: 100 },
    );
    expect(queries).toHaveLength(DISCOVERY_TERMS.length);
    expect(queries.every((q) => q.place === "Val d'Anniviers")).toBe(true);
  });

  it("ne produit rien quand le territoire n'offre aucun qualificatif exploitable", () => {
    expect(
      buildDiscoveryQueries(territory({ name: "   ", aliases: ["", " "], parents: [] })),
    ).toEqual([]);
  });

  it("dédoublonne les alias répétés et l'alias identique au nom", () => {
    const queries = buildDiscoveryQueries(
      territory({ aliases: ["Pozzi", "Pozzi", "pozzi", "Bastelica"], parents: [] }),
      { terms: ["randonnée GPX"], limit: 50 },
    );
    expect(queries.map((q) => q.query)).toEqual([
      "randonnée GPX Bastelica",
      "randonnée GPX Pozzi Bastelica",
    ]);
  });

  it("garde la priorité la plus forte quand deux qualificatifs donnent la même requête", () => {
    const queries = buildDiscoveryQueries(
      territory({ aliases: ["Bastelica"], parents: ["Bastelica"] }),
      { terms: ["randonnée GPX"], limit: 50 },
    );
    expect(queries).toHaveLength(1);
    expect(queries[0].priority).toBe(DISCOVERY_PRIORITY_CORE * DISCOVERY_PLACE_WEIGHT_NAME);
  });

  it("écarte les alias quand `includeAliases` vaut false", () => {
    const queries = buildDiscoveryQueries(territory(), { includeAliases: false, limit: 200 });
    expect(queries.some((q) => q.place.startsWith("Pozzi"))).toBe(false);
    expect(queries).toHaveLength(DISCOVERY_TERMS.length * 4);
  });

  it("filtre par activité en conservant les termes « all »", () => {
    const queries = buildDiscoveryQueries(territory(), { activities: ["mtb"], limit: 200 });
    const terms = new Set(queries.map((q) => q.term));
    expect(terms).toEqual(new Set(["VTT GPX", "sentier GPX", "chemin GPX"]));
  });

  it("ne filtre rien quand la liste d'activités est vide", () => {
    const queries = buildDiscoveryQueries(territory(), { activities: [], limit: 200 });
    expect(new Set(queries.map((q) => q.term)).size).toBe(DISCOVERY_TERMS.length);
  });

  it("respecte les termes imposés et leur rend leur activité quand ils sont connus", () => {
    const queries = buildDiscoveryQueries(territory(), { terms: ["VTT GPX"], limit: 10 });
    expect(queries.every((q) => q.term === "VTT GPX" && q.activity === "mtb")).toBe(true);
  });

  it("accepte un terme inédit avec la priorité des termes fournis par l'appelant", () => {
    const queries = buildDiscoveryQueries(territory({ parents: [], aliases: [] }), {
      terms: ["raquettes GPX"],
      limit: 10,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      term: "raquettes GPX",
      activity: "all",
      priority: DISCOVERY_CUSTOM_TERM_PRIORITY,
    });
  });

  it("retombe sur le catalogue quand la liste de termes est vide, et ne produit rien si elle est illisible", () => {
    expect(new Set(buildDiscoveryQueries(territory(), { terms: [], limit: 200 }).map((q) => q.term)).size).toBe(
      DISCOVERY_TERMS.length,
    );
    expect(buildDiscoveryQueries(territory(), { terms: ["  ", ""] })).toEqual([]);
  });

  it("produit exactement la même liste à deux exécutions, et quel que soit l'ordre des alias", () => {
    const first = buildDiscoveryQueries(territory(), { limit: 200 });
    const second = buildDiscoveryQueries(territory(), { limit: 200 });
    const shuffled = buildDiscoveryQueries(territory({ aliases: ["Val d'Ese", "Pozzi"] }), { limit: 200 });
    expect(second).toEqual(first);
    expect(shuffled).toEqual(first);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Classement des sources (section 2)                               */
/* ------------------------------------------------------------------ */

describe("classifySource", () => {
  it("place les données ouvertes et les institutions devant les plateformes", () => {
    expect(DISCOVERY_SOURCE_PRIORITY.open_data).toBeGreaterThan(DISCOVERY_SOURCE_PRIORITY.platform);
    expect(DISCOVERY_SOURCE_PRIORITY.institutional).toBeGreaterThan(DISCOVERY_SOURCE_PRIORITY.club);
    expect(DISCOVERY_SOURCE_PRIORITY.geotrek).toBeGreaterThan(DISCOVERY_SOURCE_PRIORITY.platform);
  });

  it("reconnaît un sous-domaine de la plateforme nationale de données ouvertes", () => {
    expect(classifySource("https://exemple-fictif.data.gouv.fr/datasets/sentiers")).toEqual({
      type: "open_data",
      priority: DISCOVERY_SOURCE_PRIORITY.open_data,
      confidence: DISCOVERY_CONFIDENCE_CERTAIN,
    });
  });

  it("reconnaît un portail open data territorial à son chemin", () => {
    const result = classifySource("https://opendata.exemple-departement.example.org/dataset/sentiers");
    expect(result.type).toBe("open_data");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_LIKELY);
  });

  it("reconnaît une instance Geotrek à son chemin d'API", () => {
    expect(classifySource("https://rando.exemple-parc.example.org/api/v2/trek/?format=json")).toEqual({
      type: "geotrek",
      priority: DISCOVERY_SOURCE_PRIORITY.geotrek,
      confidence: DISCOVERY_CONFIDENCE_CERTAIN,
    });
  });

  it("reconnaît une instance Geotrek nommée, avec une confiance moindre", () => {
    const result = classifySource("https://geotrek.exemple-collectivite.example.org/itineraires");
    expect(result.type).toBe("geotrek");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_LIKELY);
  });

  it("reconnaît une source OpenStreetMap", () => {
    const result = classifySource("https://overpass.example.org/api/interpreter?data=...");
    expect(result.type).toBe("osm");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_CERTAIN);
  });

  it("classe un domaine en .gouv.fr comme institutionnel", () => {
    const result = classifySource("https://exemple-collectivite-fictive.gouv.fr/sentiers");
    expect(result.type).toBe("institutional");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_CERTAIN);
  });

  it("classe un domaine de collectivité à son vocabulaire", () => {
    const result = classifySource("https://www.parc-naturel-exemple.fr/randonnees/telecharger");
    expect(result.type).toBe("institutional");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_LIKELY);
  });

  it("ne confond pas un mot contenant un indice court avec une institution", () => {
    // « design » contient « ign » : les indices institutionnels se cherchent en
    // mots entiers, jamais en sous-chaîne.
    expect(classifySource("https://design-example.example.org/page").type).not.toBe("institutional");
  });

  it("distingue un club d'une plateforme", () => {
    expect(classifySource("https://club-exemple.example.org/traces").type).toBe("club");
    expect(classifySource("https://exemple-rando.example.org/gpx/telecharger").type).toBe("platform");
  });

  it("se rabat sur le titre et le texte quand l'URL ne dit rien", () => {
    const result = classifySource("https://example.org/page-1", {
      title: "Office de tourisme fictif — sentiers balisés",
    });
    expect(result.type).toBe("institutional");
    expect(result.confidence).toBe(DISCOVERY_CONFIDENCE_WEAK);
  });

  it("répond « je ne sais pas » sans indice : l'hypothèse la moins permissive, presque sans confiance", () => {
    const result = classifySource("https://example.org/page-2");
    expect(result).toEqual({
      type: "platform",
      priority: DISCOVERY_SOURCE_PRIORITY.platform,
      confidence: DISCOVERY_CONFIDENCE_NONE,
    });
  });

  it("ne jette pas sur une URL vide, illisible ou sur des indices nuls", () => {
    expect(classifySource("").type).toBe("platform");
    expect(classifySource("pas une url du tout").confidence).toBe(DISCOVERY_CONFIDENCE_NONE);
    expect(classifySource("https://example.org/x", { title: null, body: null }).type).toBe("platform");
  });

  it("n'affirme jamais une classification avec une confiance de 1", () => {
    const urls = [
      "https://exemple-fictif.data.gouv.fr/datasets/sentiers",
      "https://rando.exemple-parc.example.org/api/v2/trek/",
      "https://exemple-collectivite-fictive.gouv.fr/",
      "https://example.org/inconnu",
    ];
    for (const url of urls) {
      const result = classifySource(url);
      expect(result.confidence).toBeLessThan(1);
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it("expose des indices institutionnels non vides et sans accent (comparaison repliée)", () => {
    expect(INSTITUTIONAL_HINTS.length).toBeGreaterThan(5);
    for (const hint of INSTITUTIONAL_HINTS) {
      expect(hint).toBe(hint.toLowerCase());
      expect(hint.normalize("NFD")).toBe(hint);
      expect(hint.trim()).toBe(hint);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Indices d'une page (section 1)                                   */
/* ------------------------------------------------------------------ */

describe("gpxHints", () => {
  it("repère un lien relatif et le rend tel quel", () => {
    const html = '<a href="/traces/sentier-de-demonstration.gpx">Télécharger GPX</a>';
    const hints = gpxHints(html);
    expect(hints.links).toEqual(["/traces/sentier-de-demonstration.gpx"]);
    expect(hints.mentionsGpx).toBe(true);
  });

  it("repère aussi les fichiers KML et GeoJSON", () => {
    const html = `
      <a href="https://example.org/a.kml">KML</a>
      <a href='https://example.org/b.geojson'>GeoJSON</a>
    `;
    expect(gpxHints(html).links).toEqual(["https://example.org/a.kml", "https://example.org/b.geojson"]);
  });

  it("décode les entités pour ne pas couper une URL à paramètres", () => {
    const html = '<a href="https://example.org/t.gpx?a=1&amp;b=2">trace</a>';
    expect(gpxHints(html).links).toEqual(["https://example.org/t.gpx?a=1&b=2"]);
  });

  it("ne confond pas une archive avec une trace", () => {
    expect(gpxHints('<a href="/paquet.gpxzip">archive</a>').links).toEqual([]);
  });

  it("retire les doublons exacts en conservant l'ordre d'apparition", () => {
    const html = '<a href="/b.gpx">b</a><a href="/a.gpx">a</a><a href="/b.gpx">b bis</a>';
    expect(gpxHints(html).links).toEqual(["/b.gpx", "/a.gpx"]);
  });

  it("borne le nombre de liens rapportés", () => {
    const html = Array.from({ length: DISCOVERY_MAX_LINKS + 50 }, (_, i) => `<a href="/t-${i}.gpx">t</a>`).join("");
    expect(gpxHints(html).links).toHaveLength(DISCOVERY_MAX_LINKS);
  });

  it("repère les formulations de téléchargement même sans lien de trace", () => {
    expect(gpxHints("<p>Export GPX sur demande</p>").mentionsGpx).toBe(true);
    expect(gpxHints("<p>Téléchargez le GPX de l'itinéraire</p>").mentionsGpx).toBe(false);
    expect(gpxHints("<p>Télécharger GPX</p>").mentionsGpx).toBe(true);
  });

  it("signale un accès programmatique et une mention de licence", () => {
    const html = `
      <h1>Sentier de démonstration</h1>
      <p>API GPX documentée. Données publiées sous Licence Ouverte 2.0.</p>
    `;
    const hints = gpxHints(html);
    expect(hints.mentionsApi).toBe(true);
    expect(hints.mentionsLicence).toBe(true);
  });

  it("ne voit ni API ni licence là où il n'y en a pas", () => {
    const hints = gpxHints("<p>Une jolie boucle au départ du village.</p>");
    expect(hints.mentionsApi).toBe(false);
    expect(hints.mentionsLicence).toBe(false);
    expect(hints.mentionsGpx).toBe(false);
    expect(hints.links).toEqual([]);
  });

  it("tient sur une page vide, sans balise ou malformée", () => {
    expect(gpxHints("")).toEqual({ links: [], mentionsGpx: false, mentionsApi: false, mentionsLicence: false });
    expect(gpxHints("<<<>>> &amp;&amp; <a href=").links).toEqual([]);
    expect(gpxHints("trace.gpx").links).toEqual(["trace.gpx"]);
  });

  it("ignore le contenu des scripts pour les formulations, pas pour les liens", () => {
    const html = '<script>var x = "/data/a.gpx";</script><p>Rien à signaler</p>';
    const hints = gpxHints(html);
    expect(hints.links).toEqual(["/data/a.gpx"]);
    expect(hints.mentionsGpx).toBe(true);
  });

  it("donne exactement le même résultat à deux lectures de la même page", () => {
    const html = '<a href="/a.gpx">Télécharger GPX</a><p>Licence ouverte</p>';
    expect(gpxHints(html)).toEqual(gpxHints(html));
  });
});

/* ------------------------------------------------------------------ */
/* 4. robots.txt (section 3)                                           */
/* ------------------------------------------------------------------ */

describe("parseRobotsTxt / robotsAllows", () => {
  it("autorise tout quand le fichier est vide ou illisible", () => {
    expect(robotsAllows(parseRobotsTxt(""), "/quoi-que-ce-soit")).toBe(true);
    expect(robotsAllows(parseRobotsTxt("\n\n   \n"), "/x")).toBe(true);
    expect(robotsAllows(parseRobotsTxt("n'importe quoi sans deux-points"), "/x")).toBe(true);
  });

  it("applique une interdiction simple du groupe générique", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /prive");
    expect(robotsAllows(rules, "/prive/page")).toBe(false);
    expect(robotsAllows(rules, "/public/page")).toBe(true);
  });

  it("traite un `Disallow:` vide comme « tout est autorisé »", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(rules.groups[0].rules).toEqual([]);
    expect(robotsAllows(rules, "/prive")).toBe(true);
  });

  it("fait gagner la règle la plus longue, même quand c'est un Allow", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /data\nAllow: /data/public");
    expect(robotsAllows(rules, "/data/public/sentier.gpx")).toBe(true);
    expect(robotsAllows(rules, "/data/interne")).toBe(false);
  });

  it("fait gagner Allow à spécificité égale", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /a\nAllow: /a");
    expect(robotsAllows(rules, "/a/b")).toBe(true);
  });

  it("comprend le joker `*` au milieu d'un motif", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /*/prive");
    expect(robotsAllows(rules, "/section/prive/page")).toBe(false);
    expect(robotsAllows(rules, "/section/public")).toBe(true);
  });

  it("comprend l'ancre `$` de fin de chemin", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$");
    expect(robotsAllows(rules, "/docs/notice.pdf")).toBe(false);
    expect(robotsAllows(rules, "/docs/notice.pdf?page=2")).toBe(true);
    expect(robotsAllows(rules, "/docs/trace.gpx")).toBe(true);
  });

  it("fait primer le groupe nommant l'agent sur le groupe générique", () => {
    const text = [
      "User-agent: *",
      "Disallow: /",
      "",
      `User-agent: ${DISCOVERY_USER_AGENT.toLowerCase()}`,
      "Allow: /traces",
      "Disallow: /prive",
    ].join("\n");
    const rules = parseRobotsTxt(text);
    expect(robotsAllows(rules, "/traces/a.gpx")).toBe(true);
    expect(robotsAllows(rules, "/prive/a.gpx")).toBe(false);
    expect(robotsAllows(rules, "/autre", "UnAutreBot")).toBe(false);
  });

  it("reconnaît l'agent malgré sa version et sa casse", () => {
    const rules = parseRobotsTxt(`User-agent: ${DISCOVERY_USER_AGENT}\nDisallow: /x`);
    expect(robotsAllows(rules, "/x", `${DISCOVERY_USER_AGENT}/2.1 (+https://example.org)`)).toBe(false);
    expect(robotsAllows(rules, "/x", DISCOVERY_USER_AGENT.toUpperCase())).toBe(false);
  });

  it("cumule plusieurs blocs visant le même agent", () => {
    const rules = parseRobotsTxt(
      ["User-agent: *", "Disallow: /a", "", "User-agent: *", "Disallow: /b"].join("\n"),
    );
    expect(rules.groups).toHaveLength(2);
    expect(robotsAllows(rules, "/a")).toBe(false);
    expect(robotsAllows(rules, "/b")).toBe(false);
    expect(robotsAllows(rules, "/c")).toBe(true);
  });

  it("regroupe des `User-agent` consécutifs dans un même groupe", () => {
    const rules = parseRobotsTxt("User-agent: BotA\nUser-agent: BotB\nDisallow: /x");
    expect(rules.groups).toHaveLength(1);
    expect(rules.groups[0].agents).toEqual(["bota", "botb"]);
    expect(robotsAllows(rules, "/x", "BotB")).toBe(false);
    expect(robotsAllows(rules, "/x", "BotC")).toBe(true);
  });

  it("survit au BOM, aux commentaires et aux fins de ligne mêlées", () => {
    const text = "﻿# robots de démonstration\r\nUSER-AGENT: *  # tout le monde\rDisallow: /prive # interne\r\n";
    const rules = parseRobotsTxt(text);
    expect(rules.groups).toHaveLength(1);
    expect(robotsAllows(rules, "/prive")).toBe(false);
    expect(robotsAllows(rules, "/ouvert")).toBe(true);
  });

  it("rattache au groupe générique les directives écrites avant tout User-agent", () => {
    const rules = parseRobotsTxt("Disallow: /prive\nUser-agent: BotA\nDisallow: /a");
    expect(rules.groups[0].agents).toEqual(["*"]);
    expect(robotsAllows(rules, "/prive", "BotInconnu")).toBe(false);
  });

  it("accepte une URL complète autant qu'un chemin", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /prive");
    expect(robotsAllows(rules, "https://example.org/prive/page?x=1")).toBe(false);
    expect(robotsAllows(rules, "prive")).toBe(false);
    expect(robotsAllows(rules, "")).toBe(true);
  });

  it("collecte les sitemaps et ignore les champs inconnus sans rompre le groupe", () => {
    const rules = parseRobotsTxt(
      [
        "Sitemap: https://example.org/sitemap.xml",
        "User-agent: *",
        "Host: example.org",
        "Disallow: /prive",
      ].join("\n"),
    );
    expect(rules.sitemaps).toEqual(["https://example.org/sitemap.xml"]);
    expect(robotsAllows(rules, "/prive")).toBe(false);
  });

  it("lit le Crawl-delay et ne descend jamais sous le plancher de politesse", () => {
    const patient = parseRobotsTxt("User-agent: *\nCrawl-delay: 12\nDisallow: /prive");
    expect(patient.crawlDelay).toBe(12);
    expect(robotsCrawlDelay(patient)).toBe(12);

    const pressé = parseRobotsTxt("User-agent: *\nCrawl-delay: 0.5");
    expect(robotsCrawlDelay(pressé)).toBe(DISCOVERY_POLITE_CRAWL_DELAY_S);
    expect(robotsCrawlDelay(parseRobotsTxt(""))).toBe(DISCOVERY_POLITE_CRAWL_DELAY_S);
  });

  it("préfère le Crawl-delay du groupe nommant l'agent", () => {
    const rules = parseRobotsTxt(
      ["User-agent: *", "Crawl-delay: 30", "", `User-agent: ${DISCOVERY_USER_AGENT}`, "Crawl-delay: 9"].join("\n"),
    );
    expect(robotsCrawlDelay(rules)).toBe(9);
    expect(robotsCrawlDelay(rules, "AutreBot")).toBe(30);
  });

  it("donne le même verdict à deux analyses du même fichier", () => {
    const text = "User-agent: *\nDisallow: /data\nAllow: /data/public\nCrawl-delay: 7";
    expect(parseRobotsTxt(text)).toEqual(parseRobotsTxt(text));
    expect(robotsAllows(parseRobotsTxt(text), "/data/public/a.gpx")).toBe(
      robotsAllows(parseRobotsTxt(text), "/data/public/a.gpx"),
    );
  });
});

/* ------------------------------------------------------------------ */
/* 5. Identité d'une ressource (section 5)                             */
/* ------------------------------------------------------------------ */

describe("resourceId / normalizeResourceUrl", () => {
  it("normalise le schéma, l'hôte, le « www. », le fragment et la barre oblique finale", () => {
    expect(normalizeResourceUrl("HTTPS://WWW.Example.ORG/Traces/?#ancre")).toBe(
      "https://example.org/Traces",
    );
    expect(normalizeResourceUrl("https://example.org")).toBe("https://example.org/");
    expect(normalizeResourceUrl("https://example.org/")).toBe("https://example.org/");
  });

  it("retire les paramètres de suivi et trie les autres", () => {
    expect(
      normalizeResourceUrl("https://example.org/t.gpx?utm_source=lettre&b=2&a=1&fbclid=xyz"),
    ).toBe("https://example.org/t.gpx?a=1&b=2");
  });

  it("donne le même identifiant à deux écritures équivalentes", () => {
    const a = resourceId("https://www.Example.org/traces/sentier-de-demonstration.gpx?utm_campaign=x#haut");
    const b = resourceId("https://example.org/traces/sentier-de-demonstration.gpx");
    expect(a).toBe(b);
  });

  it("distingue deux ressources différentes, y compris par la casse du chemin", () => {
    expect(resourceId("https://example.org/a.gpx")).not.toBe(resourceId("https://example.org/b.gpx"));
    expect(resourceId("https://example.org/A.gpx")).not.toBe(resourceId("https://example.org/a.gpx"));
  });

  it("produit un identifiant préfixé, stable et de longueur constante", () => {
    const id = resourceId("https://example.org/traces/a.gpx");
    expect(id.startsWith(DISCOVERY_RESOURCE_ID_PREFIX)).toBe(true);
    expect(id).toHaveLength(DISCOVERY_RESOURCE_ID_PREFIX.length + 16);
    expect(resourceId("https://example.org/traces/a.gpx")).toBe(id);
  });

  it("ne jette ni ne produit d'identifiant vide sur une entrée dégénérée", () => {
    for (const input of ["", "   ", "pas une url", "https://", "mailto:contact@example.org"]) {
      const id = resourceId(input);
      expect(id.startsWith(DISCOVERY_RESOURCE_ID_PREFIX)).toBe(true);
      expect(id).toHaveLength(DISCOVERY_RESOURCE_ID_PREFIX.length + 16);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. Plan d'ouverture d'un territoire (section 23)                    */
/* ------------------------------------------------------------------ */

describe("territoryPlan", () => {
  it("énumère les huit étapes, numérotées dans l'ordre du cahier des charges", () => {
    const plan = territoryPlan(territory());
    expect(plan).toHaveLength(8);
    expect(plan.map((step) => step.key)).toEqual([
      "osm_network",
      "open_data",
      "geotrek",
      "gpx_search",
      "compare",
      "build_graph",
      "coverage_gaps",
      "community",
    ]);
    expect(plan.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("dit quelles étapes ont besoin du réseau : les quatre collectes, pas les quatre traitements", () => {
    const plan = territoryPlan(territory());
    expect(plan.filter((step) => step.requiresNetwork).map((step) => step.key)).toEqual([
      "osm_network",
      "open_data",
      "geotrek",
      "gpx_search",
    ]);
  });

  it("donne à chaque étape un libellé et un détail en français, rappelant le périmètre", () => {
    const plan = territoryPlan(territory());
    for (const step of plan) {
      expect(step.label.length).toBeGreaterThan(3);
      expect(step.detail).toContain("Périmètre : Bastelica (FR), emprise connue.");
    }
    expect(plan.map((step) => step.label)).toEqual(DISCOVERY_PLAN_STEPS.map((step) => step.label));
  });

  it("signale une emprise manquante au lieu de l'inventer", () => {
    const plan = territoryPlan(territory({ bbox: null }));
    expect(plan[0].detail).toContain("emprise à définir");
  });

  it("se rabat sur l'identifiant puis sur un libellé neutre quand le nom manque", () => {
    expect(territoryPlan(territory({ name: "  " }))[0].detail).toContain("Périmètre : demo-bastelica");
    expect(territoryPlan(territory({ name: "", id: "", country: "" }))[0].detail).toContain(
      `Périmètre : ${DISCOVERY_UNNAMED_TERRITORY}`,
    );
  });

  it("produit deux plans identiques pour le même territoire", () => {
    expect(territoryPlan(territory())).toEqual(territoryPlan(territory()));
  });
});

/* ------------------------------------------------------------------ */
/* 7. Bilan de campagne (section 16)                                   */
/* ------------------------------------------------------------------ */

describe("summarizeDiscovery", () => {
  it("compte les ressources par statut et par format", () => {
    const summary = summarizeDiscovery([
      resource({ status: "approved", format: "gpx", hasGpxFile: true }),
      resource({ status: "approved", format: "api" }),
      resource({ status: "review_required", format: "gpx", hasGpxFile: true }),
      resource({ status: "forbidden", format: "kml" }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byStatus).toEqual({ approved: 2, review_required: 1, forbidden: 1 });
    expect(summary.byFormat).toEqual({ gpx: 2, kml: 1, geojson: 0, api: 1, unknown: 0 });
    expect(summary.withGpx).toBe(2);
  });

  it("ne compte comme GPX que les fichiers constatés, pas les formats annoncés", () => {
    const summary = summarizeDiscovery([resource({ format: "gpx", hasGpxFile: false })]);
    expect(summary.byFormat.gpx).toBe(1);
    expect(summary.withGpx).toBe(0);
  });

  it("rend un bilan à zéro, toutes clés présentes, sur une liste vide", () => {
    expect(summarizeDiscovery([])).toEqual({
      total: 0,
      byStatus: { approved: 0, review_required: 0, forbidden: 0 },
      byFormat: { gpx: 0, kml: 0, geojson: 0, api: 0, unknown: 0 },
      withGpx: 0,
    });
  });

  it("range un statut inattendu dans « à vérifier », jamais dans « approuvé »", () => {
    // Donnée abîmée : le statut ne fait pas partie du contrat.
    const abîmée = resource({ status: "bizarre" as ReuseStatus });
    const summary = summarizeDiscovery([abîmée]);
    expect(summary.byStatus.approved).toBe(0);
    expect(summary.byStatus.review_required).toBe(1);
    expect(summary.total).toBe(1);
  });

  it("range un format inattendu dans « unknown »", () => {
    const abîmée = resource({ format: "shapefile" as DiscoveredResource["format"] });
    expect(summarizeDiscovery([abîmée]).byFormat).toEqual({
      gpx: 0,
      kml: 0,
      geojson: 0,
      api: 0,
      unknown: 1,
    });
  });

  it("n'invente aucun nombre : il ne compte que ce qu'on lui donne", () => {
    const one = summarizeDiscovery([resource()]);
    expect(one.total).toBe(1);
    expect(one.byStatus.approved + one.byStatus.review_required + one.byStatus.forbidden).toBe(1);
  });

  it("donne le même bilan à deux exécutions, clés comprises", () => {
    const list = [resource({ status: "approved", format: "gpx", hasGpxFile: true }), resource()];
    const first = summarizeDiscovery(list);
    expect(summarizeDiscovery(list)).toEqual(first);
    expect(Object.keys(first.byFormat)).toEqual(["gpx", "kml", "geojson", "api", "unknown"]);
  });
});
