/**
 * add-orders-module-spain-enzymes.js
 *
 * Activa el módulo "orders" (Pedidos) en el tenant spain_enzymes:
 *
 * 1. Crea las 3 tablas `orders`, `order_lines`, `order_settings` con SQL
 *    crudo en el schema `crm_spain_enzymes`. NO se añaden FKs físicas a
 *    clients/outbound_products/invoices porque, aunque esas tablas sí
 *    existen en este tenant, queremos un script multi-tenant-friendly
 *    (otros tenants podrían no tenerlas). Las asociaciones lógicas
 *    Sequelize sí se cargan via tenantDb.js.
 *
 * 2. Inserta una fila inicial en `order_settings` con precio de
 *    transporte 0 € (Laura lo configura desde la UI).
 *
 * 3. Registra el módulo `orders` en `master.tenant_modules` con
 *    `uiOverride: null` (UI genérica, no se necesita override).
 *
 * 4. Añade "orders" al `moduleAccess` del admin del tenant.
 *
 * Idempotente.
 *
 * Uso local:  npm run db:add-orders-spain-enzymes
 * Uso VPS:    npm run db:add-orders-spain-enzymes:prod
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "spain_enzymes";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL_DEFAULT = "admin@spainenzymes.com"; // fallback si no se encuentra otro admin

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function ensureEnum(rawDb, schema, name, values) {
  const exists = `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace WHERE tp.typname = $1 AND n.nspname = $2`;
  const [rows] = await rawDb.query(exists, { bind: [name, schema] });
  if (rows.length === 0) {
    const valuesSql = values.map((v) => `'${v}'`).join(",");
    await rawDb.query(`CREATE TYPE "${schema}"."${name}" AS ENUM (${valuesSql})`);
    log(`  ✓ enum ${name}: creado`);
  } else {
    log(`  · enum ${name}: ya existe`);
  }
}

async function createOrdersTablesIfNotExist(rawDb, schema) {
  await ensureEnum(rawDb, schema, "enum_orders_status", [
    "draft",
    "confirmed",
    "preparing",
    "shipped",
    "completed",
    "cancelled",
  ]);

  // orders
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."orders" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL,
      status "${schema}"."enum_orders_status" NOT NULL DEFAULT 'draft',
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      transport_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      scheduled_date DATE,
      delivered_at TIMESTAMPTZ,
      invoice_id UUID,
      notes TEXT,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await rawDb.query(`CREATE INDEX IF NOT EXISTS "orders_client_id_idx" ON "${schema}"."orders" (client_id)`);
  await rawDb.query(`CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "${schema}"."orders" (status)`);
  await rawDb.query(`CREATE INDEX IF NOT EXISTS "orders_invoice_id_idx" ON "${schema}"."orders" (invoice_id)`);
  log(`  ✓ tabla orders`);

  // order_lines
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."order_lines" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES "${schema}"."orders"(id) ON DELETE CASCADE,
      outbound_product_id UUID,
      product_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await rawDb.query(`CREATE INDEX IF NOT EXISTS "order_lines_order_id_idx" ON "${schema}"."order_lines" (order_id)`);
  await rawDb.query(`CREATE INDEX IF NOT EXISTS "order_lines_outbound_product_id_idx" ON "${schema}"."order_lines" (outbound_product_id)`);
  log(`  ✓ tabla order_lines`);

  // order_settings
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."order_settings" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transport_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      transport_vat_rate DECIMAL(5,2) NOT NULL DEFAULT 21,
      default_vat_rate DECIMAL(5,2) NOT NULL DEFAULT 21,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log(`  ✓ tabla order_settings`);
}

async function ensureOrderSettings(tenantModels) {
  const { OrderSettings } = tenantModels;
  const row = await OrderSettings.findOne();
  if (!row) {
    await OrderSettings.create({
      transportPrice: 0,
      transportVatRate: 21,
      defaultVatRate: 21,
    });
    log(`  ✓ fila inicial en order_settings`);
  } else {
    log(`  · order_settings ya tiene fila`);
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Spain Enzymes — Activar módulo Pedidos \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  header("Verificando tenant spain_enzymes...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant spain_enzymes no encontrado.\n");
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  header(`Creando tablas en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await createOrdersTablesIfNotExist(rawDb, SCHEMA);
  await rawDb.close();

  header("Registrando módulo orders en master.tenant_modules...");
  const [moduleRow, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "orders" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "orders",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  if (!modCreated) {
    await moduleRow.update({ enabled: true });
    log("· Módulo ya existía — re-activado");
  } else {
    log("✓ Módulo orders creado");
  }

  header("Actualizando moduleAccess de los admins...");
  const admins = await User.findAll({ where: { tenantId: tenant.id, role: ["admin", "superadmin"] } });
  if (admins.length === 0) {
    log(`· No se encontraron admins del tenant (busca también ${ADMIN_EMAIL_DEFAULT})`);
  }
  let updated = 0;
  for (const admin of admins) {
    const access = Array.isArray(admin.moduleAccess) ? admin.moduleAccess : [];
    if (!access.includes("orders")) {
      await admin.update({ moduleAccess: [...access, "orders"] });
      updated++;
      log(`  ✓ "orders" añadido a ${admin.email}`);
    } else {
      log(`  · ${admin.email} ya tenía acceso a orders`);
    }
  }

  header("Configuración inicial de pedidos...");
  const { models } = getTenantDb(SLUG);
  await ensureOrderSettings(models);

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Schema:        ${SCHEMA}\n`);
  process.stdout.write(`  Admins act.:   ${updated}\n`);
  process.stdout.write(`  Próx. paso:    Configurar precio de transporte\n`);
  process.stdout.write(`                 en /pedidos/configuracion\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
