import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/ui/Toast";
import { useApplyTheme } from "./lib/theme";
import { NavigationEngineHost } from "./features/navigation/NavigationEngineHost";

/** Applique le thème (clair / sombre / système) dès le démarrage, y compris hors de la coquille. */
function ThemeGate() {
  useApplyTheme();
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Les toasts sont disponibles sur tous les écrans, y compris hors de la coquille (connexion, assistant). */}
      <ToastProvider>
        <ThemeGate />
        {/* Suivi GPS / navigation : continue en arrière-plan quand on quitte l'écran de navigation. */}
        <NavigationEngineHost />
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
