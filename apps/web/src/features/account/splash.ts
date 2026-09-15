/** Décision de redirection au démarrage (logique pure, testée). */
export function splashTarget(input: { onboardingDone: boolean; hasToken: boolean }): "/navigate" | "/onboarding" {
  if (input.onboardingDone || input.hasToken) return "/navigate";
  return "/onboarding";
}
