/**
 * add-clients-module-nutri-laura.js
 *
 * Activa el módulo "clients" en el tenant nutri_laura:
 *
 * 1. Crea la tabla `clients` en `crm_nutri_laura` con SQL crudo
 *    (sin FKs a tablas inexistentes como Project, Invoice, etc.;
 *     misma estrategia que add-leads-module-nutri-laura.js).
 * 2. Registra el módulo `clients` en `master.tenant_modules`
 *    sin uiOverride: usa la página genérica /clientes.
 * 3. Añade "clients" al `moduleAccess` del admin
 *    (admin@nutri-laura.es).
 *
 * Idempotente: re-ejecutar no rompe nada ni genera duplicados.
 *
 * Uso local: npm run db:add-clients-nutri-laura
 * Uso VPS:   npm run db:add-clients-nutri-laura:prod
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@nutri-laura.es";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

/**
 * Crea la tabla `clients` con SQL crudo. No usamos `Client.sync()`
 * porque Sequelize añadiría FKs por las asociaciones definidas en
 * tenantDb.js (Project, Invoice, Cost, etc.), y esas tablas no
 * existen en este tenant. Cuando se activen esos módulos, se
 * podrán añadir FKs con un ALTER posterior.
 */
async function createClientsTableIfNotExist(rawDb, schema) {
  const enumExistsSql = `SELECT 1 FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    WHERE tp.typname = $1 AND n.nspname = $2`;

  const [typeRows] = await rawDb.query(enumExistsSql, {
    bind: ["enum_clients_type", schema],
  });
  if (typeRows.length === 0) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_clients_type" AS ENUM ('individual','company')`
    );
    log(`  ✓ enum enum_clients_type: creado`);
  } else {
    log(`  · enum enum_clients_type: ya existe`);
  }

  const [statusRows] = await rawDb.query(enumExistsSql, {
    bind: ["enum_clients_status", schema],
  });
  if (statusRows.length === 0) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_clients_status" AS ENUM ('active','inactive','prospect')`
    );
    log(`  ✓ enum enum_clients_status: creado`);
  } else {
    log(`  · enum enum_clients_status: ya existe`);
  }

  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."clients" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type "${schema}"."enum_clients_type" NOT NULL DEFAULT 'company',
      name VARCHAR(255) NOT NULL,
      tax_id VARCHAR(255),
      fiscal_name VARCHAR(255),
      fiscal_address VARCHAR(255),
      fiscal_city VARCHAR(255),
      fiscal_zip VARCHAR(20),
      fiscal_country CHAR(2) NOT NULL DEFAULT 'ES',
      email VARCHAR(255),
      phone VARCHAR(255),
      address JSONB DEFAULT '{}'::jsonb,
      status "${schema}"."enum_clients_status" NOT NULL DEFAULT 'active',
      portal_access BOOLEAN DEFAULT false,
      portal_email VARCHAR(255),
      notes TEXT,
      custom_fields JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await rawDb.query(
    `CREATE INDEX IF NOT EXISTS "clients_email_idx" ON "${schema}"."clients" (email)`
  );
  await rawDb.query(
    `CREATE INDEX IF NOT EXISTS "clients_status_idx" ON "${schema}"."clients" (status)`
  );

  log(`  ✓ Tabla clients lista`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Activar módulo Clients   \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ───────────────────────────────────────────────────
  header("Verificando tenant nutri_laura...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(
      "\n✗ Tenant nutri_laura no encontrado. Ejecuta `npm run db:seed:nutri-laura` primero.\n"
    );
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Crear tabla `clients` con SQL crudo ────────────────────────────────
  header(`Creando tabla clients en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  await createClientsTableIfNotExist(rawDb, SCHEMA);
  await rawDb.close();

  // ── 3. Registrar módulo clients ───────────────────────────────────────────
  header("Registrando módulo clients en master.tenant_modules...");
  const [module, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "clients" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "clients",
      enabled: true,
      version: "1.0.0",
      uiOverride: null,
      schemaExtensions: {
        edad: { type: "string" },
        motivo: { type: "text" },
        info_adicional: { type: "text" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });

  if (!modCreated) {
    await module.update({ enabled: true });
    log("· Módulo ya existía — habilitado");
  } else {
    log("✓ Módulo clients creado");
  }

  // ── 4. moduleAccess del admin ─────────────────────────────────────────────
  header("Actualizando moduleAccess del admin...");
  const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    process.stderr.write(`\n✗ Usuario ${ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }
  const currentAccess = admin.moduleAccess ?? [];
  if (!currentAccess.includes("clients")) {
    await admin.update({ moduleAccess: [...currentAccess, "clients"] });
    log(`✓ "clients" añadido a moduleAccess de ${ADMIN_EMAIL}`);
  } else {
    log(`· ${ADMIN_EMAIL} ya tenía acceso a clients`);
  }

  // ── 5. Resumen ────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!                                \n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Schema:                     ${SCHEMA}\n`);
  process.stdout.write(`  Tabla:                      clients\n`);
  process.stdout.write(`  Módulo:                     clients (sin uiOverride)\n`);
  process.stdout.write(`  Cuenta admin:               ${ADMIN_EMAIL}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
