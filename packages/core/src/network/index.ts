/**
 * Moteur cartographique collectif : contrat partagé et modules d'analyse.
 *
 * Chaîne : qualité des points → passages → statistiques → temps → routage,
 * avec l'apprentissage (géométrie, chemins potentiels, comportements) et les
 * garde-fous de vie privée.
 */
export * from "./types";
export * from "./dto";
export * from "./quality";
export * from "./traversals";
export * from "./statistics";
export * from "./timing";
export * from "./routing";
export * from "./learning-geometry";
export * from "./learning-behaviour";
export * from "./privacy";

// `SPREAD_REFERENCE` (dispersion des durées, même valeur et même sens) est défini
// dans les deux modules : on tranche ici pour lever l'ambiguïté d'export.
export { SPREAD_REFERENCE } from "./statistics";
