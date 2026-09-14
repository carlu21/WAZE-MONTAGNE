/**
 * Écran de démarrage : logo, « La montagne en temps réel. », puis redirection
 * vers l'onboarding (premier lancement) ou la carte. Rafraîchit la session.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { fr } from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { useSessionStore } from "@/store/session";
import { splashTarget } from "@/features/account/splash";
import { MountainArt } from "@/features/account/MountainArt";

export const SPLASH_MIN_MS = 900;

export default function SplashPage() {
  const navigate = useNavigate();
  const { token, onboardingDone, setUser, logout } = useSessionStore();

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const go = () => {
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - started));
      window.setTimeout(() => {
        if (!cancelled) navigate(splashTarget({ onboardingDone, hasToken: Boolean(token) }), { replace: true });
      }, wait);
    };
    if (token) {
      api.auth
        .me()
        .then((r) => setUser(r.user))
        .catch((e) => {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) logout();
        })
        .finally(go);
    } else {
      go();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg px-6 text-center" role="status" aria-live="polite">
      <div className="inline-flex size-24 items-center justify-center rounded-3xl bg-primary shadow-lg">
        <svg viewBox="0 0 64 64" className="size-16" aria-hidden="true">
          <path d="M8 48 24 22l8 12 6-8 18 22Z" fill="#F4F1EA" />
          <circle cx="46" cy="16" r="5" fill="#D9822B" />
        </svg>
      </div>
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-fg">{fr.appName}</h1>
        <p className="mt-1 text-[17px] text-muted">{fr.tagline}</p>
      </div>
      <MountainArt className="w-full max-w-sm" />
      <p className="text-[13px] text-muted">{fr.splash.loading}</p>
    </div>
  );
}
