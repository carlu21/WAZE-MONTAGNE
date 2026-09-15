import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PhoneFrame } from "./PhoneFrame";
import { lanUrls } from "./OpenOnPhone";
import { portalRoot } from "@/lib/portal";

vi.mock("@/lib/api", () => ({ api: { health: () => Promise.resolve({ ok: true, time: "", lan: ["192.168.1.20"] }) } }));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: query.includes("display-mode") ? false : matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  });
}

function renderFrame() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhoneFrame>
        <p>Écran</p>
      </PhoneFrame>
    </QueryClientProvider>,
  );
}

describe("<PhoneFrame />", () => {
  afterEach(() => {
    mockMatchMedia(false);
  });

  it("affiche l'application telle quelle sur un écran étroit (vrai téléphone)", () => {
    mockMatchMedia(false);
    renderFrame();
    expect(screen.getByText("Écran")).toBeInTheDocument();
    expect(screen.queryByTestId("phone-frame")).toBeNull();
    expect(portalRoot()).toBe(document.body);
  });

  it("entoure l'application d'un cadre d'iPhone sur grand écran et y rend les portails", () => {
    mockMatchMedia(true);
    renderFrame();
    const frame = screen.getByTestId("phone-frame");
    expect(frame).toBeInTheDocument();
    expect(screen.getByText("Écran")).toBeInTheDocument();
    expect(portalRoot().id).toBe("ml-portal");
    expect(frame.querySelector(".ml-phone-screen")?.getAttribute("style")).toContain("--safe-top: 54px");
    expect(screen.getByRole("complementary", { name: "Ouvrir sur votre iPhone" })).toBeInTheDocument();
  });

  it("construit l'adresse à ouvrir sur le téléphone", () => {
    expect(lanUrls(["192.168.1.20", "10.0.0.5"], { protocol: "https:", port: "5173", hostname: "localhost" })).toEqual(["https://192.168.1.20:5173", "https://10.0.0.5:5173"]);
    expect(lanUrls([], { protocol: "https:", port: "", hostname: "mountain.example" })).toEqual(["https://mountain.example"]);
  });
});
