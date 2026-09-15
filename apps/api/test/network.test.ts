import { describe, expect, it } from "vitest";
import {
  K_ANONYMITY_MIN,
  type ActivitiesResponse,
  type ActivityDto,
  type CreateActivityResponse,
  type HeatmapResponse,
  type NetworkCandidatesResponse,
  type NetworkOverview,
  type PathSegment,
  type RoutePlanResponse,
  type SegmentDetail,
} from "@mountain-live/core";
import { call, registerUser, setup, type TestApp } from "./helpers";

/**
 * Moteur cartographique collectif : consentement, ingestion, passages,
 * statistiques agrégées, k-anonymat, apprentissage et itinéraires.
 *
 * Le fil conducteur des tests est la règle de la section 34 : aucune route
 * publique ne doit laisser deviner le passage d'une personne identifiable.
 * Tout le reste (fréquentation, durées, candidatures) n'existe qu'au-delà du
 * seuil d'utilisateurs distincts.
 */
const { app, seedReference } = await setup();
seedReference();

const RESTONICA_BBOX = "9.0,42.2,9.06,42.24";

/** Réseau de démonstration de la Restonica, trié pour un ordre stable. */
async function restonicaSegments(): Promise<PathSegment[]> {
  const res = await call<{ paths: PathSegment[] }>(app, "GET", `/paths?bbox=${RESTONICA_BBOX}`);
  expect(res.status).toBe(200);
  return res.body.paths.filter((p) => p.id.startsWith("d_t_restonica_melo")).sort((a, b) => a.id.localeCompare(b.id));
}

interface TracePoint {
  at: number;
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
}

/**
 * Trace simulée le long d'une suite de segments : un point par `stepS`
 * secondes, avec un bruit latéral déterministe (aucune trace réelle n'est
 * parfaitement collée au tracé). `offsetM` décale volontairement le faisceau.
 */
function walk(
  segments: readonly PathSegment[],
  opts: { startAt: number; speedMs?: number; stepS?: number; accuracy?: number; offsetM?: number; seed?: number; reverse?: boolean } = { startAt: 0 },
): TracePoint[] {
  const speed = opts.speedMs ?? 1.2;
  const step = opts.stepS ?? 3;
  const accuracy = opts.accuracy ?? 8;
  const offset = opts.offsetM ?? 0;
  let rnd = (opts.seed ?? 1) * 7919;
  const next = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648 - 0.5;
  };
  const line: [number, number][] = [];
  for (const s of segments) for (const c of s.coordinates) line.push([c[0], c[1]]);
  const path = opts.reverse ? [...line].reverse() : line;
  const points: TracePoint[] = [];
  let at = opts.startAt;
  let carry = 0;
  const stepM = speed * step;
  for (let i = 1; i < path.length; i++) {
    const [lng0, lat0] = path[i - 1];
    const [lng1, lat1] = path[i];
    const mLat = 111_320;
    const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const dx = (lng1 - lng0) * mLng;
    const dy = (lat1 - lat0) * mLat;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    // Normale au tracé : c'est elle qui porte le bruit et le décalage volontaire.
    const nx = -dy / len;
    const ny = dx / len;
    for (let d = carry; d < len; d += stepM) {
      const t = d / len;
      const lateral = offset + next() * 4;
      points.push({
        at,
        lat: lat0 + (lat1 - lat0) * t + (ny * lateral) / mLat,
        lng: lng0 + (lng1 - lng0) * t + (nx * lateral) / mLng,
        alt: 1000 + i,
        accuracy,
      });
      at += step * 1000;
    }
    carry = ((carry - len) % stepM + stepM) % stepM;
  }
  return points;
}

