import { describe, expect, it } from "vitest";
import type { OfficialAlert, PresenceCell, Report } from "@mountain-live/core";
import {
  alertsToCollections,
  circlePolygon,
  filterByZoom,
  isVisibleAtZoom,
  metersToPixelsAtZoom,
  presenceToCollection,
  priorityThresholdForZoom,
  reportPriority,
  toFeatureCollection,
  zoomPriorityFilter,
} from "./geojson";

function report(over: Partial<Report>): Report {
  return {
    id: "r1",
    userId: "u1",
    authorPseudo: "rando",
    category: "danger",
    subtype: "fallen_tree",
    lat: 42.3,
    lng: 9.15,
    blurred: false,
    dangerLevel: "moderate",
    description: null,
    photoUrl: null,
    photos: [],
    source: "community",
    status: "active",
    zone: "Corte",
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    expiresAt: "2026-09-19T10:00:00.000Z",
    startsAt: null,
    endsAt: null,
    confirmationsCount: 2,
    disputesCount: 0,
    resolvedVotesCount: 0,
    lastConfirmationAt: null,
    confidenceScore: 55,
    confidenceLabel: "probable",
    fade: 1,
    ...over,
  };
}

describe("toFeatureCollection", () => {
  it("convertit les signalements en points avec les propriétés attendues par les couches", () => {
    const fc = toFeatureCollection([report({ id: "a", fade: 0.6 }), report({ id: "b", subtype: "hunting", category: "activity", source: "official", lat: 42.4, lng: 9.2 })]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    const [a, b] = fc.features;
    expect(a.geometry.coordinates).toEqual([9.15, 42.3]);
    expect(a.id).toBe("a");
    expect(a.properties).toMatchObject({ id: "a", subtype: "fallen_tree", category: "danger", priority: 3, fade: 0.6, official: false, blurred: false, markerImage: "ml-marker-fallen_tree-default" });
    expect(b.properties.markerImage).toBe("ml-marker-hunting-official");
    expect(b.properties.official).toBe(true);
  });

  it("marque le signalement sélectionné et borne l'opacité", () => {
    const fc = toFeatureCollection([report({ id: "a", fade: 0.1 }), report({ id: "b", fade: Number.NaN })], { selectedId: "b" });
    expect(fc.features[0].properties.fade).toBe(0.35);
    expect(fc.features[1].properties.fade).toBe(1);
    expect(fc.features[1].properties.markerImage).toBe("ml-marker-fallen_tree-selected");
  });

  it("ignore les coordonnées invalides et calcule le halo des positions floutées", () => {
    const fc = toFeatureCollection([report({ id: "bad", lat: Number.NaN }), report({ id: "blur", subtype: "wildlife", category: "animals", blurred: true })]);
    expect(fc.features.map((f) => f.properties.id)).toEqual(["blur"]);
    expect(fc.features[0].properties.blurred).toBe(true);
    expect(fc.features[0].properties.blurPx20).toBeGreaterThan(1000);
  });

  it("applique la priorité minimale demandée", () => {
    const list = [report({ id: "p3", subtype: "fallen_tree" }), report({ id: "p2", subtype: "herd", category: "animals" }), report({ id: "p1", subtype: "mtb", category: "crowd" })];
    expect(toFeatureCollection(list, { minPriority: 3 }).features.map((f) => f.properties.id)).toEqual(["p3"]);
    expect(toFeatureCollection(list, { minPriority: 2 }).features.map((f) => f.properties.id)).toEqual(["p3", "p2"]);
    expect(toFeatureCollection(list).features).toHaveLength(3);
  });
});

describe("zoom intelligent", () => {
  it("dérive le seuil de priorité du zoom", () => {
    expect(priorityThresholdForZoom(8)).toBe(3);
    expect(priorityThresholdForZoom(9.99)).toBe(3);
    expect(priorityThresholdForZoom(10)).toBe(2);
    expect(priorityThresholdForZoom(11.5)).toBe(2);
    expect(priorityThresholdForZoom(12)).toBe(1);
    expect(priorityThresholdForZoom(16)).toBe(1);
    expect(priorityThresholdForZoom(Number.NaN)).toBe(1);
  });

  it("filtre les données selon le zoom", () => {
    const list = [report({ id: "p3", subtype: "battue", category: "activity" }), report({ id: "p2", subtype: "snow" }), report({ id: "p1", subtype: "quiet_area", category: "crowd" })];
    expect(filterByZoom(list, 9).map((r) => r.id)).toEqual(["p3"]);
    expect(filterByZoom(list, 11).map((r) => r.id)).toEqual(["p3", "p2"]);
    expect(filterByZoom(list, 13).map((r) => r.id)).toEqual(["p3", "p2", "p1"]);
    expect(reportPriority({ subtype: "refuge" })).toBe(3);
    expect(isVisibleAtZoom(1, 11)).toBe(false);
    expect(isVisibleAtZoom(2, 11)).toBe(true);
  });

  it("produit une expression de filtre MapLibre cohérente avec les seuils", () => {
    const expr = zoomPriorityFilter() as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["<", ["zoom"], 10]);
    expect(expr[2]).toEqual([">=", ["coalesce", ["get", "priority"], 2], 3]);
    expect(expr[3]).toEqual(["<", ["zoom"], 12]);
    expect(expr[4]).toEqual([">=", ["coalesce", ["get", "priority"], 2], 2]);
    expect(expr[5]).toBe(true);
  });
});

