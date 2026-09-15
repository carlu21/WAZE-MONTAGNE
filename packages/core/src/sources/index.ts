/**
 * Collecte des traces GPX existantes : contrat partagé et modules d'analyse.
 *
 * Chaîne : découverte → vérification des droits → ingestion → normalisation
 * → qualité → comparaison entre sources → rattachement au réseau → connaissance
 * du segment.
 */
export * from "./types";
export * from "./dto";
export * from "./licence";
export * from "./discovery";
export * from "./ingest";
export * from "./trace-quality";
export * from "./compare";
export * from "./knowledge";
