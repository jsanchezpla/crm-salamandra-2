#!/bin/bash
# backup-db.sh — copia de seguridad automática de la base de datos.
#
# QUÉ RESUELVE: hasta ahora solo se hacían volcados MANUALES antes de cada
# despliegue. Un fallo del disco del VPS entre despliegues se llevaba los datos
# reales de los clientes (Aumenta con 15 personas, la consulta de Laura) sin
# ninguna copia reciente. Esto lo automatiza.
#
# QUÉ HACE: un pg_dump comprimido de TODA la base (todos los tenants + master)
# MÁS los ficheros subidos (uploads/), guardando la ÚLTIMA SEMANA en el
# servidor y, si está configurado, copia a un destino FUERA del servidor — una
# copia que SUMA (un borrado aquí no viaja allí) y que se poda sola a las dos
# últimas semanas (ver «CUÁNTAS SE GUARDAN»). Es idempotente.
#
# ─── LOS FICHEROS NO CABEN (28/08/2026) ──────────────────────────────────────
# Hasta hoy, cada madrugada se empaquetaba el archivo ENTERO en un .tar.gz. Con
# 127 MB era gratis. El 26/08 la migración del OneDrive de Aumenta metió 6,2 GB
# de documentación clínica en uploads/, y esa misma noche el paquete diario pasó
# a 5,3 GB. Con 14 días de retención eso son 74 GB donde quedaban 44 libres: el
# disco lleno hacia el 6 de septiembre, y con él la base sin poder escribir.
# Nadie se habría enterado — el registro decía «✅ Copia completada» cada mañana.
#
# Ahora los ficheros se copian así:
#
#   uploads-espejo/            el estado de HOY, una sola copia (6,2 GB)
#   uploads-cambios/AAAAMMDD-HHMM/   solo lo que esa noche se pisó o se borró,
#                              con su ruta original dentro
#   uploads-AAAAMMDD-HHMM.tar.gz     el paquete portátil, UNA VEZ POR SEMANA
#
# Una noche cuesta lo que ocupa lo que cambió, no lo que ocupa el archivo. En un
# archivo que casi solo crece, eso son kilobytes.
#
# POR QUÉ ASÍ Y NO UN TAR INCREMENTAL: porque aquí borrar una noche no estropea
# ninguna otra. Cada directorio se basta solo. Con `tar --listed-incremental`,
# la rotación por antigüedad se lleva un día el paquete entero y deja quince
# parciales que ya no se pueden aplicar a nada — una copia rota con toda la
# pinta de estar bien. (Lo natural sería `rsync --link-dest`; este servidor no
# tiene rsync y no se instaló por no tocar el sistema. `rclone` sí está, y hace
# esto mismo con --backup-dir.)
#
# ─── QUÉ SALE Y QUÉ NO ───────────────────────────────────────────────────────
# Fuera del servidor van los volcados de la base y el paquete SEMANAL de
# ficheros. El espejo y las noches de cambios NO salen, a propósito: son 6,2 GB
# que no caben en la capa gratuita de R2 ni de B2, y cuánto se paga por guardar
# el archivo clínico fuera es una decisión de Jorge, no de este script. Cuando
# se decida, se quitan los `--exclude` de abajo y ya está.
#
# INSTALACIÓN EN EL VPS (una sola vez, como root):
#   chmod +x /opt/crm-salamandra/scripts/backup-db.sh
#   cp /opt/crm-salamandra/scripts/deploy/crm-backup.{service,timer} /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now crm-backup.timer
#   # (este servidor NO tiene cron: se usa un timer de systemd, como
#   #  crm-poda, crm-recordatorios y crm-retenciones)
#
# COMPROBAR QUE FUNCIONA:
#   systemctl list-timers | grep crm-backup
#   /opt/crm-salamandra/scripts/backup-db.sh && ls -lh /opt/crm-salamandra/backups | tail
#
# ─── RESTAURAR ───────────────────────────────────────────────────────────────
# ⚠️ SOBRESCRIBE. Haz una copia ANTES de restaurar una copia.
#
#   1) Base de datos:
#      gunzip -c backups/auto-AAAAMMDD-HHMM.sql.gz \
#        | docker exec -i crm-salamandra-db-1 psql -v ON_ERROR_STOP=1 -U crm_user -d salamandra
#
#      El `-v ON_ERROR_STOP=1` NO es opcional: sin él, psql se traga los errores,
#      sigue adelante y termina con código 0 aunque no haya restaurado nada. Una
#      restauración rota sería indistinguible de una buena.
#
#   2) Ficheros (contratos firmados, informes, adjuntos). Tres casos, de menos
#      a más grave — el primero es el que pasa de verdad:
#
#      a) UN fichero borrado o pisado por error. Está en la noche que se lo
#         llevó, con su ruta original dentro:
#           ls backups/uploads-cambios/
#           find backups/uploads-cambios -name '*loquesea*'
#           cp backups/uploads-cambios/AAAAMMDD-HHMM/<ruta> uploads/<ruta>
#
#      b) TODO el archivo, a como estaba anoche:
#           rclone copy backups/uploads-espejo /opt/crm-salamandra/uploads
#         (`copy`, no `sync`: añade y pisa, pero no borra lo que haya de más.)
#
#      c) TODO el archivo, desde el paquete semanal o desde fuera del servidor:
#           tar xzf backups/uploads-AAAAMMDD-HHMM.tar.gz -C /opt/crm-salamandra
#
#      ⚠️ El espejo es de ANOCHE, no de hace un rato: lo subido hoy no está en
#      él todavía. Y para volver a un día concreto hay que ir del espejo hacia
#      atrás aplicando las noches posteriores, de la más nueva a la más vieja.
#
#      Restaurar SOLO la base deja miles de filas apuntando a ficheros que no
#      existen: la app arranca bien y los documentos fallan uno a uno.
#
# ⚠️ UNA COPIA NUNCA RESTAURADA ES UNA HIPÓTESIS. Prueba el procedimiento
#    entero en local al menos una vez.
#
#    ENSAYADO EL 20/08/2026, y no salió a la primera. La copia de esa noche se
#    restauró entera en una base local vacía: 19,6 s, cero errores, 1.391 tablas
#    y los recuentos idénticos a producción (la única que difería era la tabla
#    tocada después de las 03:15). Los modelos del CRM la leyeron sin retoques.
#    Pero el procedimiento de arriba, tal cual, ABORTA DOS VECES antes de
#    llegar ahí. Quien restaure con prisa tiene que saber esto:
#
#      1) El volcado empieza por \restrict (protección que pg_dump 16.13 ya
#         escribe). Un psql más VIEJO que el pg_dump que lo hizo no entiende
#         esa orden y, con ON_ERROR_STOP=1, se para en la línea 5. Restaura
#         con psql >= 16.10 / 17.6, o quítale esa línea y la de cierre.
#      2) El volcado asigna la propiedad a crm_user. Si ese rol no existe en
#         el destino, se para en la 27: CREATE ROLE crm_user; antes de nada.
#      3) Si un intento falla a mitad, la base destino queda a medias y el
#         siguiente muere con «ya existe el esquema». Tírala y créala de
#         nuevo: no se restaura encima de un intento fallido.
#
#    Lo que NO hace falta: que las versiones de servidor coincidan. Se restauró
#    un volcado de PostgreSQL 16.13 en un servidor 17.2 sin una sola queja.
#
# ─── COPIA FUERA DEL SERVIDOR ────────────────────────────────────────────────
# Sin DESTINO_REMOTO configurado, todo esto vive en el MISMO disco que la base:
# protege de un borrado accidental o de una migración que salga mal, NO de la
# pérdida del servidor. Para activarla, define DESTINO_REMOTO en el entorno del
# servicio (ver scripts/deploy/crm-backup.service):
#
#   · rclone:  DESTINO_REMOTO="b2:salamandra-backups"   (requiere `rclone config`)
#   · rsync:   DESTINO_REMOTO="usuario@otro-vps:/backups/salamandra"
#
# Se detecta solo cuál usar por el formato. Si falla, el script NO aborta: la
# copia local ya está hecha y es mejor tenerla que perderla por un fallo de red.
#
# EL BORRADO NO VIAJA (Jorge, 21/08/2026). Hasta hoy este bloque hacía `rclone
# sync` (y `rsync --delete`): el destino ESPEJABA los 14 días locales. O sea que
# si algo borrase las copias del servidor —un disco que se va, un script, una
# persona—, a las 03:15 de la noche siguiente ese borrado habría VIAJADO y se
# habrían perdido también las de fuera. Una copia de seguridad que se puede
# borrar desde la máquina que protege no es una copia de seguridad.
#
# Ahora se sube con `rclone copy` (y rsync SIN `--delete`): esta copia solo
# suma. Lo que ya llegó allí no lo borra este script pase lo que pase aquí, y no
# hace falta que el proveedor tenga versionado ni papelera activados.
#
# ─── CUÁNTAS SE GUARDAN — UNA SEMANA AQUÍ, DOS FUERA (Rodrigo, 03/09/2026) ───
# Hasta hoy se guardaba por EDAD: 14 días aquí y 90 fuera. Con el archivo de
# Aumenta dentro (6,3 GB de uploads, más su espejo, más un paquete de 5,4 GB
# cada domingo) el disco de 99 GB pasó de 85 GB libres a 14 y llegaron dos
# correos de aviso seguidos. Rodrigo decidió que sobra historial:
#
#   · en el SERVIDOR se guarda LA ÚLTIMA SEMANA (DIAS_EN_SERVIDOR=7): los 7
#     volcados nocturnos más nuevos y el último paquete de ficheros. «Eso
#     siempre.»
#   · FUERA se guardan LAS DOS ÚLTIMAS SEMANAS (DIAS_FUERA=14): 14 volcados
#     y 2 paquetes.
#   · las noches de cambios de uploads-cambios/ siguen yendo por edad, a 7
#     días (RETENCION_DIAS = DIAS_EN_SERVIDOR), nunca menos de 3 noches. El
#     espejo no es una copia vieja, es el estado de hoy: no se toca.
#
# Los días se traducen a NÚMERO de copias (`copias_en_dias`): un volcado por
# noche, un paquete de ficheros por semana. Se cuenta por número y no por edad
# a propósito: «las N últimas» se deciden por NOMBRE (llevan la fecha dentro y
# ordenan solas), sobre lo que hay, así que un reloj loco o un servidor parado
# un mes no pueden dejar el destino vacío. Los frenos que quedan, todos EN LA
# DUDA NO BORRA: si DIAS_* no es un entero mayor que cero no se borra nada y se
# avisa; fuera solo se poda si la subida de esta noche salió bien Y el volcado
# de esta noche aparece en la lista del destino; si el destino no se deja
# listar o contesta vacío, no se toca; y solo se miran `auto-*.sql.gz` y
# `uploads-*.tar.gz` de la RAÍZ, nunca las copias manuales ni lo que otro deje
# ahí. La rama rsync sigue sin borrar nada en la otra máquina: que ese servidor
# tenga su propia limpieza.
#
# Lo que se pierde a cambio, dicho claro: fuera hay dos semanas de historial,
# no noventa días. Una corrupción que se descubra al mes ya no tiene copia sana
# a la que volver. Es una decisión de negocio, no técnica, y está en
# docs/decisions/2026-09-03-una-semana-aqui-dos-fuera.md (que supera la
# caducidad por edad de 2026-08-21-el-borrado-no-viaja.md). Primero se pidió
# «solo la última» y se aclaró el mismo día: el correo del lunes es un parte,
# la copia es de cada noche.

