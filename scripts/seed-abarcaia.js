/**
 * seed-abarcaia.js — Inicializa el tenant AbarcaIA
 *
 * 1. Crea schema crm_abarcaia
 * 2. Crea el tenant, usuario admin y módulos leads + referidos
 *
 * Uso: docker compose exec app node scripts/seed-abarcaia.js
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "abarcaia";
const SCHEMA = `crm_${SLUG}`;
const USER_EMAIL = "admin@abarcaia.es"; // ← cambiar si es necesario
const USER_PASSWORD = "Abarca#2026!";   // ← cambiar antes de producción

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write("         AbarcaIA — Seed inicial            \n");
  process.stdout.write("════════════════════════════════════════════\n");

  // ── 1. Crear schema ────────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tablas master ────────────────────────────────────────────────────────
  header("Sincronizando tablas master...");
  getMasterDb();

  // ── 3. Tablas del tenant ────────────────────────────────────────────────────
  header(`Sincronizando tablas de ${SCHEMA}...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log(`✓ Tablas en ${SCHEMA} creadas`);

  // ── 4. Tenant ───────────────────────────────────────────────────────────────
  header("Creando tenant AbarcaIA...");
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "AbarcaIA",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#00C9A7",
          secondaryColor: "#0083b0",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 5. Usuario ──────────────────────────────────────────────────────────────
  header("Creando usuario administrador...");
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 12);
  const [, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["leads", "referidos"],
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existía"} usuario "${USER_EMAIL}"`);

  // ── 6. Módulo leads ─────────────────────────────────────────────────────────
  header('Registrando módulo "leads"...');
  const [, leadsCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "abarcaia/LeadsModule",
      schemaExtensions: {
        experiencia: { type: "string" },
        zona: { type: "string" },
        fecha_envio: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${leadsCreated ? "✓ Creado" : "· Ya existía"} módulo "leads"`);

  // ── 7. Módulo referidos ─────────────────────────────────────────────────────
  header('Registrando módulo "referidos"...');
  const [, refCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "referidos" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "referidos",
      enabled: true,
      version: "1.0.0",
      uiOverride: "abarcaia/ReferidosModule",
      schemaExtensions: {
        codigo_referido: { type: "string" },
        source: { type: "string" },
        fecha_envio: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${refCreated ? "✓ Creado" : "· Ya existía"} módulo "referidos"`);

  // ── 8. Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Accede con estas credenciales:\n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  URL:        https://crm.salamandrasolutions.com/login\n`);
  process.stdout.write(`  Tenant:     x-tenant: ${SLUG}\n`);
  process.stdout.write(`  Email:      ${USER_EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${USER_PASSWORD}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
