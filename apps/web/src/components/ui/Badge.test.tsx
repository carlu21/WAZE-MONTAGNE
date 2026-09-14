import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CONFIDENCE_LABELS, DANGER_LEVELS, STATUS_LABELS, type ConfidenceLabel } from "@mountain-live/core";
import { ConfidenceBadge, DangerPill, SourceBadge, StatusPill } from "./Badge";

describe("<ConfidenceBadge />", () => {
  it.each(Object.keys(CONFIDENCE_LABELS) as ConfidenceLabel[])("affiche le libellé et la couleur de « %s »", (label) => {
    const { container } = render(<ConfidenceBadge label={label} />);
    const def = CONFIDENCE_LABELS[label];
    expect(screen.getByText(def.label)).toBeInTheDocument();
    const el = container.querySelector<HTMLElement>("[data-confidence]");
    expect(el?.dataset.confidence).toBe(label);
    expect(el?.style.getPropertyValue("--badge-color")).toBe(def.color);
  });

  it("affiche le score arrondi quand il est fourni", () => {
    render(<ConfidenceBadge label="confirmed" score={71.6} />);
    expect(screen.getByText("72 %")).toBeInTheDocument();
    expect(screen.getByTitle("Indice de confiance : 72 / 100")).toBeInTheDocument();
  });
});

describe("<SourceBadge />", () => {
  it("distingue officiel, partenaire et communauté", () => {
    render(
      <>
        <SourceBadge source="official" />
        <SourceBadge source="partner" />
        <SourceBadge source="community" long />
      </>,
    );
    expect(screen.getByText("Officiel")).toBeInTheDocument();
    expect(screen.getByText("Partenaire")).toBeInTheDocument();
    expect(screen.getByText("Signalement communautaire")).toBeInTheDocument();
  });
});

describe("<DangerPill /> et <StatusPill />", () => {
  it("utilise les libellés et couleurs de la taxonomie", () => {
    const { container } = render(<DangerPill level="critical" />);
    const critical = DANGER_LEVELS.find((d) => d.id === "critical")!;
    expect(screen.getByText(critical.label)).toBeInTheDocument();
    const el = container.querySelector<HTMLElement>("[data-danger-level]");
    expect(el?.style.getPropertyValue("--badge-color")).toBe(critical.color);
    expect(el?.className).toContain("ml-badge--solid");
  });

  it("affiche le statut en français", () => {
    render(<StatusPill status="probably_resolved" />);
    expect(screen.getByText(STATUS_LABELS.probably_resolved)).toBeInTheDocument();
  });
});
