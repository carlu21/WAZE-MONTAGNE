import { describe, expect, it } from "vitest";
import type {
  CampaignResponse,
  DataSourceDto,
  ImportTraceResponse,
  ImportedTraceDto,
  PathSegment,
  SegmentSourcesResponse,
  SourcesResponse,
  TerritoriesResponse,
  TerritoryPlanResponse,
  TraceDetail,
  TracesResponse,
} from "@mountain-live/core";
import { call, registerUser, setup, type TestApp } from "./helpers";

/**
 * Collecte des traces existantes : registre des sources, droits, bibliothèque,
 * rattachement au réseau, provenance.
 *
 * Le fil conducteur est la section 3 : **rien n'entre dans la base sans droits
 * vérifiés**. Chaque test qui approuve quelque chose vérifie d'abord qu'on ne
 * peut PAS l'approuver sans licence identifiée.
 */
const { app, seedReference } = await setup();
seedReference();
const { seedSources } = await import("../src/db/seed-sources");
seedSources();

const RESTONICA_BBOX = "9.0,42.2,9.06,42.24";

async function restonica(): Promise<PathSegment[]> {
  const res = await call<{ paths: PathSegment[] }>(app, "GET", `/paths?bbox=${RESTONICA_BBOX}`);
  return res.body.paths.filter((p) => p.id.startsWith("d_t_restonica_melo")).sort((a, b) => a.id.localeCompare(b.id));
}

