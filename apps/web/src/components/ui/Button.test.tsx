import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Button, Fab, IconButton, buttonClasses } from "./Button";

describe("<Button />", () => {
  it("rend un bouton de type button par défaut et déclenche onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Publier</Button>);
    const btn = screen.getByRole("button", { name: "Publier" });
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("désactive le bouton et annonce aria-busy en chargement", () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Publication…" onClick={onClick}>
        Publier
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent("Publication…");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applique variantes, tailles et pleine largeur", () => {
    render(
      <Button variant="danger" size="lg" fullWidth>
        Supprimer
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Supprimer" });
    expect(btn.className).toContain("bg-danger");
    expect(btn.className).toContain("h-14");
    expect(btn.className).toContain("w-full");
    expect(buttonClasses({ variant: "outline", size: "xl" })).toContain("h-16");
  });

  it("IconButton exige un aria-label et gère l'état enfoncé", () => {
    render(
      <IconButton aria-label="Filtres" pressed>
        <svg />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Filtres" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("Fab rend un lien accessible « Signaler » quand `to` est fourni", () => {
    render(
      <MemoryRouter>
        <Fab to="/report" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Signaler" });
    expect(link).toHaveAttribute("href", "/report");
    expect(link.style.width).toBe("var(--fab-size)");
  });
});
