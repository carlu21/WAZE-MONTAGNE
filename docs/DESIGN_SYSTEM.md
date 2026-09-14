# Design system — Mountain Live

Référence du système de composants de `apps/web` (sections 3, 19, 20 et 31 du cahier des charges).
Tout est exporté depuis `@/components/ui` (`apps/web/src/components/ui/index.ts`).

## 1. Principes

| Principe | Traduction concrète |
| --- | --- |
| **Carte prioritaire** | La coquille ne réserve que la barre de navigation ; les surcouches (barre haute, boutons, feuille basse) sont translucides et floutées (`.glass`, `.glass-strong`). |
| **Usage extérieur** (gants, soleil, pluie, mouvement) | Cibles tactiles ≥ 48 px, 56 px pour les actions principales, bouton flottant 64 px ; base 16 px, boutons 17 px ; contraste AA ; pas d'état signalé par la couleur seule. |
| **Une main** | Actions principales en bas (barre, Fab, feuille basse, modales montant du bas sur mobile). |
| **Compréhension en quelques secondes** | Une couleur par catégorie, icône lucide par sous-type, libellés français courts issus de `@mountain-live/core` (taxonomie, `fr`). |
| **Rouge = danger uniquement** | `--danger` sert aux alertes importantes, au niveau « Critique » et aux actions destructrices. L'action principale « Signaler » et les avertissements sont **orange sécurité** (`--accent`). |
| **Mode sombre complet** | Tous les tokens sémantiques changent avec `html[data-theme]` ; aucun composant n'utilise de variante `dark:`. |

## 2. Tokens (`src/styles/tokens.css`)

Trois niveaux : palette brute (`@theme --color-*`), tokens sémantiques (`:root --bg`, `--fg`, `--primary`…), exposition Tailwind (`@theme inline` : `bg-surface`, `text-muted`, `border-line`, `bg-primary`, `text-danger`, `shadow-md`…).

### Palette

| Rôle | Clair | Sombre | Token |
| --- | --- | --- | --- |
| Vert forêt (marque, actif) | `#1F4D28` | `#4F8A5B` | `--primary` |
| Vert profond (survol) | `#14351B` | `#5E9C6A` | `--primary-hover` |
| Vert (succès, anneau de focus) | `#2F6B3A` | `#5E9C6A` | `--success`, `--ring` |
| Beige naturel (fond) | `#F4F1EA` | `#0F1613` | `--bg` |
| Blanc cassé (surfaces) | `#F9F7F1` / `#FFFFFF` | `#17211C` | `--surface-2` / `--surface` |
| Gris roche (texte secondaire) | `#5B6B7A` | `#A9B3AC` | `--fg-muted` |
| Orange sécurité (Signaler, avertissement) | `#D9822B` | `#E8944A` | `--accent`, `--warning` |
| Rouge danger (alertes importantes) | `#C8341F` | `#E0533D` | `--danger` |
| Bleu eau | `#1D6FA5` | `#4A93C7` | `--water`, `--info` |
| Or (source officielle) | `#C9A227` | `#D9B546` | `--gold` |

Couleurs de catégorie (`CATEGORIES[].colorVar`) : `--c-danger`, `--c-path`, `--c-activity`, `--c-animals`, `--c-water`, `--c-crowd`, `--c-official`. Sur la carte, `CATEGORY_COLORS` (markers.ts) reprend les hex fixes de la taxonomie, quel que soit le thème.

### Dimensions et rythme

- Rayons : boutons `rounded-lg` (14 px), champs 14 px, cartes `rounded-xl` (20 px), feuilles/modales `rounded-2xl`/`rounded-3xl` (24–28 px), puces `rounded-full`.
- Tailles : `--touch` 48 px, `--touch-lg` 56 px, `--fab-size` 64 px, `--nav-height` 64 px, `--topbar-height` 56 px, `--sidebar-width` 88 px.
- Zones sûres : `--safe-top/bottom/left/right` ; encombrement de la coquille `--shell-bottom`, `--shell-left` (mis à jour par `AppShell` sur `<html>` ; utilisés par BottomSheet et les toasts).
- Plans : `--z-map` 0 < `--z-overlay` 10 < `--z-sheet` 20 < `--z-nav` 30 < `--z-drawer` 40 < `--z-modal` 50 < `--z-toast` 60.
- Mouvement : `--dur-fast` 120 ms, `--dur` 200 ms, `--dur-slow` 320 ms, `--ease` ; animations `.anim-fade-in`, `.anim-slide-up`, `.anim-scale-in` ; tout est neutralisé sous `prefers-reduced-motion`.

