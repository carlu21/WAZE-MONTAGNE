/**
 * Calcul d'un itinéraire piéton SUR LE RÉSEAU RÉEL.
 *
 * Règle absolue : on ne relie jamais deux positions par une ligne droite pour
 * représenter un itinéraire. Le calcul passe par le moteur de routage du
 * serveur (`POST /network/routes` : graphe de nœuds et d'arêtes, A* sur les
 * chemins réellement cartographiés). S'il ne trouve rien, ou si les segments
 * empruntés ne viennent pas de données relevées, on ne dessine RIEN et on le
 * dit — « Aucun itinéraire pédestre fiable disponible entre ces deux points. »
 *
 * Une absence de réponse vaut mieux qu'un faux itinéraire.
 */
import {
  buildRoute,
  fr,
  isSurveyed,
  routeVerdict,
  type ActivityMode,
  type LatLng,
  type NavRoute,
  type PathSource,
  type RouteOption,
  type RoutePlanResponse,
  type RouteRefusal,
} from "@mountain-live/core";
import { api } from "@/lib/api";

export interface PlanRequest {
  from: LatLng;
  to: LatLng;
  activity: ActivityMode;
  /** Nom affiché de la destination (« Lac de Melo »). */
  name: string;
}

export type PlanResult =
  | { status: "ok"; route: NavRoute; option: RouteOption }
  | { status: "refused"; refusal: RouteRefusal; message: string; note: string | null };

/**
 * Provenance retenue pour un itinéraire : la MOINS fiable de ses segments.
 * Un parcours n'est relevé que si tous ses maillons le sont — un seul tronçon
 * de démonstration suffit à rendre l'ensemble faux.
 */
export function planSource(sources: readonly PathSource[]): PathSource | null {
  if (sources.length === 0) return null;
  return sources.find((s) => !isSurveyed(s)) ?? sources[0];
}

/** Phrase affichée pour chaque refus. On nomme ce qui manque, on n'invente rien. */
export function refusalMessage(refusal: RouteRefusal): string {
  const t = fr.navigation.unavailable;
  switch (refusal) {
    case "no_network":
      return t.noNetwork;
    case "unreachable":
      return t.unreachable;
    case "not_surveyed":
      return t.notSurveyed;
    case "schematic_geometry":
      return t.schematicGeometry;
    default:
      return t.noGeometry;
  }
}

/**
 * Traduit la réponse du serveur en décision d'affichage. Fonction pure : c'est
 * ici que se joue le refus, et c'est donc ici qu'il se teste.
 */
export function interpretPlan(response: RoutePlanResponse, request: PlanRequest): PlanResult {
  const option = response.options[0] ?? null;
  if (option === null) {
    const refusal: RouteRefusal = response.unreachable ? "unreachable" : "no_network";
    return { status: "refused", refusal, message: fr.navigation.unavailable.noRoute, note: response.note ?? refusalMessage(refusal) };
  }
  const verdict = routeVerdict({ coordinates: option.coordinates, source: planSource(option.sources) });
  if (!verdict.drawable) {
    const refusal = verdict.refusal ?? "no_geometry";
    return { status: "refused", refusal, message: fr.navigation.unavailable.noRoute, note: refusalMessage(refusal) };
  }
  return {
    status: "ok",
    option,
    route: buildRoute({
      id: `plan_${option.criterion}_${request.to.lat.toFixed(5)}_${request.to.lng.toFixed(5)}`,
      name: request.name,
      coordinates: option.coordinates,
      elevationGainM: option.elevationGainM,
      source: "trail",
    }),
  };
}

/** Demande un itinéraire au moteur de routage. Une panne réseau est un refus, pas une ligne droite. */
export async function planOnRealNetwork(request: PlanRequest): Promise<PlanResult> {
  try {
    const response = await api.network.routes({ from: request.from, to: request.to, activity: request.activity });
    return interpretPlan(response, request);
  } catch {
    return { status: "refused", refusal: "no_network", message: fr.navigation.unavailable.noRoute, note: fr.errors.offline };
  }
}