set -euo pipefail

DIR_REPO="${DIR_REPO:-/opt/crm-salamandra}"
DIR_BACKUPS="${DIR_BACKUPS:-$DIR_REPO/backups}"
DIR_UPLOADS="${UPLOADS_HOST_DIR:-$DIR_REPO/uploads}"
CONTENEDOR_DB="${CONTENEDOR_DB:-crm-salamandra-db-1}"
USUARIO_DB="${USUARIO_DB:-crm_user}"
NOMBRE_DB="${NOMBRE_DB:-salamandra}"
# ─── Cuántas copias se guardan (Rodrigo, 03/09/2026) ─────────────────────────
# En días, pero contados por NÚMERO de copias y no por edad — ver «CUÁNTAS SE
# GUARDAN» en la cabecera: un volcado por noche, un paquete de ficheros por
# semana (`copias_en_dias`).
DIAS_EN_SERVIDOR="${DIAS_EN_SERVIDOR:-7}"  # aquí: la última semana (7 volcados + 1 paquete)
DIAS_FUERA="${DIAS_FUERA:-14}"             # fuera: las dos últimas semanas (14 volcados + 2 paquetes)
RETENCION_DIAS="${RETENCION_DIAS:-$DIAS_EN_SERVIDOR}" # noches de cambios de uploads-cambios/ (era 14)
MINIMO_BYTES="${MINIMO_BYTES:-100000}" # por debajo de esto, el volcado es basura
# ─── Los ficheros subidos, desde el 28/08/2026 ───────────────────────────────
# Ya no se empaqueta el archivo entero cada noche (ver «LOS FICHEROS NO CABEN»
# en la cabecera): se mantiene un ESPEJO del estado de hoy y, al lado, lo que
# cada noche se pisó o se borró, en un directorio con la fecha.
DIR_ESPEJO="${DIR_ESPEJO:-$DIR_BACKUPS/uploads-espejo}"
DIR_CAMBIOS="${DIR_CAMBIOS:-$DIR_BACKUPS/uploads-cambios}"
DIA_TAR_ENTERO="${DIA_TAR_ENTERO:-7}"  # date +%u; 7 = domingo. El paquete portátil.
MINIMO_DIAS_CAMBIOS="${MINIMO_DIAS_CAMBIOS:-3}" # nunca dejar menos noches que esto
# Aviso de disco. No es un adorno: la copia de ficheros pasó de 127 MB a 5,3 GB
# de una noche a otra (migración del OneDrive de Aumenta, 26/08/2026) y nadie se
# enteró hasta que alguien miró a mano. El disco no avisa, se acaba.
MINIMO_LIBRE_GB="${MINIMO_LIBRE_GB:-15}"
DESTINO_REMOTO="${DESTINO_REMOTO:-}"   # vacío = solo copia local (ver cabecera)
CONTENEDOR_APP="${CONTENEDOR_APP:-crm-salamandra-app-1}"
LOG_COPIA="${LOG_COPIA:-/var/log/crm-backup.log}"
AVISAR="${AVISAR:-1}"                  # 0 = no mandar correo (para probar en seco)
ok_remoto=0                            # se declara aquí porque el parte semanal lo lee
modo_remoto=""                         # rclone|rsync — lo fija el bloque externo; el parte semanal lo lee

