/**
 * Tests de la barrière juridique de la collecte (sections 2, 3, 4 et 22).
 *
 * Toutes les données sont manifestement fictives (« example.org », « Sentiers
 * de démonstration ») : aucun test ne prétend décrire les conditions réelles
 * d'une plateforme existante. Seuls les textes de licence eux-mêmes (ODbL,
 * Creative Commons, Licence Ouverte) sont authentiques, puisque c'est
 * précisément ce que le module doit savoir reconnaître.
 */
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../time";
import { UNVERIFIED_RELIABILITY_CAP, type DataSource, type LicenceId, type SourceStatus } from "./types";
import {
  LICENCES,
  LICENCE_BLOCKER_ORDER,
  LICENCE_BLOCKER_REASONS,
  LICENCE_DEFAULT_ID,
  LICENCE_ETALAB_DEFAULT_ID,
  LICENCE_FORBIDDING_BLOCKERS,
  LICENCE_IDS,
  LICENCE_RECHECK_AFTER_DAYS,
  LICENCE_RESTRICTION_RANK,
  LICENCE_SOURCE_PENDING_REASON,
  LICENCE_UNNAMED_SOURCE,
  LICENCE_VERSION_WINDOW_CHARS,
  attributionLine,
  canAutoImport,
  detectLicence,
  isLicenceId,
  licenceTerms,
  mostRestrictiveLicence,
  reliabilityCap,
  reuseDecision,
} from "./licence";

/* ------------------------------------------------------------------ */
/* Jeux de données locaux (tous fictifs)                               */
/* ------------------------------------------------------------------ */

/** 15 septembre 2026, midi UTC : instant de référence de tous les tests. */
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

/** Date ISO située `days` jours avant `NOW`. */
const daysBefore = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();

/** Source de démonstration : approuvée, vérifiée hier, sous Licence Ouverte. */
function makeSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: "src-demo",
    name: "Sentiers de démonstration",
    url: "https://example.org/sentiers",
    type: "open_data",
    country: "FR",
    territory: null,
    licence: "etalab-2.0",
    licenceUrl: "https://example.org/sentiers/licence",
    commercialReuseAllowed: null,
    redistributionAllowed: null,
    attributionRequired: true,
    attributionText: null,
    apiAvailable: false,
    apiUrl: null,
    lastCheckedAt: daysBefore(1),
    reliabilityScore: 80,
    status: "approved",
    notes: null,
    ...overrides,
  };
}

/** Les trois statuts possibles d'une source au registre. */
const STATUSES: readonly SourceStatus[] = ["approved", "review_required", "forbidden"];

/**
 * Identifiant hors contrat obtenu sans `as` : simule un champ recopié d'une
 * base ancienne ou d'une API tierce.
 */
const LICENCE_HORS_CONTRAT: LicenceId = JSON.parse('"licence-imaginaire"');

/* ------------------------------------------------------------------ */
/* 1. Table des licences                                               */
/* ------------------------------------------------------------------ */

