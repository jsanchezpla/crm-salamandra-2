/**
 * add-calendar-module-demo.js
 *
 * Registra el módulo "calendar" en el tenant demo para poder probarlo.
 *
 * Uso: node scripts/add-calendar-module-demo.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";

const DEMO_SLUG = "demo";
const DEMO_ADMIN_EMAIL = "admin@demo.salamandra";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Demo — Activar módulo Calendar          \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant demo ─────────────────────────────────────────────────
  header("Verificando tenant demo...");
  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant demo no encontrado. Ejecuta npm run db:sync primero.\n");
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Registrar módulo calendar ─────────────────────────────────────────────
  header("Registrando módulo calendar...");
  const [mod, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "calendar" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "calendar",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });

  if (!modCreated) {
    await mod.update({ enabled: true });
    log("· Módulo ya existía — marcado como enabled");
  } else {
    log("✓ Módulo calendar creado y activado");
  }

  // ── 3. Actualizar moduleAccess del usuario admin ──────────────────────────────
  header("Actualizando acceso del usuario admin...");
  const user = await User.findOne({ where: { email: DEMO_ADMIN_EMAIL } });
  if (!user) {
    process.stderr.write(`\n✗ Usuario ${DEMO_ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }

  const currentAccess = user.moduleAccess ?? [];
  if (!currentAccess.includes("calendar")) {
    await user.update({ moduleAccess: [...currentAccess, "calendar"] });
    log(`✓ "calendar" añadido al moduleAccess de ${DEMO_ADMIN_EMAIL}`);
  } else {
    log(`· ${DEMO_ADMIN_EMAIL} ya tenía acceso al módulo calendar`);
  }

  // ── 4. Resumen ────────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Módulo:   calendar\n`);
  process.stdout.write(`  Tenant:   ${DEMO_SLUG}\n`);
  process.stdout.write(`  Cuenta:   ${DEMO_ADMIN_EMAIL}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
