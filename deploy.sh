#!/bin/bash

# deploy.sh — Salamandra Solutions
# Uso: ./deploy.sh [--full]
#
# Sin flags:  build en VPS + rebuild rápido de imagen (~60-90s)
# --full:     reinstala deps + build + reconstruye imagen completa
#             (usar cuando cambian dependencias o hay problemas)
#
# Requisito: node y npm instalados en el VPS host
#
# ⚠️ UN CAMBIO EN ESTE FICHERO NO SE APLICA HASTA EL DESPLIEGUE SIGUIENTE
# (13/08/2026). El `git pull` de aquí abajo reemplaza este mismo script mientras
# bash lo está ejecutando, así que la ejecución en curso sigue con el contenido
# viejo. Se vio al meter el comprobador de las fotos doradas: el deploy terminó
# sin sacarlo, y salió al relanzarlo sin haber cambiado nada. Si tocas
# `deploy.sh`, cuenta con lanzarlo DOS veces.

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
#
#    Se mira SOLO package-lock.json (19/08/2026). Antes se miraba también
#    package.json, y eso mandaba a la ruta larga —`npm ci` y `docker compose
#    down`, o sea la base de TODOS los clientes parada un rato— por tocar un
#    alias de `scripts` que no cambia ninguna dependencia. El lock es lo que
#    `npm ci` instala: si cambian las dependencias, cambia el lock (y si alguien
#    edita package.json a mano sin `npm install`, `npm ci` falla igual por lock
#    desincronizado, así que mirar package.json no protegía de nada).
if [ "$BEFORE" = "$AFTER" ]; then
  DEPS_CHANGED=""
else
  DEPS_CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" -- package-lock.json)
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

# ─────────────────────────────────────────────────────────────────────────────
# 3. ¿Se han quedado atrás las fotos doradas de las demos?
#
# ── POR QUÉ ESTO VIVE EN EL DEPLOY (13/08/2026) ──────────────────────────────
# Cada demo se restaura sola desde su foto `crm_{slug}_golden`, y esa foto es
# una FOTO: se saca un día y ahí se queda.
#
# Desde el 29/08/2026 las migraciones tocan TAMBIÉN las fotos (byTable/byModule
# en scripts/_schema-targets.js incluyen los dorados), así que una columna nueva
# ya no las deja atrás. Esta comprobación sigue aquí como red: pilla la
# migración vieja que se relance con ONLY_SCHEMAS, la que no usa el helper, y
# la deriva de DATOS (seeds nuevos sin re-foto).
#
# Rehacerla es UN COMANDO. Nunca fue un problema de dificultad: es que nada
# avisaba. La diferencia era CERO el 27/07 y en dos semanas y media había vuelto
# a ser 9 tablas y 27 columnas sin que nadie se enterara, y encima con tres tipos
# enum desincronizados que hacían que la restauración se abandonara en silencio
# —el `catch` que evita que un fallo ahí tumbe el dashboard se lo tragaba—. La
# demo es el escaparate de ventas y llevaba semanas sin limpiarse sola.
#
# El deploy es el único momento en que alguien está MIRANDO esto y además acaba
# de meter las columnas nuevas. Por eso el aviso va aquí y va el ÚLTIMO: lo que
# se lee de un deploy son las tres últimas líneas.
#
# ── NO LO ARREGLA SOLO, Y ES A PROPÓSITO ─────────────────────────────────────
# Rehacer la foto congela lo que haya en la demo EN ESE MOMENTO, incluido lo que
# haya dejado un visitante cinco minutos antes. Automatizarlo aquí convertiría
# el escaparate en la última cagada de alguien, sin que nadie lo viera. Se avisa;
# lo mira una persona y lanza el comando.
#
# NUNCA hace fallar el deploy: una foto vieja no es motivo para dar por malo un
# despliegue que ha ido bien.
# ─────────────────────────────────────────────────────────────────────────────
if docker ps --format '{{.Names}}' | grep -q '^crm-salamandra-app-1$'; then
  echo ""
  echo "→ Comprobando las fotos doradas de las demos..."
  set +e
  docker exec crm-salamandra-app-1 node scripts/demo-golden-snapshot.js --comprobar
  FOTOS=$?
  set -e

  if [ "$FOTOS" -ne 0 ]; then
    echo ""
    echo "  ⚠  ALGUNA FOTO DORADA NO CASA CON SU SCHEMA (el detalle, arriba)."
    echo ""
    echo "     Lo que se ve por fuera: campos vacíos en el escaparate, o la"
    echo "     restauración abandonándose y el siguiente visitante encontrándose"
    echo "     lo que ensució el anterior."
    echo ""
    echo "     Se rehacen con:"
    echo "       docker exec crm-salamandra-app-1 node scripts/demo-golden-snapshot.js"
    echo ""
    echo "     MÍRALAS ANTES: la foto congela lo que haya en la demo ahora mismo,"
    echo "     incluido lo que haya dejado un visitante."
    echo ""
    echo "     (Desde el 29/08/2026 las migraciones migran también las fotos:"
    echo "     si esto salta, lo raro es la migración — ¿usa _schema-targets?)"
    echo ""
  fi
fi
