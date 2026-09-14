import { describe, expect, it } from "vitest";
import { haversineM, type Area, type Report, type WaterPoint, type OfficialAlert } from "@mountain-live/core";
import { groupAreasByType } from "./search";
import { cardinalDirection, mergeAround } from "../around/merge";

const area = (id: string, type: Area["type"]): Area => ({ id, name: id, type, lat: 42, lng: 9, bbox: null, elevation: null, description: null });

describe("explorer", () => {
  it("groupe les résultats par type dans l'ordre", () => {
    const g = groupAreasByType([area("s", "summit"), area("c", "commune"), area("c2", "commune"), area("l", "lake")]);
    expect(g.map((x) => x.type)).toEqual(["commune", "summit", "lake"]);
    expect(g[0].items).toHaveLength(2);
  });
});

describe("autour de moi", () => {
  const center = { lat: 42.3, lng: 9.15 };
  const report = (id: string, lat: number, lng: number): Report =>
    ({ id, lat, lng, category: "danger", subtype: "fallen_tree", status: "active", source: "community", createdAt: "", updatedAt: "", expiresAt: "", confirmationsCount: 0, disputesCount: 0, resolvedVotesCount: 0, lastConfirmationAt: null, confidenceScore: 30, confidenceLabel: "low", fade: 1, photos: [], photoUrl: null, description: null, dangerLevel: null, zone: null, userId: null, authorPseudo: null, blurred: false, startsAt: null, endsAt: null }) as Report;
  const water: WaterPoint & { distanceM: number } = { id: "w", name: "Source", type: "spring", lat: 42.301, lng: 9.15, lastState: "active", lastStateAt: null, elevation: null, distanceM: 111 };
  const alert: OfficialAlert = { id: "a", organisation: "Préfecture", title: "Risque incendie", body: "", category: "danger", severity: "high", geometry: { type: "Point", coordinates: [9.2, 42.3] }, centroidLat: 42.3, centroidLng: 9.2, startsAt: "", endsAt: null, url: null, createdAt: "" };

  it("trie par distance en gardant les alertes officielles en tête", () => {
    const merged = mergeAround([report("far", 42.32, 9.15), report("near", 42.3005, 9.15)], [water], [alert], center, haversineM);
    expect(merged[0].kind).toBe("alert");
    expect(merged.slice(1).map((e) => e.distanceM)).toEqual([...merged.slice(1).map((e) => e.distanceM)].sort((a, b) => a - b));
    expect(merged[1].kind === "report" && merged[1].report.id).toBe("near");
  });

  it("calcule une direction cardinale", () => {
    expect(cardinalDirection(center, { lat: 42.4, lng: 9.15 })).toBe("N");
    expect(cardinalDirection(center, { lat: 42.3, lng: 9.3 })).toBe("E");
  });
});