### Thème

`src/lib/theme.ts` : la préférence vit dans `useUiStore().theme` (`light | dark | system`, type `ThemePreference` ; thème effectif `ResolvedTheme`). `useApplyTheme()` (monté une fois dans `AppShell`) écrit `data-theme` sur `<html>`, `color-scheme` et `meta[name=theme-color]` (`THEME_COLOR`), et suit `matchMedia("(prefers-color-scheme: dark)")` en mode « system ». Avant le premier rendu, `tokens.css` suit le système via `:root:not([data-theme])`. Utilitaires : `resolveTheme(pref, prefersDark?)`, `applyTheme(pref)`, `initTheme()`, `systemPrefersDark()`, `useSystemPrefersDark()`, `useResolvedTheme()`, `nextThemePreference(pref)` (cycle clair → sombre → système), `THEME_LABELS`.

## 3. Composants

Tous acceptent `className`. Les props sont typées (`*Props` exportées).

### Actions

| Composant | Props principales | Notes |
| --- | --- | --- |
| `Button` | `variant` primary/secondary/ghost/danger/outline · `size` md 48 / lg 56 / xl 64 · `loading`, `loadingLabel` · `leftIcon`, `rightIcon` · `fullWidth` | `type="button"` par défaut, `aria-busy` en chargement. `LinkButton` = même habillage pour un `<Link>`. `buttonClasses()` pour un `<label>`. |
| `IconButton` | `aria-label` **obligatoire** · `size` 44/52 · `variant` solid/glass/ghost/outline/primary/danger · `pressed` (aria-pressed) · `shape` square/round · `loading` | `glass` pour les boutons posés sur la carte. |
| `Fab` | `to` (lien) ou `onClick` · `label` (défaut « Signaler ») · `tone` safety/forest · `extended` · `halo` · `icon` | 64 px, orange sécurité, halo pulsant. |

```tsx
<Button size="lg" fullWidth loading={isPending} loadingLabel="Publication…" onClick={publish}>Publier</Button>
<IconButton aria-label="Me localiser" variant="glass" size={52}><LocateFixed /></IconButton>
<Fab to="/report" />
```

### Surcouches

| Composant | Props principales |
| --- | --- |
| `BottomSheet` | `open`, `onClose` · `snap`/`defaultSnap`/`onSnapChange` (peek/half/full, `SHEET_SNAPS`) · `snapPoints`, `snaps` · `title`, `subtitle`, `header`, `footer` · `backdrop` none/full/always · `dismissible`, `showClose` · `contentClassName`, `aria-label`, `id` — poignée glissable, Échap, flèches clavier, `role="dialog"`, positionnée au-dessus de la barre (`--shell-bottom`). |
| `Modal` | `open`, `onClose`, `title`, `description`, `footer`, `size` sm/md/lg, `tone` default/danger, `dismissible`, `showClose`, `aria-label`, `initialFocusRef` — monte du bas sur mobile, centrée dès 640 px, piège de focus. |
| `Drawer` | `open`, `onClose`, `side` left/right, `title`, `footer`, `width` (défaut min(360px, 88vw)), `dismissible`, `showClose`, `aria-label`. |
| `TopBar` | `variant` overlay/solid · `title`, `subtitle`, `leading`, `actions` · `searchTo`/`onSearchClick`, `searchValue`, `searchPlaceholder` · `children` (rangée de puces défilable). |
| `SearchField` | `value`, `onChange(value)`, `onSubmit`, `onClear`, `onCancel` (bouton « Annuler »), `loading`, `size` md/lg + attributs natifs. |

### Formulaires

