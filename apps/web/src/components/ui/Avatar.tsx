/**
 * Avatar : photo ou initiales sur fond coloré déterministe (selon le pseudo).
 * Liseré doré pour les comptes officiels, vert pour les partenaires.
 */
import { useState } from "react";
import type { UserRole } from "@mountain-live/core";
import { cn } from "./cn";
import { initials } from "@/lib/format";

export type AvatarSize = 32 | 40 | 48 | 64 | 96;

export interface AvatarProps {
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  /** Liseré selon le rôle (official : or, partner : vert). */
  role?: UserRole;
  className?: string;
}

/** Fonds contrastés avec du texte blanc, lisibles en clair comme en sombre. */
export const AVATAR_COLORS: readonly string[] = ["#2F6B3A", "#1D6FA5", "#B9691C", "#5B6B7A", "#8A6D1C", "#6B4F2A", "#3E4A54", "#175A86"];

/** Couleur stable pour un nom (hachage simple). */
export function avatarColor(name: string | null | undefined): string {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const FONT: Record<AvatarSize, string> = { 32: "text-[13px]", 40: "text-[15px]", 48: "text-[17px]", 64: "text-[22px]", 96: "text-[32px]" };

export function Avatar({ name, src, size = 40, role, className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const label = (name ?? "").trim() || "Utilisateur";
  const ring = role === "official" ? "ring-2 ring-gold" : role === "partner" ? "ring-2 ring-primary" : "";
  const showImage = Boolean(src) && !broken;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold text-white", FONT[size], ring, className)}
      style={{ width: size, height: size, background: showImage ? "var(--surface-2)" : avatarColor(name) }}
    >
      {showImage ? (
        <img src={src ?? undefined} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
