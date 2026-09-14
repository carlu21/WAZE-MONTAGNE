/**
 * Hôte du moteur de navigation : monté une fois dans l'application, il fait
 * tourner le suivi tant qu'une activité est en cours, quel que soit l'écran.
 */
import { useNavigationEngine } from "./useNavigationEngine";

export function NavigationEngineHost() {
  useNavigationEngine();
  return null;
}