| Composant | Props principales |
| --- | --- |
| `Field` | `label`, `hint`, `error` (role=alert), `required`, `optional`, `disabled`, `id`, `labelEnd` — fournit id / aria-describedby / aria-invalid aux contrôles enfants via `FieldContext` ; un contrôle personnalisé appelle `useFieldControl(props)` pour hériter des mêmes attributs. |
| `Input` | `size` md/lg, `leftIcon`, `rightSlot`, `invalid`, `wrapperClassName` + attributs natifs. `INPUT_CLASSES` expose l'habillage pour un contrôle maison. |
| `Textarea` | `autoResize` (défaut true), `maxRows` (8), `maxLength` (+ compteur `showCount`, défaut true), `invalid` + attributs natifs. |
| `Select` | `options` `{value,label,disabled?}` ou `children`, `placeholder` (première option vide), `size`, `invalid`, `wrapperClassName`. |
| `Slider` | `value`, `onChange`, `min`, `max`, `step`, `label`, `formatValue`, `marks` `{value,label}`, `hideValue` — pouce 28 px. |
| `Toggle` | `checked`, `onChange(boolean)`, `label`, `description`, `icon` (ligne 56 px) ou `aria-label` seul (interrupteur nu), `disabled`, `id`, `name` — `role="switch"`. |
| `Segmented` | `options` `{value,label,icon,disabled,aria-label}`, `value`, `onChange`, `size`, `fullWidth` (défaut true), `disabled`, `aria-label`/`aria-labelledby` — radiogroup, flèches clavier. |
| `Chip` | `selected` (aria-pressed), `icon` (nœud ou nom lucide), `category` (icône + couleur), `color`, `count`, `onRemove` + `removeLabel`, `size` md 48 / lg 56. |

```tsx
<Field label="Commentaire" optional hint="Précisez ce que vous avez vu">
  <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
</Field>
<Chip category="danger" selected={filters.includes("danger")} onClick={() => toggle("danger")}>Dangers</Chip>
<Slider label="Rayon d'alerte" min={200} max={2000} step={100} value={r} onChange={setR} formatValue={formatDistance} />
```

### Contenu et données

| Composant | Props principales |
| --- | --- |
| `Card`, `CardHeader` | `tone` default/glass/outline/soft, `padding` none/sm/md/lg, `to` (lien), `onClick` (bouton), `accentColor`, `chevron`, `as` div/section/article/li. `CardHeader` : `title`, `subtitle`, `icon`, `actions`. Ne pas imbriquer d'éléments interactifs dans une carte cliquable. |
| `ListItem` | `icon`, `iconColor`, `title`, `subtitle`, `trailing`, `to`/`onClick`, `chevron`, `active`, `disabled`, `divider`, `as` div/li. |
| `Badge` | `tone` neutral/primary/accent/danger/success/info/gold/water, `color`, `size`, `solid`, `icon`. |
| `SourceBadge` | `source` official/partner/community (badge-check or / shield vert / users gris), `long`. |
| `ConfidenceBadge` | `label` low/probable/confirmed/high (libellés et couleurs `CONFIDENCE_LABELS`), `score`. |
| `DangerPill` | `level` low/moderate/high/critical (`DANGER_LEVELS`) ; « Critique » en fond plein rouge. |
| `StatusPill` | `status` (`STATUS_LABELS`). |
| `CategoryIcon` | `name` (kebab-case lucide) ou `subtype` ou `category`, `size`, `label` (sinon décorative). `iconNameFor({ name, subtype, category })` donne le nom retenu (priorité name > subtype > category). |
| `CategoryTile` | `category`, `selected`, `to`, `compact` — icône 32 px, libellé, description, couleur de catégorie. |
| `SubtypeTile` | `subtype`, `selected`, `to`, `hint`, `layout` row/column. |
| `Avatar` | `name`, `src`, `size` 32/40/48/64/96, `role` (liseré or / vert). Initiales sur fond déterministe (`avatarColor(name)`, palette `AVATAR_COLORS`). |
| `BadgeIcon` | `id` (BADGES), `size`, `earned`, `showLabel`, `showDescription`. |
| `Stat` | `value`, `label`, `icon`, `tone`, `size`, `align`. |
| `ReliabilityLevel` | `level` (ramené dans 1..5 par `clampLevel`, jamais négatif ; `RELIABILITY_MAX` = 5), `size` sm/md/lg, `showLabel`. |
| `RelativeTime` | `date`, `prefix`, `intervalMs` (30 s), `fallback` — `formatRelative` de core, `<time dateTime>`. |
| `Distance` | `meters`, `withPrefix` (« À 320 m »), `fallback`. |

