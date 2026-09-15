#!/bin/bash
# Double-cliquez sur ce fichier dans le Finder : il ouvre le Terminal, prépare le projet
# au premier lancement, démarre l'API et l'application web, puis ouvre le navigateur.
# Pour arrêter : Ctrl + C dans cette fenêtre (ou fermez-la).

cd "$(dirname "$0")" || exit 1

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; printf 'Appuyez sur Entrée pour fermer.'; read -r; exit 1; }

bold "Mountain Live — la montagne en temps réel"
echo "Dossier : $(pwd)"
echo

# 1. Node.js (version 20 minimum)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Ouverture de la page de téléchargement…"
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/fr/download"
  fail "Installez Node.js (version LTS), puis relancez ce fichier."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/fr/download"
  fail "Node.js $(node -v) est trop ancien : installez la version 20 ou plus, puis relancez."
fi
echo "Node.js $(node -v) : OK"

# 2. pnpm (via corepack, fourni avec Node : aucune installation globale nécessaire)
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  # Les scripts du projet appellent « pnpm » par son nom : on le rend disponible le temps de la session.
  SHIM_DIR="$(mktemp -d 2>/dev/null || echo "/tmp/mountain-live-shim-$$")"
  mkdir -p "$SHIM_DIR"
  printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > "$SHIM_DIR/pnpm"
  chmod +x "$SHIM_DIR/pnpm"
  export PATH="$SHIM_DIR:$PATH"
fi
PNPM="pnpm"
echo "pnpm : $($PNPM --version 2>/dev/null || echo 'indisponible')"

# 3. Dépendances (premier lancement ou mise à jour)
if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  bold "Installation des dépendances (quelques minutes la première fois)…"
  $PNPM install || fail "L'installation des dépendances a échoué."
fi

# 4. Base de données de démonstration : créée si absente ou vide (vos données sont conservées sinon)
DB_FILE="apps/api/data/mountain-live.db"
USERS_COUNT=0
if [ -f "$DB_FILE" ]; then
  USERS_COUNT=$(node -e "try{const D=require('./apps/api/node_modules/better-sqlite3');const db=new D(process.argv[1],{readonly:true});console.log(db.prepare('select count(*) as n from users').get().n)}catch(e){console.log(0)}" "$DB_FILE" 2>/dev/null || echo 0)
fi
if [ "${USERS_COUNT:-0}" -eq 0 ]; then
  bold "Création de la base de données et du jeu de données Corse…"
  $PNPM --filter @mountain-live/api db:reset || fail "La création de la base a échoué."
fi

# 5. Vrais sentiers et itinéraires (OpenStreetMap) : import en arrière-plan si la base n'en contient pas encore
OSM_COUNT=0
if [ -f "$DB_FILE" ]; then
  OSM_COUNT=$(node -e "try{const D=require('./apps/api/node_modules/better-sqlite3');const db=new D(process.argv[1],{readonly:true});console.log(db.prepare(\"select count(*) as n from paths where source='osm'\").get().n)}catch(e){console.log(0)}" "$DB_FILE" 2>/dev/null || echo 0)
fi
if [ "${OSM_COUNT:-0}" -eq 0 ] && [ ! -f "apps/api/data/osm/.import-en-cours" ]; then
  if curl -sf -m 10 "https://overpass-api.de/api/status" >/dev/null 2>&1; then
    bold "Import des vrais sentiers et itinéraires de Corse (OpenStreetMap) en arrière-plan…"
    echo "  Quelques minutes ; l'application reste utilisable. Journal : apps/api/data/osm/import.log"
    mkdir -p apps/api/data/osm
    touch apps/api/data/osm/.import-en-cours
    ( $PNPM --filter @mountain-live/api geo:import-osm > apps/api/data/osm/import.log 2>&1; rm -f apps/api/data/osm/.import-en-cours ) &
  else
    echo "Pas de connexion à OpenStreetMap pour l'instant : les vrais sentiers seront importés au prochain lancement connecté"
    echo "(ou par double-clic sur « Importer les sentiers (OpenStreetMap).command »)."
  fi
fi

# 6. Adresse pour votre iPhone (même Wi-Fi) : l'application est servie en HTTPS (certificat auto-signé,
#    à accepter une fois dans Safari : « Afficher les détails » → « visiter ce site web »).
LAN_IP=""
for IF in en0 en1 en2 en3; do
  LAN_IP=$(ipconfig getifaddr "$IF" 2>/dev/null) && [ -n "$LAN_IP" ] && break
done
[ -z "$LAN_IP" ] && LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

# 7. Ouverture du navigateur dès que l'application répond
(
  for _ in $(seq 1 90); do
    if curl -skf https://localhost:5173/ >/dev/null 2>&1 && curl -sf http://localhost:8787/api/v1/health >/dev/null 2>&1; then
      command -v open >/dev/null 2>&1 && open "https://localhost:5173"
      exit 0
    fi
    sleep 1
  done
) &

bold "Démarrage de l'application…"
echo "  Sur cet ordinateur : https://localhost:5173  (vue iPhone avec QR code à côté)"
if [ -n "$LAN_IP" ]; then
  echo "  Sur votre iPhone   : https://$LAN_IP:5173  (même Wi-Fi ; acceptez le certificat une fois, puis Partager → Sur l'écran d'accueil)"
fi
echo "  API : http://localhost:8787"
echo "  Comptes de démo : rando@mountain-live.demo / demo1234 (admin@… pour le back-office)"
echo "  Pour arrêter : Ctrl + C"
echo
$PNPM dev
