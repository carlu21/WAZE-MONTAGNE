import { describe, expect, it } from "vitest";
import {
  BLUR_GRID_DEG,
  bboxCenter,
  bboxContains,
  bboxFromCenter,
  bearing,
  blurLocation,
  cellCenter,
  clampBBox,
  distanceToPolylineM,
  expandBBox,
  formatDistance,
  hashString,
  haversineM,
  inBBox,
  isValidLatLng,
  offsetPoint,
  pointsAlongLine,
  polylineLengthM,
  presenceCell,
  snapToGrid,
  type LngLat,
} from "./geo";

const AJACCIO = { lat: 41.9192, lng: 8.7386 };
const BASTIA = { lat: 42.6977, lng: 9.45 };
const CORSICA = { lat: 42.25, lng: 9.05 };

describe("haversineM / bearing", () => {
  it("mesure des distances réalistes", () => {
    expect(haversineM(AJACCIO, AJACCIO)).toBe(0);
    const d = haversineM(AJACCIO, BASTIA);
    expect(d).toBeGreaterThan(100_000);
    expect(d).toBeLessThan(110_000);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
    expect(haversineM(AJACCIO, BASTIA)).toBeCloseTo(haversineM(BASTIA, AJACCIO), 6);
  });
  it("calcule le cap initial", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0);
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90);
    expect(bearing({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180);
    expect(bearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 })).toBeCloseTo(270);
  });
  it("offsetPoint est cohérent avec haversine et bearing", () => {
    const p = offsetPoint(CORSICA, 1500, 45);
    expect(haversineM(CORSICA, p)).toBeCloseTo(1500, 0);
    expect(bearing(CORSICA, p)).toBeCloseTo(45, 1);
  });
});

