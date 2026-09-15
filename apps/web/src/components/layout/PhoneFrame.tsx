/**
 * Cadre de téléphone (application smartphone uniquement).
 *
 * Sur un écran large (ordinateur), l'application s'affiche dans un écran
 * d'iPhone simulé : 390 × 844 pt, coins arrondis, îlot dynamique, barre d'état
 * (heure réelle), indicateur d'accueil, zones sûres (54 pt en haut, 34 pt en
 * bas) pour que l'interface se comporte exactement comme sur l'appareil. Les
 * portails (modales, toasts, navigation plein écran) sont rendus dans l'écran.
 * À côté : l'adresse et le QR code pour ouvrir l'application sur un vrai
 * iPhone connecté au même Wi-Fi.
 *
 * Sur un vrai téléphone (écran étroit) ou avec `?frame=0`, rien ne change :
 * l'application occupe tout l'écran.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useShowPhoneFrame } from "@/components/ui/hooks";
import { PORTAL_ROOT_ID } from "@/lib/portal";
import { OpenOnPhone } from "./OpenOnPhone";

export const FRAME_WIDTH = 390;
export const FRAME_HEIGHT = 844;
export const FRAME_SAFE_TOP = 54;
export const FRAME_SAFE_BOTTOM = 34;

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
}

function frameDisabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return new URLSearchParams(window.location.search).get("frame") === "0" || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  const wide = useShowPhoneFrame();
  const show = wide && !frameDisabled();
  const time = useClock();

  if (!show) return <>{children}</>;

  return (
    <div className="ml-phone-stage" data-testid="phone-frame">
      <div className="ml-phone-device" role="presentation">
        <div
          className="ml-phone-screen"
          style={{ ["--safe-top" as string]: `${FRAME_SAFE_TOP}px`, ["--safe-bottom" as string]: `${FRAME_SAFE_BOTTOM}px`, ["--safe-left" as string]: "0px", ["--safe-right" as string]: "0px" }}
        >
          {children}
          {/* Racine des portails : modales, feuilles, toasts et navigation restent dans l'écran. */}
          <div id={PORTAL_ROOT_ID} />
          <div className="ml-phone-statusbar" aria-hidden="true">
            <span className="ml-phone-time">{time}</span>
            <span className="ml-phone-icons">
              <svg width="18" height="12" viewBox="0 0 18 12">
                <rect x="0" y="8" width="3" height="4" rx="0.8" fill="currentColor" />
                <rect x="5" y="6" width="3" height="6" rx="0.8" fill="currentColor" />
                <rect x="10" y="3" width="3" height="9" rx="0.8" fill="currentColor" />
                <rect x="15" y="0" width="3" height="12" rx="0.8" fill="currentColor" />
              </svg>
              <svg width="16" height="12" viewBox="0 0 16 12">
                <path d="M8 11.2 5.9 8.6a3 3 0 0 1 4.2 0Zm-3.6-3.9L2.9 5.7a7.3 7.3 0 0 1 10.2 0l-1.5 1.6a5.1 5.1 0 0 0-7.2 0Zm-3-3L0 2.7a11.4 11.4 0 0 1 16 0l-1.4 1.6a9.2 9.2 0 0 0-13.2 0Z" fill="currentColor" />
              </svg>
              <svg width="27" height="12" viewBox="0 0 27 12">
                <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.45" />
                <rect x="2" y="2" width="17" height="8" rx="1.6" fill="currentColor" />
                <path d="M24.5 4v4a2 2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.45" />
              </svg>
            </span>
          </div>
          <div className="ml-phone-island" aria-hidden="true" />
          <div className="ml-phone-home" aria-hidden="true" />
        </div>
      </div>
      <OpenOnPhone />
    </div>
  );
}
