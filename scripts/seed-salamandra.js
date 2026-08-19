// @vivo — Es la única receta para crear NUESTRO tenant (schema crm_salamandra_solutions + fila en master + admin con moduleAccess ["all"] + 5 tenant_modules… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-salamandra.js — Crea el tenant "Salamandra Solutions"
 *
 * Tenant interno de Salamandra con 5 módulos, TODOS sin override:
 *   clients, calendar, projects, billing, team
 *
 * Crea: schema crm_salamandra_solutions + registro en master.tenants +
 * usuario admin (moduleAccess ["all"]) + 5 filas en master.tenant_modules +
 * todas las tablas base del tenant vía sequelize.sync().
 *
 * Tenant VACÍO: no siembra datos de negocio (clientes, proyectos, etc.).
 *
 * Contraseña admin (regla #14 — nunca por chat):
 *   · Si existe la env var SALAMANDRA_ADMIN_PASSWORD, se usa esa.
 *   · Si no, se genera aleatoria y se imprime UNA sola vez en consola.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-salamandra.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-salamandra.js
 *             (dentro del contenedor NO se usa --env-file: Docker ya inyecta
 *              las envs vía env_file. Ver lección de deploys previos.)
 *
 * Idempotente: re-ejecutar no duplica nada. Si el usuario ya existe, NO
 * modifica su password.
 *
 * Paridad de índices de Proyectos (opcional): los índices/constraints extra
 * de projects que no viven en los modelos (projects_code_unique, índices de
 * tasks, FK board_column) se añaden con las migraciones idempotentes
 * `projects-1` y `projects-2`, que auto-detectan este tenant al tener el
 * módulo `projects` activo. Este script deja el tenant 100% funcional sin
 * ellas.
 */

import crypto from "node:crypto";
import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "salamandra_solutions";
const SCHEMA = `crm_${SLUG}`;
const NAME = "Salamandra Solutions";
const USER_EMAIL = "admin@salamandrasolutions.com";

const MODULES = ["clients", "calendar", "projects", "billing", "team"];

// Paleta corporativa Salamandra (cambiable luego en tenant.settings.brand)
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
  process.stdout.write("   Salamandra Solutions — Seed de tenant       \n");
  process.stdout.write("══════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  // ── 1. Crear schema ──────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Master + Tenant ───────────────────────────────────────────────────
  header("Sincronizando master y creando tenant...");
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

  if (!tenantCreated) {
    // Reconciliar brand por si se cambió el script (fuente de verdad: aquí).
    const current = tenant.settings || {};
    await tenant.update({
      settings: { ...current, brand: { ...(current.brand || {}), ...BRAND } },
    });
    log("· settings.brand reconciliado");
  }

  // ── 3. Usuario admin (moduleAccess ["all"]) ──────────────────────────────
  header("Creando usuario administrador...");
  const envPassword = process.env.SALAMANDRA_ADMIN_PASSWORD;
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

  if (!userCreated) {
    log(`· Ya existía usuario "${USER_EMAIL}" — password NO modificada`);
    if (adminUser.tenantId !== tenant.id) {
      log(`⚠ OJO: ese usuario pertenece a otro tenant (${adminUser.tenantId}). Revisar manualmente.`);
    }
  } else {
    log(`✓ Creado usuario "${USER_EMAIL}" (id: ${adminUser.id}, role admin, moduleAccess ["all"])`);
  }

  // ── 4. Módulos (los 5, sin override) ─────────────────────────────────────
  header("Activando módulos (sin override)...");
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
    // Si ya existía, garantizar enabled + sin override (fuente de verdad: aquí).
    if (!created && (!mod.enabled || mod.uiOverride)) {
      await mod.update({ enabled: true, uiOverride: null });
    }
    log(`${created ? "✓ Creado" : "· Ya existía"} módulo "${moduleKey}"`);
  }

  // ── 5. Tablas base del tenant (sync sin alter, schema nuevo) ──────────────
  header(`Creando tablas base en ${SCHEMA} (sync)...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync(); // CREATE TABLE IF NOT EXISTS de todos los modelos
  log("✓ Tablas base creadas");

  invalidateTenantCache(SLUG);

  // ── 6. Resumen + credenciales ────────────────────────────────────────────
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Tenant Salamandra Solutions creado\n");
  process.stdout.write("══════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:   ${NAME} (${SLUG})\n`);
  process.stdout.write(`  Schema:   ${SCHEMA}\n`);
  process.stdout.write(`  Módulos:  ${MODULES.join(", ")}  (sin override)\n`);
  process.stdout.write(`  URL:      https://crm.salamandrasolutions.com\n`);
  process.stdout.write("──────────────────────────────────────────────\n");
  if (userCreated) {
    process.stdout.write(" === CUENTA ADMIN ===\n");
    process.stdout.write(`  Email:    ${USER_EMAIL}\n`);
    if (envPassword) {
      process.stdout.write("  Password: (la de la env var SALAMANDRA_ADMIN_PASSWORD)\n");
    } else {
      process.stdout.write(`  Password: ${rawPassword}\n`);
      process.stdout.write("  ⚠ Guárdala AHORA; no se volverá a mostrar. Cámbiala tras el 1er login.\n");
    }
  } else {
    process.stdout.write(` El usuario ${USER_EMAIL} ya existía: password sin cambios.\n`);
  }
  process.stdout.write("══════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  try { await closeAllConnections(); } catch {}
  process.exit(1);
});
