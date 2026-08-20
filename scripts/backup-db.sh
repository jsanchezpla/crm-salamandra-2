#!/bin/bash
# backup-db.sh — copia de seguridad automática de la base de datos.
#
# QUÉ RESUELVE: hasta ahora solo se hacían volcados MANUALES antes de cada
# despliegue. Un fallo del disco del VPS entre despliegues se llevaba los datos
# reales de los clientes (Aumenta con 15 personas, la consulta de Laura) sin
# ninguna copia reciente. Esto lo automatiza.
#
# QUÉ HACE: un pg_dump comprimido de TODA la base (todos los tenants + master)
# MÁS los ficheros subidos (uploads/), con rotación por antigüedad y, si está
# configurado, copia a un destino FUERA del servidor. Es idempotente.
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
#   2) Ficheros (contratos firmados, informes, adjuntos):
#      tar xzf backups/uploads-AAAAMMDD-HHMM.tar.gz -C /opt/crm-salamandra
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

set -euo pipefail

DIR_REPO="${DIR_REPO:-/opt/crm-salamandra}"
DIR_BACKUPS="${DIR_BACKUPS:-$DIR_REPO/backups}"
DIR_UPLOADS="${UPLOADS_HOST_DIR:-$DIR_REPO/uploads}"
CONTENEDOR_DB="${CONTENEDOR_DB:-crm-salamandra-db-1}"
USUARIO_DB="${USUARIO_DB:-crm_user}"
NOMBRE_DB="${NOMBRE_DB:-salamandra}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
MINIMO_BYTES="${MINIMO_BYTES:-100000}" # por debajo de esto, el volcado es basura
DESTINO_REMOTO="${DESTINO_REMOTO:-}"   # vacío = solo copia local (ver cabecera)

marca=$(date +%Y%m%d-%H%M)
destino="$DIR_BACKUPS/auto-$marca.sql.gz"
destino_uploads="$DIR_BACKUPS/uploads-$marca.tar.gz"

# Un fallo NO puede pasar desapercibido: el `set -e` mataría el script sin dejar
# más rastro que una línea en un log que nadie lee. Esta trampa garantiza que la
# última línea diga siempre si la copia salió o no.
fallo() {
  echo "[$(date '+%F %T')] ❌ LA COPIA HA FALLADO (línea $1). Revísalo: los datos"
  echo "[$(date '+%F %T')]    de hoy NO están respaldados."
}
trap 'fallo $LINENO' ERR

mkdir -p "$DIR_BACKUPS"

echo "[$(date '+%F %T')] Copia de seguridad → $destino"

# El volcado va primero a un temporal: si pg_dump falla a mitad, no queda un
# .sql.gz corrupto con nombre de copia buena.
tmp="$destino.parcial"
if ! docker exec "$CONTENEDOR_DB" pg_dump -U "$USUARIO_DB" "$NOMBRE_DB" | gzip > "$tmp"; then
  echo "[$(date '+%F %T')] ERROR: pg_dump falló. Se descarta el fichero parcial."
  rm -f "$tmp"
  exit 1
fi

tam=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
if [ "$tam" -lt "$MINIMO_BYTES" ]; then
  echo "[$(date '+%F %T')] ERROR: el volcado pesa $tam bytes (mínimo $MINIMO_BYTES). Se descarta."
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$destino"
echo "[$(date '+%F %T')] OK base de datos: $(du -h "$destino" | cut -f1)"

# ─── Ficheros subidos ────────────────────────────────────────────────────────
# Contratos FIRMADOS, informes clínicos, adjuntos de clientes y de tickets. No
# se regeneran solos: restaurar únicamente la base deja las fichas apuntando a
# papeles que ya no existen. Siete módulos escriben aquí.
if [ -d "$DIR_UPLOADS" ]; then
  tmp_up="$destino_uploads.parcial"
  if tar czf "$tmp_up" -C "$(dirname "$DIR_UPLOADS")" "$(basename "$DIR_UPLOADS")"; then
    mv "$tmp_up" "$destino_uploads"
    echo "[$(date '+%F %T')] OK ficheros: $(du -h "$destino_uploads" | cut -f1)"
  else
    rm -f "$tmp_up"
    echo "[$(date '+%F %T')] ⚠️ No se pudo empaquetar $DIR_UPLOADS. La base SÍ está copiada."
  fi
else
  echo "[$(date '+%F %T')] ⚠️ No existe $DIR_UPLOADS — no hay ficheros que copiar."
fi

# ─── Rotación ────────────────────────────────────────────────────────────────
# Se borran las copias AUTOMÁTICAS antiguas. Las manuales (pre-deploy-*, etc.)
# NO se tocan: son puntos de rescate deliberados.
borradas=$(find "$DIR_BACKUPS" \( -name 'auto-*.sql.gz' -o -name 'uploads-*.tar.gz' \) \
  -type f -mtime "+$RETENCION_DIAS" -print -delete | wc -l)
echo "[$(date '+%F %T')] Rotación: $borradas copia(s) de más de $RETENCION_DIAS días borradas."

total=$(find "$DIR_BACKUPS" -name 'auto-*.sql.gz' -type f | wc -l)
echo "[$(date '+%F %T')] Copias automáticas guardadas: $total · espacio: $(du -sh "$DIR_BACKUPS" | cut -f1)"

# ─── Copia FUERA del servidor ────────────────────────────────────────────────
# Lo de arriba vive en el mismo disco que la base: si se pierde el servidor, se
# pierde todo a la vez. Esto es lo único que protege de eso.
#
# Un fallo aquí NO aborta el script: la copia local ya está hecha, y perderla
# por un problema de red sería peor que quedarse sin la remota de hoy.
if [ -n "$DESTINO_REMOTO" ]; then
  echo "[$(date '+%F %T')] Sincronizando fuera del servidor → $DESTINO_REMOTO"
  ok_remoto=0
  case "$DESTINO_REMOTO" in
    *:/*|*@*:*)  # usuario@host:/ruta → rsync
      rsync -az --delete "$DIR_BACKUPS/" "$DESTINO_REMOTO/" && ok_remoto=1 || true
      ;;
    *:*)         # remoto:bucket de rclone
      rclone sync "$DIR_BACKUPS" "$DESTINO_REMOTO" && ok_remoto=1 || true
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
  fi
else
  echo "[$(date '+%F %T')] ⚠️ Sin DESTINO_REMOTO: las copias están en el MISMO disco"
  echo "[$(date '+%F %T')]    que la base de datos. Ver la cabecera de este script."
fi

trap - ERR
echo "[$(date '+%F %T')] ✅ Copia completada."
