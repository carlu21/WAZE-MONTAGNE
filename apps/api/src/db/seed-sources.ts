/**
 * Amorçage du registre : territoires pilotes et **pistes de sources à
 * vérifier** (sections 4, 16, 28, 29 du cahier des charges GPX).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ AUCUNE LICENCE N'EST VÉRIFIÉE ICI.                                   │
 * │                                                                      │
 * │ Chaque source est créée avec `last_checked_at = NULL` et le statut    │
 * │ `review_required`. `canAutoImport` les refuse toutes tant qu'un       │
 * │ humain n'a pas ouvert les conditions d'utilisation, constaté la       │
 * │ licence et enregistré sa vérification. Ce fichier ne dit pas « voici  │
 * │ des sources utilisables » : il dit « voici où regarder, et quoi       │
 * │ vérifier ». La distinction est toute la section 3.                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Aucune trace GPX n'est fabriquée : la section 28 l'interdit explicitement
 * quand l'environnement n'a pas d'accès réseau. Seuls le squelette du registre
 * et les territoires de l'expérimentation corse sont posés.
 */
import { eq } from "drizzle-orm";
import type { LicenceId, SourceType } from "@mountain-live/core";
import { db } from "./client";
import { dataSources, territories, type DataSourceRow, type TerritoryRow } from "./schema";
import { nowIso } from "../services/util";

interface TerritorySeed {
  id: string;
  name: string;
  parentId?: string;
  aliases?: string[];
  bbox?: { west: number; south: number; east: number; north: number };
}

/**
 * Territoires de l'expérimentation (section 29) : on commence petit, sur des
 * secteurs où l'on pourra comparer les résultats, plutôt que d'essayer
 * d'importer la France entière.
 */
export const PILOT_TERRITORIES: TerritorySeed[] = [
  { id: "fr", name: "France", aliases: [] },
  { id: "fr-corse", name: "Corse", parentId: "fr", aliases: ["Corsica", "Corse-du-Sud", "Haute-Corse"], bbox: { west: 8.4, south: 41.3, east: 9.6, north: 43.05 } },
  {
    id: "fr-corse-bastelica",
    name: "Bastelica",
    parentId: "fr-corse",
    aliases: ["Val d'Ese", "Plateau d'Ese", "Pozzi", "Monte Renoso", "Renoso", "Bocca di Verde"],
    bbox: { west: 8.98, south: 41.92, east: 9.18, north: 42.06 },
  },
  {
    id: "fr-corse-corte",
    name: "Corte",
    parentId: "fr-corse",
    aliases: ["Restonica", "Vallée de la Restonica", "Tavignano", "Lac de Melo", "Lac de Capitello", "Monte Rotondo"],
    bbox: { west: 8.95, south: 42.15, east: 9.25, north: 42.38 },
  },
  {
    id: "fr-corse-gr20",
    name: "GR 20",
    parentId: "fr-corse",
    aliases: ["Fra li Monti", "GR20 nord", "GR20 sud", "Vizzavona", "Bavella", "Asco", "Calenzana", "Conca"],
    bbox: { west: 8.6, south: 41.7, east: 9.35, north: 42.6 },
  },
];

/** Piste de source : ce qu'il y a à aller vérifier, et rien de plus. */
interface SourceLead {
  name: string;
  url: string;
  type: SourceType;
  territory: string | null;
  /**
   * Licence *attendue d'après la documentation publique de la plateforme*.
   * Elle n'est PAS une vérification : le statut reste `review_required` et
   * `last_checked_at` reste nul jusqu'à contrôle humain des conditions.
   */
  expectedLicence: LicenceId;
  apiAvailable: boolean;
  apiUrl: string | null;
  /** Ce qu'il faut précisément aller vérifier avant toute exploitation. */
  toVerify: string;
}

/**
 * Pistes de la section 2, par catégorie. Volontairement peu nombreuses et
 * génériques : une liste longue de domaines inventés serait pire qu'inutile.
 * Chaque entrée dit ce qu'il faut vérifier, pas ce qui est acquis.
 */
