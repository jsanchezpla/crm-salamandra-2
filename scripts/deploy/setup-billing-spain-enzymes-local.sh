#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# setup-billing-spain-enzymes-local.sh
#
# Activa el módulo Facturación en el tenant `spain_enzymes` (LOCAL) y
# carga datos de prueba con perfil de empresa de enzimas industriales.
#
# IMPORTANTE: spain_enzymes existe SOLO en el entorno local. No está en
# el VPS de producción. Este script asume que estás trabajando contra
# tu PostgreSQL local (.env.local). Idempotente.
#
# Pasos:
#   1. Asegurar la migración billing-rework (idempotente; ya estará
#      aplicada si ejecutaste antes db:migrate:billing-rework).
#   2. Activar billing en master.tenant_modules para spain_enzymes.
#   3. Conceder a los users del tenant todos los módulos enabled.
#   4. Crear 3 TeamMembers si no existen.
#   5. Rellenar TenantBillingSettings con datos fiscales de Spain Enzymes.
#   6. Rellenar fiscal_name + tax_id en los primeros 8 clientes.
#   7. Ejecutar el seed de billing con perfil de empresa de enzimas
#      (11 facturas, ~100 costes, 8 cobros, 1 rectificativa).
#
# Uso:
#   bash scripts/deploy/setup-billing-spain-enzymes-local.sh
#
# Prerequisitos:
#   - Tenant spain_enzymes ya existe (status=active) y tiene clientes.
#   - .env.local con DATABASE_URL apuntando a tu Postgres local.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo "════════════════════════════════════════════════════"
echo " Setup billing en spain_enzymes (LOCAL)             "
echo "════════════════════════════════════════════════════"

# ── 1. Migración billing-rework (idempotente) ──────────────────────────
echo
echo "── Paso 1: aplicar migración billing-rework (idempotente)"
npm run db:migrate:billing-rework

# ── 2-6. Activar módulo, crear TeamMembers, settings, datos fiscales ──
echo
echo "── Pasos 2-6: setup tenant_modules, users, team_members, settings, clientes"
node --env-file=.env.local --input-type=module -e "
import { Sequelize } from 'sequelize';
const s = new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false });

// 2. Activar billing en tenant_modules
const [tRows] = await s.query(\"SELECT id FROM master.tenants WHERE slug = 'spain_enzymes'\");
if (tRows.length === 0) { console.error('✗ Tenant spain_enzymes no encontrado'); process.exit(1); }
const tenantId = tRows[0].id;

await s.query(\`
  INSERT INTO master.tenant_modules (id, tenant_id, module_key, enabled, version, schema_extensions, logic_overrides, feature_flags, created_at, updated_at)
  VALUES (gen_random_uuid(), \$1, 'billing', true, '1.0.0', '{}', '{}', '{}', NOW(), NOW())
  ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, updated_at = NOW()
\`, { bind: [tenantId] });
console.log('  ✓ Módulo billing activado');

// 3. Dar acceso a TODOS los módulos del tenant a los admins
await s.query(\`
  UPDATE master.users
  SET module_access = (
    SELECT jsonb_agg(module_key ORDER BY module_key)
    FROM master.tenant_modules
    WHERE tenant_id = \$1 AND enabled = true
  )
  WHERE tenant_id = \$1 AND role IN ('admin','superadmin')
\`, { bind: [tenantId] });
console.log('  ✓ moduleAccess actualizado para admins');

// 4. Crear TeamMembers si no existen (3 perfiles)
await s.query(\`
  INSERT INTO crm_spain_enzymes.team_members
    (id, display_name, email, position, department, hourly_cost, hourly_rate, monthly_salary, currency, status, hired_at, custom_fields, created_at, updated_at)
  VALUES
    (gen_random_uuid(), 'Marc Solé',  'marc.sole@spain-enzymes.local',  'Director Técnico',   'I+D',         35, 90, 3500, 'EUR', 'active', '2023-04-01', '{}', NOW(), NOW()),
    (gen_random_uuid(), 'Laia Vidal', 'laia.vidal@spain-enzymes.local', 'Comercial Senior',   'Comercial',   28, 70, 2800, 'EUR', 'active', '2024-01-15', '{}', NOW(), NOW()),
    (gen_random_uuid(), 'Jordi Puig', 'jordi.puig@spain-enzymes.local', 'Técnico Producción', 'Producción',  22, 50, 2200, 'EUR', 'active', '2023-09-01', '{}', NOW(), NOW())
  ON CONFLICT (email) DO NOTHING
\`);
console.log('  ✓ TeamMembers asegurados (Marc, Laia, Jordi)');

// 5. Settings fiscales del emisor
await s.query(\`
  UPDATE crm_spain_enzymes.tenant_billing_settings
  SET fiscal_name = 'Spain Enzymes S.L.',
      tax_id = 'B86543219',
      fiscal_address = 'Polígono Industrial Can Pelegrí, Nave 7',
      fiscal_city = 'Castellbisbal',
      fiscal_zip = '08755',
      fiscal_country = 'ES',
      invoice_footer_text = 'Spain Enzymes S.L. · Inscrita en el Registro Mercantil de Barcelona',
      updated_at = NOW()
\`);
console.log('  ✓ Datos fiscales del tenant actualizados');

// 6. Datos fiscales en los primeros 8 clientes que no los tengan
await s.query(\`
  WITH targets AS (
    SELECT id, name, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM crm_spain_enzymes.clients
    WHERE fiscal_name IS NULL
    LIMIT 8
  )
  UPDATE crm_spain_enzymes.clients c
  SET fiscal_name = t.name || ' S.L.',
      tax_id = 'B' || LPAD((10000000 + t.rn * 7654321 % 89999999)::text, 8, '0'),
      fiscal_address = 'Calle ' || split_part(t.name, ' ', 1) || ' ' || (10 + t.rn * 7)::text,
      fiscal_city = (ARRAY['Barcelona','Madrid','Valencia','Sevilla','Bilbao','Málaga'])[(t.rn % 6) + 1],
      fiscal_zip = LPAD((28000 + t.rn * 137 % 999)::text, 5, '0'),
      fiscal_country = 'ES'
  FROM targets t
  WHERE c.id = t.id
\`);
console.log('  ✓ 8 clientes con datos fiscales');

await s.close();
"

# ── 7. Seed de datos de prueba ─────────────────────────────────────────
echo
echo "── Paso 7: seed billing con perfil de empresa de enzimas"
npm run db:seed:billing:spain

echo
echo "════════════════════════════════════════════════════"
echo " ✓ Setup billing spain_enzymes (local) completado"
echo "════════════════════════════════════════════════════"
echo
echo "Acceso:"
echo "  URL:        http://localhost:3000/login"
echo "  Tenant:     spain-enzymes (subdominio o x-tenant)"
echo "  Email:      admin@spain-enzymes.salamandra"
echo
echo "Comprueba:"
echo "  - /facturacion              (Resumen con KPIs)"
echo "  - /facturacion/configuracion (datos fiscales del tenant)"
echo "  - /facturacion/facturas     (11 facturas demo)"
echo "  - /facturacion/analitica/iva (Libro IVA + Modelo 303)"
