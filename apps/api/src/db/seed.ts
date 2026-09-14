import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import {
  SUBTYPE_BY_ID,
  type AreaType,
  type BadgeId,
  type ConfirmationKind,
  type DangerLevel,
  type FlagReason,
  type GeoJsonGeometry,
  type NotificationType,
  type Practice,
  type ReportCategory,
  type ReportStatus,
  type ReportSubtype,
  type UserRole,
} from "@mountain-live/core";
import { config } from "../config";
import { db, sqlite } from "./client";
import { encodeDemoPng, writeDemoPng, type Rgb } from "./demo-assets";
import { runMigrations } from "./migrate";
import {
  areas,
  moderationReports,
  notifications,
  officialAlerts,
  offlineZones,
  partners,
  photos,
  presencePings,
  reportComments,
  reportConfirmations,
  reports,
  trails,
  userPreferences,
  userReputationEvents,
  users,
  waterPoints,
  type ReportRow,
  type UserRow,
} from "./schema";
import { blurLocation, computeExpiresAt, isSensitiveSubtype } from "../services/domain";
import { hashPassword } from "../services/password";
import { createOfficialAlert } from "../services/reference";
import { recomputeReport } from "../services/reports";
import { addReputationEvent, recomputeUserStanding } from "../services/reputation";
import { DEFAULT_FILTERS_BY_PRACTICE } from "@mountain-live/core";
import { defaultPreferences } from "../services/users";
import { geometryExtent, normalizeText } from "../services/util";

/**
 * Jeu de données de démonstration — territoire pilote : la Corse.
 * Idempotent : vide toutes les tables puis recrée les données avec des identifiants fixes.
 * Mot de passe de tous les comptes de démo : « demo1234 ».
 */
export const DEMO_PASSWORD = "demo1234";

const NOW = new Date();
const iso = (d: Date) => d.toISOString();
const ago = (minutes: number) => iso(new Date(NOW.getTime() - minutes * 60_000));
const inMin = (minutes: number) => iso(new Date(NOW.getTime() + minutes * 60_000));
const H = 60;
const D = 24 * H;

// ---------------------------------------------------------------------------
// Lieux (areas)
// ---------------------------------------------------------------------------

interface AreaSeed {
  id: string;
  name: string;
  type: AreaType;
  lat: number;
  lng: number;
  elevation?: number;
  description?: string;
  /** Demi-largeur de la bbox (km) ; sinon aucune bbox déclarée. */
  halfKm?: number;
}

const AREAS: AreaSeed[] = [
  // Communes
  { id: "a_corte", name: "Corte", type: "commune", lat: 42.3061, lng: 9.1497, elevation: 400, halfKm: 6, description: "Cité historique au cœur de la Corse, porte des gorges de la Restonica et du Tavignano." },
  { id: "a_restonica", name: "Vallée de la Restonica", type: "place", lat: 42.2528, lng: 9.0925, elevation: 900, halfKm: 6, description: "Gorges et vallée glaciaire au-dessus de Corte : accès aux bergeries de Grotelle et aux lacs de Melo et de Capitello." },
  { id: "a_calenzana", name: "Calenzana", type: "commune", lat: 42.5083, lng: 8.8567, elevation: 275, halfKm: 5, description: "Point de départ du GR20 et du Mare e Monti, en Balagne." },
  { id: "a_vizzavona", name: "Vizzavona", type: "commune", lat: 42.1275, lng: 9.1339, elevation: 920, halfKm: 4, description: "Hameau forestier à mi-parcours du GR20, au pied du Monte d'Oro." },
  { id: "a_zonza", name: "Zonza", type: "commune", lat: 41.7519, lng: 9.1697, elevation: 780, halfKm: 6, description: "Village de l'Alta Rocca, accès au col et aux aiguilles de Bavella." },
  { id: "a_conca", name: "Conca", type: "commune", lat: 41.7378, lng: 9.3364, elevation: 250, halfKm: 4, description: "Arrivée sud du GR20, entre maquis et mer." },
  { id: "a_asco", name: "Asco", type: "commune", lat: 42.4536, lng: 9.0369, elevation: 620, halfKm: 8, description: "Vallée sauvage menant à Haut-Asco et au Monte Cinto." },
  { id: "a_ghisoni", name: "Ghisoni", type: "commune", lat: 42.1039, lng: 9.2144, elevation: 650, halfKm: 6, description: "Village du Fiumorbu dominé par les Kyrie Eleison." },
  { id: "a_bastelica", name: "Bastelica", type: "commune", lat: 42.0058, lng: 9.05, elevation: 800, halfKm: 6, description: "Village du Prunelli, au pied du plateau d'Ese et du Monte Renoso." },
  { id: "a_evisa", name: "Évisa", type: "commune", lat: 42.2589, lng: 8.8022, elevation: 830, halfKm: 5, description: "Village de châtaigniers entre les gorges de Spelunca et la forêt d'Aïtone." },
  { id: "a_calacuccia", name: "Calacuccia", type: "commune", lat: 42.3336, lng: 9.0128, elevation: 830, halfKm: 5, description: "Chef-lieu du Niolu, au bord du lac de barrage." },
  { id: "a_bavella", name: "Bavella", type: "place", lat: 41.7953, lng: 9.2233, elevation: 1218, halfKm: 3, description: "Hameau et col au pied des aiguilles, haut lieu de la randonnée en Corse-du-Sud." },
  // Massifs
  { id: "a_massif_cinto", name: "Massif du Cinto", type: "massif", lat: 42.38, lng: 8.94, halfKm: 10, description: "Le plus haut massif de Corse, autour du Monte Cinto et de la Paglia Orba." },
  { id: "a_massif_rotondo", name: "Massif du Rotondo", type: "massif", lat: 42.23, lng: 9.03, halfKm: 9, description: "Cœur granitique de l'île : lacs de Melo, Capitello, Nino et Petra Piana." },
  { id: "a_aiguilles_bavella", name: "Aiguilles de Bavella", type: "massif", lat: 41.8067, lng: 9.2078, elevation: 1855, halfKm: 4, description: "Tours de granite rose dominant le col de Bavella." },
  // Sommets
  { id: "a_cinto", name: "Monte Cinto", type: "summit", lat: 42.3806, lng: 8.9403, elevation: 2706, description: "Point culminant de la Corse." },
  { id: "a_rotondo", name: "Monte Rotondo", type: "summit", lat: 42.2244, lng: 9.0503, elevation: 2622, description: "Deuxième sommet de l'île, au-dessus de la Restonica." },
  { id: "a_oro", name: "Monte d'Oro", type: "summit", lat: 42.1425, lng: 9.1097, elevation: 2389, description: "Sommet emblématique de Vizzavona." },
  { id: "a_renoso", name: "Monte Renoso", type: "summit", lat: 42.0619, lng: 9.0722, elevation: 2352, description: "Sommet du sud de la chaîne centrale, au-dessus du plateau d'Ese." },
  { id: "a_incudine", name: "Monte Incudine", type: "summit", lat: 41.8636, lng: 9.2136, elevation: 2134, description: "Dernier grand sommet du GR20 avant Bavella." },
  { id: "a_paglia_orba", name: "Paglia Orba", type: "summit", lat: 42.3575, lng: 8.8883, elevation: 2525, description: "Le « Cervin corse », au-dessus du refuge de Ciottulu." },
  // Sentiers
  { id: "a_gr20_nord", name: "GR20 Nord", type: "trail", lat: 42.35, lng: 8.95, halfKm: 25, description: "Calenzana → Vizzavona : la partie la plus technique du GR20." },
  { id: "a_gr20_sud", name: "GR20 Sud", type: "trail", lat: 41.95, lng: 9.2, halfKm: 25, description: "Vizzavona → Conca : crêtes, plateaux et aiguilles de Bavella." },
  { id: "a_mare_a_mare_nord", name: "Mare a Mare Nord", type: "trail", lat: 42.3, lng: 9.05, halfKm: 20, description: "Traversée Moriani → Cargèse par Corte et le Niolu." },
  { id: "a_mare_e_monti", name: "Mare e Monti", type: "trail", lat: 42.45, lng: 8.75, halfKm: 20, description: "Calenzana → Cargèse par la côte ouest et les vallées." },
  // Cols
  { id: "a_col_bavella", name: "Col de Bavella", type: "pass", lat: 41.7953, lng: 9.2233, elevation: 1218, description: "Col routier, départ du Trou de la Bombe et de la variante alpine du GR20." },
  { id: "a_col_vergio", name: "Col de Vergio", type: "pass", lat: 42.295, lng: 8.8853, elevation: 1478, description: "Plus haut col routier de Corse, entre Niolu et forêt d'Aïtone." },
  { id: "a_col_vizzavona", name: "Col de Vizzavona", type: "pass", lat: 42.1206, lng: 9.1428, elevation: 1163, description: "Col de la route nationale, au cœur de la forêt de Vizzavona." },
  // Lacs
  { id: "a_lac_nino", name: "Lac de Nino", type: "lake", lat: 42.2586, lng: 8.9403, elevation: 1743, description: "Lac et pozzines, source du Tavignano." },
  { id: "a_lac_melo", name: "Lac de Melo", type: "lake", lat: 42.2139, lng: 9.0261, elevation: 1711, description: "Lac glaciaire de la Restonica, très fréquenté en été." },
  { id: "a_lac_capitello", name: "Lac de Capitello", type: "lake", lat: 42.2117, lng: 9.0183, elevation: 1930, description: "Lac le plus profond de Corse, au-dessus de Melo." },
  // Refuges du GR20
  { id: "a_ref_piobbu", name: "Refuge d'Ortu di u Piobbu", type: "refuge", lat: 42.4692, lng: 8.9106, elevation: 1520 },
  { id: "a_ref_carrozzu", name: "Refuge de Carrozzu", type: "refuge", lat: 42.4433, lng: 8.92, elevation: 1270 },
  { id: "a_ref_asco", name: "Refuge d'Asco Stagnu", type: "refuge", lat: 42.4083, lng: 8.9219, elevation: 1422 },
  { id: "a_ref_tighjettu", name: "Refuge de Tighjettu", type: "refuge", lat: 42.3728, lng: 8.9219, elevation: 1683 },
  { id: "a_ref_ciottulu", name: "Refuge de Ciottulu di i Mori", type: "refuge", lat: 42.3339, lng: 8.8983, elevation: 1991 },
  { id: "a_ref_manganu", name: "Refuge de Manganu", type: "refuge", lat: 42.2597, lng: 8.9678, elevation: 1601 },
  { id: "a_ref_petra_piana", name: "Refuge de Petra Piana", type: "refuge", lat: 42.2381, lng: 9.0206, elevation: 1842 },
  { id: "a_ref_onda", name: "Refuge de l'Onda", type: "refuge", lat: 42.18, lng: 9.0794, elevation: 1430 },
  { id: "a_ref_prati", name: "Refuge de Prati", type: "refuge", lat: 42.0783, lng: 9.1858, elevation: 1820 },
  { id: "a_ref_usciolu", name: "Refuge d'Usciolu", type: "refuge", lat: 41.9569, lng: 9.2028, elevation: 1750 },
  { id: "a_ref_asinau", name: "Refuge d'Asinau", type: "refuge", lat: 41.8617, lng: 9.2, elevation: 1530 },
  { id: "a_ref_paliri", name: "Refuge de Paliri", type: "refuge", lat: 41.7936, lng: 9.2453, elevation: 1055 },
  { id: "a_ref_sega", name: "Refuge de la Sega", type: "refuge", lat: 42.285, lng: 9.0728, elevation: 1166 },
];

