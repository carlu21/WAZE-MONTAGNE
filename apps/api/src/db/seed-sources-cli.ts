/**
 * `pnpm --filter @mountain-live/api db:seed-sources`
 *
 * Pose les territoires pilotes et les pistes de sources à vérifier. Ne
 * télécharge rien, ne fabrique aucune trace : le registre sert de plan de
 * travail pour la vérification des droits.
 */
import { pathToFileURL } from "node:url";
import { runMigrations } from "./migrate";
import { seedSources } from "./seed-sources";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { sqlite } = await import("./client");
  runMigrations(sqlite);
  const result = seedSources();
  console.log(`[sources] ${result.territories} territoires, ${result.sources} pistes de sources enregistrées.`);
  console.log(`[sources] ${result.note}`);
  sqlite.close();
}