### Retours et états

| Composant | Props principales |
| --- | --- |
| `Banner` | `tone` info/warning/danger/success, `title`, `action`, `onDismiss` (+ `dismissLabel`), `compact`, `icon`. |
| `ToastProvider` / `useToast()` / `toast` | API impérative (`@/lib/toast`, utilisable hors React) : `toast.show(opts) → id`, `toast.info/success/warning/danger(texte \| opts)`, `toast.alert({ title, action: { label: "Voir", onClick } })` (persistant, tonalité warning), `toast.update(id, patch)`, `toast.dismiss(id)`, `toast.clear()`. Options : `id` (remplace le toast existant), `title`, `description`, `tone`, `duration` (ms, 0/null = persistant, défauts `TOAST_DURATIONS`), `action`, `dismissible`, `icon`, `assertive`. `TOAST_MAX` = 4 empilés (les plus anciens non persistants sont évincés), pause au survol, positionnés au-dessus de la barre. `useToasts()` (liste réactive) et `ToastViewport` (portail) servent au provider, monté une fois dans `App.tsx`. |
| `EmptyState` | `icon`, `title`, `description`, `action`, `compact`. |
| `Skeleton`, `SkeletonText`, `SkeletonListItem`, `SkeletonGroup` | `width`, `height` (16), `circle`, `style` ; `lines` (3) ; groupe annoncé « Chargement… » (`label`, role=status). |
| `PageLoader` | `label`, `fullscreen`. |
| `Divider` | `orientation` horizontal/vertical, `label`, `spacing` none/sm/md/lg. |
| `SafetyNotice` | `variant` compact (dépliable, `defaultOpen`) / full, `onAccept`, `acceptLabel`, `children` (lien vers la page légale…) — règles de `fr.safetyNotice` (section 27). |

### Utilitaires et hooks (exportés par `@/components/ui`)

| Export | Rôle |
| --- | --- |
| `cn(...classes)` | Concaténation de classes (chaînes, tableaux, objets `{ classe: booléen }`). |
| `useEscapeKey(active, onEscape)` | Ferme une surcouche sur Échap. |
| `useLockBodyScroll(active)` | Bloque le défilement de la page (réentrant : modales imbriquées). |
| `useFocusTrap(ref, active, { initialFocus, restoreFocus })` | Piège de focus clavier des modales et tiroirs. |
| `useMediaQuery(query)`, `useIsDesktop()`, `DESKTOP_QUERY` | Suivi d'une media query ; point de rupture 1024 px de la coquille. |
| `usePrefersReducedMotion()` | Respect de `prefers-reduced-motion`. |
| `useNow(intervalMs = 30 000, enabled)` | Horloge partagée (dates relatives, comptes à rebours), rafraîchie au retour au premier plan. |
| `buttonClasses({ variant, size, fullWidth })`, `INPUT_CLASSES` | Habillage bouton / champ pour un élément natif (`<label>`, `<a>`, contrôle maison). |
| `FieldContext`, `useFieldControl(props)` | Héritage id / aria-describedby / aria-invalid / required / disabled d'un `Field`. |
| `SHEET_SNAPS` | `["peek", "half", "full"]`. |
| `iconNameFor(props)` | Nom d'icône retenu par `CategoryIcon`. |
| `avatarColor(name)`, `AVATAR_COLORS` | Fond déterministe des initiales. |
| `clampLevel(n)`, `RELIABILITY_MAX` | Niveau de fiabilité ramené dans 1..5. |
| `toast`, `useToasts()`, `ToastViewport`, `TOAST_DURATIONS`, `TOAST_MAX` | Voir « Retours et états ». |
| `resolveLucideIcon`, `resolveLucideIconName`, `findLucideIcon`, `hasLucideIcon`, `kebabToPascal`, `ICON_ALIASES`, `FALLBACK_ICON` | Voir « Iconographie ». Types `LucideIcon`, `LucideProps` ré-exportés. |

