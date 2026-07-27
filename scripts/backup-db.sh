#!/bin/bash
# backup-db.sh — copia de seguridad automática de la base de datos.
#
# QUÉ RESUELVE: hasta ahora solo se hacían volcados MANUALES antes de cada
# despliegue. Un fallo del disco del VPS entre despliegues se llevaba los datos
# reales de los clientes (Aumenta con 15 personas, la consulta de Laura) sin
# ninguna copia reciente. Esto lo automatiza.
#
# QUÉ HACE: un pg_dump comprimido de TODA la base (todos los tenants + master),
# con rotación por antigüedad. Es idempotente y no toca nada más.
#
# INSTALACIÓN EN EL VPS (una sola vez, como root):
#   chmod +x /opt/crm-salamandra/scripts/backup-db.sh
#   crontab -e
#   # copia diaria a las 03:15
#   15 3 * * * /opt/crm-salamandra/scripts/backup-db.sh >> /var/log/crm-backup.log 2>&1
#
# COMPROBAR QUE FUNCIONA:
#   /opt/crm-salamandra/scripts/backup-db.sh && ls -lh /opt/crm-salamandra/backups | tail
#
# RESTAURAR (¡ojo, sobrescribe!):
#   gunzip -c backups/auto-YYYYMMDD-HHMM.sql.gz | docker exec -i crm-salamandra-db-1 psql -U crm_user -d salamandra
#
# ⚠️ Esto es copia LOCAL en el mismo servidor: protege de un borrado accidental
# o de una migración que salga mal, NO de la pérdida del servidor entero. El
# siguiente paso pendiente es sincronizar la carpeta a un destino externo
# (S3/Backblaze/otro VPS) — ver RETENCION_DIAS y la nota del final.

set -euo pipefail

DIR_REPO="${DIR_REPO:-/opt/crm-salamandra}"
DIR_BACKUPS="${DIR_BACKUPS:-$DIR_REPO/backups}"
CONTENEDOR_DB="${CONTENEDOR_DB:-crm-salamandra-db-1}"
USUARIO_DB="${USUARIO_DB:-crm_user}"
NOMBRE_DB="${NOMBRE_DB:-salamandra}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
MINIMO_BYTES="${MINIMO_BYTES:-100000}" # por debajo de esto, el volcado es basura

marca=$(date +%Y%m%d-%H%M)
destino="$DIR_BACKUPS/auto-$marca.sql.gz"

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
echo "[$(date '+%F %T')] OK: $(du -h "$destino" | cut -f1)"

# Rotación: se borran las copias AUTOMÁTICAS antiguas. Las manuales
# (pre-deploy-*.sql.gz) NO se tocan: son puntos de rescate deliberados.
borradas=$(find "$DIR_BACKUPS" -name 'auto-*.sql.gz' -type f -mtime "+$RETENCION_DIAS" -print -delete | wc -l)
echo "[$(date '+%F %T')] Rotación: $borradas copia(s) de más de $RETENCION_DIAS días borradas."

total=$(find "$DIR_BACKUPS" -name 'auto-*.sql.gz' -type f | wc -l)
echo "[$(date '+%F %T')] Copias automáticas guardadas: $total · espacio: $(du -sh "$DIR_BACKUPS" | cut -f1)"