describe("validation et bbox", () => {
  const box = { west: 8.5, south: 41.3, east: 9.6, north: 43.05 };
  it("isValidLatLng", () => {
    expect(isValidLatLng(CORSICA)).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng({ lat: "42", lng: 9 })).toBe(false);
  });
  it("inBBox et bboxContains", () => {
    expect(inBBox(CORSICA, box)).toBe(true);
    expect(inBBox({ lat: 45, lng: 9 }, box)).toBe(false);
    expect(bboxContains(box, { west: 9, south: 42, east: 9.2, north: 42.3 })).toBe(true);
    expect(bboxContains(box, { west: 9, south: 42, east: 9.7, north: 42.3 })).toBe(false);
    expect(bboxContains(box, box)).toBe(true);
  });
  it("clampBBox borne et remet dans l'ordre", () => {
    expect(clampBBox({ west: 9.6, south: 43.05, east: 8.5, north: 41.3 })).toEqual(box);
    expect(clampBBox({ west: -200, south: -100, east: 200, north: 100 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
  it("bboxFromCenter produit une boîte de rayon donné", () => {
    const b = bboxFromCenter(CORSICA, 1000);
    expect(bboxCenter(b).lat).toBeCloseTo(CORSICA.lat, 9);
    expect(bboxCenter(b).lng).toBeCloseTo(CORSICA.lng, 9);
    expect(haversineM(CORSICA, { lat: b.north, lng: CORSICA.lng })).toBeCloseTo(1000, -1);
    expect(haversineM(CORSICA, { lat: CORSICA.lat, lng: b.east })).toBeCloseTo(1000, -1);
    expect(inBBox(CORSICA, b)).toBe(true);
  });
  it("expandBBox agrandit autour du centre", () => {
    const b2 = expandBBox(box, 2);
    expect(bboxCenter(b2)).toEqual(bboxCenter(box));
    expect(b2.east - b2.west).toBeCloseTo((box.east - box.west) * 2);
    expect(bboxContains(b2, box)).toBe(true);
    expect(expandBBox(box, 1)).toEqual(box);
    expect(expandBBox(box, 0).east).toBeCloseTo(expandBBox(box, 0).west);
  });
});

describe("cellules de présence", () => {
  it("presenceCell arrondit à 0,01°", () => {
    expect(presenceCell({ lat: 42.254, lng: 9.049 })).toBe("42.25:9.05");
    expect(presenceCell({ lat: 42.255, lng: 9.0449 })).toBe("42.26:9.04");
    expect(presenceCell({ lat: -0.001, lng: 0 })).toBe("0.00:0.00");
    expect(presenceCell({ lat: -33.8688, lng: 151.2093 })).toBe("-33.87:151.21");
  });
  it("cellCenter inverse presenceCell", () => {
    expect(cellCenter("42.25:9.05")).toEqual({ lat: 42.25, lng: 9.05 });
    const c = cellCenter(presenceCell(CORSICA))!;
    expect(haversineM(c, CORSICA)).toBeLessThan(800);
    expect(cellCenter("abc")).toBeNull();
    expect(cellCenter("1:2:3")).toBeNull();
    expect(cellCenter("")).toBeNull();
    expect(cellCenter(":9")).toBeNull();
    expect(cellCenter("95:9")).toBeNull();
  });
});

describe("formatDistance", () => {
  it("formate en mètres puis kilomètres à la française", () => {
    expect(formatDistance(320)).toBe("320 m");
    expect(formatDistance(314)).toBe("310 m");
    expect(formatDistance(315)).toBe("320 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(12_000)).toBe("12 km");
    expect(formatDistance(12_499)).toBe("12 km");
    expect(formatDistance(1000)).toBe("1 km");
    expect(formatDistance(996)).toBe("1 km");
    expect(formatDistance(9_949)).toBe("9,9 km");
    expect(formatDistance(9_960)).toBe("10 km");
  });
  it("gère les petites valeurs et les valeurs invalides", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(3)).toBe("10 m");
    expect(formatDistance(-5)).toBe("0 m");
    expect(formatDistance(Number.NaN)).toBe("—");
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("blurLocation", () => {
  const origins = [CORSICA, { lat: 0, lng: 0 }, { lat: 60.5, lng: -20.2 }, { lat: -41.3, lng: 174.8 }];
  const seeds = Array.from({ length: 40 }, (_, i) => `report-${i}-${i * 7919}`);

  it("est déterministe pour un même seed", () => {
    const a = blurLocation(CORSICA.lat, CORSICA.lng, "abc");
    const b = blurLocation(CORSICA.lat, CORSICA.lng, "abc");
    expect(a).toEqual(b);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
  it("varie selon le seed dès que le rayon dépasse le pas de la grille", () => {
    const distinct = new Set(seeds.map((s) => JSON.stringify(blurLocation(CORSICA.lat, CORSICA.lng, s, 1500))));
    expect(distinct.size).toBeGreaterThan(5);
    // Au rayon par défaut, une position déjà sur un nœud n'a qu'un candidat : le nœud lui-même.
    expect(blurLocation(CORSICA.lat, CORSICA.lng, "x")).toEqual(CORSICA);
  });
  it("ne renvoie jamais la position exacte lorsqu'elle n'est pas sur la grille", () => {
    const o = { lat: 42.2513, lng: 9.0527 };
    for (const s of seeds) expect(blurLocation(o.lat, o.lng, s)).not.toEqual(o);
  });
  it("reste à moins du rayon demandé et sur la grille de 0,005°", () => {
    for (const o of origins) {
      for (const s of seeds) {
        const p = blurLocation(o.lat, o.lng, s);
        expect(haversineM(o, p)).toBeLessThan(400);
        expect(Math.abs(p.lat / BLUR_GRID_DEG - Math.round(p.lat / BLUR_GRID_DEG))).toBeLessThan(1e-6);
        expect(Math.abs(p.lng / BLUR_GRID_DEG - Math.round(p.lng / BLUR_GRID_DEG))).toBeLessThan(1e-6);
        expect(isValidLatLng(p)).toBe(true);
      }
    }
  });
  it("respecte un rayon plus grand et déplace réellement le point", () => {
    let moved = 0;
    for (const s of seeds) {
      const p = blurLocation(CORSICA.lat, CORSICA.lng, s, 1500);
      expect(haversineM(CORSICA, p)).toBeLessThan(1500);
      if (haversineM(CORSICA, p) > 400) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
  it("snapToGrid ne produit ni artefact flottant ni -0", () => {
    expect(snapToGrid({ lat: 0.3000004, lng: -0.0001 }, 0.005)).toEqual({ lat: 0.3, lng: 0 });
  });
});

describe("polylignes", () => {
  const A: LngLat = [9.0, 42.0];
  const B: LngLat = [9.1, 42.0];
  const line: LngLat[] = [A, B];

  it("distanceToPolylineM : point sur, à côté et au-delà de la ligne", () => {
    expect(distanceToPolylineM({ lat: 42.0, lng: 9.05 }, line)).toBeLessThan(0.5);
    const north = { lat: 42.0 + 100 / 111_320, lng: 9.05 };
    expect(distanceToPolylineM(north, line)).toBeCloseTo(100, 0);
    const beyond = offsetPoint({ lat: 42.0, lng: 9.1 }, 250, 90);
    expect(distanceToPolylineM(beyond, line)).toBeCloseTo(250, 0);
    expect(distanceToPolylineM({ lat: 42, lng: 9 }, [])).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolylineM({ lat: 42.01, lng: 9 }, [A])).toBeCloseTo(haversineM({ lat: 42.01, lng: 9 }, { lat: 42, lng: 9 }), 6);
    // Un segment de longueur nulle ne provoque pas de division par zéro.
    expect(distanceToPolylineM({ lat: 42.001, lng: 9 }, [A, A])).toBeCloseTo(111.3, 0);
  });
  it("polylineLengthM somme les segments", () => {
    expect(polylineLengthM([[0, 0], [0, 1]])).toBeCloseTo(111_195, -1);
    expect(polylineLengthM([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(2 * 111_195, -1);
    expect(polylineLengthM([])).toBe(0);
  });
  it("pointsAlongLine échantillonne à pas régulier", () => {
    const end = offsetPoint({ lat: 42, lng: 9 }, 1000, 0);
    const l: LngLat[] = [[9, 42], [end.lng, end.lat]];
    const pts = pointsAlongLine(l, 250);
    expect(pts).toHaveLength(5);
    for (let i = 1; i < pts.length; i++) expect(haversineM(pts[i - 1], pts[i])).toBeCloseTo(250, 0);
    expect(haversineM(pts[pts.length - 1], end)).toBeLessThan(0.01);
    const pts2 = pointsAlongLine(l, 400);
    expect(pts2).toHaveLength(4);
    expect(haversineM(pts2[2], pts2[3])).toBeCloseTo(200, 0);
    expect(pointsAlongLine([], 100)).toEqual([]);
    expect(pointsAlongLine(l, 0)).toEqual([{ lng: 9, lat: 42 }]);
    expect(pointsAlongLine([[9, 42]], 100)).toEqual([{ lng: 9, lat: 42 }]);
  });
  it("pointsAlongLine reporte le reste d'un segment sur le suivant", () => {
    const mid = offsetPoint({ lat: 42, lng: 9 }, 300, 0);
    const end = offsetPoint(mid, 300, 0);
    const l: LngLat[] = [[9, 42], [mid.lng, mid.lat], [end.lng, end.lat]];
    const pts = pointsAlongLine(l, 250);
    expect(pts).toHaveLength(4); // 0, 250, 500, 600
    expect(haversineM(pts[0], pts[1])).toBeCloseTo(250, 0);
    expect(haversineM(pts[1], pts[2])).toBeCloseTo(250, 0);
  });
});