describe("alertes, présence et géométrie", () => {
  const alert: OfficialAlert = {
    id: "al1",
    organisation: "Préfecture",
    title: "Risque incendie",
    body: "Accès interdit",
    category: "danger",
    severity: "critical",
    geometry: { type: "Polygon", coordinates: [[[9.1, 42.2], [9.2, 42.2], [9.2, 42.3], [9.1, 42.2]]] },
    centroidLat: 42.23,
    centroidLng: 9.16,
    startsAt: "2026-09-14T00:00:00.000Z",
    endsAt: null,
    url: null,
    createdAt: "2026-09-14T00:00:00.000Z",
  };

  it("sépare polygones et marqueurs des alertes officielles", () => {
    const point: OfficialAlert = { ...alert, id: "al2", geometry: { type: "Point", coordinates: [9.3, 42.5] }, severity: "high" };
    const { polygons, points } = alertsToCollections([alert, point]);
    expect(polygons.features).toHaveLength(1);
    expect(polygons.features[0].properties.severity).toBe("critical");
    expect(points.features.map((f) => f.geometry.coordinates)).toEqual([[9.16, 42.23], [9.3, 42.5]]);
    expect(points.features[0].properties.markerImage).toBe("ml-marker-cat-danger-official");
  });

  it("convertit les cellules de présence en points pondérés (jamais de position individuelle)", () => {
    const cells: PresenceCell[] = [
      { cell: "42.25:9.05", lat: 42.255, lng: 9.055, count: 4 },
      { cell: "42.26:9.05", lat: 42.265, lng: 9.055, count: 0 },
    ];
    const fc = presenceToCollection(cells);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.count).toBe(4);
    expect(Object.keys(fc.features[0].properties)).toEqual(["count"]);
  });

  it("construit un cercle fermé et convertit des mètres en pixels", () => {
    const circle = circlePolygon({ lat: 42.3, lng: 9.15 }, 50, 16);
    const ring = circle.geometry.coordinates[0];
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
    expect(ring[0][0]).toBeGreaterThan(9.15);
    // 400 m ≈ 7 245 px au zoom 20 à 42,3° de latitude (monde de 512 × 2^z px dans MapLibre).
    expect(metersToPixelsAtZoom(400, 42.3, 20)).toBeCloseTo(7245, -1);
  });
});