### Coquille (`src/components/layout/AppShell.tsx`)

- Mobile : contenu (`<main id="main">`, hauteur restante, défilement interne) + barre basse 5 entrées : Carte `/map`, Explorer `/explore`, **Signaler** (Fab → `/report`), Communauté `/community`, Profil `/profile` (icônes map, compass, plus, users, user-round). Actif = `aria-current="page"` (`/around` et `/reports/*` activent « Carte » ; `/notifications` et `/offline` activent « Profil »).
- ≥ 1024 px (`useIsDesktop`) : barre latérale gauche de 88 px avec les mêmes entrées.
- Badge orange du nombre de notifications non lues sur « Profil » (`useQuery(qk.notifications)` seulement si connecté, rafraîchi toutes les 60 s).
- Monte `useApplyTheme()`, `<OfflineBanner />` au-dessus du contenu, `<AlertsWatcher />` une fois, le lien d'évitement « Aller au contenu ».
- Écrit `--shell-bottom` / `--shell-left` sur `<html>` ; les pages qui défilent n'ont rien à prévoir (la barre n'est pas superposée au contenu). `.shell-pb` reste disponible pour un contenu fixe.

## 4. Grille tactile

| Élément | Taille |
| --- | --- |
| Bouton standard, puce, champ, ligne de liste, IconButton | ≥ 48 px |
| Action principale d'écran (Publier, Confirmer, J'ai compris), champ « lg » | 56 px |
| Fab « + Signaler », bouton xl | 64 px |
| Tuile de catégorie | ≥ 88 px de haut, icône 32 px |
| Pouce de curseur | 28 px, piste 48 px de haut |
| Espacement entre cibles | ≥ 8 px |

## 5. Iconographie

