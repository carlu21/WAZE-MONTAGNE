# Mobile : PWA aujourd'hui, application native demain

## Installer la PWA

- **Android (Chrome)** : menu ⋮ → « Installer l'application » (ou bannière automatique). L'application s'ouvre en plein écran, en orientation portrait, avec l'icône Mountain Live.
- **iOS (Safari)** : Partager → « Sur l'écran d'accueil ». Le service worker, la géolocalisation et la caméra fonctionnent ; les notifications système nécessitent iOS 16.4+ et l'installation sur l'écran d'accueil.
- Le site doit être servi en **HTTPS** (géolocalisation, caméra, service worker).

## Permissions et usage en extérieur

| Sujet | Mise en œuvre |
| --- | --- |
| Localisation | demandée après explication (onboarding), `watchPosition` haute précision limité à une mise à jour toutes les 5 s ; jamais publiée individuellement |
| Caméra | `input capture="environment"`, redimensionnement à 1600 px / JPEG 0,8 avant envoi (économie de données) |
| Batterie | rafraîchissement des données toutes les 60 s seulement, présence toutes les 5 min, alertes calculées localement toutes les 20 s ou après 50 m |
| Gants / soleil / pluie | cibles ≥ 48 px (56–64 px pour les actions principales), contraste AA, texte 16–17 px, une main, mode sombre |
| Réseau faible | cache network-first de l'API, zones hors connexion, file d'attente des actions |

## Passer en application native avec Capacitor

Le code web est réutilisé tel quel ; Capacitor l'emballe dans une WebView native et expose les API système.

1. Dans `apps/web` : `pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android` puis `npx cap init "Mountain Live" "fr.mountainlive.app" --web-dir dist`.
2. Construire : `pnpm build`, puis `npx cap add ios` / `npx cap add android` et `npx cap sync`.
3. Plugins recommandés : `@capacitor/geolocation` (permissions natives, précision), `@capacitor/camera` (photo plein format, galerie), `@capacitor/filesystem` (zones hors connexion volumineuses), `@capacitor/push-notifications` (alertes), `@capacitor/haptics` (vibration à l'alerte), `@capacitor/status-bar` / `splash-screen`.
4. Adapter les points d'entrée : dans `features/map/useGeolocation.ts` et `features/report/useReportPosition.ts`, remplacer `navigator.geolocation` par `Geolocation` de Capacitor lorsque `Capacitor.isNativePlatform()` ; dans `features/report/PhotoField.tsx`, proposer `Camera.getPhoto`.
5. Servir l'API en HTTPS et renseigner `VITE_API_URL` (le proxy Vite n'existe qu'en développement) ; ajouter l'origine `capacitor://localhost` / `https://localhost` à `CORS_ORIGINS`.
6. Icônes et écrans de démarrage : générer depuis `public/icons/icon-512.png` (`@capacitor/assets`).

Aucune de ces étapes ne modifie la logique métier : `packages/core` et les écrans restent identiques entre web, PWA et natif.