marca=$(date +%Y%m%d-%H%M)
destino="$DIR_BACKUPS/auto-$marca.sql.gz"
destino_uploads="$DIR_BACKUPS/uploads-$marca.tar.gz"

# ─── El correo ───────────────────────────────────────────────────────────────
# Un fallo que solo se escribe en un log no lo lee nadie: hasta el 20/08/2026
# esta copia podía llevar semanas rota sin que nos enterásemos. Ahora escribe a
# info@salamandrasolutions.com por el mismo camino que el buzón — las
# credenciales de Resend de salamandra_solutions, que viven en la base y no en
# el entorno (ver la cabecera de scripts/avisar-copia.mjs).
#
# BEST-EFFORT SIEMPRE, y por eso todo lleva `|| true`: si la app está caída o
# Resend no contesta, la COPIA no puede fallar por culpa del correo. Una copia
# buena sin aviso sigue siendo una copia buena.
#
# TRES TIPOS (02/09/2026): `fallo` solo cuando la copia NO se ha hecho o no ha
# salido del servidor; `aviso` cuando la copia está hecha pero hay algo que
# mirar (disco justo, caducidad externa frenada); `resumen` el parte del lunes.
# Hasta hoy el disco justo iba como `fallo` y el correo decía «la copia ha
# fallado» dos mañanas seguidas con la copia bien hecha. El titular tiene que
# ser verdad, o se deja de leer.
avisar() {
  [ "${AVISAR}" = "1" ] || return 0
  if ! printf '%s\n' "$3" | docker exec -i "$CONTENEDOR_APP" \
      node scripts/avisar-copia.mjs --asunto "$1" --tipo "$2" 2>&1; then
    echo "[$(date '+%F %T')] ⚠️ No se pudo mandar el correo de aviso (¿está levantada la app?)."
  fi
  return 0
}

