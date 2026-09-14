import { describe, expect, it } from "vitest";
import { filterLabel, fr, interpolate, phrases, t, type TranslationKey } from "./i18n";

function leaves(node: unknown, path = ""): { path: string; value: string }[] {
  if (typeof node === "string") return [{ path, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (typeof node === "object" && node !== null) {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("fr — contenu", () => {
  it("conserve les clés historiques", () => {
    expect(fr.appName).toBe("Mountain Live");
    expect(fr.map).toBe("Carte");
    expect(fr.explore).toBe("Explorer");
    expect(fr.report).toBe("Signaler");
    expect(fr.community).toBe("Communauté");
    expect(fr.profile).toBe("Profil");
  });
  it("navigation (section 3)", () => {
    expect([fr.nav.map, fr.nav.explore, fr.nav.report, fr.nav.community, fr.nav.profile]).toEqual([
      "Carte",
      "Explorer",
      "Signaler",
      "Communauté",
      "Profil",
    ]);
  });
  it("onboarding : les trois écrans exacts (section 21)", () => {
    expect(fr.onboarding.slide1).toBe("La montagne en temps réel.");
    expect(fr.onboarding.slide2).toBe("Découvrez les dangers, activités et conditions autour de vous.");
    expect(fr.onboarding.slide3).toBe("Signalez ce que vous rencontrez et aidez les autres usagers.");
  });
  it("assistant de signalement", () => {
    expect(fr.wizard.title).toBe("Que souhaitez-vous signaler ?");
  });
  it("filtres (section 11)", () => {
    expect([
      fr.filters.all,
      fr.filters.danger,
      fr.filters.hunting,
      fr.filters.animals,
      fr.filters.path,
      fr.filters.water,
      fr.filters.activity,
      fr.filters.crowd,
      fr.filters.official,
    ]).toEqual(["Tout afficher", "Dangers", "Chasse", "Animaux", "Chemins", "Eau", "Activités", "Fréquentation", "Informations officielles"]);
    expect(filterLabel("water")).toBe("Eau");
    expect(filterLabel("all")).toBe("Tout afficher");
  });
  it("hors connexion (section 9)", () => {
    expect(fr.offline.mode).toBe("Mode hors connexion");
    expect(fr.offline.synced).toBe("Synchronisation effectuée");
    expect(fr.offline.download).toBe("Télécharger cette zone");
  });
  it("règles de sécurité (section 27)", () => {
    expect(fr.safetyNotice.rules).toHaveLength(5);
    expect(fr.safetyNotice.priority).toBe("Les alertes officielles ont toujours priorité.");
    expect(fr.safetyNotice.rules[1]).toBe("L'absence de signalement ne signifie pas l'absence de danger.");
  });
  it("les boutons de confirmation reprennent la taxonomie", () => {
    expect(fr.confirmations.stillPresent).toBe("Toujours présent");
    expect(fr.confirmations.improved).toBe("Situation améliorée");
    expect(fr.confirmations.gone).toBe("Plus présent");
  });
  it("couvre tous les types de notification et motifs de signalement", () => {
    expect(Object.keys(fr.notifications.types)).toHaveLength(8);
    expect(Object.keys(fr.moderation.reasons)).toHaveLength(6);
    expect(Object.keys(fr.profilePage.basemaps)).toEqual(["topo", "satellite", "classic", "relief"]);
  });
  it("aucune chaîne vide ni placeholder", () => {
    const all = leaves(fr);
    expect(all.length).toBeGreaterThan(200);
    for (const { path, value } of all) {
      expect(value.trim(), path).not.toBe("");
      expect(value.toLowerCase(), path).not.toMatch(/lorem|todo|tbd|xxx/);
    }
  });
});

describe("t / interpolate", () => {
  it("résout une clé et interpole", () => {
    expect(t("offline.mode")).toBe("Mode hors connexion");
    expect(t("sheet.distance", { distance: "320 m" })).toBe("À 320 m");
    expect(t("sheet.actions.confirm")).toBe("Confirmer");
    expect(t("notifications.types.new_battue_nearby")).toBe("Nouvelle battue à proximité");
  });
  it("renvoie la clé pour une clé inconnue et laisse les gabarits sans valeur", () => {
    expect(t("inconnu.cle" as TranslationKey)).toBe("inconnu.cle");
    expect(t("safetyNotice" as TranslationKey)).toBe("safetyNotice");
    expect(interpolate("Bonjour {nom}, {autre}", { nom: "Ana" })).toBe("Bonjour Ana, {autre}");
    expect(interpolate("Sans variable")).toBe("Sans variable");
  });
});

describe("phrases", () => {
  const NOW = new Date("2026-09-14T12:00:00.000Z");
  it("confirmations et récence (section 6)", () => {
    expect(phrases.confirmedBy(8)).toBe("Confirmé par 8 utilisateurs");
    expect(phrases.confirmedBy(1)).toBe("Confirmé par 1 utilisateur");
    expect(phrases.confirmedBy(0)).toBe("Pas encore confirmé");
    expect(phrases.reportedAgo(new Date(NOW.getTime() - 35 * 60_000), NOW)).toBe("Signalé il y a 35 min");
    expect(phrases.lastConfirmation(new Date(NOW.getTime() - 12 * 60_000), NOW)).toBe("Dernière confirmation il y a 12 min");
  });
  it("autour de moi et alertes (sections 12 et 24)", () => {
    expect(phrases.aroundItem(650, "Troupeau")).toBe("À 650 m : Troupeau");
    expect(phrases.aroundItem(1200, "Battue")).toBe("À 1,2 km : Battue");
    expect(phrases.proximityAlert("Battue", 600, "onRoute")).toBe("Attention : Battue à 600 m sur votre itinéraire.");
    expect(phrases.proximityAlert("Arbre tombé", 300)).toBe("Arbre tombé à 300 m.");
    expect(phrases.proximityAlert("Troupeau et chiens de protection", 400, "ahead")).toBe("Troupeau et chiens de protection dans 400 m.");
  });
  it("présence, itinéraires, synchronisation", () => {
    expect(phrases.activeUsers(12)).toBe("Environ 12 utilisateurs actifs dans cette zone");
    expect(phrases.activeUsers(1)).toBe("Fréquentation faible dans cette zone");
    expect(phrases.reportsOnRoute(3)).toBe("3 signalements présents sur votre itinéraire");
    expect(phrases.reportsOnRoute(1)).toBe("1 signalement présent sur votre itinéraire");
    expect(phrases.reportsOnRoute(0)).toBe("Aucun signalement sur votre itinéraire");
    expect(phrases.pendingSync(1)).toBe("1 action en attente d'envoi");
    expect(phrases.pendingSync(4)).toBe("4 actions en attente d'envoi");
    expect(phrases.cluster(12)).toBe("12 signalements");
  });
});
