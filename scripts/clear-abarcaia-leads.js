/**
 * Elimina TODOS los leads y referidos del tenant "abarcaia".
 *
 * ⚠️ FRENADO desde el 2026-08-07. AbarcaIA existe SOLO en producción y sus dos
 * módulos son `leads` y `referidos`: aquí no hay red de un entorno local donde
 * equivocarse sin consecuencias. La cabecera documentaba la invocación en el VPS.
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { exigirTenantDePruebas } from "./_guard-datos-reales.js";

const SLUG = "abarcaia";

exigirTenantDePruebas(SLUG, {
  script: "clear-abarcaia-leads.js",
  destruye:
    "TODOS los leads y referidos de AbarcaIA, que solo existe en PRODUCCIÓN " +
    "y cuyo negocio entero son esas dos tablas.",
});

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
