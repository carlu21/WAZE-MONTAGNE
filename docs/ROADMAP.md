# Feuille de route

## Livré (MVP — section 29)

1. inscription / connexion · 2. onboarding · 3. carte · 4. géolocalisation · 5. signalements · 6. catégories · 7. photos · 8. confirmation communautaire · 9. expiration automatique · 10. filtres · 11. alertes simples · 12. profil · 13. hors connexion basique · 14. back-office de modération — plus Explorer, Autour de moi, notifications in-app, communauté, tableau de bord professionnel (version pilote).

## Prochaines étapes (par priorité)

1. **Pilote terrain en Corse** : recueil des retours des randonneurs, bergers, sociétés de chasse, communes ; ajustement des durées de vie et des seuils de confiance à partir des données réelles.
2. **Itinéraires (section 13)** : sélection départ/arrivée sur les sentiers de référence, distance, dénivelé, profil altimétrique, difficulté par pratique ; « 3 signalements présents sur votre itinéraire » (`distanceToPolylineM` existe déjà) ; alertes `new_danger_on_route` sur itinéraires enregistrés.
3. **Notifications push** (Web Push puis natif) pour les types déjà définis, avec les préférences existantes.
4. **Import de données officielles / partenaires** : arrêtés préfectoraux (risque incendie), fermetures de sentiers, calendriers de battues ; comptes organisation multi-utilisateurs. (Le référentiel toponymique GeoNames et le géocodage IGN sont déjà intégrés à la recherche de lieux.)
5. **Application native** via Capacitor (voir [MOBILE.md](MOBILE.md)) : stores iOS / Android, géolocalisation en arrière-plan pour les alertes, photos plein format.
6. **Offre B2B** : tableau de bord multi-secteurs, historique long, exports planifiés, API partenaire, SLA de résolution.
7. **Cartographie** : tuiles vectorielles auto-hébergées (moins de dépendance aux services tiers), cache hors connexion des courbes de niveau, sentiers vectoriels avec praticabilité par pratique.
8. **Qualité de la donnée** : détection de doublons à la publication (même sous-type à < 100 m), regroupement automatique, modération assistée.
9. **Internationalisation** : extraction des chaînes (`core/i18n.ts` est déjà centralisé), corse et anglais en priorité, puis autres massifs et pays.
10. **Accessibilité renforcée** : audit lecteur d'écran, contrastes en plein soleil (mode haute visibilité), commandes vocales.

## Volontairement exclu

Réseau social, messagerie privée, marketplace, réservations, fonctions commerciales complexes (section 29).
