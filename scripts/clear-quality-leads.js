/**
 * Elimina TODOS los leads del tenant "quality_energy" (leads y referidos).
 *
 * ⚠️ FRENADO desde el 2026-08-07. Quality Energy tiene UN solo módulo
 * contratado: `leads`. Vaciar esa tabla no le borra una sección del CRM, le
 * borra el CRM entero. La cabecera documentaba la invocación en producción.
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { exigirTenantDePruebas } from "./_guard-datos-reales.js";

const SLUG = "quality_energy";

exigirTenantDePruebas(SLUG, {
  script: "clear-quality-leads.js",
  destruye:
    "TODOS los leads de Quality Energy — que es su ÚNICO módulo, o sea, todo su CRM.",
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
