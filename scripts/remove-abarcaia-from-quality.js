/**
 * remove-abarcaia-from-quality.js
 *
 * 1. Elimina los leads de AbarcaIA del tenant quality_energy
 * 2. Elimina los referidos de AbarcaIA del tenant quality_energy
 * 3. Desactiva el módulo "referidos" en quality_energy
 *
 * Uso: docker compose exec app node scripts/remove-abarcaia-from-quality.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { Op } from "sequelize";

const SLUG = "quality_energy";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write("  Quitar AbarcaIA de Quality Energy         \n");
  process.stdout.write("════════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ────────────────────────────────────────────────────
  header(`Buscando tenant "${SLUG}"...`);
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${SLUG}" no encontrado.\n`);
    process.exit(1);
  }
  log(`✓ Tenant encontrado (id: ${tenant.id})`);

  // ── 2. Eliminar leads de AbarcaIA ──────────────────────────────────────────
  header("Eliminando leads de AbarcaIA...");
  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  const leadsCount = await Lead.count({
    where: { customFields: { [Op.contains]: { empresa: "AbarcaIA" } } },
  });
  if (leadsCount > 0) {
    await Lead.destroy({
      where: { customFields: { [Op.contains]: { empresa: "AbarcaIA" } } },
    });
    log(`✓ ${leadsCount} leads de AbarcaIA eliminados`);
  } else {
    log("· No había leads de AbarcaIA");
  }

  // ── 3. Eliminar referidos de AbarcaIA ──────────────────────────────────────
  header("Eliminando referidos de AbarcaIA...");
  const refCount = await Lead.count({
    where: { customFields: { [Op.contains]: { source: "referido_abarcaia" } } },
  });
  if (refCount > 0) {
    await Lead.destroy({
      where: { customFields: { [Op.contains]: { source: "referido_abarcaia" } } },
    });
    log(`✓ ${refCount} referidos eliminados`);
  } else {
    log("· No había referidos");
  }

  // ── 4. Desactivar módulo referidos en quality_energy ───────────────────────
  header('Desactivando módulo "referidos" en quality_energy...');
  const modRef = await TenantModule.findOne({
    where: { tenantId: tenant.id, moduleKey: "referidos" },
  });
  if (modRef) {
    await modRef.update({ enabled: false });
    log('✓ Módulo "referidos" desactivado');
  } else {
    log('· Módulo "referidos" no existía en quality_energy');
  }

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Quality Energy ya no tiene datos\n");
  process.stdout.write(" ni módulo de AbarcaIA.\n");
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
