/**
 * add-team-module-nutri-laura.js
 *
 * Activa el módulo "team" (Equipo & RRHH) en el tenant nutri_laura, que arrancó
 * como tenant mínimo y NO tiene la tabla team_members (las migraciones de team
 * solo ALTER-an, nunca crean la tabla base). Laura va a fichar nutricionistas.
 *
 * 1. Crea en crm_nutri_laura, con SQL crudo y sin FKs a tablas inexistentes:
 *    - enum enum_team_members_status,
 *    - tabla team_members con el JUEGO COMPLETO de columnas del modelo
 *      (incluye specialties y avatar_color, ya en producción),
 *    - tabla team_member_modules (config de módulos por miembro).
 * 2. Registra el módulo `team` en master.tenant_modules (página genérica /equipo).
 * 3. Añade "team" al moduleAccess del admin (admin@nutri-laura.es).
 * 4. Da de alta a Laura como PRIMER miembro del equipo (nutricionista),
 *    enlazada al usuario admin para que auto-firme sus planes/notas.
 * 5. Invalida la caché del tenant.
 *
 * Idempotente: re-ejecutar no duplica ni rompe.
 *
 * Uso local: node --env-file=.env.local scripts/add-team-module-nutri-laura.js
 * Uso VPS:   docker exec crm-salamandra-app-1 node scripts/add-team-module-nutri-laura.js
 */

import { Sequelize } from "sequelize";
import { randomUUID } from "node:crypto";
import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { closeAllConnections } from "../../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@nutri-laura.es";
const LAURA = { displayName: "Laura Barbero", email: "info@tunutrilaura.com", position: "Nutricionista" };

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function createTeamTables(rawDb, schema) {
  const [typeRows] = await rawDb.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace
      WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: ["enum_team_members_status", schema] }
  );
  if (typeRows.length === 0) {
    await rawDb.query(`CREATE TYPE "${schema}"."enum_team_members_status" AS ENUM ('active','inactive','on_leave')`);
    log("✓ enum enum_team_members_status: creado");
  } else {
    log("· enum enum_team_members_status: ya existe");
  }

  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."team_members" (
      id UUID PRIMARY KEY,
      user_id UUID UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE,
      position VARCHAR(255),
      department VARCHAR(255),
      phone VARCHAR(255),
      avatar_url VARCHAR(255),
      avatar_color VARCHAR(7),
      hourly_cost NUMERIC(10,2),
      hourly_rate NUMERIC(10,2),
      annual_gross NUMERIC(10,2),
      payment_periods INTEGER NOT NULL DEFAULT 12,
      monthly_salary NUMERIC(10,2),
      currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
      status "${schema}"."enum_team_members_status" NOT NULL DEFAULT 'active',
      hired_at DATE,
      notes TEXT,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log("✓ tabla team_members lista");

  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."team_member_modules" (
      id UUID PRIMARY KEY,
      team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
      module_key VARCHAR(64) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT team_member_modules_uq UNIQUE (team_member_id, module_key)
    )
  `);
  await rawDb.query(
    `CREATE INDEX IF NOT EXISTS team_member_modules_team_member_idx
       ON "${schema}"."team_member_modules" (team_member_id)`
  );
  log("✓ tabla team_member_modules lista");
}

async function seedLaura(rawDb, schema, userId) {
  // avatar_color determinista (mismo criterio que migrate-team-members-avatar-color).
  const id = randomUUID();
  const [rows] = await rawDb.query(
    `INSERT INTO "${schema}"."team_members"
       (id, user_id, display_name, email, position, status, specialties,
        avatar_color, currency, payment_periods, custom_fields, created_at, updated_at)
     SELECT :id, :userId, :displayName, :email, :position, 'active', '["nutricion"]'::jsonb,
            '#' || SUBSTR(MD5(:id), 1, 6), 'EUR', 12, '{}'::jsonb, now(), now()
     WHERE NOT EXISTS (
       SELECT 1 FROM "${schema}"."team_members"
        WHERE user_id = :userId OR lower(email) = lower(:email)
     )
     RETURNING id`,
    { replacements: { id, userId, displayName: LAURA.displayName, email: LAURA.email, position: LAURA.position } }
  );
  if (rows.length > 0) log(`✓ Laura dada de alta como miembro del equipo (nutricionista)`);
  else log("· Laura ya existía como miembro — no se duplica");
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Activar módulo Equipo    \n");
  process.stdout.write("════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  header("Verificando tenant nutri_laura...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant nutri_laura no encontrado.\n");
    process.exit(1);
  }
  log(`✓ Tenant: ${tenant.name} (id: ${tenant.id})`);

  const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    process.stderr.write(`\n✗ Usuario ${ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }

  header(`Creando tablas de equipo en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await createTeamTables(rawDb, SCHEMA);

  header("Dando de alta a Laura...");
  await seedLaura(rawDb, SCHEMA, admin.id);
  await rawDb.close();

  header("Registrando módulo team en master.tenant_modules...");
  const [module, created] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "team" },
    defaults: {
      tenantId: tenant.id, moduleKey: "team", enabled: true, version: "1.0.0",
      uiOverride: null, schemaExtensions: {}, logicOverrides: {}, featureFlags: {},
    },
  });
  if (!created) { await module.update({ enabled: true }); log("· Módulo ya existía — habilitado"); }
  else log("✓ Módulo team creado");

  header("Actualizando moduleAccess del admin...");
  const currentAccess = admin.moduleAccess ?? [];
  if (!currentAccess.includes("team")) {
    await admin.update({ moduleAccess: [...currentAccess, "team"] });
    log(`✓ "team" añadido a moduleAccess de ${ADMIN_EMAIL}`);
  } else {
    log(`· ${ADMIN_EMAIL} ya tenía acceso a team`);
  }

  invalidateTenantCache(SLUG);
  log("✓ caché del tenant invalidada");

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Equipo activo en nutri_laura   \n");
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