# Lo que se manda cuando algo falla. Sin datos de nadie: rutas, tamaños y el
# final del registro, que es lo que hace falta para saber por dónde empezar.
cuerpo_de_fallo() {
  echo "Servidor: $(hostname) · $(date '+%F %T %Z')"
  echo "Motivo: $1"
  echo ""
  echo "Últimas líneas de $LOG_COPIA:"
  tail -n 25 "$LOG_COPIA" 2>/dev/null || echo "(no se ha podido leer el registro)"
  echo ""
  echo "Disco:"
  df -h "$DIR_BACKUPS" | tail -2
}

# ¿Queda sitio? Se mira ANTES de escribir, y avisa por correo.
#
# Existe porque el 26/08/2026 la copia de ficheros pasó de 127 MB a 5,3 GB en
# una noche y el script siguió tan contento: con 14 días de retención eso son 74
# GB donde había 44 libres, o sea el disco lleno en ocho noches y, con él, la
# base sin poder escribir. El registro decía «✅ Copia completada» cada mañana.
#
# NO aborta: una copia con el disco justo sigue siendo mejor que ninguna, y
# quien tiene que decidir es una persona. Solo grita.
#
# Y dice DÓNDE mirar (02/09/2026): el primer aviso de disco decía «mira qué ha
# crecido» y llevó a las copias, que ocupaban 24 GB — pero el disco se lo
# estaba comiendo la caché de compilación de Docker, 42 GB de builds viejos
# que ni `du` de las copias ni `df` enseñan. Desde entonces deploy.sh la poda,
# y este correo trae `docker system df` para que se vea a la primera.
cuerpo_de_disco() {
  cuerpo_de_fallo "$1"
  echo ""
  echo "Qué ocupan las copias ($DIR_BACKUPS):"
  du -sh "$DIR_BACKUPS" 2>/dev/null || true
  echo ""
  echo "Docker (la fila 'Build Cache' es el sospechoso habitual; se poda con"
  echo "  docker builder prune -f --keep-storage 5GB):"
  docker system df 2>/dev/null || echo "(docker system df no contestó)"
}
avisar_si_falta_disco() {
  local libre_kb libre_gb
  libre_kb=$(df -Pk "$DIR_BACKUPS" | awk 'NR==2 {print $4}')
  # Si `df` no contesta un número, este aviso se calla en vez de reventar la
  # copia: es un chivato, no un requisito. (Y `$(( ))` con basura dentro mata el
  # script entero por el `set -e` de arriba.)
  case "${libre_kb:-x}${MINIMO_LIBRE_GB:-x}" in *[!0-9]*) return 0 ;; esac
  libre_gb=$((libre_kb / 1024 / 1024))
  if [ "$libre_gb" -lt "$MINIMO_LIBRE_GB" ]; then
    echo "[$(date '+%F %T')] ⚠️ Quedan $libre_gb GB libres (mínimo $MINIMO_LIBRE_GB). Las copias"
    echo "[$(date '+%F %T')]    caben hoy, pero esto se acaba. Mira qué ha crecido."
    avisar "⚠️ Al disco del CRM le quedan $libre_gb GB" aviso \
      "$(cuerpo_de_disco "quedan $libre_gb GB libres en $DIR_BACKUPS, por debajo del mínimo de $MINIMO_LIBRE_GB GB (la copia de esta noche sí se hace)")" || true
  fi
  return 0
}

# El parte de los lunes. Existe para que el SILENCIO signifique algo: si el
# servidor muere del todo tampoco llega el correo de fallo, así que hace falta
# uno que se espere cada semana (Jorge, 20/08/2026).
cuerpo_semanal() {
  echo "Servidor: $(hostname) · $(date '+%F %T %Z')"
  # La poda de fuera solo se nombra si de verdad hay algo fuera Y es este
  # script quien la hace: decir «las dos últimas fuera» sin destino, o con un
  # destino rsync donde no se borra nada, es contarle al lector una limpieza
  # que no pasa.
  if [ "$modo_remoto" = "rclone" ]; then
    echo "Se guardan: $DIAS_EN_SERVIDOR días aquí · $DIAS_FUERA días fuera del servidor · $RETENCION_DIAS noches de cambios de ficheros."
  else
    echo "Se guardan: $DIAS_EN_SERVIDOR días aquí · $RETENCION_DIAS noches de cambios de ficheros."
  fi
  echo ""
  echo "Copias de la base guardadas:     $(find "$DIR_BACKUPS" -maxdepth 1 -name 'auto-*.sql.gz' -type f | wc -l)"
  echo "Paquetes de ficheros (semanal):  $(find "$DIR_BACKUPS" -maxdepth 1 -name 'uploads-*.tar.gz' -type f | wc -l)"
  echo "Espejo de los ficheros:          $(du -sh "$DIR_ESPEJO" 2>/dev/null | cut -f1 || echo '—') ($(find "$DIR_ESPEJO" -type f 2>/dev/null | wc -l) ficheros)"
  echo "Noches de cambios guardadas:     $(find "$DIR_CAMBIOS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  echo "Ocupan en total:                 $(du -sh "$DIR_BACKUPS" | cut -f1)"
  echo "La de esta noche:                $(basename "$destino") ($(du -h "$destino" 2>/dev/null | cut -f1))"
  echo ""
  echo "Disco: $(df -Pk "$DIR_BACKUPS" | awk 'NR==2 {printf "%d GB libres de %d", $4/1048576, $2/1048576}') GB."
  echo ""
  if [ -z "$DESTINO_REMOTO" ]; then
    echo "Copia FUERA del servidor: NO HAY. Todo vive en el mismo disco que la base:"
    echo "protege de un borrado accidental, no de perder el servidor."
  elif [ "$ok_remoto" = "1" ]; then
    echo "Copia fuera del servidor: OK → $DESTINO_REMOTO"
    if [ "$modo_remoto" = "rclone" ]; then
      echo "(solo suma: un borrado aquí NO viaja allí; allí se guardan los últimos $DIAS_FUERA días)"
    else
      echo "(solo suma: un borrado aquí NO viaja allí; allí NO se caduca nada —"
      echo "este script no borra en otra máquina: la limpieza la pone ese servidor)"
    fi
  else
    echo "Copia fuera del servidor: FALLÓ esta noche → $DESTINO_REMOTO"
  fi
  echo ""
  echo "Disco:"
  df -h "$DIR_BACKUPS" | tail -2
  echo ""
  echo "Últimas líneas del registro:"
  tail -n 12 "$LOG_COPIA" 2>/dev/null || echo "(no se ha podido leer el registro)"
}