// ---------------------------------------------------------------------------
// Sentiers (trails)
// ---------------------------------------------------------------------------

interface TrailSeed {
  id: string;
  name: string;
  type: "hiking" | "trail" | "mtb" | "equestrian" | "mixed";
  difficulty: "easy" | "moderate" | "hard" | "expert";
  distanceKm: number;
  elevationGainM: number;
  /** [lng, lat] */
  coords: [number, number][];
  description: string;
}

const TRAILS: TrailSeed[] = [
  {
    id: "t_gr20_nord",
    name: "GR20 Nord — Calenzana → Vizzavona",
    type: "hiking",
    difficulty: "expert",
    distanceKm: 96,
    elevationGainM: 7100,
    coords: [
      [8.8567, 42.5083], [8.9106, 42.4692], [8.92, 42.4433], [8.9219, 42.4083], [8.9219, 42.3728],
      [8.8983, 42.3339], [8.9403, 42.2586], [8.9678, 42.2597], [9.0206, 42.2381], [9.0794, 42.18], [9.1339, 42.1275],
    ],
    description: "La moitié nord du GR20 : passerelle de Spasimata, Cirque de la Solitude contourné par la Pointe des Éboulis, lacs de Nino et de Capitello.",
  },
  {
    id: "t_gr20_sud",
    name: "GR20 Sud — Vizzavona → Conca",
    type: "hiking",
    difficulty: "hard",
    distanceKm: 84,
    elevationGainM: 5300,
    coords: [
      [9.1339, 42.1275], [9.1858, 42.0783], [9.2028, 41.9569], [9.2136, 41.8636], [9.2, 41.8617],
      [9.2233, 41.7953], [9.2453, 41.7936], [9.3364, 41.7378],
    ],
    description: "Crêtes du Renoso, plateau du Coscione, Monte Incudine, aiguilles de Bavella puis descente vers Conca.",
  },
  {
    id: "t_restonica_melo",
    name: "Restonica — Grotelle → Lac de Melo → Lac de Capitello",
    type: "hiking",
    difficulty: "moderate",
    distanceKm: 5.6,
    elevationGainM: 530,
    coords: [[9.0453, 42.2261], [9.0412, 42.2236], [9.0355, 42.2203], [9.0305, 42.2168], [9.0261, 42.2139], [9.0221, 42.2124], [9.0183, 42.2117]],
    description: "Le classique de la Restonica : sentier rocheux avec chaînes avant Melo, puis raidillon jusqu'à Capitello.",
  },
  {
    id: "t_bavella_bombe",
    name: "Bavella — Trou de la Bombe",
    type: "hiking",
    difficulty: "easy",
    distanceKm: 6.2,
    elevationGainM: 260,
    coords: [[9.2233, 41.7953], [9.2275, 41.7967], [9.2318, 41.7975], [9.236, 41.7982], [9.2392, 41.7988], [9.2404, 41.7994]],
    description: "Boucle familiale en forêt de pins laricio jusqu'à l'arche naturelle du Tafunatu di u Cumpuleddu.",
  },
  {
    id: "t_cascade_anglais",
    name: "Cascade des Anglais depuis Vizzavona",
    type: "hiking",
    difficulty: "easy",
    distanceKm: 4.4,
    elevationGainM: 180,
    coords: [[9.1339, 42.1275], [9.1305, 42.1262], [9.1272, 42.1248], [9.1242, 42.1236], [9.1212, 42.1229], [9.1189, 42.1226]],
    description: "Vasques et cascades de l'Agnone sous les hêtres, accessible à tous.",
  },
  {
    id: "t_mare_a_mare_corte_sega",
    name: "Mare a Mare Nord — Corte → Refuge de la Sega → Calacuccia",
    type: "mixed",
    difficulty: "moderate",
    distanceKm: 27,
    elevationGainM: 1450,
    coords: [[9.1497, 42.3061], [9.1268, 42.2978], [9.1036, 42.2915], [9.0728, 42.285], [9.0512, 42.2986], [9.0308, 42.3172], [9.0128, 42.3336]],
    description: "Remontée des gorges du Tavignano jusqu'au refuge de la Sega puis bascule dans le Niolu.",
  },
  {
    id: "t_mare_e_monti_calenzana_galeria",
    name: "Mare e Monti — Calenzana → Bonifatu → Galéria",
    type: "hiking",
    difficulty: "moderate",
    distanceKm: 38,
    elevationGainM: 1800,
    coords: [[8.8567, 42.5083], [8.8855, 42.4906], [8.9033, 42.4703], [8.8455, 42.4612], [8.7692, 42.4468], [8.7055, 42.4288], [8.6539, 42.4106]],
    description: "Première étape du Mare e Monti : cirque de Bonifatu, vallée du Fangu puis Galéria.",
  },
  {
    id: "t_vtt_vergio_nino",
    name: "Boucle VTT Col de Vergio — Bergeries de Radule",
    type: "mtb",
    difficulty: "hard",
    distanceKm: 14,
    elevationGainM: 640,
    coords: [[8.8853, 42.295], [8.8942, 42.3018], [8.9051, 42.3067], [8.9123, 42.2981], [8.8998, 42.2888], [8.8853, 42.295]],
    description: "Pistes forestières de Valdu Niellu et single technique vers les bergeries de Radule.",
  },
];

// ---------------------------------------------------------------------------
// Points d'eau
// ---------------------------------------------------------------------------

interface WaterSeed {
  id: string;
  name: string;
  type: "spring" | "fountain" | "stream" | "lake" | "refuge" | "shelter";
  lat: number;
  lng: number;
  elevation?: number;
  state?: "active" | "dry" | "unknown";
  stateAgoMin?: number;
}

