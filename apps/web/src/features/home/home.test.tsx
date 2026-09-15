import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { NearbyTrail } from "@mountain-live/core";
import { TrailCard } from "./TrailCard";
import { DURATION_FILTERS, filterByDuration } from "./HomeSheet";

/**
 * L'écran d'accueil promet une chose : comprendre immédiatement où l'on est et
 * ce qu'on peut faire autour. Ces tests protègent les deux points où cette
 * promesse peut se briser silencieusement — la confusion entre les deux
 * distances, et un chemin sans données présenté comme désert.
 */
function trail(extra: Partial<NearbyTrail> = {}): NearbyTrail {
  return {
    id: "t1",
    name: "Lac de Melo",
    activity: "hiking",
    difficulty: "moderate",
    shape: "out_and_back",
    approachM: 4200,
    lengthM: 9400,
    durationMs: 3 * 3_600_000 + 10 * 60_000,
    durationObserved: false,
    elevationGainM: 620,
    elevationLossM: 620,
    trailhead: { point: { lat: 42.226, lng: 9.045 }, distanceM: 4200, end: "start" },
    frequentation: null,
    passagesToday: null,
    popularityScore: 0,
    activeReports: 0,
    reportHint: null,
    ...extra,
  };
}

function renderCard(t: NearbyTrail, onSelect = vi.fn()) {
  render(
    <MemoryRouter>
      <TrailCard trail={t} onSelect={onSelect} />
    </MemoryRouter>,
  );
  return onSelect;
}

describe("carte d'une randonnée", () => {
  it("affiche les deux distances sans les confondre", () => {
    renderCard(trail());
    const card = screen.getByTestId("trail-card-t1");
    // L'approche est annoncée comme telle…
    expect(within(card).getByText(/À 4,2 km de vous/)).toBeInTheDocument();
    // …et la longueur du parcours vit ailleurs, sans « de vous ».
    const longueur = within(card).getByText("9,4 km");
    expect(longueur).toBeInTheDocument();
    expect(longueur.textContent).not.toMatch(/de vous/);
  });

  it("montre nom, durée, dénivelé, difficulté et forme", () => {
    renderCard(trail());
    const card = screen.getByTestId("trail-card-t1");
    expect(within(card).getByRole("heading", { name: "Lac de Melo" })).toBeInTheDocument();
    expect(within(card).getByText(/3 h 10/)).toBeInTheDocument();
    expect(within(card).getByText("+620 m")).toBeInTheDocument();
    expect(within(card).getByText("Modérée")).toBeInTheDocument();
    expect(within(card).getByText("Aller-retour")).toBeInTheDocument();
  });

  it("marque d'un « ≈ » une durée seulement estimée", () => {
    renderCard(trail({ durationObserved: false }));
    expect(screen.getByText(/≈\s*3 h 10/)).toBeInTheDocument();
  });

  it("ne dit rien de la fréquentation quand elle est inconnue", () => {
    renderCard(trail());
    const card = screen.getByTestId("trail-card-t1");
    expect(within(card).queryByText(/calme|fréquent/i)).toBeNull();
  });

  it("affiche le comptage réel quand il existe", () => {
    renderCard(trail({ passagesToday: 27, frequentation: "high" }));
    expect(screen.getByText("27 passages aujourd'hui")).toBeInTheDocument();
  });

  it("remonte un signalement actif en tête de carte", () => {
    renderCard(trail({ activeReports: 2, reportHint: "Battue signalée" }));
    const card = screen.getByTestId("trail-card-t1");
    expect(within(card).getByText("Battue signalée")).toBeInTheDocument();
  });

  it("se sélectionne au tap et annonce son état", () => {
    const onSelect = renderCard(trail());
    const card = screen.getByTestId("trail-card-t1");
    expect(card).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});

describe("filtres de durée", () => {
  const court = trail({ id: "court", durationMs: 90 * 60_000 });
  const moyen = trail({ id: "moyen", durationMs: 3 * 3_600_000 });
  const journee = trail({ id: "journee", durationMs: 6 * 3_600_000 });
  const all = [court, moyen, journee];

  it("ne filtre rien par défaut", () => {
    expect(filterByDuration(all, "all")).toHaveLength(3);
  });

  it("sépare les tranches sans recouvrement", () => {
    expect(filterByDuration(all, "short").map((t) => t.id)).toEqual(["court"]);
    expect(filterByDuration(all, "half").map((t) => t.id)).toEqual(["moyen"]);
    expect(filterByDuration(all, "day").map((t) => t.id)).toEqual(["journee"]);
  });

  it("couvre les quatre tranches annoncées et ne mute pas l'entrée", () => {
    expect(DURATION_FILTERS).toHaveLength(4);
    const copy = [...all];
    filterByDuration(all, "short");
    expect(all).toEqual(copy);
  });

  it("supporte une liste vide", () => {
    expect(filterByDuration([], "day")).toEqual([]);
  });
});