# Cuenta líneas NO vacías de un texto. `wc -l` no vale: una lista vacía tiene
# cero ficheros, y aquí confundir cero con uno significaría borrar de más.
contar_lineas() {
  local n=0 linea
  while IFS= read -r linea; do
    if [ -n "$linea" ]; then n=$((n + 1)); fi
  done <<<"$1"
  echo "$n"
}

# Las líneas de un texto que encajan con un patrón glob (una clase de copia).
filtrar_clase() {
  local patron="$1" linea
  while IFS= read -r linea; do
    # shellcheck disable=SC2254
    case "$linea" in $patron) printf '%s\n' "$linea" ;; esac
  done <<<"$2"
}

# Cuántas copias de una clase caben en N días: los volcados de la base son uno
# por noche; los paquetes de ficheros, uno por semana (y nunca menos de uno).
copias_en_dias() {
  case "$1" in
    uploads-*) echo $((($2 + 6) / 7)) ;;
    *) echo "$2" ;;
  esac
}

# ─── Poda en el destino externo ──────────────────────────────────────────────
# La subida es `rclone copy`: allí no se borra nada, así que el destino crecería
# sin fin. Desde el 03/09/2026 se poda POR NÚMERO (ver «CUÁNTAS SE GUARDAN» en
# la cabecera): de cada clase —volcados de la base, paquetes de ficheros— se
# quedan las que caben en $DIAS_FUERA días y se borra el resto. Es la ÚNICA parte
# del script que borra algo que ya está fuera del servidor, y está escrita para
# que EN LA DUDA NO BORRE. Cinco frenos, cualquiera la para en seco:
#
#   0. si DIAS_FUERA no es un entero mayor que cero → no borra y avisa. En un
#      camino que borra copias, un `[ 0 -lt abc ]` no es un error de tipos: es
#      el último freno desarmado en silencio (bash lo da por falso y sigue);
#   1. solo se llama si la subida de esta noche salió bien;
#   2. si el destino no se deja listar → no borra;
#   3. si el destino dice que está vacío → no borra (destino vacío = avería);
#   4. si el volcado de ESTA noche no aparece en la lista del destino → no
#      borra y avisa: «subida OK» sin el fichero allí es que algo va mal;
#   5. solo mira auto-*.sql.gz y uploads-*.tar.gz, y solo en la RAÍZ del destino
#      (--max-depth 1), igual que la rotación local respeta las manuales. Lo
#      que se borra sale, por nombre, de la misma lista que se acaba de leer:
#      el censo y el borrado miran EXACTAMENTE lo mismo.
#
# «Las N más nuevas» se decide por NOMBRE (llevan la fecha dentro y ordenan
# solas), no por la fecha del fichero ni por el reloj del servidor. Y todo
# best-effort: si el borrado falla, se anota y ya. Allí sobra, no falta.
podar_en_destino() {
  local filtros=(--max-depth 1 --include "auto-*.sql.gz" --include "uploads-*.tar.gz")
  local todo n_todo clase lista n_clase n_sobran sobran lista_tmp borradas=0

  if ! [[ "${DIAS_FUERA-}" =~ ^[0-9]+$ ]] || [ "$DIAS_FUERA" -lt 1 ]; then
    echo "[$(date '+%F %T')] ⛔ DIAS_FUERA vale '${DIAS_FUERA-}': tiene que ser un entero mayor que cero."
    echo "[$(date '+%F %T')]    NO se poda nada en $DESTINO_REMOTO: con un ajuste que no se"
    echo "[$(date '+%F %T')]    entiende, los frenos no valen y esto borra copias de seguridad."
    avisar "⚠️ La poda de la copia externa está mal configurada" aviso \
      "$(cuerpo_de_fallo "DIAS_FUERA vale '${DIAS_FUERA-}' y no es un entero mayor que cero; no se ha podado nada en $DESTINO_REMOTO")" || true
    return 0
  fi

  if ! todo=$(rclone lsf --files-only "${filtros[@]}" "$DESTINO_REMOTO" 2>/dev/null); then
    echo "[$(date '+%F %T')] ⚠️ No se pudo listar $DESTINO_REMOTO. NO se poda nada allí."
    return 0
  fi
  n_todo=$(contar_lineas "$todo")
  if [ "$n_todo" -eq 0 ]; then
    echo "[$(date '+%F %T')] ⚠️ El destino externo contesta que está VACÍO. NO se borra nada allí."
    return 0
  fi
  if ! grep -qxF -- "$(basename "$destino")" <<<"$todo"; then
    echo "[$(date '+%F %T')] ⛔ La copia de esta noche ($(basename "$destino")) NO aparece en $DESTINO_REMOTO"
    echo "[$(date '+%F %T')]    aunque la subida dijo OK. NO se poda nada: algo va mal."
    avisar "⚠️ La poda de la copia externa se ha frenado sola" aviso \
      "$(cuerpo_de_fallo "la subida a $DESTINO_REMOTO dijo OK pero $(basename "$destino") no está en la lista del destino; no se ha podado nada")" || true
    return 0
  fi

  lista_tmp=$(mktemp)
  for clase in 'auto-*.sql.gz' 'uploads-*.tar.gz'; do
    lista=$(filtrar_clase "$clase" "$todo" | sort)
    n_clase=$(contar_lineas "$lista")
    n_sobran=$((n_clase - $(copias_en_dias "$clase" "$DIAS_FUERA")))
    [ "$n_sobran" -gt 0 ] || continue
    # Ordenadas por nombre, las viejas van arriba: `head` se lleva las que sobran.
    sobran=$(printf '%s\n' "$lista" | head -n "$n_sobran")
    printf '%s\n' "$sobran" > "$lista_tmp"
    if rclone delete "$DESTINO_REMOTO" --files-from "$lista_tmp"; then
      borradas=$((borradas + n_sobran))
    else
      echo "[$(date '+%F %T')] ⚠️ Falló la poda de '$clase' en $DESTINO_REMOTO. Se queda para mañana:"
      echo "[$(date '+%F %T')]    allí sobra sitio, no falta copia."
    fi
  done
  rm -f "$lista_tmp"
  echo "[$(date '+%F %T')] Poda externa: $borradas copia(s) borradas; quedan los últimos $DIAS_FUERA días ($((n_todo - borradas)) fichero(s) allí)."
  return 0
}

