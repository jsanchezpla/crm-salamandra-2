#!/usr/bin/env bash
#
# rotar-clave-bd.sh — cambia la contraseña de PostgreSQL en producción.
#
# CUÁNDO SE USA: cuando la contraseña se ha visto donde no debía (un chat, una
# captura, un log). Es la respuesta estándar a una credencial expuesta, y no se
# discute: si se ha visto, se cambia.
#
# ── LO QUE HACE, EN ORDEN, Y POR QUÉ ─────────────────────────────────────────
#  1. Genera la contraseña AQUÍ, en el servidor. Nunca viaja por chat ni por
#     WhatsApp, y no se pasa por argumento (los argumentos quedan en el historial
#     del shell y en la lista de procesos). Va por stdin y por variable.
#  2. `ALTER ROLE`. Cambiar POSTGRES_PASSWORD en el compose NO basta: esa
#     variable solo se usa la primera vez que se crea la base. El rol ya existe,
#     así que hay que cambiarlo en PostgreSQL.
#  3. COMPRUEBA que la nueva funciona ANTES de tocar la configuración. Si algo
#     falla aquí, no se ha roto nada todavía.
#  4. Actualiza .env.production (con copia de seguridad en 600).
#  5. Recrea el contenedor de la app para que lea la variable nueva.
#  6. Verifica que la app responde y que el volcado de seguridad sigue saliendo.
#  7. Cierra el fichero de secretos a 600 y borra las copias viejas, que llevan
#     la contraseña ANTERIOR y estaban en 644 — legibles por cualquiera.
#
# ── LO QUE NO SE ROMPE ───────────────────────────────────────────────────────
# El backup y los temporizadores entran por `docker exec` dentro del contenedor,
# sin contraseña. No hay que tocarlos.
#
# MARCHA ATRÁS: la copia .antes-de-rotar-* tiene la contraseña vieja. Si algo
# sale mal, se restaura ese fichero y se vuelve a hacer ALTER ROLE con el valor
# que contiene.
#
# Uso (en el VPS, como root):
#   bash scripts/deploy/rotar-clave-bd.sh
#   bash scripts/deploy/rotar-clave-bd.sh --simular    (no cambia nada)

set -euo pipefail

CARPETA="/opt/crm-salamandra"
ENV="$CARPETA/.env.production"
DB="crm-salamandra-db-1"
APP="crm-salamandra-app-1"
USUARIO="crm_user"
BASE="salamandra"
DESTINO_CLAVE="/root/.crm-db-password"
SIMULAR=false
[ "${1:-}" = "--simular" ] && SIMULAR=true

