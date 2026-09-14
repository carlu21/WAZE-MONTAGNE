import { fr, interpolate } from "@mountain-live/core";

export interface ShareInput {
  title: string;
  url: string;
  text?: string;
}

/** Partage natif si disponible, sinon copie du lien. Renvoie « shared » | « copied » | « failed ». */
export async function shareReport(input: ShareInput): Promise<"shared" | "copied" | "failed"> {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ title: input.title, text: input.text, url: input.url });
      return "shared";
    } catch (e) {
      // Annulation par l'utilisateur : rien à faire.
      if (e instanceof DOMException && e.name === "AbortError") return "failed";
    }
  }
  return (await copyToClipboard(input.url)) ? "copied" : "failed";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function shareTitle(label: string): string {
  return interpolate(fr.sheet.shareTitle, { label });
}

export function reportUrl(id: string): string {
  if (typeof window === "undefined") return `/reports/${id}`;
  return `${window.location.origin}/reports/${id}`;
}