# Un fallo NO puede pasar desapercibido: el `set -e` mataría el script sin dejar
# más rastro que una línea en un log que nadie lee. Esta trampa garantiza que la
# última línea diga siempre si la copia salió o no.
fallo() {
  echo "[$(date '+%F %T')] ❌ LA COPIA HA FALLADO (línea $1). Revísalo: los datos"
  echo "[$(date '+%F %T')]    de hoy NO están respaldados."
  avisar "❌ La copia del CRM ha fallado" fallo "$(cuerpo_de_fallo "se cortó en la línea $1 de backup-db.sh")" || true
}
trap 'fallo $LINENO' ERR

mkdir -p "$DIR_BACKUPS"

echo "[$(date '+%F %T')] Copia de seguridad → $destino"

avisar_si_falta_disco

# El volcado va primero a un temporal: si pg_dump falla a mitad, no queda un
# .sql.gz corrupto con nombre de copia buena.
tmp="$destino.parcial"
if ! docker exec "$CONTENEDOR_DB" pg_dump -U "$USUARIO_DB" "$NOMBRE_DB" | gzip > "$tmp"; then
  echo "[$(date '+%F %T')] ERROR: pg_dump falló. Se descarta el fichero parcial."
  rm -f "$tmp"
  avisar "❌ La copia del CRM ha fallado" fallo "$(cuerpo_de_fallo 'pg_dump no terminó bien')" || true
  exit 1
fi

tam=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
if [ "$tam" -lt "$MINIMO_BYTES" ]; then
  echo "[$(date '+%F %T')] ERROR: el volcado pesa $tam bytes (mínimo $MINIMO_BYTES). Se descarta."
  rm -f "$tmp"
  avisar "❌ La copia del CRM ha fallado" fallo "$(cuerpo_de_fallo "el volcado pesaba $tam bytes, por debajo del mínimo")" || true
  exit 1
fi

mv "$tmp" "$destino"
echo "[$(date '+%F %T')] OK base de datos: $(du -h "$destino" | cut -f1)"

# ─── Ficheros subidos ────────────────────────────────────────────────────────
# Contratos FIRMADOS, informes clínicos, adjuntos de clientes y de tickets. No
# se regeneran solos: restaurar únicamente la base deja las fichas apuntando a
# papeles que ya no existen. Siete módulos escriben aquí.
#
# CÓMO se copian, desde el 28/08/2026: un ESPEJO del estado de hoy, y al lado un
# directorio por noche con lo único que esa noche se pisó o se borró. Ya no se
# empaqueta el archivo entero cada madrugada — ver «LOS FICHEROS NO CABEN» en la
# cabecera. El paquete .tar.gz sigue existiendo, pero UNA VEZ POR SEMANA.
if [ -d "$DIR_UPLOADS" ]; then
  mkdir -p "$DIR_ESPEJO" "$DIR_CAMBIOS"
  cambios_hoy="$DIR_CAMBIOS/$marca"

  # `sync` y no `copy`: el espejo tiene que reflejar también los borrados, o un
  # fichero borrado por error se quedaría ahí para siempre y el espejo dejaría
  # de ser el estado de hoy. Lo que el sync quitaría o pisaría NO se pierde:
  # `--backup-dir` lo aparta en el directorio de esta noche con su ruta original.
  # Esa es toda la gracia — el borrado se puede deshacer, y cuesta lo que ocupa
  # lo borrado, no lo que ocupa el archivo entero.
  if rclone sync "$DIR_UPLOADS" "$DIR_ESPEJO" --backup-dir "$cambios_hoy"; then
    # Una noche sin cambios no deja directorio: `rmdir` solo se lleva el vacío.
    rmdir "$cambios_hoy" 2>/dev/null || true
    if [ -d "$cambios_hoy" ]; then
      echo "[$(date '+%F %T')] OK ficheros: espejo $(du -sh "$DIR_ESPEJO" | cut -f1) · esta noche cambiaron $(du -sh "$cambios_hoy" | cut -f1) ($(find "$cambios_hoy" -type f | wc -l) fichero(s))"
    else
      echo "[$(date '+%F %T')] OK ficheros: espejo $(du -sh "$DIR_ESPEJO" | cut -f1) · esta noche no cambió ninguno"
    fi
  else
    echo "[$(date '+%F %T')] ⚠️ No se pudo espejar $DIR_UPLOADS. La base SÍ está copiada."
  fi

  # El paquete portátil: un solo fichero que se lleva a cualquier sitio y se
  # restaura con un `tar xzf`. Es lo que viaja fuera del servidor. Semanal
  # porque son 5,3 GB: diario era justo lo que se comía el disco.
  #
  # También se hace si NO hay ninguno, para que un servidor recién instalado no
  # se quede hasta el domingo sin paquete.
  hay_tar=$(find "$DIR_BACKUPS" -maxdepth 1 -name 'uploads-*.tar.gz' -type f | wc -l)
  if [ "$(date +%u)" = "$DIA_TAR_ENTERO" ] || [ "$hay_tar" -eq 0 ]; then
    tmp_up="$destino_uploads.parcial"
    if tar czf "$tmp_up" -C "$(dirname "$DIR_UPLOADS")" "$(basename "$DIR_UPLOADS")"; then
      mv "$tmp_up" "$destino_uploads"
      echo "[$(date '+%F %T')] OK paquete semanal: $(du -h "$destino_uploads" | cut -f1)"
    else
      rm -f "$tmp_up"
      echo "[$(date '+%F %T')] ⚠️ No se pudo empaquetar $DIR_UPLOADS. El espejo SÍ está hecho."
    fi
  fi
