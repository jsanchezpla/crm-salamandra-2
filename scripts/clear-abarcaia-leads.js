/**
 * Elimina todos los leads Y referidos de AbarcaIA del tenant "quality_energy"
 * Uso: docker compose exec app node scripts/clear-abarcaia-leads.js
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { Op } from "sequelize";

const SLUG = "quality_energy";

async function main() {
  process.stdout.write(`\n🗑️  Limpiando leads y referidos de AbarcaIA en '${SLUG}'...\n\n`);

  getMasterDb();

  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  // Leads normales de AbarcaIA (desde formulario [abarcaia_leads])
  const leadsCount = await Lead.count({
    where: {
      customFields: { [Op.contains]: { empresa: "AbarcaIA" } },
    },
  });

  // Referidos de AbarcaIA (desde formulario [abarcaia_referidos])
  const referidosCount = await Lead.count({
    where: {
      customFields: { [Op.contains]: { source: "referido_abarcaia" } },
    },
  });

  process.stdout.write(`   Leads AbarcaIA encontrados:    ${leadsCount}\n`);
  process.stdout.write(`   Referidos AbarcaIA encontrados: ${referidosCount}\n\n`);

  if (leadsCount === 0 && referidosCount === 0) {
    process.stdout.write("   No hay registros que eliminar.\n");
  } else {
    if (leadsCount > 0) {
      await Lead.destroy({
        where: { customFields: { [Op.contains]: { empresa: "AbarcaIA" } } },
      });
      process.stdout.write(`   ✅ ${leadsCount} leads eliminados.\n`);
    }
    if (referidosCount > 0) {
      await Lead.destroy({
        where: { customFields: { [Op.contains]: { source: "referido_abarcaia" } } },
      });
      process.stdout.write(`   ✅ ${referidosCount} referidos eliminados.\n`);
    }
  }

  process.stdout.write("\n   ¡Listo!\n\n");
  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\nError: ${err.message}\n`);
  process.exit(1);
});
