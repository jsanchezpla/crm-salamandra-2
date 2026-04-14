#!/bin/bash

# deploy.sh — Salamandra Solutions
# Uso: ./deploy.sh [--full]
#
# Sin flags:  build en VPS + rebuild rápido de imagen (~60-90s)
# --full:     reinstala deps + build + reconstruye imagen completa
#             (usar cuando cambian dependencias o hay problemas)
#
# Requisito: node y npm instalados en el VPS host

set -e

FULL=false
if [ "$1" == "--full" ]; then
  FULL=true
fi

echo "Salamandra Deploy — $(date '+%H:%M:%S')"
echo "──────────────────────────────────────"

# 1. Bajar cambios
echo "→ git pull..."
git pull

# 2. Detectar si package.json cambió en el último pull
DEPS_CHANGED=$(git diff HEAD~ HEAD --name-only 2>/dev/null | grep -E "package(-lock)?\.json" || true)

if [ "$FULL" = true ] || [ -n "$DEPS_CHANGED" ]; then
  echo "→ Dependencias cambiadas — instalando y reconstruyendo todo..."
  # npm ci con devDeps porque son necesarias para next build (Tailwind, etc.)
  npm ci
  npm run build
  docker compose down
  docker compose up -d --build
else
  echo "→ Solo código — build en VPS + rebuild rápido de imagen..."
  # node_modules ya está en el VPS del deploy anterior
  npm run build
  # Solo reconstruye la imagen del servicio app; Docker cachea todo excepto
  # las capas que cambiaron (básicamente solo COPY .next)
  docker compose up -d --build --no-deps app
fi

echo "──────────────────────────────────────"
echo "Deploy completado — $(date '+%H:%M:%S')"