else
  echo "[$(date '+%F %T')] ⚠️ No existe $DIR_UPLOADS — no hay ficheros que copiar."
fi

# ─── Caducidad de las noches de cambios ──────────────────────────────────────
# Hermana pequeña de `podar_en_destino`, y escrita con el mismo miedo: esto
# borra copias, así que EN LA DUDA NO BORRA. Tres frenos:
#
#   1. solo mira directorios de PRIMER nivel dentro de $DIR_CAMBIOS y solo si se
#      llaman AAAAMMDD-HHMM. Cualquier otra cosa que alguien deje ahí se queda;
#   2. nunca deja menos de $MINIMO_DIAS_CAMBIOS noches, aunque todas sean viejas
#      —si el servidor ha estado parado un mes, lo viejo es lo único que hay—;
#   3. si $DIR_CAMBIOS está vacío como variable, no se ejecuta nada.
#
# Borrar una noche NUNCA estropea otra: cada directorio se basta solo, no hay
# cadena que romper. Esa es la razón de haber elegido esta forma y no un tar
# incremental encadenado, donde perder el paquete entero invalida los parciales.
if [ -n "${DIR_CAMBIOS:-}" ] && [ -d "$DIR_CAMBIOS" ]; then
  patron='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
  n_noches=$(find "$DIR_CAMBIOS" -mindepth 1 -maxdepth 1 -type d -name "$patron" | wc -l)
  if [ "$n_noches" -le "$MINIMO_DIAS_CAMBIOS" ]; then
    echo "[$(date '+%F %T')] Cambios guardados: $n_noches noche(s); no se caduca nada (mínimo $MINIMO_DIAS_CAMBIOS)."
  else
    borrables=$(find "$DIR_CAMBIOS" -mindepth 1 -maxdepth 1 -type d -name "$patron" -mtime "+$RETENCION_DIAS" | sort)
    n_borrables=$(contar_lineas "$borrables")
    # Si caducar dejaría por debajo del mínimo, se quitan solo las más viejas
    # hasta llegar a él: mejor guardar de más que quedarse corto.
    max_a_borrar=$((n_noches - MINIMO_DIAS_CAMBIOS))
    [ "$n_borrables" -gt "$max_a_borrar" ] && n_borrables="$max_a_borrar"
    n_hechas=0
    if [ "$n_borrables" -gt 0 ]; then
      while IFS= read -r noche; do
        [ -n "$noche" ] || continue
        [ "$n_hechas" -lt "$n_borrables" ] || break
        rm -rf "$noche" && n_hechas=$((n_hechas + 1))
      done <<<"$borrables"
    fi
    echo "[$(date '+%F %T')] Cambios: $n_hechas noche(s) de más de $RETENCION_DIAS días borradas; quedan $((n_noches - n_hechas))."
  fi
fi

