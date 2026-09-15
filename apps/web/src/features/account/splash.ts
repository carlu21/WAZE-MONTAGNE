/**
 * Décision de redirection au démarrage (logique pure, testée).
 *
 * L'application s'ouvre DIRECTEMENT sur la carte (section 1 du cahier des
 * charges « Waze de la montagne ») : ni tableau de bord, ni liste de
 * randonnées avant elle. Seul un premier lancement passe par la présentation.
 */
export function splashTarget(input: { onboardingDone: boolean; hasToken: boolean }): "/home" | "/onboarding" {
  if (input.onboardingDone || input.hasToken) return "/home";
  return "/onboarding";
}
