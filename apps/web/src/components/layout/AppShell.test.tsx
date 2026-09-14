import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell, NAV_ENTRIES, isNavActive } from "./AppShell";

// Les fonctionnalités montées par la coquille sont testées séparément.
vi.mock("@/features/offline/OfflineBanner", () => ({ OfflineBanner: () => <div data-testid="offline-banner" /> }));
vi.mock("@/features/alerts/AlertsWatcher", () => ({ AlertsWatcher: () => null }));

function renderShell(path = "/map") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell>
          <p>Contenu de la page</p>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("<AppShell />", () => {
  it("rend les cinq entrées de navigation avec le bouton central « Signaler »", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual(["Carte", "Explorer", "Signaler", "Communauté", "Profil"]);
    expect(within(nav).getByRole("link", { name: "Signaler" })).toHaveAttribute("href", "/report");
    expect(within(nav).getByRole("link", { name: "Carte" })).toHaveAttribute("href", "/map");
    expect(within(nav).getByRole("link", { name: "Explorer" })).toHaveAttribute("href", "/explore");
    expect(within(nav).getByRole("link", { name: "Communauté" })).toHaveAttribute("href", "/community");
    expect(within(nav).getByRole("link", { name: "Profil" })).toHaveAttribute("href", "/profile");
  });

  it("marque l'entrée active avec aria-current", () => {
    renderShell("/explore");
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("link", { name: "Explorer" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Carte" })).not.toHaveAttribute("aria-current");
  });

  it("rend le contenu, la bannière hors connexion et le lien d'évitement", () => {
    renderShell();
    expect(screen.getByText("Contenu de la page")).toBeInTheDocument();
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByText("Aller au contenu")).toHaveAttribute("href", "#main");
  });

  it("expose l'encombrement de la coquille sur <html>", () => {
    const { unmount } = renderShell();
    expect(document.documentElement.style.getPropertyValue("--shell-bottom")).toContain("--nav-height");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--shell-bottom")).toBe("");
  });

  it("considère « Autour de moi » et les fiches comme des sous-écrans de la carte", () => {
    const map = NAV_ENTRIES[0];
    expect(isNavActive(map, "/around")).toBe(true);
    expect(isNavActive(map, "/reports/abc")).toBe(true);
    expect(isNavActive(map, "/mapping")).toBe(false);
  });
});
