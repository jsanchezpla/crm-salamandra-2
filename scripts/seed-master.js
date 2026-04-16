/**
 * seed-master.js — Crea el tenant Retorika en el schema master
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar datos.
 *
 * Uso: npm run db:seed:master
 */

import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const SLUG = "retorika";
const ADMIN_EMAIL = "admin@retorika.es";
const ADMIN_PASSWORD = "Admin1234!"; // temporal — cambiar en producción
const MODULES = ["training", "clients"];

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Retorika — Seed schema master           \n");
  process.stdout.write("════════════════════════════════════════\n");

  // ── 1. Inicializar master DB ──────────────────────────────────────────────
  header("Inicializando schema master...");
  const masterDb = getMasterDb();
  await masterDb.sync({ force: false });
  log("✓ Schema master sincronizado");

  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 2. Tenant ─────────────────────────────────────────────────────────────
  header("Verificando tenant retorika...");
  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "Retorika",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#174792",
          secondaryColor: "#1b539f",
          logoUrl: "",
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existe"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 3. Usuario admin ──────────────────────────────────────────────────────
  header("Verificando usuario admin...");
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const [, userCreated] = await User.findOrCreate({
    where: { email: ADMIN_EMAIL },
    defaults: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: MODULES,
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existe"} usuario "${ADMIN_EMAIL}"`);

  // ── 4. Módulos ────────────────────────────────────────────────────────────
  header("Verificando módulos...");
  for (const moduleKey of MODULES) {
    const [, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id,
        moduleKey,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        featureFlags: {},
      },
    });
    log(`${created ? "✓ Creado" : "· Ya existe"} módulo "${moduleKey}"`);
  }

  // ── 5. Resumen ────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Credenciales de acceso Retorika:\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:     x-tenant: ${SLUG}\n`);
  process.stdout.write(`  Email:      ${ADMIN_EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${ADMIN_PASSWORD}  ← cambiar en producción\n`);
  process.stdout.write(`  Módulos:    ${MODULES.join(", ")}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
