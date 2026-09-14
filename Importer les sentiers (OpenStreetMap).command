#!/bin/bash
# Double-cliquez pour importer le réseau de sentiers, pistes et chemins de Corse depuis
# OpenStreetMap (licence ODbL) dans la base de Mountain Live : c'est ce réseau que la
# navigation utilise pour rattacher votre position au bon chemin (map matching).
# Connexion Internet nécessaire (une trentaine de requêtes vers l'API Overpass, quelques minutes).
# L'application peut rester ouverte : les chemins sont disponibles immédiatement.
cd "$(dirname "$0")" || exit 1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  SHIM_DIR="$(mktemp -d 2>/dev/null || echo "/tmp/mountain-live-shim-$$")"; mkdir -p "$SHIM_DIR"
  printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > "$SHIM_DIR/pnpm"; chmod +x "$SHIM_DIR/pnpm"; export PATH="$SHIM_DIR:$PATH"
fi
printf '\033[1m%s\033[0m\n' "Import des sentiers OpenStreetMap — Corse"
echo "Pour une autre zone : pnpm --filter @mountain-live/api geo:import-osm -- --bbox ouest,sud,est,nord"
echo "Depuis un fichier :   pnpm --filter @mountain-live/api geo:import-osm -- --file export.geojson"
echo
pnpm --filter @mountain-live/api geo:import-osm "$@" || printf '\n\033[31m%s\033[0m\n' "L'import a échoué (voir le message ci-dessus)."
echo
printf 'Appuyez sur Entrée pour fermer.'; read -r
