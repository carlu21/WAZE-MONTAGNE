#!/bin/bash
# Double-cliquez pour remettre la base de démonstration à zéro (jeu de données Corse).
# Arrêtez d'abord l'application (Ctrl + C dans sa fenêtre).
cd "$(dirname "$0")" || exit 1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if command -v pnpm >/dev/null 2>&1; then PNPM="pnpm"; else PNPM="corepack pnpm"; fi
printf '\033[1m%s\033[0m\n' "Réinitialisation de la base de données Mountain Live…"
$PNPM --filter @mountain-live/api db:reset && echo && echo "Terminé. Vous pouvez relancer « Lancer Mountain Live.command »."
printf 'Appuyez sur Entrée pour fermer.'; read -r