/** GPX construit sur une géométrie réelle du réseau de démonstration. */
function gpxFor(segments: readonly PathSegment[], opts: { name?: string; ele?: boolean; time?: boolean; offsetM?: number } = {}): string {
  const start = Date.parse("2024-06-12T07:30:00.000Z");
  const offset = opts.offsetM ?? 0;
  const points: string[] = [];
  let i = 0;
  for (const segment of segments) {
    for (const [lng, lat] of segment.coordinates) {
      const dLat = offset / 111_320;
      const parts = [`<trkpt lat="${(lat + dLat).toFixed(6)}" lon="${lng.toFixed(6)}">`];
      if (opts.ele !== false) parts.push(`<ele>${(1100 + i * 0.8).toFixed(1)}</ele>`);
      if (opts.time !== false) parts.push(`<time>${new Date(start + i * 9000).toISOString()}</time>`);
      parts.push("</trkpt>");
      points.push(parts.join(""));
      i += 1;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TestSuite" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${opts.name ?? "Montée au lac de Melo"}</name><copyright author="Club de test"/></metadata>
  <trk><name>${opts.name ?? "Montée au lac de Melo"}</name><trkseg>${points.join("")}</trkseg></trk>
</gpx>`;
}

async function moderator(): Promise<string> {
  return (await registerUser(app, { role: "moderator" })).token;
}

describe("Registre des sources", () => {
  it("crée toute source « à vérifier », sans droits dérivés", async () => {
    const token = await moderator();
    const res = await call<{ source: DataSourceDto }>(app, "POST", "/admin/collect/sources", {
      token,
      body: { name: "Office de tourisme de démonstration", url: "https://example.org/sentiers", type: "institutional" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const source = res.body.source;
    expect(source.status).toBe("review_required");
    expect(source.licence).toBe("unknown");
    expect(source.lastCheckedAt).toBeNull();
    expect(source.autoImport).toBe(false);
    expect(source.decision.status).not.toBe("approved");
    // Une source jamais vérifiée ne peut pas se prétendre fiable.
    expect(source.reliabilityScore).toBeLessThanOrEqual(40);
  });

  it("refuse d'approuver une source dont la licence n'est pas identifiée", async () => {
    const token = await moderator();
    const created = await call<{ source: DataSourceDto }>(app, "POST", "/admin/collect/sources", {
      token,
      body: { name: "Plateforme de démonstration", url: "https://example.org/plateforme", type: "platform" },
    });
    const res = await call<{ error: { code: string } }>(app, "PATCH", `/admin/collect/sources/${created.body.source.id}`, {
      token,
      body: { status: "approved" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("licence_unknown");
  });

  it("dérive les droits de la licence constatée, jamais d'une saisie libre", async () => {
    const token = await moderator();
    const created = await call<{ source: DataSourceDto }>(app, "POST", "/admin/collect/sources", {
      token,
      body: { name: "Données ouvertes de démonstration", url: "https://example.org/opendata", type: "open_data" },
    });
    const approved = await call<{ source: DataSourceDto; attribution: string | null }>(
      app,
      "PATCH",
      `/admin/collect/sources/${created.body.source.id}`,
      { token, body: { status: "approved", licence: "etalab-2.0", reliabilityScore: 80 } },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.source.commercialReuseAllowed).toBe(true);
    expect(approved.body.source.attributionRequired).toBe(true);
    expect(approved.body.source.lastCheckedAt).not.toBeNull();
    expect(approved.body.source.autoImport).toBe(true);
    expect(approved.body.attribution).toBeTruthy();

    // Une licence non commerciale ferme la porte, quel que soit le statut demandé.
    const nc = await call<{ source: DataSourceDto }>(app, "PATCH", `/admin/collect/sources/${created.body.source.id}`, {
      token,
      body: { status: "approved", licence: "cc-by-nc" },
    });
    expect(nc.body.source.commercialReuseAllowed).toBe(false);
    expect(nc.body.source.decision.status).not.toBe("approved");
    expect(nc.body.source.autoImport).toBe(false);
  });

  it("amorce le registre sans jamais déclarer une licence vérifiée", async () => {
    const token = await moderator();
    const res = await call<SourcesResponse>(app, "GET", "/admin/collect/sources?limit=200", { token });
    expect(res.status).toBe(200);
    const seeded = res.body.sources.filter((s) => s.notes?.includes("À VÉRIFIER"));
    expect(seeded.length).toBeGreaterThan(0);
    for (const source of seeded) {
      expect(source.licence).toBe("unknown");
      expect(source.status).toBe("review_required");
      expect(source.lastCheckedAt).toBeNull();
      expect(source.autoImport).toBe(false);
    }
  });

  it("réserve le registre aux modérateurs", async () => {
    const user = await registerUser(app);
    expect((await call(app, "GET", "/admin/collect/sources", { token: user.token })).status).toBe(403);
    expect((await call(app, "GET", "/admin/collect/sources")).status).toBe(401);
    expect((await call(app, "GET", "/admin/traces", { token: user.token })).status).toBe(403);
  });
});

describe("Importation d'une trace", () => {
  it("analyse un GPX, le rattache au réseau et le met en revue", async () => {
    const token = await moderator();
    const segments = await restonica();
    const res = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", {
      token,
      body: { content: gpxFor(segments.slice(0, 3)), fileName: "melo.gpx", territory: "fr-corse-corte", declaredOrigin: "Relevé personnel", declaredRights: true },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { trace, summary } = res.body;
    expect(trace.format).toBe("gpx");
    expect(trace.name).toBe("Montée au lac de Melo");
    expect(summary.points).toBeGreaterThan(50);
    expect(summary.distanceM).toBeGreaterThan(300);
    // L'itinéraire devient une suite de segments (section 6).
    expect(summary.matchedSegments).toBeGreaterThan(0);
    expect(summary.matchedRatio).toBeGreaterThan(0.5);
    expect(trace.qualityScore ?? 0).toBeGreaterThan(0);
    // Sans source enregistrée, la déclaration de droits ne vaut pas vérification.
    expect(trace.status).toBe("review_required");
    expect(res.body.decision.status).not.toBe("approved");
  });

  it("conserve le fichier d'origine tel quel", async () => {
    const token = await moderator();
    const segments = await restonica();
    const content = gpxFor(segments.slice(0, 2), { name: "Trace d'origine" });
    const imported = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", {
      token,
      body: { content, fileName: "origine.gpx" },
    });
    const original = await call<string>(app, "GET", `/admin/traces/${imported.body.trace.id}/original`, { token });
    expect(original.status).toBe(200);
    expect(String(original.body)).toBe(content);
  });

  it("repère qu'une même géométrie a déjà été importée", async () => {
    const token = await moderator();
    const segments = await restonica();
    const content = gpxFor(segments.slice(1, 3), { name: "Doublon" });
    const first = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", { token, body: { content, fileName: "a.gpx" } });
    const second = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", { token, body: { content, fileName: "b.gpx" } });
    expect(first.body.duplicateOf).toBeNull();
    expect(second.body.duplicateOf).toBe(first.body.trace.id);
    expect(second.body.note).toMatch(/déjà présente/i);
    expect(second.body.trace.status).toBe("review_required");
  });

  it("refuse un fichier illisible et un format inconnu", async () => {
    const token = await moderator();
    const res = await call<{ error: { code: string } }>(app, "POST", "/admin/traces/upload", {
      token,
      body: { content: "ceci n'est ni du GPX ni du KML ni du GeoJSON, juste du texte assez long pour passer la validation" },
    });
    expect(res.status).toBe(400);
    expect(["bad_file", "empty_trace"]).toContain(res.body.error.code);
  });

  it("accepte aussi KML et GeoJSON", async () => {
    const token = await moderator();
    const segments = await restonica();
    const line = segments[0].coordinates.slice(0, 40);

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Trace KML</name>
<LineString><coordinates>${line.map(([lng, lat]) => `${lng},${lat},1200`).join(" ")}</coordinates></LineString>
</Placemark></Document></kml>`;
    const kmlRes = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", { token, body: { content: kml, fileName: "trace.kml" } });
    expect(kmlRes.status, JSON.stringify(kmlRes.body)).toBe(201);
    expect(kmlRes.body.trace.format).toBe("kml");
    // Piège classique : KML est en lng,lat — une inversion placerait la trace en mer.
    expect(kmlRes.body.summary.bbox.south).toBeGreaterThan(41);
    expect(kmlRes.body.summary.bbox.south).toBeLessThan(43);

    const geojson = JSON.stringify({
      type: "Feature",
      properties: { name: "Trace GeoJSON" },
      geometry: { type: "LineString", coordinates: line },
    });
    const geoRes = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", { token, body: { content: geojson, fileName: "trace.geojson" } });
    expect(geoRes.status, JSON.stringify(geoRes.body)).toBe(201);
    expect(geoRes.body.trace.format).toBe("geojson");
  });

  it("dit clairement qu'aucun accès réseau n'est disponible plutôt que d'échouer en silence", async () => {
    const token = await moderator();
    const res = await call<{ error: { code: string; message: string } }>(app, "POST", "/admin/traces/import-url", {
      token,
      body: { url: "https://example.invalid/parcours.gpx" },
    });
    // Selon l'environnement : robots.txt invérifiable, ou accès sortant refusé.
    expect([403, 503, 400]).toContain(res.status);
    expect(res.body.error.message).toMatch(/robots|réseau|sortant|Téléchargement/i);
  });

  it("refuse une adresse interne (le serveur ne visite pas son propre réseau)", async () => {
    const token = await moderator();
    for (const url of ["http://localhost/x.gpx", "http://127.0.0.1/x.gpx", "http://192.168.1.10/x.gpx", "ftp://example.org/x.gpx"]) {
      const res = await call(app, "POST", "/admin/traces/import-url", { token, body: { url } });
      expect(res.status, url).toBe(400);
    }
  });
});

