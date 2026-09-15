/**
 * Conteneur des portails (modales, feuilles, toasts, navigation plein écran).
 * Dans le cadre de téléphone affiché sur grand écran, les éléments « fixed »
 * doivent rester à l'intérieur de l'écran simulé : le cadre fournit un
 * conteneur dédié (#ml-portal) qui sert alors de racine aux portails.
 */
export const PORTAL_ROOT_ID = "ml-portal";

export function portalRoot(): HTMLElement {
  if (typeof document === "undefined") throw new Error("portalRoot() hors navigateur");
  return document.getElementById(PORTAL_ROOT_ID) ?? document.body;
}