export const SOURCE_LEADS: SourceLead[] = [
  // --- Catégorie B : cartographie ouverte, base principale de géométrie ---
  {
    name: "OpenStreetMap — réseau de chemins",
    url: "https://www.openstreetmap.org",
    type: "osm",
    territory: null,
    expectedLicence: "odbl",
    apiAvailable: true,
    apiUrl: "https://overpass-api.de/api/interpreter",
    toVerify:
      "ODbL : partage à l'identique. Vérifier l'impact sur nos géométries dérivées et la mention « © les contributeurs OpenStreetMap ». Respecter la politique d'usage de l'instance Overpass retenue (ou en héberger une).",
  },
  {
    name: "OpenStreetMap — relations d'itinéraires",
    url: "https://wiki.openstreetmap.org/wiki/Relation:route",
    type: "osm",
    territory: null,
    expectedLicence: "odbl",
    apiAvailable: true,
    apiUrl: "https://overpass-api.de/api/interpreter",
    toVerify: "Mêmes conditions que le réseau. Les relations donnent les itinéraires balisés ; le réseau donne la géométrie.",
  },

  // --- Catégorie A : données publiques et open data ---
  {
    name: "data.gouv.fr — catalogue open data",
    url: "https://www.data.gouv.fr",
    type: "open_data",
    territory: "fr",
    expectedLicence: "unknown",
    apiAvailable: true,
    apiUrl: "https://www.data.gouv.fr/api/1/datasets/",
    toVerify:
      "La licence est portée par CHAQUE JEU DE DONNÉES, pas par la plateforme : Licence Ouverte, ODbL, ou autre. Vérifier jeu par jeu avant toute importation.",
  },
  {
    name: "Geotrek — instances de gestionnaires d'espaces naturels",
    url: "https://geotrek.fr",
    type: "geotrek",
    territory: null,
    expectedLicence: "unknown",
    apiAvailable: true,
    apiUrl: null,
    toVerify:
      "Geotrek est un logiciel, pas une source unique : chaque parc, département ou office de tourisme héberge son instance, avec ses propres conditions. Relever l'URL de l'API v2 de chaque instance et sa licence. Une instance = une ligne dans ce registre.",
  },
  {
    name: "IGN — données cartographiques et géoservices",
    url: "https://geoservices.ign.fr",
    type: "institutional",
    territory: "fr",
    expectedLicence: "unknown",
    apiAvailable: true,
    apiUrl: null,
    toVerify:
      "Vérifier les conditions du flux visé (certaines données sont sous Licence Ouverte, d'autres non) et les conditions d'usage des géoservices, notamment pour un service commercial.",
  },
  {
    name: "Parcs nationaux et parcs naturels régionaux",
    url: "https://www.parcs-naturels-regionaux.fr",
    type: "institutional",
    territory: "fr",
    expectedLicence: "unknown",
    apiAvailable: false,
    apiUrl: null,
    toVerify:
      "Chaque parc publie ses itinéraires à ses conditions. Un accord direct est souvent plus simple — et plus fiable — qu'une collecte automatique. Créer une ligne par parc.",
  },
  {
    name: "Collectivités de Corse — open data territorial",
    url: "https://www.isula.corsica",
    type: "institutional",
    territory: "fr-corse",
    expectedLicence: "unknown",
    apiAvailable: false,
    apiUrl: null,
    toVerify:
      "Identifier le portail open data de la Collectivité de Corse et les jeux de données « sentiers », « itinéraires de randonnée », « PDIPR ». Vérifier la licence de chacun.",
  },

  // --- Catégorie C : plateformes de randonnée ---
  {
    name: "Plateformes de randonnée et de trail (à recenser une par une)",
    url: "https://example.org/plateformes-a-recenser",
    type: "platform",
    territory: null,
    expectedLicence: "unknown",
    apiAvailable: false,
    apiUrl: null,
    toVerify:
      "ENTRÉE GÉNÉRIQUE, à remplacer par une ligne par plateforme réellement examinée. Un bouton « Télécharger GPX » ne vaut pas autorisation de réutilisation : lire les CGU (réutilisation commerciale, redistribution, API), et privilégier un accord direct. En l'absence d'autorisation claire : FORBIDDEN_SOURCE.",
  },
];

export interface SeedSourcesResult {
  territories: number;
  sources: number;
  note: string;
}

/** Pose le squelette du registre. Idempotent : relancer ne duplique rien. */
export function seedSources(): SeedSourcesResult {
  const now = nowIso();
  let territoriesWritten = 0;
  let sourcesWritten = 0;

  for (const t of PILOT_TERRITORIES) {
    const row: TerritoryRow = {
      id: t.id,
      name: t.name,
      country: "FR",
      parentId: t.parentId ?? null,
      aliases: t.aliases ?? [],
      minLat: t.bbox?.south ?? null,
      minLng: t.bbox?.west ?? null,
      maxLat: t.bbox?.north ?? null,
      maxLng: t.bbox?.east ?? null,
      createdAt: now,
    };
    db.insert(territories).values(row).onConflictDoUpdate({ target: territories.id, set: { ...row, createdAt: undefined } }).run();
    territoriesWritten += 1;
  }

  for (const lead of SOURCE_LEADS) {
    const existing = db.select().from(dataSources).where(eq(dataSources.url, lead.url)).get();
    // Une source déjà vérifiée par un humain n'est jamais réécrite par l'amorçage.
    if (existing?.lastCheckedAt) continue;
    const row: DataSourceRow = {
      id: existing?.id ?? `src_${lead.url.replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}`,
      name: lead.name,
      url: lead.url,
      type: lead.type,
      country: "FR",
      territory: lead.territory,
      // La licence attendue est une PISTE : elle n'est pas enregistrée comme
      // acquise, sans quoi les droits dérivés seraient faux.
      licence: "unknown",
      licenceUrl: null,
      commercialReuseAllowed: null,
      redistributionAllowed: null,
      attributionRequired: null,
      attributionText: null,
      apiAvailable: lead.apiAvailable,
      apiUrl: lead.apiUrl,
      lastCheckedAt: null,
      checkedBy: null,
      reliabilityScore: 0,
      status: "review_required",
      notes: `Licence attendue : ${lead.expectedLicence}. À VÉRIFIER — ${lead.toVerify}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    db.insert(dataSources).values(row).onConflictDoUpdate({ target: dataSources.id, set: row }).run();
    sourcesWritten += 1;
  }

  return {
    territories: territoriesWritten,
    sources: sourcesWritten,
    note: "Aucune licence vérifiée : toutes les sources sont en revue et n'alimentent rien tant qu'un humain n'a pas contrôlé leurs conditions.",
  };
}
