/**
 * Règles de sécurité (section 27), politique de confidentialité (section 28)
 * et attributions cartographiques.
 */
import { useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { fr } from "@mountain-live/core";
import { IconButton, SafetyNotice, TopBar } from "@/components/ui";

export default function LegalPage() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" style={{ paddingTop: "var(--safe-top)" }}>
      <TopBar
        variant="solid"
        title="Sécurité et confidentialité"
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/map"))}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="prose-ml mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-12 pt-4 text-[16px] leading-relaxed text-fg">
          <SafetyNotice variant="full" />

          <section>
            <h2 className="text-[20px] font-extrabold">Politique de confidentialité</h2>
            <p className="mt-2">
              Mountain Live (nom de projet temporaire) est conçu conformément au Règlement général sur la protection des données (RGPD). Cette page décrit, de façon synthétique, les données traitées et vos droits.
            </p>
            <h3 className="mt-4 text-[17px] font-bold">Données collectées</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Compte : adresse e-mail (jamais affichée publiquement), pseudo, pratiques, région facultative, préférences.</li>
              <li>Contributions : signalements (position, catégorie, description, photos), confirmations, commentaires, signalements de contenu.</li>
              <li>Présence anonyme : une cellule d'environ 1 km et une tranche de 5 minutes, sans identifiant, conservée 30 minutes, pour estimer la fréquentation et déclencher les alertes de proximité. Cette contribution peut être désactivée dans les paramètres.</li>
              <li>Aucun historique de déplacement n'est enregistré, ni sur nos serveurs, ni sur votre appareil.</li>
            </ul>
            <h3 className="mt-4 text-[17px] font-bold">Finalités</h3>
            <p className="mt-1">Afficher la situation en montagne en temps réel, permettre la contribution communautaire, calculer la fiabilité des informations, modérer les abus, vous alerter à proximité d'un danger.</p>
            <h3 className="mt-4 text-[17px] font-bold">Protection des personnes et des espèces</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Aucune position individuelle n'est jamais publiée : seules des estimations agrégées sont affichées.</li>
              <li>Les observations d'espèces sensibles sont floutées (position approximative dans un rayon d'environ 400 m).</li>
              <li>L'application ne comporte aucune fonction permettant de localiser des agents chargés de contrôles (gardes, agents de l'OFB ou autres agents publics).</li>
            </ul>
            <h3 className="mt-4 text-[17px] font-bold">Durées de conservation</h3>
            <p className="mt-1">Présence anonyme : 30 minutes. Signalements terminés : 90 jours puis suppression. Compte : jusqu'à sa suppression par vous.</p>
            <h3 className="mt-4 text-[17px] font-bold">Vos droits</h3>
            <p className="mt-1">Vous pouvez consulter et modifier vos données depuis votre profil, et supprimer définitivement votre compte depuis les paramètres : vos données personnelles sont alors effacées et vos contributions anonymisées. Vous pouvez également effacer à tout moment les données stockées localement sur votre appareil.</p>
          </section>

          <section>
            <h2 className="text-[20px] font-extrabold">Sources cartographiques</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">
              <li>Données © les contributeurs OpenStreetMap (ODbL).</li>
              <li>Fond topographique © OpenTopoMap (CC-BY-SA), données SRTM.</li>
              <li>Imagerie satellite : Esri World Imagery (Esri, Maxar, Earthstar Geographics et la communauté des utilisateurs SIG).</li>
              <li>Relief : AWS Terrain Tiles (Mapzen / Amazon).</li>
            </ul>
          </section>

          <p className="text-[13px] text-muted">Version pilote destinée à un territoire d'expérimentation (Corse). Les informations communautaires sont fournies sans garantie.</p>
        </div>
      </main>
    </div>
  );
}
