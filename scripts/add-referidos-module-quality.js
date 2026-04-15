/**
 * add-referidos-module-quality.js — Registra el módulo "referidos" para el tenant quality_energy
 *
 * Idempotente: si el módulo ya existe no hace nada.
 *
 * Uso en VPS (dentro del contenedor):
 *   docker exec -it <nombre-contenedor> node --env-file=.env.local scripts/add-referidos-module-quality.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const SLUG = "quality_energy";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" Quality Energy — Activar módulo Referidos  \n");
  process.stdout.write("════════════════════════════════════════════\n");

  header("Conectando a master...");
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  header(`Buscando tenant "${SLUG}"...`);
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${SLUG}" no encontrado. ¿Está bien escrito el slug?\n`);
    process.exit(1);
  }
  log(`✓ Tenant encontrado (id: ${tenant.id})`);

  header('Registrando módulo "referidos"...');
  const [mod, created] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "referidos" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "referidos",
      enabled: true,
      version: "1.0.0",
      uiOverride: "quality-energy/ReferidosModule",
      schemaExtensions: {
        codigo_referido: { type: "string" },
        source: { type: "string" },
        fecha_envio: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });

  if (created) {
    log('✓ Módulo "referidos" creado correctamente');
  } else {
    log('· El módulo "referidos" ya existía — sin cambios');
    if (!mod.enabled) {
      await mod.update({ enabled: true });
      log("· Estaba desactivado → reactivado");
    }
  }

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! El módulo Referidos está activo.\n");
  process.stdout.write(` Tenant: ${SLUG}\n`);
  process.stdout.write(` Módulo: referidos (enabled: true)\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
