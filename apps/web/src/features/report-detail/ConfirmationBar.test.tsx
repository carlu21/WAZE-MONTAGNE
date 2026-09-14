import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmationBar } from "./ConfirmationBar";

describe("ConfirmationBar", () => {
  it("rend les trois boutons et déclenche le vote", () => {
    const onVote = vi.fn();
    render(<ConfirmationBar current={null} onVote={onVote} onDispute={() => {}} />);
    expect(screen.getByRole("button", { name: /toujours présent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /situation améliorée/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /plus présent/i }));
    expect(onVote).toHaveBeenCalledWith("gone");
  });

  it("désactive les votes pour l'auteur", () => {
    render(<ConfirmationBar current={null} onVote={() => {}} onDispute={() => {}} isAuthor />);
    expect(screen.getByRole("button", { name: /toujours présent/i })).toBeDisabled();
    expect(screen.getByText(/votre propre signalement/i)).toBeInTheDocument();
  });

  it("marque le vote courant", () => {
    render(<ConfirmationBar current="still_present" onVote={() => {}} onDispute={() => {}} />);
    expect(screen.getByRole("button", { name: /toujours présent/i })).toHaveAttribute("aria-pressed", "true");
  });
});
