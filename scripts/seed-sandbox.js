/**
 * seed-sandbox.js — Tenant local de pruebas con TODOS los módulos, sin override.
 *
 * Crea un tenant limpio `sandbox` con todos los módulos funcionales activados
 * y SIN override (usa la UI por defecto en todo — por eso no se reutiliza
 * `demo`, que tiene override de leads). Ideal para clicar y probar el CRM
 * entero de una vez.
 *
 * Crea: schema crm_sandbox + master.tenants + usuario admin (moduleAccess
 * ["all"]) + una fila por módulo en master.tenant_modules + todas las tablas
 * del tenant vía sequelize.sync() (que cubre citas, proyectos, billing con
 * quotes/IRPF, clínica, pacientes, nutrición, etc.).
 *
 * Tenant VACÍO: no siembra datos; crea las estructuras para que puedas
 * entrar en cada módulo y empezar a probar.
 *
 * Contraseña admin (regla #14 — nunca por chat): aleatoria e impresa UNA vez,
 * o fija con la env var SANDBOX_ADMIN_PASSWORD.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-sandbox.js
 *   (o, si no usas .env.local:  DATABASE_URL="postgres://..." node scripts/seed-sandbox.js)
 *
 * Idempotente: re-ejecutable. Si el usuario ya existe, NO cambia su password.
 */

import crypto from "node:crypto";
import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "sandbox";
const SCHEMA = `crm_${SLUG}`;
const NAME = "Sandbox (pruebas)";
const USER_EMAIL = "admin@sandbox.local";

// Todos los módulos FUNCIONALES (con página real), sin override.
// Se omiten los placeholders del sidebar sin pantalla (support, planning,
// documents, analytics, ai, automations, integrations): activarlos solo
// mostraría entradas de menú que llevan a páginas inexistentes.
const MODULES = [
  "clients",
  "leads",
  "sales",
  "projects",
  "billing",
  "team",
  "inventory",
  "training",
  "cuestionarios",
  "calendar",
  "citas",
  "orders",
  "referidos",
  "pacientes",
  "clinica",
  "nutricion",
];

const BRAND = {
  primaryColor: "#1B3A2D",
  secondaryColor: "#3E6B54",
  accentColor: "#FAFAF8",
  inkColor: "#1B3A2D",
  cardColor: "#FFFFFF",
  logoUrl: null,
};

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write("   Sandbox — tenant local con TODOS los módulos\n");
  process.stdout.write("══════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada (usa --env-file=.env.local o DATABASE_URL=...)\n");
    process.exit(1);
  }
  if (/prod|production/i.test(process.env.DATABASE_URL)) {
    process.stderr.write("\n✗ La DATABASE_URL parece de producción. Este script es SOLO para local. Abortando.\n");
    process.exit(1);
  }

  // ── 1. Schema ────────────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tenant ────────────────────────────────────────────────────────────
  header("Creando tenant en master...");
  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: NAME,
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: { brand: { ...BRAND } },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 3. Admin ─────────────────────────────────────────────────────────────
  header("Creando usuario administrador...");
  const envPassword = process.env.SANDBOX_ADMIN_PASSWORD;
  const rawPassword = envPassword || crypto.randomBytes(9).toString("base64").slice(0, 12);
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const [adminUser, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["all"],
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existía"} usuario "${USER_EMAIL}"`);

  // ── 4. Módulos (todos, sin override) ─────────────────────────────────────
  header(`Activando ${MODULES.length} módulos (sin override)...`);
  for (const moduleKey of MODULES) {
    const [mod, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id,
        moduleKey,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        uiOverride: null,
        featureFlags: {},
      },
    });
    if (!created && (!mod.enabled || mod.uiOverride)) {
      await mod.update({ enabled: true, uiOverride: null, logicOverrides: {}, schemaExtensions: {}, featureFlags: {} });
    }
    log(`${created ? "✓" : "·"} ${moduleKey}`);
  }

  // ── 5. Tablas del tenant (sync: crea TODAS las tablas de todos los modelos) ─
  header(`Creando tablas en ${SCHEMA} (sync)...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync();
  log("✓ Tablas creadas (citas, proyectos, billing+quotes+IRPF, clínica, pacientes, nutrición…)");

  invalidateTenantCache(SLUG);

  // ── 6. Resumen + credenciales ────────────────────────────────────────────
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Tenant sandbox creado\n");
  process.stdout.write("══════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:   ${NAME} (${SLUG})\n`);
  process.stdout.write(`  Schema:   ${SCHEMA}\n`);
  process.stdout.write(`  Módulos:  ${MODULES.length} (todos sin override)\n`);
  process.stdout.write(`  URL:      http://localhost:3000\n`);
  process.stdout.write("──────────────────────────────────────────────\n");
  if (userCreated) {
    process.stdout.write(`  Email:    ${USER_EMAIL}\n`);
    if (envPassword) {
      process.stdout.write("  Password: (la de SANDBOX_ADMIN_PASSWORD)\n");
    } else {
      process.stdout.write(`  Password: ${rawPassword}\n`);
      process.stdout.write("  ⚠ Guárdala ahora; no se vuelve a mostrar.\n");
    }
  } else {
    process.stdout.write(`  Usuario ${USER_EMAIL} ya existía: password sin cambios.\n`);
  }
  process.stdout.write("══════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch {}
  process.exit(1);
});