const WATER: WaterSeed[] = [
  { id: "w_fontaine_calenzana", name: "Fontaine de Calenzana", type: "fountain", lat: 42.5079, lng: 8.8572, elevation: 275, state: "active", stateAgoMin: 5 * D },
  { id: "w_source_piobbu", name: "Source d'Ortu di u Piobbu", type: "spring", lat: 42.4684, lng: 8.9112, elevation: 1500, state: "active", stateAgoMin: 2 * D },
  { id: "w_ref_piobbu", name: "Refuge d'Ortu di u Piobbu", type: "refuge", lat: 42.4692, lng: 8.9106, elevation: 1520, state: "active", stateAgoMin: 2 * D },
  { id: "w_ref_carrozzu", name: "Refuge de Carrozzu", type: "refuge", lat: 42.4433, lng: 8.92, elevation: 1270, state: "active", stateAgoMin: 3 * D },
  { id: "w_source_spasimata", name: "Source de Spasimata", type: "spring", lat: 42.4372, lng: 8.9242, elevation: 1350, state: "active", stateAgoMin: 6 * D },
  { id: "w_ref_asco", name: "Refuge d'Asco Stagnu", type: "refuge", lat: 42.4083, lng: 8.9219, elevation: 1422, state: "active", stateAgoMin: 1 * D },
  { id: "w_fontaine_haut_asco", name: "Fontaine de Haut-Asco", type: "fountain", lat: 42.4079, lng: 8.9228, elevation: 1420, state: "active", stateAgoMin: 1 * D },
  { id: "w_ref_tighjettu", name: "Refuge de Tighjettu", type: "refuge", lat: 42.3728, lng: 8.9219, elevation: 1683, state: "active", stateAgoMin: 4 * D },
  { id: "w_bergeries_ballone", name: "Bergeries de Ballone", type: "shelter", lat: 42.3672, lng: 8.9186, elevation: 1440, state: "unknown" },
  { id: "w_ref_ciottulu", name: "Refuge de Ciottulu di i Mori", type: "refuge", lat: 42.3339, lng: 8.8983, elevation: 1991, state: "active", stateAgoMin: 2 * D },
  { id: "w_source_golo", name: "Source du Golo", type: "spring", lat: 42.3312, lng: 8.8961, elevation: 1960, state: "active", stateAgoMin: 2 * D },
  { id: "w_bergeries_radule", name: "Bergeries de Radule", type: "shelter", lat: 42.3067, lng: 8.9051, elevation: 1370, state: "active", stateAgoMin: 8 * D },
  { id: "w_fontaine_vergio", name: "Fontaine du col de Vergio", type: "fountain", lat: 42.2948, lng: 8.8849, elevation: 1478, state: "active", stateAgoMin: 1 * D },
  { id: "w_lac_nino", name: "Lac de Nino", type: "lake", lat: 42.2586, lng: 8.9403, elevation: 1743, state: "active", stateAgoMin: 3 * D },
  { id: "w_ref_manganu", name: "Refuge de Manganu", type: "refuge", lat: 42.2597, lng: 8.9678, elevation: 1601, state: "active", stateAgoMin: 3 * D },
  { id: "w_ref_petra_piana", name: "Refuge de Petra Piana", type: "refuge", lat: 42.2381, lng: 9.0206, elevation: 1842, state: "active", stateAgoMin: 2 * D },
  { id: "w_lac_melo", name: "Lac de Melo", type: "lake", lat: 42.2139, lng: 9.0261, elevation: 1711, state: "active", stateAgoMin: 1 * D },
  { id: "w_lac_capitello", name: "Lac de Capitello", type: "lake", lat: 42.2117, lng: 9.0183, elevation: 1930, state: "active", stateAgoMin: 2 * D },
  { id: "w_bergeries_grotelle", name: "Bergeries de Grotelle", type: "shelter", lat: 42.2261, lng: 9.0453, elevation: 1375, state: "active", stateAgoMin: 1 * D },
  { id: "w_source_grotelle", name: "Source des Bergeries de Grotelle", type: "spring", lat: 42.2254, lng: 9.0441, elevation: 1380, state: "dry", stateAgoMin: 3 * H },
  { id: "w_ref_onda", name: "Refuge de l'Onda", type: "refuge", lat: 42.18, lng: 9.0794, elevation: 1430, state: "active", stateAgoMin: 5 * D },
  { id: "w_fontaine_vizzavona", name: "Fontaine de la gare de Vizzavona", type: "fountain", lat: 42.1278, lng: 9.1343, elevation: 920, state: "active", stateAgoMin: 1 * D },
  { id: "w_cascade_anglais", name: "Cascade des Anglais (Agnone)", type: "stream", lat: 42.1226, lng: 9.1189, elevation: 1100, state: "active", stateAgoMin: 2 * D },
  { id: "w_ref_prati", name: "Refuge de Prati", type: "refuge", lat: 42.0783, lng: 9.1858, elevation: 1820, state: "active", stateAgoMin: 4 * D },
  { id: "w_ref_usciolu", name: "Refuge d'Usciolu", type: "refuge", lat: 41.9569, lng: 9.2028, elevation: 1750, state: "active", stateAgoMin: 6 * D },
  { id: "w_source_coscione", name: "Source du plateau du Coscione", type: "spring", lat: 41.9012, lng: 9.2101, elevation: 1500, state: "dry", stateAgoMin: 2 * D },
  { id: "w_ref_asinau", name: "Refuge d'Asinau", type: "refuge", lat: 41.8617, lng: 9.2, elevation: 1530, state: "active", stateAgoMin: 3 * D },
  { id: "w_fontaine_bavella", name: "Fontaine du col de Bavella", type: "fountain", lat: 41.7956, lng: 9.2229, elevation: 1218, state: "active", stateAgoMin: 6 * H },
  { id: "w_ref_paliri", name: "Refuge de Paliri", type: "refuge", lat: 41.7936, lng: 9.2453, elevation: 1055, state: "active", stateAgoMin: 2 * D },
  { id: "w_source_paliri", name: "Source de Paliri", type: "spring", lat: 41.7928, lng: 9.2462, elevation: 1040, state: "dry", stateAgoMin: 1 * D },
  { id: "w_ref_sega", name: "Refuge de la Sega", type: "refuge", lat: 42.285, lng: 9.0728, elevation: 1166, state: "active", stateAgoMin: 7 * D },
  { id: "w_fontaine_zonza", name: "Fontaine de Zonza", type: "fountain", lat: 41.7522, lng: 9.1692, elevation: 780, state: "active", stateAgoMin: 10 * D },
];

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

interface UserSeed {
  id: string;
  email: string;
  pseudo: string;
  role: UserRole;
  practices: Practice[];
  region?: string;
  createdDaysAgo: number;
  partner?: { organisation: string; kind: "guide" | "shepherd" | "hunting_society" | "association" | "trail_manager" | "commune" | "public_service" | "other"; description: string };
}

const USERS: UserSeed[] = [
  { id: "u_admin", email: "admin@mountain-live.demo", pseudo: "Admin Mountain Live", role: "admin", practices: ["manager"], region: "Corse", createdDaysAgo: 400 },
  { id: "u_moderateur", email: "moderateur@mountain-live.demo", pseudo: "Modération", role: "moderator", practices: ["hiker", "manager"], region: "Corse", createdDaysAgo: 300 },
  { id: "u_mairie_corte", email: "mairie-corte@mountain-live.demo", pseudo: "Mairie de Corte", role: "official", practices: ["manager"], region: "Haute-Corse", createdDaysAgo: 200, partner: { organisation: "Mairie de Corte", kind: "commune", description: "Service environnement et sentiers de la commune de Corte." } },
  { id: "u_berger_asco", email: "berger-asco@mountain-live.demo", pseudo: "Berger d'Asco", role: "partner", practices: ["shepherd"], region: "Haute-Corse", createdDaysAgo: 180, partner: { organisation: "Estive d'Asco — élevage ovin", kind: "shepherd", description: "Éleveur transhumant, chiens de protection en estive de juin à octobre." } },
  { id: "u_guide_bavella", email: "guide-bavella@mountain-live.demo", pseudo: "Guide Bavella", role: "partner", practices: ["professional", "hiker"], region: "Corse-du-Sud", createdDaysAgo: 220, partner: { organisation: "Bavella Aventura — accompagnateur en montagne", kind: "guide", description: "Accompagnateur diplômé, sorties quotidiennes dans le massif de Bavella." } },
  { id: "u_rando", email: "rando@mountain-live.demo", pseudo: "Rando Corsica", role: "user", practices: ["hiker", "trail"], region: "Corse", createdDaysAgo: 90 },
  { id: "u_c1", email: "lisandru@mountain-live.demo", pseudo: "Lisandru", role: "user", practices: ["hiker"], region: "Haute-Corse", createdDaysAgo: 150 },
  { id: "u_c2", email: "ghjulia@mountain-live.demo", pseudo: "Ghjulia", role: "user", practices: ["trail", "hiker"], region: "Corse-du-Sud", createdDaysAgo: 120 },
  { id: "u_c3", email: "petru@mountain-live.demo", pseudo: "Petru Trail", role: "user", practices: ["trail"], region: "Corse", createdDaysAgo: 60 },
  { id: "u_c4", email: "maria@mountain-live.demo", pseudo: "Maria Cavalière", role: "user", practices: ["rider"], region: "Corse-du-Sud", createdDaysAgo: 75 },
  { id: "u_c5", email: "anto@mountain-live.demo", pseudo: "Antò VTT", role: "user", practices: ["mtb"], region: "Haute-Corse", createdDaysAgo: 40 },
  { id: "u_c6", email: "santu@mountain-live.demo", pseudo: "Santu Chasseur", role: "user", practices: ["hunter"], region: "Corse-du-Sud", createdDaysAgo: 210 },
  { id: "u_c7", email: "paulu@mountain-live.demo", pseudo: "Paulu Pêcheur", role: "user", practices: ["fisher", "hiker"], region: "Haute-Corse", createdDaysAgo: 30 },
  { id: "u_c8", email: "francesca@mountain-live.demo", pseudo: "Francesca", role: "user", practices: ["hiker", "other"], region: "Corse", createdDaysAgo: 12 },
];

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