# ─── Rotación ────────────────────────────────────────────────────────────────
# Se guarda la última SEMANA de copias automáticas (Rodrigo, 03/09/2026: «en
# el servidor, la última semana; eso siempre»): los $DIAS_EN_SERVIDOR volcados
# más nuevos y el último paquete de ficheros (`copias_en_dias`). Las manuales
# (pre-deploy-*, etc.) NO se tocan:
# son puntos de rescate deliberados. Se decide por NOMBRE y no por edad, como
# en la poda de fuera; y si DIAS_EN_SERVIDOR no es un entero mayor que cero,
# no se borra nada. Llega aquí solo si el volcado de esta noche ha salido bien
# (si no, el script ya ha terminado antes): nunca se tira la de anoche sin
# tener la de hoy.
#
# ⚠️ `-maxdepth 1` NO es una optimización: desde que el espejo vive DENTRO de
# $DIR_BACKUPS, un `find` sin tope recorrería los ficheros de los clientes. Un
# documento subido por alguien y llamado `uploads-2019.tar.gz` encajaría en el
# patrón y se borraría de la copia de seguridad. Las copias están en la raíz.
if [[ "${DIAS_EN_SERVIDOR-}" =~ ^[0-9]+$ ]] && [ "$DIAS_EN_SERVIDOR" -ge 1 ]; then
  borradas=0
  for clase in 'auto-*.sql.gz' 'uploads-*.tar.gz'; do
    lista=$(find "$DIR_BACKUPS" -maxdepth 1 -name "$clase" -type f -printf '%f\n' | sort)
    n_clase=$(contar_lineas "$lista")
    n_sobran=$((n_clase - $(copias_en_dias "$clase" "$DIAS_EN_SERVIDOR")))
    [ "$n_sobran" -gt 0 ] || continue
    while IFS= read -r fichero; do
      [ -n "$fichero" ] || continue
      rm -f "$DIR_BACKUPS/$fichero" && borradas=$((borradas + 1))
    done <<<"$(printf '%s\n' "$lista" | head -n "$n_sobran")"
  done
  echo "[$(date '+%F %T')] Rotación: $borradas copia(s) borradas; se guardan los últimos $DIAS_EN_SERVIDOR días."
else
  echo "[$(date '+%F %T')] ⛔ DIAS_EN_SERVIDOR vale '${DIAS_EN_SERVIDOR-}': tiene que ser un entero mayor que cero. NO se rota nada."
fi

total=$(find "$DIR_BACKUPS" -maxdepth 1 -name 'auto-*.sql.gz' -type f | wc -l)
echo "[$(date '+%F %T')] Copias automáticas guardadas: $total · espacio: $(du -sh "$DIR_BACKUPS" | cut -f1)"

# ─── Copia FUERA del servidor ────────────────────────────────────────────────
# Lo de arriba vive en el mismo disco que la base: si se pierde el servidor, se
# pierde todo a la vez. Esto es lo único que protege de eso.
#
# Un fallo aquí NO aborta el script: la copia local ya está hecha, y perderla
# por un problema de red sería peor que quedarse sin la remota de hoy.
#
# Esto SUMA, no espeja: ni `sync` ni `--delete`, para que un borrado de aquí no
# viaje allí (ver «EL BORRADO NO VIAJA» en la cabecera). Lo que sobre fuera lo
# quita la poda propia del destino (los últimos $DIAS_FUERA días), no el
# reflejo de lo que pase aquí.
if [ -n "$DESTINO_REMOTO" ]; then
  echo "[$(date '+%F %T')] Copiando fuera del servidor → $DESTINO_REMOTO"
  ok_remoto=0
  case "$DESTINO_REMOTO" in
    *:/*|*@*:*)  # usuario@host:/ruta → rsync
      modo_remoto="rsync"
      # SIN --delete a propósito. `--exclude` para no subir volcados a medias
      # ni el espejo (ver «QUÉ SALE Y QUÉ NO» en la cabecera).
      rsync -az --exclude '*.parcial' --exclude 'uploads-espejo/' --exclude 'uploads-cambios/' \
        "$DIR_BACKUPS/" "$DESTINO_REMOTO/" && ok_remoto=1 || true
      if [ "$ok_remoto" = "1" ]; then
        echo "[$(date '+%F %T')] ⚠️ Destino rsync: aquí NO se caduca nada — este script no manda"
        echo "[$(date '+%F %T')]    órdenes de borrado a otra máquina. Que el otro servidor tenga"
        echo "[$(date '+%F %T')]    su propia limpieza, o su disco se llenará."
      fi
      ;;
    *:*)         # remoto:bucket de rclone
      modo_remoto="rclone"
      # `copy`, NUNCA `sync`: `sync` borraría allí lo que falte aquí.
      # El espejo y las noches de cambios NO salen: ver «QUÉ SALE Y QUÉ NO».
      rclone copy --exclude '*.parcial' --exclude 'uploads-espejo/**' --exclude 'uploads-cambios/**' \
        "$DIR_BACKUPS" "$DESTINO_REMOTO" && ok_remoto=1 || true
      # Solo se poda si lo de esta noche llegó: nada viejo se tira si no ha
      # entrado nada nuevo.
      if [ "$ok_remoto" = "1" ]; then podar_en_destino; fi
      ;;
    *)
      echo "[$(date '+%F %T')] ⚠️ DESTINO_REMOTO no parece ni rsync ni rclone: '$DESTINO_REMOTO'"
      ;;
  esac
  if [ "$ok_remoto" = "1" ]; then
    echo "[$(date '+%F %T')] OK copia externa."
  else
    echo "[$(date '+%F %T')] ⚠️ FALLÓ la copia externa. La local SÍ está hecha,"
    echo "[$(date '+%F %T')]    pero hoy no hay nada fuera del servidor."
    avisar "⚠️ La copia del CRM no ha salido del servidor" fallo "$(cuerpo_de_fallo "rclone/rsync no pudo copiar a $DESTINO_REMOTO")" || true
  fi
else
  echo "[$(date '+%F %T')] ⚠️ Sin DESTINO_REMOTO: las copias están en el MISMO disco"
  echo "[$(date '+%F %T')]    que la base de datos. Ver la cabecera de este script."
fi

trap - ERR
echo "[$(date '+%F %T')] ✅ Copia completada."

# El parte de los lunes, vaya bien o mal. No es adorno: sin un correo que se
# espera, el silencio no distingue «todo en orden» de «el servidor no existe».
if [ "$(date +%u)" = "1" ]; then
  avisar "Copia del CRM: parte semanal" resumen "$(cuerpo_semanal)" || true
fi
