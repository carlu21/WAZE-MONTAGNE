import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/ui/Toast";
import { useApplyTheme } from "./lib/theme";

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
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