describe("LICENCES — droits réels de chaque licence", () => {
  it("couvre exactement les identifiants du contrat, chacun cohérent avec sa clé", () => {
    expect(Object.keys(LICENCES).sort()).toEqual([...LICENCE_IDS].sort());
    for (const id of LICENCE_IDS) {
      expect(LICENCES[id].id).toBe(id);
      expect(LICENCES[id].name.length).toBeGreaterThan(0);
    }
  });

  it("ODbL : commercial, redistribution et dérivés autorisés, attribution et partage imposés", () => {
    expect(LICENCES.odbl).toMatchObject({
      commercialReuse: true,
      redistribution: true,
      attributionRequired: true,
      shareAlike: true,
      derivativesAllowed: true,
    });
  });

  it("CC-BY-NC et CC-BY-NC-SA excluent la réutilisation commerciale", () => {
    expect(LICENCES["cc-by-nc"].commercialReuse).toBe(false);
    expect(LICENCES["cc-by-nc-sa"].commercialReuse).toBe(false);
    expect(LICENCES["cc-by-nc-sa"].shareAlike).toBe(true);
  });

  it("CC-BY-ND interdit les dérivés (une géométrie recalée en est un)", () => {
    expect(LICENCES["cc-by-nd"].derivativesAllowed).toBe(false);
    expect(LICENCES["cc-by-nd"].commercialReuse).toBe(true);
  });

  it("Licence Ouverte 1.0 et 2.0 : très permissives, attribution obligatoire", () => {
    for (const id of ["etalab-2.0", "licence-ouverte-1.0"] as const) {
      expect(LICENCES[id]).toMatchObject({
        commercialReuse: true,
        redistribution: true,
        attributionRequired: true,
        shareAlike: false,
        derivativesAllowed: true,
      });
    }
  });

  it("CC0 et domaine public : tout autorisé, aucune attribution imposée", () => {
    for (const id of ["cc0", "public-domain"] as const) {
      expect(LICENCES[id]).toMatchObject({
        commercialReuse: true,
        redistribution: true,
        attributionRequired: false,
        derivativesAllowed: true,
      });
    }
  });

  it("unknown et proprietary : aucun droit accordé", () => {
    for (const id of ["unknown", "proprietary"] as const) {
      expect(LICENCES[id]).toMatchObject({
        commercialReuse: false,
        redistribution: false,
        attributionRequired: false,
        shareAlike: false,
        derivativesAllowed: false,
      });
    }
  });

  it("licenceTerms retombe sur `unknown` pour un identifiant hors contrat", () => {
    expect(licenceTerms(LICENCE_HORS_CONTRAT).id).toBe("unknown");
    expect(licenceTerms("cc-by").id).toBe("cc-by");
  });

  it("isLicenceId refuse ce qui n'est pas du contrat, y compris null et un nombre", () => {
    expect(isLicenceId("odbl")).toBe(true);
    expect(isLicenceId("licence-imaginaire")).toBe(false);
    expect(isLicenceId(null)).toBe(false);
    expect(isLicenceId(42)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Rangs de restriction                                             */
/* ------------------------------------------------------------------ */

describe("LICENCE_RESTRICTION_RANK — arbitrage entre licences", () => {
  it("attribue un rang distinct à chaque licence du contrat", () => {
    const ranks = LICENCE_IDS.map((id) => LICENCE_RESTRICTION_RANK[id]);
    expect(ranks.length).toBe(new Set(ranks).size);
  });

  it("classe proprietary au-dessus de tout et le domaine public en dessous", () => {
    for (const id of LICENCE_IDS) {
      if (id !== "proprietary") {
        expect(LICENCE_RESTRICTION_RANK.proprietary).toBeGreaterThan(LICENCE_RESTRICTION_RANK[id]);
      }
      if (id !== "public-domain") {
        expect(LICENCE_RESTRICTION_RANK["public-domain"]).toBeLessThan(LICENCE_RESTRICTION_RANK[id]);
      }
    }
  });

  it("mostRestrictiveLicence retient la plus fermée, quel que soit l'ordre de la liste", () => {
    expect(mostRestrictiveLicence(["cc0", "odbl", "cc-by-nc"])).toBe("cc-by-nc");
    expect(mostRestrictiveLicence(["cc-by-nc", "odbl", "cc0"])).toBe("cc-by-nc");
  });

  it("mostRestrictiveLicence vaut `unknown` sur une liste vide ou illisible", () => {
    expect(mostRestrictiveLicence([])).toBe(LICENCE_DEFAULT_ID);
    expect(mostRestrictiveLicence([LICENCE_HORS_CONTRAT])).toBe(LICENCE_DEFAULT_ID);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Détection de licence                                             */
/* ------------------------------------------------------------------ */

describe("detectLicence — reconnaissance dans un texte libre", () => {
  it("renvoie `unknown` sur null, undefined, vide ou purement typographique", () => {
    expect(detectLicence(null)).toBe(LICENCE_DEFAULT_ID);
    expect(detectLicence(undefined)).toBe(LICENCE_DEFAULT_ID);
    expect(detectLicence("")).toBe(LICENCE_DEFAULT_ID);
    expect(detectLicence("   ")).toBe(LICENCE_DEFAULT_ID);
    expect(detectLicence("©®™ — /// ")).toBe(LICENCE_DEFAULT_ID);
  });

  it("renvoie `unknown` sur un texte sans mention de droits", () => {
    expect(detectLicence("Sentier de démonstration, 4,2 km, balisage jaune.")).toBe("unknown");
  });

  it("reconnaît ODbL, écrit en sigle ou en toutes lettres", () => {
    expect(detectLicence("Données publiées sous ODbL 1.0")).toBe("odbl");
    expect(detectLicence("Open Database License")).toBe("odbl");
    expect(detectLicence("Open Database Licence")).toBe("odbl");
  });

  it("reconnaît l'attribution OpenStreetMap comme une donnée ODbL", () => {
    expect(detectLicence("© OpenStreetMap contributors")).toBe("odbl");
    expect(detectLicence("Fond : les contributeurs d'OpenStreetMap")).toBe("odbl");
    expect(detectLicence("© OSM contributors")).toBe("odbl");
  });

  it("reconnaît une URL de licence Creative Commons", () => {
    expect(detectLicence("https://creativecommons.org/licenses/by/4.0/")).toBe("cc-by");
    expect(detectLicence("https://creativecommons.org/licenses/by-sa/4.0/deed.fr")).toBe("cc-by-sa");
    expect(detectLicence("https://creativecommons.org/publicdomain/zero/1.0/")).toBe("cc0");
  });

  it("ne lit JAMAIS « CC-BY-NC-SA » comme un « CC-BY »", () => {
    expect(detectLicence("CC-BY-NC-SA 4.0")).toBe("cc-by-nc-sa");
    expect(detectLicence("https://creativecommons.org/licenses/by-nc-sa/4.0/")).toBe("cc-by-nc-sa");
    expect(detectLicence("cc_by_nc_sa")).toBe("cc-by-nc-sa");
  });

  it("distingue les variantes CC : BY, BY-SA, BY-NC, BY-ND", () => {
    expect(detectLicence("CC BY 4.0")).toBe("cc-by");
    expect(detectLicence("CC BY-SA")).toBe("cc-by-sa");
    expect(detectLicence("CC BY-NC")).toBe("cc-by-nc");
    expect(detectLicence("CC BY-ND 4.0")).toBe("cc-by-nd");
  });

  it("rabat « CC BY-NC-ND », absent du contrat, sur la restriction la plus fermée", () => {
    expect(detectLicence("CC BY-NC-ND 4.0")).toBe("cc-by-nd");
  });

  it("lit les sigles CC écrits en toutes lettres, en français", () => {
    const texte =
      "Creative Commons Attribution - Pas d'Utilisation Commerciale - Partage dans les Mêmes Conditions 4.0";
    expect(detectLicence(texte)).toBe("cc-by-nc-sa");
  });

  it("reconnaît CC0 et le domaine public explicite", () => {
    expect(detectLicence("CC0 1.0 Universal")).toBe("cc0");
    expect(detectLicence("Œuvre versée au domaine public")).toBe("public-domain");
  });

  it("reconnaît la Licence Ouverte et Etalab, avec leur version", () => {
    expect(detectLicence("Licence Ouverte v2.0")).toBe("etalab-2.0");
    expect(detectLicence("Licence Ouverte 1.0")).toBe("licence-ouverte-1.0");
    expect(detectLicence("Publié par Etalab")).toBe("etalab-2.0");
    expect(detectLicence("Licence Ouverte / Open Licence version 2.0")).toBe("etalab-2.0");
  });

  it("retient LICENCE_ETALAB_DEFAULT_ID pour une Licence Ouverte sans numéro", () => {
    expect(detectLicence("Réutilisation libre sous Licence Ouverte")).toBe(LICENCE_ETALAB_DEFAULT_ID);
  });

  it("ne cherche le numéro de version que dans LICENCE_VERSION_WINDOW_CHARS caractères", () => {
    const proche = `Licence Ouverte ${"x".repeat(LICENCE_VERSION_WINDOW_CHARS - 10)} 1.0`;
    const lointain = `Licence Ouverte ${"x".repeat(LICENCE_VERSION_WINDOW_CHARS + 20)} 1.0`;
    expect(detectLicence(proche)).toBe("licence-ouverte-1.0");
    expect(detectLicence(lointain)).toBe(LICENCE_ETALAB_DEFAULT_ID);
  });

  it("reconnaît « tous droits réservés » et ses variantes", () => {
    expect(detectLicence("Tous droits réservés")).toBe("proprietary");
    expect(detectLicence("All rights reserved")).toBe("proprietary");
    expect(detectLicence("Toute reproduction interdite")).toBe("proprietary");
  });

  it("retient la plus restrictive quand une page cite plusieurs licences", () => {
    expect(detectLicence("Tracés sous Licence Ouverte 2.0, descriptions sous CC BY-SA")).toBe("cc-by-sa");
    expect(detectLicence("Données OpenStreetMap contributors, photos en CC BY-NC")).toBe("cc-by-nc");
    expect(detectLicence("CC BY 4.0 pour les textes et CC BY-NC-SA pour les cartes")).toBe("cc-by-nc-sa");
  });

  it("laisse « tous droits réservés » l'emporter sur toute mention ouverte de la même page", () => {
    const texte = "Données sous ODbL, sous Licence Ouverte 2.0 — © 2026 Exemple, tous droits réservés.";
    expect(detectLicence(texte)).toBe("proprietary");
  });

  it("n'interprète pas un « by » isolé hors contexte Creative Commons", () => {
    expect(detectLicence("Trace enregistrée by Marie sur le sentier de démonstration")).toBe("unknown");
    expect(detectLicence("Le mot ruby n'est pas une licence")).toBe("unknown");
  });

  it("ignore la casse, les accents et la ponctuation", () => {
    expect(detectLicence("licence ouverte 2.0")).toBe("etalab-2.0");
    expect(detectLicence("LICENCE OUVERTE 2.0")).toBe("etalab-2.0");
    expect(detectLicence("cc—by–nc/4.0")).toBe("cc-by-nc");
  });

  it("lit une balise <copyright> de GPX telle qu'elle se présente", () => {
    const balise =
      '<copyright author="Exemple">' +
      "<license>https://creativecommons.org/licenses/by-nd/4.0/</license></copyright>";
    expect(detectLicence(balise)).toBe("cc-by-nd");
  });

  it("ne rend jamais autre chose qu'un identifiant du contrat", () => {
    const textes = ["", "n'importe quoi", "CC", "licence", "odbl cc0 etalab tous droits réservés"];
    for (const texte of textes) expect(isLicenceId(detectLicence(texte))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Décision de réutilisation                                        */
/* ------------------------------------------------------------------ */

describe("reuseDecision — la décision unique du système", () => {
  it("approuve une licence permissive sans obstacle", () => {
    const decision = reuseDecision({ licence: "etalab-2.0", sourceName: "Sentiers de démonstration" });
    expect(decision.status).toBe("approved");
    expect(decision.blockers).toEqual([]);
    expect(decision.attribution).toBe("© Sentiers de démonstration (Licence Ouverte 2.0)");
  });

  it("approuve CC0 sans exiger d'attribution", () => {
    const decision = reuseDecision({ licence: "cc0", sourceName: "Sentiers de démonstration" });
    expect(decision.status).toBe("approved");
    expect(decision.attribution).toBeNull();
  });

  it("exige une vérification humaine quand la licence est inconnue, sans inventer d'interdiction", () => {
    const decision = reuseDecision({ licence: "unknown" });
    expect(decision.status).toBe("review_required");
    expect(decision.blockers).toEqual(["licence_unknown"]);
  });

  it("refuse une licence non commerciale", () => {
    const decision = reuseDecision({ licence: "cc-by-nc" });
    expect(decision.status).toBe("forbidden");
    expect(decision.blockers).toContain("no_commercial_reuse");
  });

  it("refuse une licence sans dérivé, car une géométrie recalée est un dérivé", () => {
    const decision = reuseDecision({ licence: "cc-by-nd" });
    expect(decision.status).toBe("forbidden");
    expect(decision.blockers).toEqual(["no_derivatives"]);
    expect(decision.reason).toContain("dérivée");
  });

  it("liste TOUTES les raisons d'un refus, pas la première", () => {
    const decision = reuseDecision({ licence: "proprietary", robotsAllows: false, sourceStatus: "forbidden" });
    expect(decision.status).toBe("forbidden");
    expect(decision.blockers).toEqual([
      "source_forbidden",
      "no_commercial_reuse",
      "no_redistribution",
      "no_derivatives",
      "robots_disallow",
    ]);
  });

  it("trie les blocages selon LICENCE_BLOCKER_ORDER et n'en répète aucun", () => {
    const decision = reuseDecision({ licence: "cc-by-nc-sa", robotsAllows: false, sourceStatus: "forbidden" });
    const positions = decision.blockers.map((blocker) => LICENCE_BLOCKER_ORDER.indexOf(blocker));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(decision.blockers).size).toBe(decision.blockers.length);
  });

  it("met en attente quand le robots.txt refuse la collecte", () => {
    const decision = reuseDecision({ licence: "cc-by", robotsAllows: false });
    expect(decision.status).toBe("review_required");
    expect(decision.blockers).toEqual(["robots_disallow"]);
    expect(decision.reason).toContain(LICENCE_BLOCKER_REASONS.robots_disallow);
  });

  it("n'exige rien quand le robots.txt n'a pas été consulté", () => {
    expect(reuseDecision({ licence: "cc-by" }).status).toBe("approved");
    expect(reuseDecision({ licence: "cc-by", robotsAllows: true }).status).toBe("approved");
  });

  it("met le partage à l'identique en décision produit, et le lève seulement sur demande explicite", () => {
    const sans = reuseDecision({ licence: "odbl" });
    expect(sans.status).toBe("review_required");
    expect(sans.blockers).toEqual(["share_alike"]);
    const avec = reuseDecision({ licence: "odbl", allowShareAlike: true, sourceName: "Exemple" });
    expect(avec.status).toBe("approved");
    expect(avec.blockers).toEqual([]);
    expect(avec.reason).toContain("Partage à l'identique accepté");
  });

  it("ne lève le partage à l'identique que sur `true`, jamais sur une valeur approchante", () => {
    expect(reuseDecision({ licence: "cc-by-sa", allowShareAlike: false }).status).toBe("review_required");
    expect(reuseDecision({ licence: "cc-by-sa" }).status).toBe("review_required");
  });

  it("laisse `sourceStatus: forbidden` l'emporter sur toutes les licences et toutes les options", () => {
    for (const licence of LICENCE_IDS) {
      for (const allowShareAlike of [true, false]) {
        for (const robotsAllows of [true, false]) {
          const decision = reuseDecision({ licence, sourceStatus: "forbidden", allowShareAlike, robotsAllows });
          expect(decision.status).toBe("forbidden");
          expect(decision.blockers).toContain("source_forbidden");
        }
      }
    }
  });

  it("n'approuve jamais une licence `unknown`, quelle que soit la combinaison d'entrées", () => {
    for (const sourceStatus of STATUSES) {
      for (const allowShareAlike of [true, false]) {
        for (const robotsAllows of [true, false, undefined]) {
          const decision = reuseDecision({
            licence: "unknown",
            sourceStatus,
            allowShareAlike,
            robotsAllows,
            attributionText: "Mention imposée",
            sourceName: "Exemple",
          });
          expect(decision.status).not.toBe("approved");
          expect(decision.blockers).toContain("licence_unknown");
        }
      }
    }
  });

  it("n'approuve pas une source encore en attente de validation, sans inventer de code de blocage", () => {
    const decision = reuseDecision({ licence: "cc0", sourceStatus: "review_required" });
    expect(decision.status).toBe("review_required");
    expect(decision.blockers).toEqual([]);
    expect(decision.reason).toContain(LICENCE_SOURCE_PENDING_REASON);
  });

  it("ne produit `forbidden` que sur un blocage dirimant", () => {
    for (const licence of LICENCE_IDS) {
      const decision = reuseDecision({ licence, allowShareAlike: true });
      const dirimant = decision.blockers.some((blocker) => LICENCE_FORBIDDING_BLOCKERS.includes(blocker));
      expect(decision.status === "forbidden").toBe(dirimant);
    }
  });

  it("rend toujours une phrase française non vide terminée par un point", () => {
    for (const licence of LICENCE_IDS) {
      for (const sourceStatus of STATUSES) {
        const reason = reuseDecision({ licence, sourceStatus, sourceName: "Exemple" }).reason;
        expect(reason.length).toBeGreaterThan(10);
        expect(reason.endsWith(".")).toBe(true);
      }
    }
  });

  it("ne jette pas et reste exploitable sur une entrée minimale ou illisible", () => {
    expect(() => reuseDecision({ licence: LICENCE_HORS_CONTRAT })).not.toThrow();
    const decision = reuseDecision({
      licence: LICENCE_HORS_CONTRAT,
      attributionText: null,
      sourceName: null,
    });
    expect(decision.status).toBe("review_required");
    expect(decision.attribution).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 5. Attribution                                                      */
/* ------------------------------------------------------------------ */

describe("attributionLine — mention à afficher (section 22)", () => {
  it("reprend mot pour mot la mention imposée par la source", () => {
    const line = attributionLine({
      name: "Sentiers de démonstration",
      licence: "etalab-2.0",
      attributionText: "Sentiers de démonstration — mise à jour 2026",
      url: "https://example.org/sentiers",
    });
    expect(line).toBe("Sentiers de démonstration — mise à jour 2026");
  });

  it("honore la mention imposée même quand la licence n'en exige aucune", () => {
    const line = attributionLine({
      name: "Sentiers de démonstration",
      licence: "cc0",
      attributionText: "Merci de citer Sentiers de démonstration",
      url: "https://example.org/sentiers",
    });
    expect(line).toBe("Merci de citer Sentiers de démonstration");
  });

  it("construit la mention quand la source n'en impose pas", () => {
    const line = attributionLine({
      name: "OpenStreetMap contributors",
      licence: "odbl",
      attributionText: null,
      url: "https://example.org/osm",
    });
    expect(line).toBe("© OpenStreetMap contributors (ODbL)");
  });

  it("ne double pas le symbole © déjà présent dans le nom", () => {
    const line = attributionLine({
      name: "© Sentiers de démonstration",
      licence: "cc-by",
      attributionText: null,
      url: "https://example.org/sentiers",
    });
    expect(line).toBe("© Sentiers de démonstration (CC BY 4.0)");
  });

  it("renvoie null quand la licence n'exige aucune attribution", () => {
    for (const licence of ["cc0", "public-domain", "unknown", "proprietary"] as const) {
      const source = { name: "Exemple", licence, attributionText: null, url: "https://example.org/demo" };
      expect(attributionLine(source)).toBeNull();
    }
  });

  it("se rabat sur l'hôte de l'URL quand le nom manque", () => {
    const line = attributionLine({
      name: "   ",
      licence: "cc-by",
      attributionText: "  ",
      url: "https://www.example.org/randonnees?page=2",
    });
    expect(line).toBe("© example.org (CC BY 4.0)");
  });

  it("affiche une mention visiblement incomplète plutôt qu'aucune mention", () => {
    const line = attributionLine({ name: "", licence: "cc-by-sa", attributionText: null, url: "" });
    expect(line).toBe(`© ${LICENCE_UNNAMED_SOURCE} (CC BY-SA 4.0)`);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Registre : importation automatique                               */
/* ------------------------------------------------------------------ */

describe("canAutoImport — ce qui alimente la base sans intervention", () => {
  it("autorise une source approuvée, sous licence claire et vérifiée récemment", () => {
    expect(canAutoImport(makeSource(), NOW)).toBe(true);
  });

  it("refuse une source jamais vérifiée par un humain", () => {
    expect(canAutoImport(makeSource({ lastCheckedAt: null }), NOW)).toBe(false);
    expect(canAutoImport(makeSource({ lastCheckedAt: "   " }), NOW)).toBe(false);
    expect(canAutoImport(makeSource({ lastCheckedAt: "pas une date" }), NOW)).toBe(false);
  });

  it("refuse une vérification périmée au-delà de LICENCE_RECHECK_AFTER_DAYS", () => {
    expect(canAutoImport(makeSource({ lastCheckedAt: daysBefore(LICENCE_RECHECK_AFTER_DAYS) }), NOW)).toBe(true);
    expect(canAutoImport(makeSource({ lastCheckedAt: daysBefore(LICENCE_RECHECK_AFTER_DAYS + 1) }), NOW)).toBe(false);
  });

  it("tolère une date de vérification en avance sur l'horloge", () => {
    expect(canAutoImport(makeSource({ lastCheckedAt: daysBefore(-10) }), NOW)).toBe(true);
  });

  it("refuse toute source dont le statut n'est pas `approved`", () => {
    expect(canAutoImport(makeSource({ status: "review_required" }), NOW)).toBe(false);
    expect(canAutoImport(makeSource({ status: "forbidden" }), NOW)).toBe(false);
  });

  it("refuse une licence inconnue ou interdite même sur une source approuvée", () => {
    for (const licence of ["unknown", "proprietary", "cc-by-nc", "cc-by-nd"] as const) {
      expect(canAutoImport(makeSource({ licence }), NOW)).toBe(false);
    }
  });

  it("accepte une licence à partage à l'identique : approuver la source EST la décision produit", () => {
    expect(canAutoImport(makeSource({ licence: "odbl" }), NOW)).toBe(true);
    expect(canAutoImport(makeSource({ licence: "cc-by-sa" }), NOW)).toBe(true);
  });

  it("respecte un constat négatif du registre, même si la licence semble permissive", () => {
    expect(canAutoImport(makeSource({ commercialReuseAllowed: false }), NOW)).toBe(false);
    expect(canAutoImport(makeSource({ redistributionAllowed: false }), NOW)).toBe(false);
    expect(canAutoImport(makeSource({ commercialReuseAllowed: null, redistributionAllowed: null }), NOW)).toBe(true);
  });

  it("refuse plutôt que de conclure sur un instant courant illisible", () => {
    expect(canAutoImport(makeSource(), Number.NaN)).toBe(false);
    expect(canAutoImport(makeSource(), Number.POSITIVE_INFINITY)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Plafond de fiabilité                                             */
/* ------------------------------------------------------------------ */

describe("reliabilityCap — plafond des sources non vérifiées", () => {
  it("laisse intact le score d'une source vérifiée", () => {
    expect(reliabilityCap(makeSource({ reliabilityScore: 80 }))).toBe(80);
  });

  it("plafonne le score d'une source jamais vérifiée à UNVERIFIED_RELIABILITY_CAP", () => {
    expect(reliabilityCap(makeSource({ reliabilityScore: 95, lastCheckedAt: null }))).toBe(UNVERIFIED_RELIABILITY_CAP);
  });

  it("ne relève jamais un score bas sous prétexte de plafond", () => {
    expect(reliabilityCap(makeSource({ reliabilityScore: 12, lastCheckedAt: null }))).toBe(12);
  });

  it("ramène les scores hors bornes ou illisibles dans 0..100, sans NaN ni -0", () => {
    expect(reliabilityCap(makeSource({ reliabilityScore: 150 }))).toBe(100);
    expect(reliabilityCap(makeSource({ reliabilityScore: -30 }))).toBe(0);
    expect(reliabilityCap(makeSource({ reliabilityScore: Number.NaN }))).toBe(0);
    expect(Object.is(reliabilityCap(makeSource({ reliabilityScore: -0 })), -0)).toBe(false);
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1000]) {
      const value = reliabilityCap(makeSource({ reliabilityScore: score }));
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. Robustesse et déterminisme                                       */
/* ------------------------------------------------------------------ */

describe("robustesse et déterminisme", () => {
  it("ne jette sur aucune entrée dégénérée", () => {
    const vide: DataSource = makeSource({
      name: "",
      url: "",
      licence: LICENCE_HORS_CONTRAT,
      licenceUrl: null,
      attributionText: null,
      lastCheckedAt: null,
      reliabilityScore: Number.NaN,
      territory: null,
      notes: null,
    });
    expect(() => detectLicence("")).not.toThrow();
    expect(() => attributionLine(vide)).not.toThrow();
    expect(() => canAutoImport(vide, NOW)).not.toThrow();
    expect(() => reliabilityCap(vide)).not.toThrow();
    expect(() => reuseDecision({ licence: vide.licence })).not.toThrow();
  });

  it("rend exactement le même résultat à chaque appel (aucun état résiduel)", () => {
    const textes = [
      "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      "© OpenStreetMap contributors",
      "Licence Ouverte 2.0 puis CC BY 4.0",
      "Tous droits réservés",
      "",
    ];
    const run = (): string =>
      JSON.stringify({
        licences: textes.map((texte) => detectLicence(texte)),
        decisions: LICENCE_IDS.map((licence) => reuseDecision({ licence, sourceName: "Exemple" })),
        attributions: LICENCE_IDS.map((licence) =>
          attributionLine({ name: "Exemple", licence, attributionText: null, url: "https://example.org" }),
        ),
        imports: LICENCE_IDS.map((licence) => canAutoImport(makeSource({ licence }), NOW)),
      });
    const premier = run();
    expect(run()).toBe(premier);
    expect(run()).toBe(premier);
  });

  it("ne dépend pas de l'instant réel : `now` est toujours un paramètre", () => {
    const source = makeSource({ lastCheckedAt: new Date(NOW - 10 * DAY_MS).toISOString() });
    expect(canAutoImport(source, NOW)).toBe(true);
    expect(canAutoImport(source, NOW + (LICENCE_RECHECK_AFTER_DAYS + 5) * DAY_MS)).toBe(false);
  });
});