paso() { printf '\n▶ %s\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
mal()  { printf '  ✗ %s\n' "$1" >&2; }

cd "$CARPETA"

[ -f "$ENV" ] || { mal "No existe $ENV"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$DB"  || { mal "No corre $DB";  exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$APP" || { mal "No corre $APP"; exit 1; }

paso "Estado de partida"
ok "$(docker ps --filter "name=$APP" --format '{{.Status}}')"
ok "permisos actuales del env: $(stat -c '%a' "$ENV")"

# ── 1. Contraseña nueva ──────────────────────────────────────────────────────
# Sin caracteres que compliquen la URL de conexión ni el escapado del shell.
NUEVA="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 40)"
[ ${#NUEVA} -eq 40 ] || { mal "No se pudo generar la contraseña"; exit 1; }
paso "Contraseña nueva generada (40 caracteres, no se muestra)"

if [ "$SIMULAR" = true ]; then
  paso "SIMULACIÓN: no se cambia nada"
  ok "se habría hecho ALTER ROLE, actualizado el env, recreado la app y cerrado permisos"
  exit 0
fi

# ── 2. Cambiar el rol ────────────────────────────────────────────────────────
# Por stdin: así no aparece en la lista de procesos.
paso "Cambiando la contraseña del rol en PostgreSQL"
printf "ALTER ROLE %s WITH PASSWORD '%s';\n" "$USUARIO" "$NUEVA" \
  | docker exec -i "$DB" psql -U "$USUARIO" -d "$BASE" -q
ok "ALTER ROLE aplicado"

# ── 3. Comprobar ANTES de tocar la configuración ─────────────────────────────
paso "Comprobando que la contraseña nueva funciona"
if docker exec -i -e PGPASSWORD="$NUEVA" "$DB" psql -U "$USUARIO" -d "$BASE" -h 127.0.0.1 -tAc 'SELECT 1' | grep -qx 1; then
  ok "conecta con la nueva"
else
  mal "La nueva NO conecta. NO se toca la configuración: la app sigue con la vieja."
  mal "Revisa a mano antes de reintentar."
  exit 1
fi

# ── 4. Actualizar el fichero de entorno ──────────────────────────────────────
paso "Actualizando $ENV"
COPIA="$ENV.antes-de-rotar-$(date +%Y%m%d-%H%M%S)"
cp "$ENV" "$COPIA"
chmod 600 "$COPIA"
ok "copia de seguridad en $(basename "$COPIA") (600)"

# La contraseña entra por variable de entorno, nunca por argumento.
NUEVA="$NUEVA" python3 - "$ENV" <<'PY'
import os, re, sys
ruta = sys.argv[1]
nueva = os.environ["NUEVA"]
texto = open(ruta, encoding="utf-8").read()

# DATABASE_URL=postgres://usuario:LO_QUE_SEA@host:puerto/base
texto, n1 = re.subn(
    r'(?m)^(DATABASE_URL=[a-z]+://[^:@\s]+:)[^@\s]*(@)',
    lambda m: m.group(1) + nueva + m.group(2),
    texto,
)
# POSTGRES_PASSWORD=...  (solo se usa al crear la base, pero se deja coherente)
texto, n2 = re.subn(r'(?m)^(POSTGRES_PASSWORD=).*$', lambda m: m.group(1) + nueva, texto)

open(ruta, "w", encoding="utf-8").write(texto)
print(f"  · DATABASE_URL actualizada: {n1} · POSTGRES_PASSWORD: {n2}")
if n1 != 1:
    sys.exit("  ✗ No se encontró exactamente una DATABASE_URL. Revisa el fichero.")
PY

chmod 600 "$ENV"
ok "env actualizado y cerrado a 600"

# ── 5. Recrear la app ────────────────────────────────────────────────────────
paso "Recreando el contenedor de la app (unos segundos de corte)"
docker compose up -d --force-recreate --no-deps app >/dev/null 2>&1
sleep 20
ok "$(docker ps --filter "name=$APP" --format '{{.Status}}')"

# ── 6. Verificar ─────────────────────────────────────────────────────────────
paso "Verificando"
CODIGO=""
for _ in 1 2 3 4 5 6; do
  CODIGO="$(curl -s -o /dev/null -w '%{http_code}' -m 15 http://127.0.0.1:3000/login || true)"
  [ "$CODIGO" = "200" ] && break
  sleep 5
done
[ "$CODIGO" = "200" ] && ok "la app responde (/login -> 200)" || { mal "la app NO responde (HTTP $CODIGO)"; mal "Restaura $(basename "$COPIA") y revisa los logs."; exit 1; }

if docker exec "$APP" node -e "
  const {Sequelize}=require('sequelize');
  new Sequelize(process.env.DATABASE_URL,{logging:false}).authenticate()
    .then(()=>{console.log('ok');process.exit(0)})
    .catch(e=>{console.error(e.message);process.exit(1)});
" 2>/dev/null | grep -qx ok; then
  ok "la app conecta a la base con la contraseña nueva"
else
  mal "la app NO conecta a la base. Restaura $(basename "$COPIA") y recrea el contenedor."
  exit 1
fi

if docker exec "$DB" pg_dump -U "$USUARIO" "$BASE" --schema-only >/dev/null 2>&1; then
  ok "el volcado de seguridad sigue funcionando"
else
  mal "pg_dump falla — revisar antes de la copia de esta noche"
fi

# ── 7. Limpiar lo que sobra ──────────────────────────────────────────────────
paso "Cerrando la puerta que quedaba abierta"
BORRADAS=0
for f in "$ENV".save "$ENV".bak-*; do
  [ -e "$f" ] || continue
  rm -f "$f"
  BORRADAS=$((BORRADAS+1))
done
ok "$BORRADAS copia(s) vieja(s) del env borradas (llevaban la contraseña anterior en 644)"

printf '%s\n' "$NUEVA" > "$DESTINO_CLAVE"
chmod 600 "$DESTINO_CLAVE"
unset NUEVA

paso "Hecho"
ok "La contraseña nueva está en $DESTINO_CLAVE (solo root)"
ok "Guárdala en el gestor de contraseñas y borra el fichero:  shred -u $DESTINO_CLAVE"
ok "Marcha atrás, si hiciera falta: $(basename "$COPIA")"
printf '\n'
