import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fr, type PreferencesInput, type UpdateMeInput, type UserMe } from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { toast } from "@/components/ui";

/** Profil courant : session locale rafraîchie par l'API. */
export function useMe() {
  const token = useSessionStore((s) => s.token);
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const query = useQuery({
    queryKey: qk.me,
    enabled: Boolean(token),
    staleTime: 60_000,
    queryFn: async () => {
      const r = await api.auth.me();
      setUser(r.user);
      return r.user;
    },
    initialData: user ?? undefined,
  });
  return { user: query.data ?? user, isLoading: query.isLoading, refetch: query.refetch };
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  const setUser = useSessionStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.users.updateMe(input),
    onSuccess: ({ user }) => {
      setUser(user);
      queryClient.setQueryData(qk.me, user);
      toast.success(fr.profilePage.saved);
    },
    onError: (e) => toast.warning(e instanceof ApiError ? (e.code === "pseudo_taken" ? fr.auth.errors.pseudoTaken : e.message) : fr.errors.network),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  const setUser = useSessionStore((s) => s.setUser);
  const ui = useUiStore();
  return useMutation({
    mutationFn: (prefs: PreferencesInput) => api.users.updatePreferences(prefs),
    onSuccess: ({ user }: { user: UserMe }) => {
      setUser(user);
      queryClient.setQueryData(qk.me, user);
      // Les préférences serveur pilotent l'interface locale.
      ui.setFilters(user.preferences.filters);
      ui.setShowOfficialOnly(user.preferences.showOfficialOnly);
      ui.setBasemap(user.preferences.basemap);
      ui.setTheme(user.preferences.theme);
      toast.success(fr.profilePage.saved);
    },
    onError: (e) => toast.warning(e instanceof ApiError ? e.message : fr.errors.network),
  });
}