- Icônes lucide, trait 2 (2,25–2,5 pour les tuiles et l'entrée active), toujours `aria-hidden` sauf `label`.
- Résolution dynamique (`src/components/ui/icons.ts`) : nom kebab-case de la taxonomie → PascalCase (`kebabToPascal`) → export lucide ; alias puis repli `FALLBACK_ICON` (« map-pin »). `resolveLucideIcon(name)` renvoie toujours un composant, `resolveLucideIconName(name)` le nom effectif (utile pour les tests et les images de carte), `findLucideIcon(name)` / `hasLucideIcon(name)` sans repli.
- Alias (`ICON_ALIASES`) : **`horse` → `magnet`** (fer à cheval, proxy équestre : lucide n'a pas de cheval), `cow`/`boar`/`panda` → proxies animaux, anciens noms lucide (`alert-triangle` → `triangle-alert`, `alert-octagon` → `octagon-alert`, `alert-circle` → `circle-alert`, `home` → `house`, `loader-2` → `loader-circle`, `filter` → `funnel`…). Le test `CategoryIcon.test.tsx` parcourt toutes les icônes de `CATEGORIES`, `SUBTYPES`, `PRACTICES`, `BADGES` et `CONFIRMATION_KINDS` et échoue si l'une d'elles tombe sur le repli.
- Marqueurs de carte (`src/components/map/markers.ts`, hors index `ui`) : `buildMarkerSvg({ icon, color, size, official, faded, selected, shape })` (goutte 36 px, ancre `bottom`, icône blanche rendue via `renderToStaticMarkup`), `svgToDataUri(svg)`, `markerImageId(subtype, variant)`, `categoryMarkerImageId(category, variant)`, `markerVariantFor(source, selected)`, `markerAppearance(subtype)` → `{ icon, color }`, `categoryColor(category)`, `allMarkerSpecs()`, `loadSvgImage(svg, pixelRatio)`, `loadMarkerImages(map, pixelRatio = 2)` (idempotent, 156 images). Constantes : `CATEGORY_COLORS`, `OFFICIAL_RING_COLOR`, `SELECTED_RING_COLOR`, `MARKER_STROKE_COLOR`, `MARKER_SIZE` 36, `MARKER_SIZE_SELECTED` 46, `MARKER_ANCHOR`, `PIN_ASPECT` 1,2, `MARKER_VARIANTS` (types `MarkerVariant`, `MarkerShape`). Couches : `CLUSTER_SOURCE_OPTIONS` (rayon 48, zoom max 13), `CLUSTER_RADIUS_STEPS`, `clusterStyle`, `CLUSTER_CIRCLE_PAINT`, `CLUSTER_TEXT_LAYOUT`, `CLUSTER_TEXT_PAINT`, `REPORT_SYMBOL_LAYOUT` (`icon-image: ["get", "markerImage"]`, tri par `priority`), `REPORT_SYMBOL_PAINT` (`icon-opacity: ["get", "fade"]`). Variantes : `default`, `official` (liseré et point or), `selected` (46 px, liseré vert profond). L'estompage des signalements anciens passe par `fade`.
- Icônes PWA : `public/icons/icon-192.png`, `icon-512.png` générées par `node apps/web/scripts/generate-icons.mjs` (encodeur PNG sans dépendance, fond vert forêt, montagne beige, soleil orange, plein cadre pour les masques iOS/maskable).

## 6. Formatage (`src/lib/format.ts`)

`formatRelative(date, { now, style, addSuffix })` (court = core : « il y a 35 min »), `formatDateTime` (« aujourd'hui à 18 h 05 »), `formatDate`, `formatDistance` (ré-export core), `formatCount(8, "utilisateur")`, `pluralize`, `formatNumber`, `formatBadgeCount` (« 99+ »), `formatPercent`, `formatElevation`, `initials`. Ré-exports core : `formatTime`, `formatUntil`, `formatDuration`, `formatTtl`.

## 7. Règles d'écriture

- Chaînes visibles en français, sans jargon ; réutiliser `fr` et la taxonomie de `@mountain-live/core`.
- Jamais de rouge pour un état neutre ; jamais de score de réputation brut (`ReliabilityLevel` seulement).
- Pas de `dark:` : utiliser les tokens. Pas de couleur codée en dur dans les composants, sauf sur la carte (`markers.ts`).
- Chaque bouton fait quelque chose ; pas d'espace réservé.

## 8. Intégration (`App.tsx`, `main.tsx`, Vite, PWA)

- `main.tsx` monte `<App />` en `StrictMode` ; `App.tsx` empile `QueryClientProvider` → `ToastProvider` → `RouterProvider`. Le provider de toasts entoure le routeur : `toast.*` fonctionne sur tous les écrans, y compris hors coquille (splash, onboarding, connexion, assistant de signalement).
- `router.tsx` : la coquille (`AppShell` + `Outlet`) enveloppe `/map`, `/explore`, `/explore/:areaId`, `/around`, `/community`, `/reports/:id`, `/profile*`, `/notifications`, `/offline` ; `/report`, `/flag/:reportId`, `/admin/*`, `/pro/*`, l'authentification et le légal sont plein écran. `RequireAuth` / `RequireRole` (`components/layout/guards.tsx`) redirigent vers `/auth/login` (avec `state.from`) ou `/map`.
- Développement : le proxy Vite relaie `/api` **et** `/uploads` vers `http://localhost:8787` (les URL de photos renvoyées par l'API sont relatives).
- Service worker (`vite-plugin-pwa`, `generateSW`, mise à jour automatique) : précache de l'application (JS, CSS, HTML, icônes), repli de navigation sur `index.html` sauf pour `/api/*` et `/uploads/*` (`navigateFallbackDenylist`), tuiles cartographiques en cache-first (60 jours), photos `/uploads/*` en cache-first (30 jours), API en network-first (délai 6 s, repli cache 7 jours).
- Vérification : `pnpm --filter @mountain-live/web typecheck`, `pnpm --filter @mountain-live/web test`, `pnpm --filter @mountain-live/web build` (génère `dist/sw.js` et `dist/manifest.webmanifest`).
