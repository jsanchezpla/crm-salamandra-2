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
BEFORE=$(git rev-parse HEAD)
git pull
AFTER=$(git rev-parse HEAD)

# 2. Detectar si las dependencias cambiaron en TODO lo que ha traído el pull.
#    Antes esto era `git diff HEAD~ HEAD`, o sea SOLO el último commit: en un
#    deploy acumulado (varios commits de golpe, lo normal aquí) se saltaba
#    cambios de dependencias que venían commits atrás, tomaba la ruta rápida sin
#    `npm ci` y el build podía romper por módulos que faltan. Ahora se compara el
#    estado previo al pull contra el posterior, que es lo que de verdad entra.
if [ "$BEFORE" = "$AFTER" ]; then
  DEPS_CHANGED=""
else
  DEPS_CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" -- package.json package-lock.json)
fi

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
