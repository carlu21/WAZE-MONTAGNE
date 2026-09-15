/**
 * Panneau « Ouvrir sur votre iPhone » (affiché à côté du cadre de téléphone) :
 * adresse de l'application sur le réseau local et QR code à scanner avec
 * l'appareil photo. L'API renvoie les adresses IP de l'ordinateur (/health).
 */
import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { api } from "@/lib/api";

export function lanUrls(lan: readonly string[], loc: Pick<Location, "protocol" | "port" | "hostname">): string[] {
  const port = loc.port || (loc.protocol === "https:" ? "443" : "80");
  const own = lan.length ? lan : [loc.hostname];
  return own.map((ip) => `${loc.protocol}//${ip}${port === "443" || port === "80" ? "" : `:${port}`}`);
}

export function OpenOnPhone() {
  // Rendu hors du fournisseur de requêtes de l'application (le cadre l'entoure) : appel direct.
  const [lan, setLan] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled) setLan(h.lan ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const urls = lan ? lanUrls(lan, window.location) : [];
  const url = urls[0] ?? null;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    toDataURL(url, { margin: 1, width: 196, color: { dark: "#14351B", light: "#FFFFFF" } })
      .then((d) => {
        if (!cancelled) setQr(d);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const secure = typeof window !== "undefined" && window.location.protocol === "https:";

  return (
    <aside className="ml-phone-aside" aria-label="Ouvrir sur votre iPhone">
      <h2>Ouvrir sur votre iPhone</h2>
      {url ? (
        <>
          {qr ? <img src={qr} width={196} height={196} alt={`QR code : ${url}`} /> : null}
          <p className="ml-phone-url">{url}</p>
          {urls.length > 1 ? <p className="ml-phone-alt">Autres adresses : {urls.slice(1).join(" · ")}</p> : null}
        </>
      ) : (
        <p className="ml-phone-alt">{!failed && lan === null ? "Recherche de l'adresse réseau…" : "Adresse réseau indisponible : lancez l'application avec « Lancer Mountain Live.command »."}</p>
      )}
      <ol>
        <li>iPhone et ordinateur sur le même Wi-Fi.</li>
        <li>Scannez le QR code avec l'appareil photo, ou tapez l'adresse dans Safari.</li>
        {secure ? <li>Avertissement de certificat la première fois : « Afficher les détails » puis « visiter ce site web ».</li> : <li>Le GPS et la boussole exigent HTTPS : lancez l'application avec le lanceur (HTTPS activé).</li>}
        <li>Partager → « Sur l'écran d'accueil » pour l'installer comme une application.</li>
      </ol>
      <p className="ml-phone-alt">Cette prévisualisation reproduit un iPhone (390 × 844) : ajoutez <code>?frame=0</code> à l'adresse pour l'afficher en plein écran.</p>
    </aside>
  );
}
