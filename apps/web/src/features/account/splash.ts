/** Décision de redirection au démarrage (logique pure, testée). */
export function splashTarget(input: { onboardingDone: boolean; hasToken: boolean }): "/map" | "/onboarding" {
  if (input.onboardingDone || input.hasToken) return "/map";
  return "/onboarding";
}