interface VoteSeed {
  user: string;
  kind: ConfirmationKind;
  agoMin: number;
  comment?: string;
}
interface CommentSeed {
  id: string;
  user: string;
  agoMin: number;
  body: string;
}
interface ReportSeed {
  id: string;
  user: string;
  subtype: ReportSubtype;
  lat: number;
  lng: number;
  agoMin: number;
  ttlMin?: number;
  /** Fin de l'événement (minutes à partir de maintenant, négatif = passé). */
  endsInMin?: number;
  startsInMin?: number;
  danger?: DangerLevel;
  description: string;
  zone?: string;
  /** Statut forcé : « resolved » (auteur) ou « expired ». */
  status?: "resolved" | "expired";
  votes?: VoteSeed[];
  comments?: CommentSeed[];
  photo?: string;
  clientId?: string;
}

const REPORTS: ReportSeed[] = [
  // ---- Restonica / Corte
  { id: "r_001", user: "u_c1", subtype: "fallen_tree", lat: 42.2312, lng: 9.0538, agoMin: 3 * H, danger: "moderate", description: "Pin tombé en travers du sentier 200 m après les bergeries de Grotelle. On passe en enjambant, prudence avec un gros sac.", photo: "arbre-tombe-restonica", votes: [{ user: "u_rando", kind: "still_present", agoMin: 90 }, { user: "u_c2", kind: "still_present", agoMin: 40 }, { user: "u_c7", kind: "still_present", agoMin: 12 }], comments: [{ id: "c_001", user: "u_c2", agoMin: 38, body: "Passage possible par la droite, un peu glissant." }] },
  { id: "r_002", user: "u_c2", subtype: "many_hikers", lat: 42.2145, lng: 9.0268, agoMin: 25, description: "Beaucoup de monde au lac de Melo, file d'attente aux chaînes.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 10 }] },
  { id: "r_003", user: "u_rando", subtype: "spring_dry", lat: 42.2254, lng: 9.0441, agoMin: 3 * H, description: "La source des bergeries de Grotelle ne coule plus. Prévoir de l'eau depuis Corte.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 2 * H }, { user: "u_c8", kind: "still_present", agoMin: 50 }] },
  { id: "r_004", user: "u_mairie_corte", subtype: "path_closed", lat: 42.276, lng: 9.108, agoMin: 2 * D, endsInMin: 5 * D, description: "Sentier des gorges de la Restonica (secteur Tuani) fermé par arrêté municipal : chutes de pierres après les orages. Itinéraire de substitution par la route.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 1 * D }] },
  { id: "r_005", user: "u_c7", subtype: "flood", lat: 42.2699, lng: 9.1145, agoMin: 4 * H, danger: "high", description: "Restonica en crue au pont de Tuani, gué impraticable, le niveau monte vite.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 3 * H }, { user: "u_c3", kind: "improved", agoMin: 40, comment: "Le niveau redescend mais ça reste impressionnant." }] },
  { id: "r_006", user: "u_c8", subtype: "vehicles", lat: 42.2401, lng: 9.0637, agoMin: 45, description: "Parking de Grotelle complet, navettes en place, voitures garées sur la route." },
  { id: "r_007", user: "u_c3", subtype: "signage_issue", lat: 42.2189, lng: 9.0328, agoMin: 6 * D, description: "Marques jaunes effacées entre Melo et Capitello, cairns peu visibles dans le brouillard.", votes: [{ user: "u_rando", kind: "still_present", agoMin: 2 * D }] },
  { id: "r_008", user: "u_c1", subtype: "boars", lat: 42.2372, lng: 9.0581, agoMin: 2 * H, description: "Compagnie de sangliers avec marcassins dans le maquis près de la route, restez à distance." },
  { id: "r_009", user: "u_c5", subtype: "mtb", lat: 42.2989, lng: 9.1271, agoMin: 70, description: "Groupe de VTT en descente sur la piste du Tavignano, attention dans les virages." },
  { id: "r_010", user: "u_rando", subtype: "refuge", lat: 42.285, lng: 9.0728, agoMin: 7 * D, description: "Refuge de la Sega ouvert, gardien présent, ravitaillement possible.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 3 * D }, { user: "u_c7", kind: "still_present", agoMin: 1 * D }] },
  { id: "r_011", user: "u_c8", subtype: "quiet_area", lat: 42.2915, lng: 9.1036, agoMin: 55, description: "Gorges du Tavignano très calmes ce matin, personne sur le sentier." },
  // ---- Asco / Cinto
  { id: "r_012", user: "u_berger_asco", subtype: "herd", lat: 42.4241, lng: 8.9522, agoMin: 40, ttlMin: 8 * H, description: "Troupeau de brebis en déplacement entre Haut-Asco et les bergeries de Cabane, chiens de protection présents. Contournez large.", photo: "troupeau-asco", votes: [{ user: "u_c1", kind: "still_present", agoMin: 15 }] },
  { id: "r_013", user: "u_berger_asco", subtype: "guard_dogs", lat: 42.4195, lng: 8.9498, agoMin: 40, ttlMin: 12 * H, danger: "moderate", description: "Trois patous avec le troupeau. Ne pas courir, ne pas caresser, éloignez votre chien.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 14 }, { user: "u_c5", kind: "still_present", agoMin: 8 }] },
  { id: "r_014", user: "u_c3", subtype: "snow", lat: 42.3908, lng: 8.9331, agoMin: 1 * D, danger: "high", description: "Névé raide et dur dans le couloir sous la Pointe des Éboulis. Crampons et piolet indispensables tôt le matin.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 12 * H }, { user: "u_c2", kind: "still_present", agoMin: 5 * H }] },
  { id: "r_015", user: "u_c1", subtype: "rockfall", lat: 42.3861, lng: 8.9375, agoMin: 3 * D, danger: "critical", description: "Éboulement récent dans le vallon de Stranciacone, blocs instables sur la sente. Passage déconseillé par temps de pluie.", votes: [{ user: "u_c3", kind: "still_present", agoMin: 2 * D }, { user: "u_rando", kind: "still_present", agoMin: 1 * D }, { user: "u_c2", kind: "still_present", agoMin: 6 * H }, { user: "u_c5", kind: "still_present", agoMin: 3 * H }], comments: [{ id: "c_002", user: "u_c3", agoMin: 2 * D, body: "Vu ce matin, la sente est déviée par des cairns sur la gauche." }, { id: "c_003", user: "u_rando", agoMin: 1 * D, body: "Confirmé, casque recommandé." }] },
  { id: "r_016", user: "u_c7", subtype: "spring_active", lat: 42.4079, lng: 8.9228, agoMin: 1 * D, description: "Fontaine de Haut-Asco : débit correct, eau fraîche." },
  { id: "r_017", user: "u_c2", subtype: "wildlife", lat: 42.4012, lng: 8.9152, agoMin: 80, description: "Mouflons observés sur les pentes au-dessus du refuge, groupe d'une dizaine d'individus." },
  { id: "r_018", user: "u_c5", subtype: "poor_condition", lat: 42.4402, lng: 8.9987, agoMin: 4 * D, description: "Piste d'Asco très dégradée après le pont, ornières profondes, VTT à pied sur 300 m." },
  { id: "r_019", user: "u_c1", subtype: "injured_animal", lat: 42.4478, lng: 9.0211, agoMin: 5 * H, description: "Chevreuil blessé au bord de la route d'Asco, l'OFB est prévenu." },
  // ---- Vizzavona / Monte d'Oro
  { id: "r_020", user: "u_c2", subtype: "busy_area", lat: 42.1232, lng: 9.1201, agoMin: 35, description: "Cascade des Anglais bondée, familles avec enfants sur les rochers." },
  { id: "r_021", user: "u_c3", subtype: "ice", lat: 42.1398, lng: 9.1132, agoMin: 6 * H, danger: "moderate", description: "Plaques de verglas sur les dalles sous le sommet du Monte d'Oro, versant nord.", votes: [{ user: "u_c2", kind: "still_present", agoMin: 3 * H }] },
  { id: "r_022", user: "u_c8", subtype: "fountain", lat: 42.1278, lng: 9.1343, agoMin: 1 * D, description: "Fontaine de la gare de Vizzavona en service, pratique avant de partir." },
  { id: "r_023", user: "u_rando", subtype: "works", lat: 42.1206, lng: 9.1428, agoMin: 2 * D, endsInMin: 12 * D, description: "Travaux ONF sur la piste au col de Vizzavona, engins en mouvement en semaine de 8 h à 17 h." },
  { id: "r_024", user: "u_c4", subtype: "riders", lat: 42.1312, lng: 9.1402, agoMin: 20, description: "Groupe de 6 cavaliers sur la piste forestière vers la Foce, laissez passer calmement." },
  { id: "r_025", user: "u_c1", subtype: "no_signal", lat: 42.1487, lng: 9.1078, agoMin: 10 * D, description: "Aucun réseau entre la Foce et le sommet du Monte d'Oro.", votes: [{ user: "u_c3", kind: "still_present", agoMin: 4 * D }, { user: "u_rando", kind: "still_present", agoMin: 1 * D }] },
  { id: "r_026", user: "u_c7", subtype: "other_animal", lat: 42.1352, lng: 9.1265, agoMin: 3 * H, description: "Couple de sittelles corses observé dans les pins laricio près du sentier." },
  { id: "r_027", user: "u_c2", subtype: "obstacle", lat: 42.1259, lng: 9.1224, agoMin: 2 * D, danger: "low", description: "Passerelle en bois cassée sur le sentier de la cascade, on passe à gué.", status: "resolved", votes: [{ user: "u_rando", kind: "gone", agoMin: 5 * H }, { user: "u_c8", kind: "gone", agoMin: 4 * H }] },
  // ---- Bavella / Zonza / Conca
  { id: "r_028", user: "u_c6", subtype: "battue", lat: 41.7684, lng: 9.1912, agoMin: 2 * H, endsInMin: 4 * H, startsInMin: -2 * H, description: "Battue au sanglier de la société de chasse de Zonza, secteur forêt de l'Ospedale – route de Bavella. Panneaux en place, restez sur les sentiers balisés.", votes: [{ user: "u_guide_bavella", kind: "still_present", agoMin: 60 }, { user: "u_c4", kind: "still_present", agoMin: 30 }] },
  { id: "r_029", user: "u_guide_bavella", subtype: "rockfall", lat: 41.8021, lng: 9.2112, agoMin: 2 * D, danger: "high", description: "Chute de blocs dans le couloir de la variante alpine sous la Punta di u Pargulu. Variante déconseillée, restez sur le GR20 classique.", photo: "eboulement-bavella", votes: [{ user: "u_c2", kind: "still_present", agoMin: 1 * D }, { user: "u_c3", kind: "still_present", agoMin: 8 * H }, { user: "u_rando", kind: "still_present", agoMin: 2 * H }] },
  { id: "r_030", user: "u_guide_bavella", subtype: "dangerous_passage", lat: 41.7998, lng: 9.2154, agoMin: 5 * D, danger: "moderate", description: "Passage de la brèche de Capellu : dalle polie et exposée, chaîne en bon état. Déconseillé par temps humide.", votes: [{ user: "u_c2", kind: "still_present", agoMin: 3 * D }, { user: "u_c8", kind: "still_present", agoMin: 2 * D }] },
  { id: "r_031", user: "u_c2", subtype: "many_hikers", lat: 41.7988, lng: 9.2392, agoMin: 50, description: "Trou de la Bombe : beaucoup de monde sur la boucle, groupes scolaires." },
  { id: "r_032", user: "u_c8", subtype: "fountain", lat: 41.7956, lng: 9.2229, agoMin: 6 * H, description: "Fontaine du col de Bavella fonctionne, remplissage facile." },
  { id: "r_033", user: "u_c3", subtype: "spring_dry", lat: 41.7928, lng: 9.2462, agoMin: 1 * D, description: "Source de Paliri à sec, le refuge vend de l'eau.", votes: [{ user: "u_c2", kind: "still_present", agoMin: 10 * H }] },
  { id: "r_034", user: "u_c4", subtype: "horses", lat: 41.7602, lng: 9.1756, agoMin: 90, description: "Chevaux en liberté sur la route de Zonza à Bavella, ralentissez." },
  { id: "r_035", user: "u_c6", subtype: "hunting", lat: 41.7311, lng: 9.3105, agoMin: 3 * H, endsInMin: 2 * H, description: "Chasse individuelle en cours au-dessus de Conca, secteur Punta Batarelli." },
  { id: "r_036", user: "u_c1", subtype: "fire", lat: 41.7789, lng: 9.2017, agoMin: 5 * D, danger: "critical", description: "Départ de feu maîtrisé au-dessus de la route, zone brûlée fumante, sentier fermé par les pompiers.", status: "expired" },
  { id: "r_037", user: "u_rando", subtype: "path_cluttered", lat: 41.8084, lng: 9.2331, agoMin: 3 * D, description: "Sentier vers le refuge de Paliri encombré de branches après le coup de vent." , votes: [{ user: "u_c2", kind: "improved", agoMin: 1 * D, comment: "Un débroussaillage partiel a été fait." }] },
  { id: "r_038", user: "u_c8", subtype: "sport_event", lat: 41.7953, lng: 9.2233, agoMin: 1 * D, startsInMin: 2 * D, endsInMin: 2 * D + 10 * H, description: "Trail des Aiguilles dimanche : 400 coureurs sur le GR20 entre Bavella et Paliri de 7 h à 17 h." },
  // ---- Calenzana / GR20 Nord
  { id: "r_039", user: "u_c1", subtype: "guard_dogs", lat: 42.4652, lng: 8.9081, agoMin: 4 * H, danger: "moderate", description: "Deux chiens de protection près du refuge d'Ortu di u Piobbu, troupeau dans les pozzines." },
  { id: "r_040", user: "u_c3", subtype: "collapsed_path", lat: 42.4398, lng: 8.9231, agoMin: 2 * D, danger: "high", description: "Marche effondrée juste avant la passerelle de Spasimata, mains courantes à utiliser.", votes: [{ user: "u_c1", kind: "still_present", agoMin: 1 * D }, { user: "u_c2", kind: "still_present", agoMin: 12 * H }] },
  { id: "r_041", user: "u_c7", subtype: "spring", lat: 42.4372, lng: 8.9242, agoMin: 4 * D, description: "Source de Spasimata bien alimentée, à 5 min du refuge de Carrozzu." },
  { id: "r_042", user: "u_c5", subtype: "vehicles", lat: 42.4703, lng: 8.9033, agoMin: 2 * H, description: "Parking de Bonifatu saturé, stationnement sur la route forestière." },
  { id: "r_043", user: "u_c2", subtype: "shelter", lat: 42.4906, lng: 8.8855, agoMin: 20 * D, description: "Abri de berger en pierre sèche utilisable en cas d'orage, 30 min après Calenzana." },
  { id: "r_044", user: "u_rando", subtype: "wildlife", lat: 42.4744, lng: 8.9171, agoMin: 30, description: "Gypaète barbu en vol au-dessus de la crête, superbe observation." },
  // ---- Évisa / Vergio / Nino
  { id: "r_045", user: "u_c8", subtype: "cattle", lat: 42.2611, lng: 8.9421, agoMin: 2 * H, description: "Vaches et veaux sur les pozzines du lac de Nino, tenir les chiens en laisse." },
  { id: "r_046", user: "u_c4", subtype: "horses", lat: 42.2569, lng: 8.9356, agoMin: 3 * H, description: "Chevaux semi-sauvages autour du lac de Nino, ne pas les nourrir." },
  { id: "r_047", user: "u_c1", subtype: "pastoral_activity", lat: 42.3067, lng: 8.9051, agoMin: 6 * H, description: "Bergeries de Radule occupées, fabrication de fromage, chiens attachés." },
  { id: "r_048", user: "u_c5", subtype: "mtb", lat: 42.3018, lng: 8.8942, agoMin: 40, description: "Sortie VTT club sur les pistes de Valdu Niellu jusqu'à midi." },
  { id: "r_049", user: "u_c2", subtype: "fallen_tree", lat: 42.2512, lng: 8.8231, agoMin: 1 * D, danger: "low", description: "Châtaignier tombé sur le sentier d'Évisa vers les gorges de Spelunca, contournement facile.", votes: [{ user: "u_c8", kind: "still_present", agoMin: 8 * H }] },
  { id: "r_050", user: "u_c7", subtype: "water_point", lat: 42.2948, lng: 8.8849, agoMin: 1 * D, description: "Fontaine du col de Vergio en service, eau potable affichée." },
  // ---- Ghisoni / Renoso / Bastelica
  { id: "r_051", user: "u_c3", subtype: "snow", lat: 42.0645, lng: 9.0711, agoMin: 2 * D, danger: "moderate", description: "Névés persistants sur l'arête nord du Renoso, passage à pied délicat le matin." },
  { id: "r_052", user: "u_c6", subtype: "zone_occupied", lat: 42.0931, lng: 9.2264, agoMin: 3 * H, endsInMin: 3 * H, description: "Exercice de secours en montagne (PGHM) sur les Kyrie Eleison, zone d'hélitreuillage à éviter." },
  { id: "r_053", user: "u_c4", subtype: "riders", lat: 42.0281, lng: 9.0562, agoMin: 60, description: "Randonnée équestre de 8 chevaux sur le plateau d'Ese jusqu'en début d'après-midi." },
  { id: "r_054", user: "u_c1", subtype: "forestry_works", lat: 42.1106, lng: 9.2001, agoMin: 1 * D, endsInMin: 20 * D, description: "Coupe de bois en forêt de Marmano, piste fermée aux véhicules, passage piéton signalé." },
  { id: "r_055", user: "u_rando", subtype: "refuge", lat: 42.0783, lng: 9.1858, agoMin: 4 * D, description: "Refuge de Prati ouvert, gardien présent, tentes disponibles à la location." },
  { id: "r_056", user: "u_c8", subtype: "aggressive_animal", lat: 42.0112, lng: 9.0489, agoMin: 3 * H, danger: "high", description: "Chien errant agressif près du pont de Bastelica, a chargé deux randonneurs.", votes: [{ user: "u_c4", kind: "disputed", agoMin: 2 * H, comment: "Passé à 14 h, aucun chien vu." }, { user: "u_c3", kind: "disputed", agoMin: 1 * H }] },
  // ---- Calacuccia / Sega
  { id: "r_057", user: "u_c7", subtype: "flood", lat: 42.3311, lng: 9.0089, agoMin: 8 * H, danger: "moderate", description: "Lâcher d'eau du barrage de Calacuccia, ne pas s'attarder dans le lit du Golo en aval." },
  { id: "r_058", user: "u_c1", subtype: "access_restriction", lat: 42.3204, lng: 9.0402, agoMin: 3 * D, endsInMin: 30 * D, description: "Accès à la piste de Calasima réservé aux riverains pendant la période d'estive." },
  { id: "r_059", user: "u_c2", subtype: "quiet_area", lat: 42.29, lng: 9.06, agoMin: 2 * H, description: "Personne sur le sentier du Tavignano entre la Sega et Calacuccia." },
  { id: "r_060", user: "u_c5", subtype: "path_impassable", lat: 42.3121, lng: 9.0512, agoMin: 1 * D, danger: "high", description: "Piste emportée par un ravinement à 2 km de Calacuccia, impossible à VTT et en voiture." , votes: [{ user: "u_c1", kind: "still_present", agoMin: 12 * H }, { user: "u_c7", kind: "still_present", agoMin: 6 * H }] },
  // ---- Incudine / Usciolu / Coscione
  { id: "r_061", user: "u_c3", subtype: "spring_dry", lat: 41.9012, lng: 9.2101, agoMin: 2 * D, description: "Source du plateau du Coscione tarie, remplissez à Usciolu." , votes: [{ user: "u_c2", kind: "still_present", agoMin: 1 * D }] },
  { id: "r_062", user: "u_c4", subtype: "herd", lat: 41.9105, lng: 9.2188, agoMin: 2 * H, description: "Grand troupeau de vaches et cochons en liberté sur le plateau du Coscione." },
  { id: "r_063", user: "u_rando", subtype: "refuge", lat: 41.9569, lng: 9.2028, agoMin: 6 * D, description: "Refuge d'Usciolu ouvert, épicerie bien fournie." },
  { id: "r_064", user: "u_c8", subtype: "dangerous_passage", lat: 41.8598, lng: 9.2142, agoMin: 4 * D, danger: "moderate", description: "Descente du Monte Incudine vers Asinau : sentier très raide et glissant sur les aiguilles de pin." },
  // ---- Divers / anciens
  { id: "r_065", user: "u_c1", subtype: "boars", lat: 42.3134, lng: 9.1544, agoMin: 4 * H, description: "Sangliers au-dessus de Corte, quartier de la citadelle.", status: "expired" },
  { id: "r_066", user: "u_c2", subtype: "many_hikers", lat: 42.2126, lng: 9.0221, agoMin: 5 * H, description: "Foule entre Melo et Capitello.", status: "expired" },
  { id: "r_067", user: "u_c6", subtype: "battue", lat: 42.4589, lng: 9.0455, agoMin: 3 * D, startsInMin: -3 * D, endsInMin: -3 * D + 6 * H, description: "Battue au sanglier de la société de chasse d'Asco, secteur Pinara.", status: "expired" },
  { id: "r_068", user: "u_c7", subtype: "fallen_tree", lat: 42.2996, lng: 9.128, agoMin: 3 * D, danger: "low", description: "Arbre tombé sur la piste du Tavignano, dégagé par les services de la commune.", status: "resolved", votes: [{ user: "u_mairie_corte", kind: "gone", agoMin: 1 * D }, { user: "u_c1", kind: "gone", agoMin: 20 * H }] },
  { id: "r_069", user: "u_c5", subtype: "other_danger", lat: 42.5051, lng: 8.8629, agoMin: 2 * D, danger: "moderate", description: "Nids de frelons asiatiques signalés dans un arbre creux au départ du GR20, à 50 m du panneau." , votes: [{ user: "u_c1", kind: "still_present", agoMin: 1 * D }] },
  { id: "r_070", user: "u_rando", subtype: "signage_issue", lat: 41.7402, lng: 9.3301, agoMin: 9 * D, description: "Panneau d'arrivée du GR20 à Conca cassé, balisage du dernier kilomètre peu visible." },
  { id: "r_071", user: "u_c8", subtype: "shelter", lat: 42.3672, lng: 8.9186, agoMin: 12 * D, description: "Bergeries de Ballone : abri sommaire, tentes possibles, pas de gardien.", votes: [{ user: "u_c3", kind: "still_present", agoMin: 5 * D }] },
  { id: "r_072", user: "u_c3", subtype: "poor_condition", lat: 42.2381, lng: 9.0289, agoMin: 3 * D, description: "Sentier Petra Piana → Melo très érodé, marches instables." , votes: [{ user: "u_rando", kind: "still_present", agoMin: 2 * D }, { user: "u_c2", kind: "still_present", agoMin: 1 * D }] },
];

// ---------------------------------------------------------------------------
// Alertes officielles
// ---------------------------------------------------------------------------

const ALERTS: {
  id: string;
  organisation: string;
  title: string;
  body: string;
  category: ReportCategory;
  severity: DangerLevel;
  geometry: GeoJsonGeometry;
  startsAgoMin: number;
  endsInMin: number | null;
  url?: string;
  createdBy: string | null;
}[] = [
  {
    id: "oa_incendie_bavella",
    organisation: "Préfecture de la Corse-du-Sud",
    title: "Risque incendie très sévère — massif de Bavella",
    body: "Arrêté préfectoral : accès réglementé au massif forestier de Bavella et de l'Ospedale de 11 h à 18 h. Feux, barbecues et travaux à risque interdits. Respectez les consignes des patrouilles.",
    category: "danger",
    severity: "critical",
    geometry: { type: "Polygon", coordinates: [[[9.17, 41.76], [9.27, 41.76], [9.27, 41.83], [9.17, 41.83], [9.17, 41.76]]] },
    startsAgoMin: 1 * D,
    endsInMin: 5 * D,
    url: "https://www.corse-du-sud.gouv.fr",
    createdBy: "u_admin",
  },
  {
    id: "oa_restonica_fermeture",
    organisation: "Mairie de Corte",
    title: "Fermeture temporaire du sentier des gorges de la Restonica",
    body: "Secteur Tuani – pont de Frasseta fermé aux piétons à la suite de chutes de pierres. Réouverture après expertise. Accès aux lacs uniquement depuis les bergeries de Grotelle.",
    category: "path",
    severity: "high",
    geometry: { type: "Polygon", coordinates: [[[9.1, 42.268], [9.12, 42.268], [9.12, 42.284], [9.1, 42.284], [9.1, 42.268]]] },
    startsAgoMin: 2 * D,
    endsInMin: 6 * D,
    createdBy: "u_mairie_corte",
  },
  {
    id: "oa_battue_zonza",
    organisation: "Société de chasse de Zonza",
    title: "Battue au sanglier déclarée — forêt de l'Ospedale",
    body: "Battue déclarée aujourd'hui de 7 h à 13 h sur les parcelles entre la route de Bavella et le lac de l'Ospedale. Panneaux « Chasse en cours » posés sur les accès. Restez sur les sentiers balisés.",
    category: "activity",
    severity: "moderate",
    geometry: { type: "Polygon", coordinates: [[[9.16, 41.75], [9.22, 41.75], [9.22, 41.79], [9.16, 41.79], [9.16, 41.75]]] },
    startsAgoMin: 3 * H,
    endsInMin: 4 * H,
    createdBy: "u_admin",
  },
  {
    id: "oa_pastoral_asco",
    organisation: "Parc naturel régional de Corse",
    title: "Restriction pastorale — vallée d'Asco",
    body: "Estive en cours : chiens de protection présents sur les pelouses entre Haut-Asco et les bergeries de Cabane. Chiens tenus en laisse obligatoirement, contournement large des troupeaux, piste des bergeries fermée aux véhicules.",
    category: "animals",
    severity: "moderate",
    geometry: { type: "Polygon", coordinates: [[[8.9, 42.4], [8.98, 42.4], [8.98, 42.45], [8.9, 42.45], [8.9, 42.4]]] },
    startsAgoMin: 20 * D,
    endsInMin: 60 * D,
    createdBy: "u_admin",
  },
];

// ---------------------------------------------------------------------------
// Photos de démonstration
// ---------------------------------------------------------------------------

const PHOTO_SPECS: Record<string, { skyTop: Rgb; skyBottom: Rgb; ridgeFar: Rgb; ridgeNear: Rgb; band: Rgb; seed: number }> = {
  "arbre-tombe-restonica": { skyTop: [173, 199, 222], skyBottom: [232, 236, 226], ridgeFar: [110, 128, 112], ridgeNear: [58, 84, 60], band: [217, 130, 43], seed: 1.3 },
  "eboulement-bavella": { skyTop: [210, 190, 170], skyBottom: [244, 232, 214], ridgeFar: [156, 120, 98], ridgeNear: [112, 80, 66], band: [200, 52, 31], seed: 2.7 },
  "troupeau-asco": { skyTop: [150, 190, 230], skyBottom: [222, 232, 240], ridgeFar: [120, 140, 118], ridgeNear: [82, 110, 76], band: [107, 79, 42], seed: 4.1 },
};

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

function wipe(): void {
  const tables = [
    presencePings,
    moderationReports,
    userReputationEvents,
    notifications,
    offlineZones,
    photos,
    reportComments,
    reportConfirmations,
    reports,
    officialAlerts,
    partners,
    userPreferences,
    users,
    trails,
    waterPoints,
    areas,
  ];
  for (const t of tables) db.delete(t).run();
}

/** Lieux, sentiers et points d'eau (données de référence, sans compte). */
export function seedReference(): { areas: number; trails: number; waterPoints: number } {
  const now = iso(NOW);
  for (const a of AREAS) {
    const bbox = a.halfKm
      ? { west: a.lng - a.halfKm / (111.32 * Math.cos((a.lat * Math.PI) / 180)), south: a.lat - a.halfKm / 111.32, east: a.lng + a.halfKm / (111.32 * Math.cos((a.lat * Math.PI) / 180)), north: a.lat + a.halfKm / 111.32 }
      : null;
    db.insert(areas)
      .values({ id: a.id, name: a.name, nameNormalized: normalizeText(a.name), type: a.type, lat: a.lat, lng: a.lng, bbox, elevation: a.elevation ?? null, description: a.description ?? null })
      .run();
  }
  for (const t of TRAILS) {
    const geometry: GeoJsonGeometry = { type: "LineString", coordinates: t.coords };
    const { bbox } = geometryExtent(geometry);
    db.insert(trails)
      .values({
        id: t.id,
        name: t.name,
        type: t.type,
        difficulty: t.difficulty,
        distanceKm: t.distanceKm,
        elevationGainM: t.elevationGainM,
        geometry,
        minLat: bbox.south,
        minLng: bbox.west,
        maxLat: bbox.north,
        maxLng: bbox.east,
        description: t.description,
        createdAt: now,
      })
      .run();
  }
  for (const w of WATER) {
    db.insert(waterPoints)
      .values({
        id: w.id,
        name: w.name,
        type: w.type,
        lat: w.lat,
        lng: w.lng,
        lastState: w.state ?? "unknown",
        lastStateAt: w.state && w.state !== "unknown" ? ago(w.stateAgoMin ?? 0) : null,
        elevation: w.elevation ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return { areas: AREAS.length, trails: TRAILS.length, waterPoints: WATER.length };
}

function insertUsers(): Map<string, UserRow> {
  const map = new Map<string, UserRow>();
  for (const u of USERS) {
    const passwordHash = hashPassword(DEMO_PASSWORD);
    const createdAt = ago(u.createdDaysAgo * D);
    const badges: BadgeId[] = [];
    const row: UserRow = {
      id: u.id,
      email: u.email,
      passwordHash,
      pseudo: u.pseudo,
      avatarUrl: null,
      practices: u.practices,
      region: u.region ?? null,
      role: u.role,
      reputationScore: 0,
      reliabilityLevel: 1,
      reportsCount: 0,
      confirmationsCount: 0,
      badges,
      consentGivenAt: createdAt,
      suspendedUntil: null,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    db.insert(users).values(row).run();
    const prefs = defaultPreferences();
    if (u.practices[0]) prefs.filters = DEFAULT_FILTERS_BY_PRACTICE[u.practices[0]];
    db.insert(userPreferences).values({ userId: u.id, data: prefs, updatedAt: createdAt }).run();
    if (u.partner) {
      db.insert(partners)
        .values({
          id: `p_${u.id}`,
          userId: u.id,
          organisation: u.partner.organisation,
          kind: u.partner.kind,
          description: u.partner.description,
          website: null,
          verifiedAt: createdAt,
          createdAt,
        })
        .run();
    }
    map.set(u.id, row);
  }
  return map;
}

function insertReports(usersById: Map<string, UserRow>): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const r of REPORTS) {
    const author = usersById.get(r.user);
    if (!author) throw new Error(`Utilisateur de seed inconnu : ${r.user}`);
    const def = SUBTYPE_BY_ID[r.subtype];
    const createdAt = new Date(NOW.getTime() - r.agoMin * 60_000);
    const endsAt = r.endsInMin != null ? inMin(r.endsInMin) : null;
    const startsAt = r.startsInMin != null ? inMin(r.startsInMin) : null;
    let expiresAt = computeExpiresAt(r.subtype, createdAt, r.ttlMin ?? null, endsAt);
    if (r.status === "expired" && expiresAt.getTime() > NOW.getTime()) expiresAt = new Date(NOW.getTime() - 30 * 60_000);
    const sensitive = isSensitiveSubtype(r.subtype);
    const display = sensitive ? blurLocation(r.lat, r.lng, r.id, config.blurRadiusM) : { lat: r.lat, lng: r.lng };
    const source = author.role === "official" ? "official" : author.role === "partner" ? "partner" : "community";
    const status: ReportStatus = r.status === "resolved" ? "resolved" : r.status === "expired" ? "expired" : "active";
    const row: ReportRow = {
      id: r.id,
      userId: author.id,
      category: def.category,
      subtype: r.subtype,
      lat: r.lat,
      lng: r.lng,
      displayLat: display.lat,
      displayLng: display.lng,
      blurred: sensitive,
      dangerLevel: r.danger ?? null,
      description: r.description,
      zone: r.zone ?? nearestZoneName(r.lat, r.lng),
      source,
      status,
      priority: def.priority,
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
      expiresAt: iso(expiresAt),
      startsAt,
      endsAt,
      confirmationsCount: 0,
      disputesCount: 0,
      resolvedVotesCount: 0,
      improvedVotesCount: 0,
      lastConfirmationAt: null,
      confidenceScore: 0,
      confidenceLabel: "low",
      resolvedAt: r.status === "resolved" ? ago(Math.max(5, Math.round(r.agoMin / 3))) : null,
      deletedAt: null,
      clientId: r.clientId ?? null,
    };
    db.insert(reports).values(row).run();
    addReputationEvent({ userId: author.id, type: "report_created", reportId: r.id });

    for (const v of r.votes ?? []) {
      const at = ago(v.agoMin);
      db.insert(reportConfirmations)
        .values({ id: `cf_${r.id}_${v.user}`, reportId: r.id, userId: v.user, kind: v.kind, comment: v.comment ?? null, createdAt: at, updatedAt: at })
        .run();
      addReputationEvent({ userId: v.user, type: "confirmation_given", reportId: r.id, actorId: v.user });
      if (v.kind === "still_present") addReputationEvent({ userId: author.id, type: "report_confirmed", reportId: r.id, actorId: v.user });
      if (v.kind === "disputed") addReputationEvent({ userId: author.id, type: "report_disputed", reportId: r.id, actorId: v.user });
    }
    for (const cm of r.comments ?? []) {
      db.insert(reportComments).values({ id: cm.id, reportId: r.id, userId: cm.user, body: cm.body, createdAt: ago(cm.agoMin), deletedAt: null }).run();
    }
    if (r.photo) {
      const spec = PHOTO_SPECS[r.photo];
      const written = writeDemoPng(config.uploadDir, r.photo, { width: 320, height: 200, ...spec });
      db.insert(photos)
        .values({
          id: `ph_${r.id}`,
          reportId: r.id,
          userId: author.id,
          url: written.url,
          storagePath: written.storagePath,
          mime: "image/png",
          sizeBytes: written.bytes,
          width: 320,
          height: 200,
          createdAt: iso(createdAt),
          deletedAt: null,
        })
        .run();
    }
    rows.push(row);
  }
  // Compteurs, confiance et statuts dérivés des votes réels, puis date de mise à jour réaliste
  // (dernier vote ou création) plutôt que l'instant du seed.
  for (const row of rows) {
    const updated = recomputeReport(row, NOW);
    const lastVote = db
      .select({ at: reportConfirmations.updatedAt })
      .from(reportConfirmations)
      .where(eq(reportConfirmations.reportId, row.id))
      .all()
      .map((v) => v.at)
      .sort()
      .at(-1);
    const updatedAt = [row.createdAt, lastVote ?? "", updated.resolvedAt ?? ""].sort().at(-1) || row.createdAt;
    db.update(reports).set({ updatedAt }).where(eq(reports.id, row.id)).run();
  }
  return rows;
}

function nearestZoneName(lat: number, lng: number): string | null {
  let best: { name: string; d: number } | null = null;
  for (const a of AREAS) {
    if (a.type !== "commune" && a.type !== "place" && a.type !== "massif") continue;
    const d = Math.hypot((a.lat - lat) * 111.32, (a.lng - lng) * 111.32 * Math.cos((lat * Math.PI) / 180));
    if (!best || d < best.d) best = { name: a.name, d };
  }
  return best && best.d <= 12 ? best.name : null;
}

function insertAlerts(): void {
  for (const a of ALERTS) {
    createOfficialAlert(
      {
        organisation: a.organisation,
        title: a.title,
        body: a.body,
        category: a.category,
        severity: a.severity,
        geometry: a.geometry as Extract<GeoJsonGeometry, { type: "Point" | "Polygon" }>,
        startsAt: ago(a.startsAgoMin),
        endsAt: a.endsInMin != null ? inMin(a.endsInMin) : null,
        url: a.url ?? null,
      },
      a.createdBy,
      a.id,
    );
  }
}

function insertNotifications(): void {
  const list: { id: string; user: string; type: NotificationType; title: string; body: string; reportId: string | null; agoMin: number; read?: boolean }[] = [
    { id: "n_001", user: "u_rando", type: "new_battue_nearby", title: "Battue signalée à proximité", body: "Attention : battue signalée à 1,2 km (Zonza) jusqu'à 13 h.", reportId: "r_028", agoMin: 110 },
    { id: "n_002", user: "u_rando", type: "report_confirmed", title: "Signalement confirmé", body: "Lisandru confirme votre signalement « Source sèche » (Corte). 2 confirmations au total.", reportId: "r_003", agoMin: 2 * H, read: true },
    { id: "n_003", user: "u_rando", type: "official_alert", title: "Alerte officielle : Risque incendie très sévère — massif de Bavella", body: "Préfecture de la Corse-du-Sud — accès réglementé de 11 h à 18 h.", reportId: null, agoMin: 1 * D, read: true },
    { id: "n_004", user: "u_rando", type: "new_danger_on_route", title: "Éboulement signalé à proximité", body: "Éboulement signalé à 600 m (Bavella). Redoublez de prudence.", reportId: "r_029", agoMin: 2 * D, read: true },
    { id: "n_005", user: "u_c1", type: "report_confirmed", title: "Signalement confirmé", body: "Paulu Pêcheur confirme votre signalement « Arbre tombé » (Corte). 3 confirmations au total.", reportId: "r_001", agoMin: 12 },
    { id: "n_006", user: "u_c2", type: "report_resolved", title: "Signalement probablement résolu", body: "Plusieurs utilisateurs indiquent que « Obstacle » (Vizzavona) n'est plus présent.", reportId: "r_027", agoMin: 4 * H, read: true },
    { id: "n_007", user: "u_c8", type: "report_updated", title: "Signalement contesté", body: "Deux utilisateurs contestent votre signalement « Animal agressif » (Bastelica). Vous pouvez le compléter ou le clôturer.", reportId: "r_056", agoMin: 55 },
    { id: "n_008", user: "u_guide_bavella", type: "trail_closed", title: "Fermeture signalée à proximité", body: "Chemin fermé à 1,8 km (Corte).", reportId: "r_004", agoMin: 2 * D, read: true },
    { id: "n_009", user: "u_moderateur", type: "system", title: "Nouveaux signalements de contenu", body: "2 signalements de contenu attendent votre examen dans le back-office.", reportId: null, agoMin: 30 },
  ];
  for (const n of list) {
    db.insert(notifications)
      .values({ id: n.id, userId: n.user, type: n.type, title: n.title, body: n.body, reportId: n.reportId, readAt: n.read ? ago(Math.max(1, n.agoMin - 10)) : null, createdAt: ago(n.agoMin) })
      .run();
  }
}

function insertFlags(): void {
  const list: { id: string; reporter: string; reportId: string; commentId?: string; reason: FlagReason; details: string; agoMin: number }[] = [
    { id: "f_001", reporter: "u_c3", reportId: "r_056", reason: "false_info", details: "Passé sur place deux fois, aucun chien errant. Le signalement fait peur inutilement.", agoMin: 50 },
    { id: "f_002", reporter: "u_c5", reportId: "r_015", commentId: "c_003", reason: "spam", details: "Commentaire dupliqué plusieurs fois sur d'autres signalements.", agoMin: 35 },
  ];
  for (const f of list) {
    db.insert(moderationReports)
      .values({
        id: f.id,
        reporterId: f.reporter,
        reportId: f.reportId,
        commentId: f.commentId ?? null,
        photoId: null,
        reason: f.reason,
        details: f.details,
        status: "open",
        resolvedBy: null,
        resolutionNote: null,
        createdAt: ago(f.agoMin),
        resolvedAt: null,
      })
      .run();
  }
}

function insertPresence(): void {
  // Quelques cellules actives (agrégats anonymes) : Restonica, Bavella, Vizzavona, Haut-Asco.
  const cells: { lat: number; lng: number; count: number }[] = [
    { lat: 42.22, lng: 9.03, count: 14 },
    { lat: 42.23, lng: 9.05, count: 6 },
    { lat: 41.8, lng: 9.22, count: 9 },
    { lat: 41.8, lng: 9.24, count: 4 },
    { lat: 42.13, lng: 9.12, count: 5 },
    { lat: 42.41, lng: 8.92, count: 3 },
    { lat: 42.26, lng: 8.94, count: 2 },
  ];
  const bucketMs = config.presenceBucketMin * 60_000;
  const bucket = new Date(Math.floor(NOW.getTime() / bucketMs) * bucketMs).toISOString();
  for (const c of cells) {
    db.insert(presencePings).values({ cell: `${c.lat.toFixed(2)}:${c.lng.toFixed(2)}`, bucketStart: bucket, count: c.count }).run();
  }
}

/** Comptes, signalements, votes, commentaires, photos, alertes, notifications, flags. */
export function seedDemo(): { users: number; reports: number; alerts: number } {
  const usersById = insertUsers();
  insertAlerts();
  insertReports(usersById);
  insertNotifications();
  insertFlags();
  insertPresence();
  for (const id of usersById.keys()) recomputeUserStanding(id, NOW);
  return { users: USERS.length, reports: REPORTS.length, alerts: ALERTS.length };
}

/** Réinitialise toutes les données et rejoue le jeu de démonstration complet. */
export function seedAll(): { areas: number; trails: number; waterPoints: number; users: number; reports: number; alerts: number } {
  runMigrations(sqlite);
  return db.transaction(() => {
    wipe();
    const ref = seedReference();
    const demo = seedDemo();
    return { ...ref, ...demo };
  });
}

const DEMO_LABELS: Record<string, string> = {
  admin: "Administrateur",
  moderateur: "Modérateur",
  "mairie-corte": "Compte officiel (commune)",
  "berger-asco": "Partenaire (berger)",
  "guide-bavella": "Partenaire (guide)",
  rando: "Utilisateur",
};

/** Comptes de démonstration (pour le README et les tests). */
export const DEMO_ACCOUNTS = USERS.filter((u) => u.email.split("@")[0] in DEMO_LABELS).map((u) => ({
  email: u.email,
  role: u.role,
  pseudo: u.pseudo,
  label: DEMO_LABELS[u.email.split("@")[0]],
}));

export function demoUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, email)).get();
}

// Petit auto-test de l'encodeur PNG (signature) pour détecter une régression au seed.
if (!encodeDemoPng({ width: 4, height: 4, skyTop: [0, 0, 0], skyBottom: [0, 0, 0], ridgeFar: [0, 0, 0], ridgeNear: [0, 0, 0], band: [0, 0, 0], seed: 1 }).subarray(1, 4).equals(Buffer.from("PNG"))) {
  throw new Error("Encodeur PNG de démonstration invalide");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = seedAll();
  console.log(
    `[seed] Corse : ${result.areas} lieux, ${result.trails} sentiers, ${result.waterPoints} points d'eau, ${result.users} comptes, ${result.reports} signalements, ${result.alerts} alertes officielles.`,
  );
  console.log(`[seed] Comptes de démo (mot de passe « ${DEMO_PASSWORD} ») :`);
  for (const a of DEMO_ACCOUNTS) console.log(`  - ${a.email.padEnd(34)} ${a.label}`);
  sqlite.close();
}
