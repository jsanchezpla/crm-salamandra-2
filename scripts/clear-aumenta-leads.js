/**
 * Elimina todos los leads del tenant "aumenta"
 * Uso: docker compose exec app node scripts/clear-aumenta-leads.js
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "aumenta";

async function main() {
  console.log(`🗑️  Eliminando leads del tenant '${SLUG}'...`);

  await getMasterDb();

  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  const count = await Lead.count();
  console.log(`   Leads encontrados: ${count}`);

  if (count === 0) {
    console.log("   No hay leads que eliminar.");
  } else {
    await Lead.destroy({ where: {}, truncate: true });
    console.log(`   ✅ ${count} leads eliminados.`);
  }

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
