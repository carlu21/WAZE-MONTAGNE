import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { barScale } from "./charts";

describe("outils d'administration", () => {
  it("génère un CSV avec échappement", () => {
    const csv = toCsv([{ a: "x;y", b: 2 }, { a: 'q"uote', b: null }]);
    expect(csv.split("\r\n")).toEqual(["a;b", '"x;y";2', '"q""uote";']);
  });
  it("calcule l'échelle des barres", () => {
    const s = barScale([2, 10, 5], 100);
    expect(s(10)).toBe(100);
    expect(s(5)).toBe(50);
    expect(barScale([], 100)(0)).toBe(0);
  });
});
