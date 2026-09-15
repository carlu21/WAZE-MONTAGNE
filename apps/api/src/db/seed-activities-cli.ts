/**
 * Peuple le réseau vivant avec des activités simulées :
 *
 *   pnpm --filter @mountain-live/api db:seed-activities
 *
 * Les passages, statistiques et propositions du terrain deviennent visibles
 * immédiatement dans l'application (carte de fréquentation, fiche d'un chemin,
 * itinéraires, tableau de bord, back-office).
 */
import { ensureDatabase } from "./migrate";
import { clearSeededActivities, seedActivities } from "./seed-activities";

async function main(): Promise<void> {
  await ensureDatabase();
  const reset = process.argv.includes("--reset");
  if (reset) {
    const removed = clearSeededActivities();
    console.log(`[activités] ${removed} activités de démonstration supprimées.`);
  }
  const started = Date.now();
  const result = seedActivities();
  console.log(
    `[activités] ${result.activities} sorties simulées par ${result.contributors} contributeurs : ` +
      `${result.traversals} passages, ${result.statistics} statistiques, ${result.candidates} propositions (${Math.round((Date.now() - started) / 1000)} s).`,
  );
}

main().catch((err) => {
  console.error(`[activités] Échec : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