describe("Validation d'une trace et provenance d'un chemin", () => {
  it("n'atteste un chemin qu'après validation, et retire l'attestation au rejet", async () => {
    const token = await moderator();
    const segments = await restonica();

    const source = await call<{ source: DataSourceDto }>(app, "POST", "/admin/collect/sources", {
      token,
      body: { name: "Parc de démonstration", url: "https://example.org/parc", type: "institutional" },
    });
    await call(app, "PATCH", `/admin/collect/sources/${source.body.source.id}`, {
      token,
      body: { status: "approved", licence: "etalab-2.0", reliabilityScore: 75 },
    });

    const imported = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", {
      token,
      body: { content: gpxFor(segments.slice(0, 3), { name: "Itinéraire officiel" }), fileName: "officiel.gpx", sourceId: source.body.source.id, licence: "etalab-2.0" },
    });
    expect(imported.status).toBe(201);
    const traceId = imported.body.trace.id;
    const segmentId = segments[0].id;

    const detail = await call<TraceDetail>(app, "GET", `/admin/traces/${traceId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.body.legs.length).toBeGreaterThan(0);
    expect(detail.body.legs.map((l) => l.segmentId)).toContain(segmentId);

    const approved = await call<{ trace: ImportedTraceDto; attested: number }>(app, "PATCH", `/admin/traces/${traceId}`, {
      token,
      body: { status: "approved" },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.trace.status).toBe("approved");

    const provenance = await call<SegmentSourcesResponse>(app, "GET", `/network/segments/${segmentId}/sources`);
    expect(provenance.status).toBe(200);
    expect(provenance.body.sources.some((s) => s.id === source.body.source.id)).toBe(true);
    expect(provenance.body.itineraries.some((i) => i.id === traceId)).toBe(true);
    expect(provenance.body.confidence.score).toBeGreaterThan(0);
    expect(provenance.body.confidence.reasons.length).toBeGreaterThan(0);
    expect(provenance.body.attributions.length).toBeGreaterThan(0);
    expect(provenance.body.geometry.coordinates.length).toBeGreaterThanOrEqual(2);

    // Rejetée, la trace ne pèse plus dans la confiance d'aucun chemin.
    await call(app, "PATCH", `/admin/traces/${traceId}`, { token, body: { status: "rejected" } });
    const after = await call<SegmentSourcesResponse>(app, "GET", `/network/segments/${segmentId}/sources`);
    expect(after.body.itineraries.some((i) => i.id === traceId)).toBe(false);
  }, 60_000);

  it("ne publie aucune fréquentation tant que le seuil d'anonymat n'est pas atteint", async () => {
    const segments = await restonica();
    const res = await call<SegmentSourcesResponse>(app, "GET", `/network/segments/${segments[1].id}/sources`);
    expect(res.status).toBe(200);
    // Aucune activité contribuée dans cette suite : l'usage reste INCONNU, ce
    // qui n'est pas « zéro passage ». Les champs valent null, et le drapeau le dit.
    expect(res.body.usage.insufficientData).toBe(true);
    expect(res.body.usage.passages).toBeNull();
    expect(res.body.usage.frequentation).toBeNull();
    expect(res.body.summary).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/userKey|userId|"email"/);
  });

  it("répond 404 sur un chemin inconnu", async () => {
    expect((await call(app, "GET", "/network/segments/inexistant/sources")).status).toBe(404);
  });
});

describe("Recherche par territoire", () => {
  it("expose les territoires pilotes et ce que l'on sait d'eux", async () => {
    const token = await moderator();
    const res = await call<TerritoriesResponse>(app, "GET", "/admin/collect/territories", { token });
    expect(res.status).toBe(200);
    const ids = res.body.territories.map((t) => t.id);
    expect(ids).toContain("fr-corse");
    expect(ids).toContain("fr-corse-bastelica");
    const corte = res.body.territories.find((t) => t.id === "fr-corse-corte");
    expect(corte?.bbox).not.toBeNull();
    expect(corte?.coverage.segments).toBeGreaterThan(0);
  });

  it("montre le plan et les requêtes AVANT de lancer quoi que ce soit", async () => {
    const token = await moderator();
    const res = await call<TerritoryPlanResponse>(app, "GET", "/admin/collect/territories/fr-corse-bastelica/plan", { token });
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(8);
    expect(res.body.steps[0].order).toBe(1);
    expect(res.body.steps.some((s) => s.requiresNetwork)).toBe(true);
    expect(res.body.queries.length).toBeGreaterThan(10);
    const queries = res.body.queries.map((q) => q.query.toLowerCase());
    // Les alias du territoire servent bien à la recherche (section 1).
    expect(queries.some((q) => q.includes("bastelica"))).toBe(true);
    expect(queries.some((q) => q.includes("pozzi"))).toBe(true);
    expect(queries.some((q) => q.includes("gpx"))).toBe(true);
    // Déterminisme : deux appels donnent exactement les mêmes requêtes.
    const again = await call<TerritoryPlanResponse>(app, "GET", "/admin/collect/territories/fr-corse-bastelica/plan", { token });
    expect(again.body.queries.map((q) => q.query)).toEqual(res.body.queries.map((q) => q.query));
  });

  it("ne compte que ce qui a réellement été constaté", async () => {
    const token = await moderator();
    const res = await call<CampaignResponse>(app, "POST", "/admin/collect/territories/fr-corse-corte/discover", {
      token,
      body: { urls: [] },
    });
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(0);
    expect(res.body.inspected).toEqual([]);
    expect(res.body.note.length).toBeGreaterThan(0);
  });

  it("répond 404 sur un territoire inconnu", async () => {
    const token = await moderator();
    expect((await call(app, "GET", "/admin/collect/territories/nulle-part/plan", { token })).status).toBe(404);
  });
});

describe("Bibliothèque", () => {
  it("filtre par statut et renvoie un total cohérent", async () => {
    const token = await moderator();
    const all = await call<TracesResponse>(app, "GET", "/admin/traces?limit=100", { token });
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThan(0);
    const pending = await call<TracesResponse>(app, "GET", "/admin/traces?status=review_required&limit=100", { token });
    expect(pending.body.traces.every((t) => t.status === "review_required")).toBe(true);
    expect(pending.body.total).toBeLessThanOrEqual(all.body.total);
  });

  it("compare plusieurs traces d'un même parcours sans en choisir une arbitrairement", async () => {
    const token = await moderator();
    const segments = await restonica();
    const ids: string[] = [];
    // Trois relevés du même passage, décalés de quelques mètres.
    for (const offset of [0, 6, -5]) {
      const res = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", {
        token,
        body: { content: gpxFor(segments.slice(0, 2), { name: `Relevé ${offset}`, offsetM: offset }), fileName: `releve-${offset}.gpx` },
      });
      ids.push(res.body.trace.id);
    }
    const res = await call<{ comparisons: { overlap: number; sameDirection: boolean }[]; corridors: unknown[]; note: string | null }>(
      app,
      "POST",
      "/admin/traces/compare",
      { token, body: { traceIds: ids } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.comparisons.length).toBe(3); // trois paires
    for (const c of res.body.comparisons) {
      expect(c.overlap).toBeGreaterThan(0.7);
      expect(c.sameDirection).toBe(true);
    }
  }, 60_000);

  it("supprime une trace et tout ce qu'elle a produit", async () => {
    const token = await moderator();
    const segments = await restonica();
    const imported = await call<ImportTraceResponse>(app, "POST", "/admin/traces/upload", {
      token,
      body: { content: gpxFor(segments.slice(2, 4), { name: "À supprimer" }), fileName: "supprimer.gpx" },
    });
    const id = imported.body.trace.id;
    expect((await call(app, "DELETE", `/admin/traces/${id}`, { token })).status).toBe(204);
    expect((await call(app, "GET", `/admin/traces/${id}`, { token })).status).toBe(404);
  });
});
