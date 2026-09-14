import { describe, expect, it, vi } from "vitest";
import { copyToClipboard, shareReport, shareTitle } from "./share";

describe("partage", () => {
  it("copie le lien quand le partage natif est absent", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    // @ts-expect-error : navigator.share absent dans jsdom
    navigator.share = undefined;
    expect(await copyToClipboard("https://x/reports/1")).toBe(true);
    expect(await shareReport({ title: "t", url: "https://x/reports/1" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://x/reports/1");
  });
  it("formate le titre de partage", () => {
    expect(shareTitle("Arbre tombé")).toContain("Arbre tombé");
  });
});