async function upload(
  token: string,
  points: readonly TracePoint[],
  opts: { contribute?: boolean; activityType?: string; name?: string } = {},
): Promise<CreateActivityResponse> {
  const res = await call<CreateActivityResponse>(app, "POST", "/activities", {
    token,
    body: {
      activityType: opts.activityType ?? "hiking",
      source: "recorded",
      name: opts.name ?? "Sortie de test",
      startedAt: new Date(points[0].at).toISOString(),
      endedAt: new Date(points[points.length - 1].at).toISOString(),
      contribute: opts.contribute ?? true,
      points,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Contributeurs distincts : c'est le nombre d'utilisateurs qui débloque les statistiques. */
async function contributors(n: number): Promise<string[]> {
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) tokens.push((await registerUser(app)).token);
  return tokens;
}

const DAY = 86_400_000;
/** Les traces simulées restent dans le passé : les statistiques sont datées. */
const BASE = Date.parse("2026-03-02T07:00:00.000Z");

describe("Moteur cartographique — ingestion et consentement", () => {
  it("n'exploite une trace qu'avec le consentement explicite de son auteur", async () => {
    const segments = await restonicaSegments();
    const user = await registerUser(app);
    const trace = walk(segments.slice(0, 3), { startAt: BASE, seed: 11 });
    expect(trace.length).toBeGreaterThan(100);

    const priv = await upload(user.token, trace, { contribute: false });
    expect(priv.contributed).toBe(false);
    expect(priv.traversals).toBe(0);
    expect(priv.segments).toBe(0);
    expect(priv.activity.contribution).toBe("private");
    expect(priv.contributionNote).toMatch(/privée/i);
    // La trace reste consultable par son auteur : privé ne veut pas dire perdu.
    const own = await call<{ activity: ActivityDto; points: unknown[] }>(app, "GET", `/activities/${priv.activity.id}`, { token: user.token });
    expect(own.status).toBe(200);
    expect(own.body.points.length).toBe(trace.length);

    const shared = await call<{ activity: ActivityDto }>(app, "PATCH", `/activities/${priv.activity.id}`, {
      token: user.token,
      body: { contribute: true },
    });
    expect(shared.status).toBe(200);
    expect(shared.body.activity.contribution).toBe("contributed");
    expect(shared.body.activity.segmentCount).toBeGreaterThan(0);

    const withdrawn = await call<{ activity: ActivityDto }>(app, "PATCH", `/activities/${priv.activity.id}`, {
      token: user.token,
      body: { contribute: false },
    });
    expect(withdrawn.body.activity.contribution).toBe("withdrawn");
    expect(withdrawn.body.activity.segmentCount).toBe(0);
  });

  it("rattache la trace au réseau et en tire des passages", async () => {
    const segments = await restonicaSegments();
    const user = await registerUser(app);
    const res = await upload(user.token, walk(segments.slice(0, 3), { startAt: BASE + DAY, seed: 22 }));
    expect(res.contributed).toBe(true);
    expect(res.traversals).toBeGreaterThan(0);
    expect(res.segments).toBeGreaterThan(0);
    expect(res.activity.matchedRatio ?? 0).toBeGreaterThan(0.8);
    expect(res.activity.qualityScore ?? 0).toBeGreaterThan(2);
    expect(res.activity.distanceM).toBeGreaterThan(500);
  });

  it("refuse d'apprendre quoi que ce soit d'une trace trop imprécise", async () => {
    const segments = await restonicaSegments();
    const user = await registerUser(app);
    const flou = walk(segments.slice(0, 3), { startAt: BASE + 2 * DAY, seed: 33, accuracy: 120 });
    const res = await upload(user.token, flou);
    expect(res.contributed).toBe(false);
    expect(res.traversals).toBe(0);
    expect(res.contributionNote).toMatch(/imprécise|GPS/i);
  });

  it("réserve chaque activité à son auteur", async () => {
    const segments = await restonicaSegments();
    const a = await registerUser(app);
    const b = await registerUser(app);
    const mine = await upload(a.token, walk(segments.slice(0, 2), { startAt: BASE + 3 * DAY, seed: 44 }));
    expect((await call(app, "GET", `/activities/${mine.activity.id}`, { token: b.token })).status).toBe(404);
    expect((await call(app, "PATCH", `/activities/${mine.activity.id}`, { token: b.token, body: { contribute: false } })).status).toBe(404);
    expect((await call(app, "DELETE", `/activities/${mine.activity.id}`, { token: b.token })).status).toBe(404);
    expect((await call(app, "GET", "/activities")).status).toBe(401);
    const list = await call<ActivitiesResponse>(app, "GET", "/activities", { token: a.token });
    expect(list.body.activities.every((x) => x.id !== undefined)).toBe(true);
  });
});

describe("Moteur cartographique — statistiques et k-anonymat", () => {
  it("ne publie rien tant que le seuil d'utilisateurs distincts n'est pas atteint", async () => {
    const segments = await restonicaSegments();
    const chain = segments.slice(0, Math.min(4, segments.length));
    const target = chain[Math.floor(chain.length / 2)];
    expect(chain.length).toBeGreaterThanOrEqual(2);
    const tokens = await contributors(K_ANONYMITY_MIN + 2);

    // Un seul contributeur : rien n'est publiable, même avec plusieurs sorties.
    for (let i = 0; i < 3; i++) {
      await upload(tokens[0], walk(chain, { startAt: BASE + (10 + i) * DAY, seed: 100 + i }));
    }
    const solo = await call<SegmentDetail>(app, "GET", `/network/segments/${target.id}`);
    expect(solo.status).toBe(200);
    expect(solo.body.overall.insufficientData).toBe(true);
    expect(solo.body.overall.uniqueUsers).toBe(0);
    expect(solo.body.overall.passages.total).toBe(0);
    expect(solo.body.overall.duration).toBeNull();
    expect(solo.body.frequentation).toBe("unknown");

    // Au-delà du seuil, la fréquentation devient une information collective.
    for (let i = 1; i < tokens.length; i++) {
      await upload(tokens[i], walk(chain, { startAt: BASE + (20 + i) * DAY, seed: 200 + i }));
    }
    const shared = await call<SegmentDetail>(app, "GET", `/network/segments/${target.id}`);
    expect(shared.body.overall.insufficientData).toBe(false);
    expect(shared.body.overall.uniqueUsers).toBeGreaterThanOrEqual(K_ANONYMITY_MIN);
    expect(shared.body.overall.passages.total).toBeGreaterThanOrEqual(K_ANONYMITY_MIN);
    expect(shared.body.frequentationLabel.length).toBeGreaterThan(0);
    expect(shared.body.profile.distanceM).toBeGreaterThan(0);
    // Les durées observées remplacent progressivement l'estimation théorique.
    const hiking = shared.body.times.find((t) => t.activity === "hiking");
    expect(hiking).toBeDefined();
    expect(hiking!.theoreticalMs).toBeGreaterThan(0);
    expect(hiking!.ms).toBeGreaterThan(0);
  }, 120_000);

  it("sert une carte de fréquentation agrégée et son taux de couverture", async () => {
    const res = await call<HeatmapResponse>(app, "GET", `/network/heatmap?bbox=${RESTONICA_BBOX}&period=all`);
    expect(res.status).toBe(200);
    expect(res.body.segments.length).toBeGreaterThan(0);
    expect(res.body.maxPassages).toBeGreaterThan(0);
    expect(res.body.coverage).toBeGreaterThan(0);
    expect(res.body.coverage).toBeLessThanOrEqual(1);
    for (const s of res.body.segments) {
      expect(s.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(s.passages).toBeGreaterThanOrEqual(0);
      // Sous le seuil d'anonymat, un tracé peut apparaître mais sans rien dire.
      if (s.insufficientData) expect(s.frequentation).toBe("unknown");
    }
    expect((await call(app, "GET", "/network/heatmap")).status).toBe(400);
  });

  it("retire les passages d'une contribution reprise ou supprimée", async () => {
    const segments = await restonicaSegments();
    const chain = segments.slice(0, 2);
    const tokens = await contributors(K_ANONYMITY_MIN + 1);
    const uploads: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const r = await upload(tokens[i], walk(chain, { startAt: BASE + (40 + i) * DAY, seed: 300 + i }));
      uploads.push(r.activity.id);
    }
    const before = await call<SegmentDetail>(app, "GET", `/network/segments/${chain[0].id}`);
    const usersBefore = before.body.overall.uniqueUsers;
    expect(usersBefore).toBeGreaterThanOrEqual(K_ANONYMITY_MIN);

    const del = await call(app, "DELETE", `/activities/${uploads[0]}`, { token: tokens[0] });
    expect(del.status).toBe(204);
    const after = await call<SegmentDetail>(app, "GET", `/network/segments/${chain[0].id}`);
    expect(after.body.overall.uniqueUsers).toBeLessThan(usersBefore);
    expect((await call(app, "GET", `/activities/${uploads[0]}`, { token: tokens[0] })).status).toBe(404);
  }, 120_000);
});

describe("Moteur cartographique — vie privée", () => {
  it("écarte les abords d'une zone privée déclarée", async () => {
    const segments = await restonicaSegments();
    const chain = segments.slice(0, 3);
    const user = await registerUser(app);
    const trace = walk(chain, { startAt: BASE + 60 * DAY, seed: 400 });

    const zones = await call<{ zones: unknown[] }>(app, "GET", "/users/me/privacy-zones", { token: user.token });
    expect(zones.status).toBe(200);
    expect(zones.body.zones).toEqual([]);

    // Une zone couvrant toute la sortie : plus rien ne peut en être tiré.
    const mid = trace[Math.floor(trace.length / 2)];
    const created = await call<{ zone: { id: string } }>(app, "POST", "/users/me/privacy-zones", {
      token: user.token,
      body: { label: "Maison", lat: mid.lat, lng: mid.lng, radiusM: 2000 },
    });
    expect(created.status).toBe(201);

    const res = await upload(user.token, trace);
    expect(res.contributed).toBe(false);
    expect(res.traversals).toBe(0);
    expect(res.contributionNote).toMatch(/privé|courte/i);

    const removed = await call(app, "DELETE", `/users/me/privacy-zones/${created.body.zone.id}`, { token: user.token });
    expect(removed.status).toBe(204);
    expect((await call(app, "DELETE", `/users/me/privacy-zones/${created.body.zone.id}`, { token: user.token })).status).toBe(404);
    expect((await call(app, "GET", "/users/me/privacy-zones")).status).toBe(401);
  });

  it("ne laisse aucune position individuelle transparaître dans les réponses publiques", async () => {
    const segments = await restonicaSegments();
    const detail = await call<SegmentDetail>(app, "GET", `/network/segments/${segments[0].id}`);
    const body = JSON.stringify(detail.body);
    expect(body).not.toMatch(/userKey|userId|"email"/);
    const heat = await call<HeatmapResponse>(app, "GET", `/network/heatmap?bbox=${RESTONICA_BBOX}&period=all`);
    expect(JSON.stringify(heat.body)).not.toMatch(/userKey|userId|"email"/);
  });
});

describe("Moteur cartographique — itinéraires multicritères", () => {
  it("propose plusieurs itinéraires entre deux points du réseau", async () => {
    const segments = await restonicaSegments();
    const first = segments[0];
    const last = segments[segments.length - 1];
    const from = { lat: first.coordinates[0][1], lng: first.coordinates[0][0] };
    const to = {
      lat: last.coordinates[last.coordinates.length - 1][1],
      lng: last.coordinates[last.coordinates.length - 1][0],
    };
    const res = await call<RoutePlanResponse>(app, "POST", "/network/routes", {
      body: { from, to, activity: "hiking", criteria: ["recommended", "shortest", "most_used"] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.unreachable).toBe(false);
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options) {
      expect(o.legs.length).toBeGreaterThan(0);
      expect(o.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(o.distanceM).toBeGreaterThan(0);
      expect(o.durationMs).toBeGreaterThan(0);
      expect(Number.isFinite(o.difficulty)).toBe(true);
      expect(o.observedWeight).toBeGreaterThanOrEqual(0);
      expect(o.observedWeight).toBeLessThanOrEqual(1);
      // Un itinéraire ne repasse jamais deux fois par le même segment.
      const ids = o.legs.map((l) => l.segmentId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const shortest = res.body.options.find((o) => o.criterion === "shortest");
    if (shortest) {
      for (const o of res.body.options) expect(shortest.distanceM).toBeLessThanOrEqual(o.distanceM + 1);
    }
  });

  it("le dit clairement quand aucun chemin connu ne relie les deux points", async () => {
    const res = await call<RoutePlanResponse>(app, "POST", "/network/routes", {
      body: { from: { lat: 48.85, lng: 2.35 }, to: { lat: 48.86, lng: 2.36 }, activity: "hiking" },
    });
    expect(res.status).toBe(200);
    expect(res.body.unreachable).toBe(true);
    expect(res.body.options).toEqual([]);
    expect(res.body.note).toBeTruthy();
    const bad = await call(app, "POST", "/network/routes", { body: { from: { lat: 999, lng: 2 }, to: { lat: 1, lng: 2 } } });
    expect(bad.status).toBe(400);
  });
});

describe("Moteur cartographique — apprentissage et modération", () => {
  it("réserve la reconstruction des candidatures aux modérateurs", async () => {
    const user = await registerUser(app);
    expect((await call(app, "POST", "/admin/network/rebuild", { token: user.token })).status).toBe(403);
    expect((await call(app, "POST", "/admin/network/rebuild")).status).toBe(401);
  });

  // Dix contributeurs, dix traces complètes et une passe d'apprentissage : ce
  // test fait tourner toute la chaîne, il lui faut plus que le délai par défaut.
  it("détecte un faisceau de traces systématiquement décalé et le soumet à modération", async () => {
    const segments = await restonicaSegments();
    const target = segments[1];
    const tokens = await contributors(10);
    // Dix personnes passent 12 m à côté du tracé officiel : c'est le tracé qui est faux.
    for (let i = 0; i < tokens.length; i++) {
      await upload(tokens[i], walk([segments[0], target, segments[2]], { startAt: BASE + (80 + i) * DAY, seed: 500 + i, offsetM: 12 }));
    }
    const admin = await registerUser(app, { role: "admin" });
    const rebuild = await call<{ created: number; updated: number; byKind: Record<string, number> }>(app, "POST", "/admin/network/rebuild", {
      token: admin.token,
    });
    expect(rebuild.status, JSON.stringify(rebuild.body)).toBe(200);

    const list = await call<NetworkCandidatesResponse>(app, "GET", "/network/candidates?status=open&limit=100");
    expect(list.status).toBe(200);
    for (const c of list.body.candidates) {
      expect(c.observations).toBeGreaterThan(0);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }

    // Une candidature tranchée conserve sa décision quand l'analyse est relancée.
    const candidate = list.body.candidates[0];
    if (candidate) {
      const review = await call<{ candidate: { status: string } }>(app, "PATCH", `/admin/network/candidates/${candidate.id}`, {
        token: admin.token,
        body: { status: "rejected", note: "Vérifié sur le terrain" },
      });
      expect(review.status).toBe(200);
      expect(review.body.candidate.status).toBe("rejected");
      await call(app, "POST", "/admin/network/rebuild", { token: admin.token });
      const again = await call<NetworkCandidatesResponse>(app, "GET", "/network/candidates?limit=200");
      const same = again.body.candidates.find((c) => c.id === candidate.id);
      if (same) expect(same.status).toBe("rejected");
    }
  }, 120_000);

  it("résume l'état du réseau vivant", async () => {
    const res = await call<NetworkOverview>(app, "GET", "/network/overview");
    expect(res.status).toBe(200);
    expect(res.body.segmentsTotal).toBeGreaterThan(0);
    expect(res.body.segmentsWithData).toBeGreaterThan(0);
    expect(res.body.passagesCount).toBeGreaterThan(0);
    expect(res.body.activitiesCount).toBeGreaterThan(0);
    expect(res.body.contributorsCount).toBeGreaterThanOrEqual(K_ANONYMITY_MIN);
    expect(res.body.topSegments.length).toBeGreaterThan(0);
    expect(Object.keys(res.body.byActivity).length).toBeGreaterThan(0);
  });
});
