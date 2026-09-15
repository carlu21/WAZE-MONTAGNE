/**
 * ÉTAT DU RÉSEAU CARTOGRAPHIQUE — `pnpm --filter @mountain-live/api network:doctor`
 *
 * Répond en quelques secondes à la seule question qui compte avant de tester
 * quoi que ce soit : cette base contient-elle des chemins réels, ou la
 * démonstration ? Et si elle contient du réel, la chaîne tient-elle de bout en
 * bout — provenance écrite, randonnées reliées à leurs segments, graphe de
 * routage constructible ?
 *
 * La commande ne modifie rien. Elle sort en code 1 si le réseau réel n'est pas
 * disponible, pour pouvoir servir de garde dans un script.
 */
import { sql } from "drizzle-orm";
import { buildRoutingGraph, segmentProfile, type BBox, type RoutingSegmentInput } from "@mountain-live/core";
import { ensureDatabase } from "./migrate";
import { db } from "./client";
import { paths, trailSegments, trails } from "./schema";
import { networkStats } from "../services/reference";
import { segmentsInBBox } from "../services/network-graph";

/** Emprise sur laquelle le graphe de routage est éprouvé : celle des données présentes. */
function dataExtent(): BBox | null {
  const row = db
    .select({
      west: sql<number>`min(${paths.minLng})`,
      south: sql<number>`min(${paths.minLat})`,
      east: sql<number>`max(${paths.maxLng})`,
      north: sql<number>`max(${paths.maxLat})`,
    })
    .from(paths)
    .get();
  if (!row || row.west === null || !Number.isFinite(row.west)) return null;
  return { west: row.west, south: row.south, east: row.east, north: row.north };
}

function line(label: string, value: string | number, ok: boolean | null = null): void {
  const mark = ok === null ? " " : ok ? "✓" : "✗";
  console.log(`  ${mark} ${label.padEnd(34, " ")} ${value}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function main(): Promise<void> {
  await ensureDatabase();

  section("BASE DE DONNÉES");
  const pathTotal = db.select({ n: sql<number>`count(*)` }).from(paths).get()?.n ?? 0;
  line("accessible", "oui", true);

  const stats = networkStats();

  section("CHEMINS (paths)");
  line("total", stats.paths.total);
  line("OpenStreetMap", stats.paths.osm, stats.paths.osm > 0);
  line("IGN", stats.paths.ign);
  line("GPX", stats.paths.gpx);
  line("démonstration", stats.paths.seed);
  line("provenance manquante", stats.paths.unknown, stats.paths.unknown === 0);
  const withFeature = db.select({ n: sql<number>`count(*)` }).from(paths).where(sql`${paths.sourceFeatureId} IS NOT NULL`).get()?.n ?? 0;
  line("objet source connu (way/…)", `${withFeature} / ${pathTotal}`);

  section("RANDONNÉES (trails)");
  line("total", stats.trails.total);
  line("OpenStreetMap", stats.trails.osm, stats.trails.osm > 0);
  line("IGN", stats.trails.ign);
  line("GPX", stats.trails.gpx);
  line("démonstration", stats.trails.seed);
  line("provenance manquante", stats.trails.unknown, stats.trails.unknown === 0);

  section("ASSOCIATIONS RANDONNÉE ↔ SEGMENTS");
  line("lignes trail_segments", stats.links.trailSegments, stats.links.trailSegments > 0);
  line("randonnées reliées", stats.links.linkedTrails);
  line("randonnées relevées orphelines", stats.links.orphanTrails, stats.links.orphanTrails === 0);
  const sharedSegments =
    db
      .select({ n: sql<number>`count(*)` })
      .from(sql`(SELECT ${trailSegments.segmentId} AS sid FROM ${trailSegments} GROUP BY ${trailSegments.segmentId} HAVING count(distinct ${trailSegments.trailId}) > 1)`)
      .get()?.n ?? 0;
  line("segments partagés (≥ 2 randonnées)", sharedSegments);

  const coverage = db
    .select({ avg: sql<number>`avg(${trails.linkCoverage})`, low: sql<number>`sum(case when ${trails.linkCoverage} < 0.8 then 1 else 0 end)` })
    .from(trails)
    .where(sql`${trails.linkCoverage} IS NOT NULL`)
    .get();
  if (coverage?.avg !== null && coverage?.avg !== undefined) {
    line("couverture moyenne des membres", `${Math.round(coverage.avg * 100)} %`);
    line("randonnées sous 80 % de couverture", coverage.low ?? 0);
  }

  section("GRAPHE DE ROUTAGE");
  const extent = dataExtent();
  if (!extent) {
    line("constructible", "aucun chemin en base", false);
  } else {
    const segments = segmentsInBBox(extent, 50_000);
    const inputs: RoutingSegmentInput[] = segments.map((segment) => ({
      segment,
      profile: segmentProfile(segment, "forward"),
      statsForward: null,
      statsBackward: null,
    }));
    const graph = buildRoutingGraph(inputs);
    line("segments chargés", segments.length);
    line("nœuds", graph.nodes.size, graph.nodes.size > 0);
    line("arêtes", graph.edges.length, graph.edges.length > 0);
    // Un nœud n'ayant qu'une seule arête est une extrémité de chemin : normal en
    // montagne, un sentier finit à un sommet. Une proportion élevée signale en
    // revanche un réseau non connecté, donc non routable.
    let terminal = 0;
    for (const list of graph.adjacency.values()) if (list.length <= 1) terminal++;
    line("nœuds terminaux", `${terminal} (${Math.round((terminal / Math.max(1, graph.nodes.size)) * 100)} %)`);
  }

  section("VERDICT");
  line("réseau réel disponible", stats.realDataReady ? "OUI" : "NON", stats.realDataReady);
  if (!stats.realDataReady) {
    console.log(`
  L'application travaille sur des données de démonstration.
  Importez un territoire réel, en commençant petit :

    pnpm --filter @mountain-live/api geo:import-osm -- --preset bastelica
`);
  }
  console.log("\n  Données © les contributeurs OpenStreetMap, licence ODbL.\n");
  process.exit(stats.realDataReady ? 0 : 1);
}

main().catch((err) => {
  console.error(`[doctor] Échec : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
