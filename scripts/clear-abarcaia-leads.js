/**
 * Elimina TODOS los leads y referidos del tenant "abarcaia"
 * Uso: docker compose exec app node scripts/clear-abarcaia-leads.js
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "abarcaia";

async function main() {
  process.stdout.write(`\n🗑️  Eliminando todos los leads de '${SLUG}'...\n\n`);

  getMasterDb();

  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  const count = await Lead.count();
  process.stdout.write(`   Leads encontrados: ${count}\n`);

  if (count === 0) {
    process.stdout.write("   No hay leads que eliminar.\n");
  } else {
    await Lead.destroy({ where: {}, truncate: true });
    process.stdout.write(`   ✅ ${count} leads eliminados.\n`);
  }

  process.stdout.write("\n   ¡Listo!\n\n");
  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\nError: ${err.message}\n`);
  process.exit(1);
});
