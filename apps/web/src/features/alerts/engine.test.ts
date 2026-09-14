import { describe, expect, it } from "vitest";
import type { OfficialAlert, Report } from "@mountain-live/core";
import { DEFAULT_ALERT_PREFS, computeAlerts } from "./engine";

const base = (id: string, subtype: Report["subtype"], category: Report["category"], lat: number, lng: number): Report =>
  ({ id, subtype, category, lat, lng, status: "active", source: "community", createdAt: "", updatedAt: "", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: null, startsAt: null, confirmationsCount: 0, disputesCount: 0, resolvedVotesCount: 0, lastConfirmationAt: null, confidenceScore: 30, confidenceLabel: "low", fade: 1, photos: [], photoUrl: null, description: null, dangerLevel: null, zone: null, userId: null, authorPseudo: null, blurred: false }) as Report;

const me = { lat: 42.3, lng: 9.15 };

describe("moteur d'alertes de proximité", () => {
  it("alerte sur un arbre tombé à 300 m, pas sur un signalement hors rayon", () => {
    const tree = base("t", "fallen_tree", "danger", 42.3027, 9.15); // ≈ 300 m au nord
    const far = base("f", "fallen_tree", "danger", 42.32, 9.15);
    const alerts = computeAlerts(me, [tree, far], [], DEFAULT_ALERT_PREFS, new Set());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/^Attention : Arbre tombé à 3\d0 m\.$/);
    expect(alerts[0].reportId).toBe("t");
  });

  it("regroupe troupeau et chiens de protection", () => {
    const herd = base("h", "herd", "animals", 42.3036, 9.15);
    const dogs = base("d", "guard_dogs", "animals", 42.3038, 9.15);
    const alerts = computeAlerts(me, [herd, dogs], [], DEFAULT_ALERT_PREFS, new Set());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/Troupeau et chiens de protection à 4\d0 m\./);
  });

  it("ignore les signalements déjà notifiés et les catégories non surveillées", () => {
    const tree = base("t", "fallen_tree", "danger", 42.3027, 9.15);
    const crowd = base("c", "many_hikers", "crowd", 42.3027, 9.15);
    expect(computeAlerts(me, [tree, crowd], [], DEFAULT_ALERT_PREFS, new Set(["report:t"]))).toHaveLength(0);
  });

  it("place les alertes officielles en premier", () => {
    const tree = base("t", "fallen_tree", "danger", 42.3027, 9.15);
    const official: OfficialAlert = { id: "o", organisation: "Préfecture", title: "Risque incendie", body: "", category: "danger", severity: "high", geometry: { type: "Point", coordinates: [9.15, 42.31] }, centroidLat: 42.31, centroidLng: 9.15, startsAt: "", endsAt: null, url: null, createdAt: "" };
    const alerts = computeAlerts(me, [tree], [official], DEFAULT_ALERT_PREFS, new Set());
    expect(alerts[0].severity).toBe("official");
  });
});
