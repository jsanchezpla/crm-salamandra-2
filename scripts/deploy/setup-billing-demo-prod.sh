#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# setup-billing-demo-prod.sh
#
# Despliega el módulo Facturación (rework + bugfixes) al tenant DEMO
# en el VPS de producción. Idempotente.
#
# Pasos:
#   1. git pull (trae código nuevo + scripts de migración)
#   2. Migración SQL del rework billing dentro del contenedor app
#   3. Activar el módulo billing en master.tenant_modules para demo
#   4. Añadir 'billing' al moduleAccess de los users del tenant demo
#   5. Asegurar que existe TenantBillingSettings con datos fiscales
#      (la migración ya inserta una fila vacía por defecto; hay que
#      rellenarla manualmente desde /facturacion/configuracion)
#   6. Reconstruir el contenedor app con el código nuevo
#
# Ejecutar en el VPS desde /opt/crm-salamandra
#
# Uso:    bash scripts/deploy/setup-billing-demo-prod.sh
# Probar: bash scripts/deploy/setup-billing-demo-prod.sh --dry-run
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

run() {
  echo "▶ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    eval "$@"
  fi
}

echo "════════════════════════════════════════════════════"
echo " Setup billing rework + demo seed (PROD VPS)        "
[[ $DRY_RUN -eq 1 ]] && echo " (DRY RUN — no se ejecuta nada)"
echo "════════════════════════════════════════════════════"

# ── 1. git pull ─────────────────────────────────────────────────────────
echo
echo "── Paso 1: actualizar código del repo"
run "git pull"

# ── 2. Migración SQL ────────────────────────────────────────────────────
echo
echo "── Paso 2: migración billing rework (multi-tenant, idempotente)"
run "docker cp scripts/migrate-billing-rework.js crm-salamandra-app-1:/app/scripts/migrate-billing-rework.js"
run "docker exec -w /app crm-salamandra-app-1 node scripts/migrate-billing-rework.js"

# ── 3. Activar billing en master.tenant_modules para demo ───────────────
echo
echo "── Paso 3: activar módulo billing en tenant demo"
run "docker exec crm-salamandra-db-1 psql -U crm_user -d salamandra -c \"
  INSERT INTO master.tenant_modules (id, tenant_id, module_key, enabled, version, schema_extensions, logic_overrides, feature_flags, created_at, updated_at)
  SELECT gen_random_uuid(), id, 'billing', true, '1.0.0', '{}', '{}', '{}', NOW(), NOW()
  FROM master.tenants WHERE slug = 'demo'
  ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, updated_at = NOW();
\""

# ── 4. Añadir 'billing' al moduleAccess de los users del tenant ─────────
echo
echo "── Paso 4: añadir 'billing' al moduleAccess de los users demo"
run "docker exec crm-salamandra-db-1 psql -U crm_user -d salamandra -c \"
  UPDATE master.users
  SET module_access = module_access || '[\\\"billing\\\"]'::jsonb
  WHERE tenant_id = (SELECT id FROM master.tenants WHERE slug = 'demo')
    AND NOT (module_access ? 'billing');
\""

# ── 5. Verificar settings (informativo) ─────────────────────────────────
echo
echo "── Paso 5: verificar tenant_billing_settings"
echo "  (la migración crea fila por defecto — rellena fiscalName/taxId desde /facturacion/configuracion)"
run "docker exec crm-salamandra-db-1 psql -U crm_user -d salamandra -c \"
  SELECT fiscal_name, tax_id, default_vat_rate FROM crm_demo.tenant_billing_settings;
\""

# ── 6. Deploy con código nuevo ──────────────────────────────────────────
echo
echo "── Paso 6: deploy (rebuild contenedor app con código nuevo)"
run "./deploy.sh"

# ── 7. (Opcional) Seed de demo billing ──────────────────────────────────
# El seed de datos de prueba SOLO se ejecuta si pasas --with-seed.
# En PRODUCCIÓN normalmente NO se ejecuta para no contaminar datos reales.
if [[ "${2:-}" == "--with-seed" ]]; then
  echo
  echo "── Paso 7 OPCIONAL: seed de demo (--with-seed activado)"
  run "docker cp scripts/seed-billing-demo.js crm-salamandra-app-1:/app/scripts/seed-billing-demo.js"
  run "docker exec -w /app crm-salamandra-app-1 node scripts/seed-billing-demo.js"
fi

echo
echo "════════════════════════════════════════════════════"
echo " ✓ Setup billing demo completado en VPS"
echo "════════════════════════════════════════════════════"
echo
echo "Comprobaciones manuales recomendadas:"
echo "  - Login admin demo en https://<dominio>/login"
echo "  - Ir a /facturacion/configuracion y rellenar datos fiscales"
echo "  - Crear factura de prueba en /facturacion/facturas"
echo "  - Verificar /facturacion/analitica/iva"
