import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserMe } from "@mountain-live/core";

interface SessionState {
  token: string | null;
  user: UserMe | null;
  /** L'onboarding a-t-il été terminé sur cet appareil ? */
  onboardingDone: boolean;
  setSession: (token: string, user: UserMe) => void;
  setUser: (user: UserMe) => void;
  logout: () => void;
  setOnboardingDone: (v: boolean) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      onboardingDone: false,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
      setOnboardingDone: (v) => set({ onboardingDone: v }),
    }),
    { name: "ml.session" },
  ),
);

export const useIsAuthenticated = () => useSessionStore((s) => !!s.token && !!s.user);
