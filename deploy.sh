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

# ─── UN SOLO DESPLIEGUE A LA VEZ (18/09/2026) ────────────────────────────────
# El 18/09 arrancaron DOS despliegues con medio minuto de diferencia (11:50:0x
# y 11:50:33) sobre el mismo /opt/crm-salamandra. Aquí no hay dos copias de
# nada: el `git pull`, `node_modules/` y sobre todo `.next/` son UNO, y
# compartido. Dos `next build` a la vez se pisan los ficheros de dentro de
# `.next/`, y entonces pasa lo que se vio: uno sale en ROJO y el otro —que no
# ha fallado, así que `set -e` no tiene nada que parar— sigue adelante y hace
# `docker compose up --build` copiando un `.next/` que el primero está
# reescribiendo. La imagen se hornea de una foto a medias. Visto desde fuera:
# «el build salió rojo y aun así recreó la imagen».
#
# Aquella vez acabó bien de chiripa —el segundo despliegue volvió a construir
# encima y la imagen final casó con el disco—, pero la ventana entre el build
# y el `COPY .next` del Dockerfile es de segundos, y con varias sesiones
# trabajando a la vez alguien acaba cayendo dentro. Esto no se arregla
# mirando el reloj: se arregla no dejando entrar al segundo.
#
# QUIÉN SUELTA EL CERROJO, medido en el VPS el 18/09/2026 y no supuesto: lo
# suelta el núcleo cuando se cierra el ÚLTIMO descriptor que lo tiene abierto,
# y los hijos heredan el fd 9. O sea que matar el script con Ctrl-C o con
# kill -9 NO lo suelta mientras siga vivo su `npm run build` o su
# `docker compose`: el cerrojo dura lo que dure el trabajo de verdad.
#
# Eso es lo que queremos —si el build sigue corriendo, el segundo despliegue
# tampoco debe entrar— pero conviene saberlo para no buscar un fichero
# encallado que no existe. No hay que borrar nada a mano: en cuanto muere el
# último hijo, el cerrojo se libera solo. Para ver qué lo tiene:
#   fuser /var/lock/crm-deploy.lock
CERROJO=/var/lock/crm-deploy.lock
QUIEN=/var/lock/crm-deploy.quien
exec 9>>"$CERROJO"          # >> y no >: abrir truncando borraría el aviso de
                            # quién lo tiene ANTES de saber siquiera si entro.
if ! flock -n 9; then
  echo ""
  echo "  ⛔ HAY OTRO DESPLIEGUE EN MARCHA. Este no arranca."
  echo ""
  echo "     $(cat "$QUIEN" 2>/dev/null || echo '(sin datos de quién lo tiene)')"
  echo ""
  echo "     Qué lo tiene ocupado ahora mismo:"
  echo "       fuser -v $CERROJO"
  echo ""
  echo "     Espera a que termine y vuelve a lanzarlo. Dos a la vez se pisan"
  echo "     el .next/, que es compartido, y la imagen puede salir de un"
  echo "     build a medio escribir."
  echo ""
  exit 1
fi
printf 'Lo tiene el pid %s desde las %s%s\n' "$" "$(date '+%H:%M:%S del %d/%m')" \
  "${SSH_CLIENT:+ (ssh desde ${SSH_CLIENT%% *})}" > "$QUIEN"

# ─── El build, con el rojo dicho por su nombre ───────────────────────────────
# `set -e` ya pararía, pero sin decir por qué: el despliegue se corta y la
# última línea que se lee es el error de Next, que puede estar doscientas
# líneas más arriba. Esto lo dice claro y, sobre todo, dice lo que NO ha
# pasado: que la imagen no se ha tocado y producción sigue como estaba.
construir() {
  set +e
  npm run build
  local codigo=$?
  set -e
  if [ "$codigo" -ne 0 ]; then
    echo ""
    echo "  ✖ EL BUILD HA FALLADO (código $codigo). LA IMAGEN NO SE HA TOCADO."
    echo "    Producción sigue corriendo la de antes, que funciona."
    echo "    Arregla el build, commitea y vuelve a lanzar el despliegue."
    echo ""
    exit 1
  fi
}

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
  construir
  docker compose down
  docker compose up -d --build
else
  echo "→ Solo código — build en VPS + rebuild rápido de imagen..."
  # node_modules ya está en el VPS del deploy anterior
  construir
  # Solo reconstruye la imagen del servicio app; Docker cachea todo excepto
  # las capas que cambiaron (básicamente solo COPY .next)
  docker compose up -d --build --no-deps app
fi

# ─── ¿LLEVA LA IMAGEN EL BUILD QUE ACABAMOS DE HACER? (18/09/2026) ───────────
# El cerrojo de arriba impide que dos despliegues se pisen, pero no cuesta
# nada comprobar el resultado, y es la única forma de saber que producción
# corre lo que creemos. `next build` escribe en `.next/BUILD_ID` un
# identificador distinto cada vez: si el de dentro del contenedor no es el que
# hay en disco, la imagen no salió de este build y el despliegue ha mentido.
#
# Se reintenta porque el contenedor acaba de arrancar y puede tardar un par de
# segundos en aceptar `docker exec`.
echo "→ Comprobando que producción corre este build..."
ESPERADO=$(cat .next/BUILD_ID 2>/dev/null || echo "")
DENTRO=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  DENTRO=$(docker exec crm-salamandra-app-1 cat .next/BUILD_ID 2>/dev/null || echo "")
  [ -n "$DENTRO" ] && break
  sleep 2
done

if [ -z "$ESPERADO" ] || [ -z "$DENTRO" ]; then
  echo "  ⚠  No he podido comprobarlo (¿contenedor levantando?). Míralo a mano:"
  echo "     docker exec crm-salamandra-app-1 cat .next/BUILD_ID"
elif [ "$ESPERADO" != "$DENTRO" ]; then
  echo ""
  echo "  ✖ LA IMAGEN NO LLEVA ESTE BUILD."
  echo "      en disco:     $ESPERADO"
  echo "      en producción: $DENTRO"
  echo ""
  echo "    Producción está corriendo otra cosa. Vuelve a lanzar el despliegue"
  echo "    y, si se repite, mira si hay otro corriendo a la vez."
  echo ""
  exit 1
else
  echo "  ✓ Producción corre el build $ESPERADO (commit $(git rev-parse --short HEAD))."
fi

# ─── La caché de compilación de Docker (02/09/2026) ──────────────────────────
# Cada `--build` deja capas intermedias que nadie borra. El 02/09 había 42 GB
# de caché de builds viejos en /var/lib/docker —más que las copias de
# seguridad, 24 GB— y la copia nocturna avisaba de que el disco se acababa.
# Nadie lo veía: no sale en `du` de las copias ni lo explica `df`. Se poda
# aquí, justo después del build, dejando los 5 GB más recientes para que el
# siguiente despliegue siga siendo rápido. Solo toca la caché de builds: ni
# imágenes en uso, ni contenedores, ni volúmenes (la base vive en un volumen).
# Nunca hace fallar el deploy: si la poda peta, la app ya está levantada.
echo "→ Podando la caché de compilación de Docker (se dejan los 5 GB más recientes)..."
docker builder prune -f --keep-storage 5GB 2>&1 | tail -1 || true

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
