#!/bin/bash
# Double-cliquez pour importer le référentiel des lieux-dits, hameaux, sommets, cols, sources,
# lacs et refuges de Corse (GeoNames, licence CC BY 4.0) dans la base de Mountain Live.
# Connexion Internet nécessaire (téléchargement d'environ 30 Mo la première fois).
# L'application peut rester ouverte : les nouveaux lieux sont disponibles immédiatement.
cd "$(dirname "$0")" || exit 1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  SHIM_DIR="$(mktemp -d 2>/dev/null || echo "/tmp/mountain-live-shim-$$")"; mkdir -p "$SHIM_DIR"
  printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > "$SHIM_DIR/pnpm"; chmod +x "$SHIM_DIR/pnpm"; export PATH="$SHIM_DIR:$PATH"
fi
printf '\033[1m%s\033[0m\n' "Import des lieux-dits (GeoNames) — Corse (2A, 2B)"
echo "Pour un autre département : pnpm --filter @mountain-live/api geo:import -- --departements 04,05"
echo "Pour toute la France :      pnpm --filter @mountain-live/api geo:import -- --all"
echo
pnpm --filter @mountain-live/api geo:import "$@" || printf '\n\033[31m%s\033[0m\n' "L'import a échoué (voir le message ci-dessus)."
echo
printf 'Appuyez sur Entrée pour fermer.'; read -r
