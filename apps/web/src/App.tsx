import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/ui/Toast";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Les toasts sont disponibles sur tous les écrans, y compris hors de la coquille (connexion, assistant). */}
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
