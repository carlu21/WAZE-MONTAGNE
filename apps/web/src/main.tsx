import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PhoneFrame } from "./components/layout/PhoneFrame";
import "./styles/index.css";
import { initServiceWorker } from "./lib/sw";
import { initNetwork } from "./features/offline/network";
import { initSync } from "./features/offline/sync";

initNetwork();
initSync();
initServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Application smartphone : sur grand écran, cadre d'iPhone + QR code pour l'ouvrir sur un vrai téléphone. */}
    <PhoneFrame>
      <App />
    </PhoneFrame>
  </React.StrictMode>,
);
