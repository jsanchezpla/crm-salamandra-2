/**
 * Elimina todos los leads del tenant "aumenta".
 *
 * ⚠️ FRENADO desde el 2026-08-07. Este script hace `truncate` de la tabla de
 * leads de un cliente REAL, y su cabecera documentaba la invocación en
 * producción. Choca de frente con `reset-aumenta-real-data.js:8-10`, que al
 * limpiar los datos de ejemplo CONSERVÓ los leads a propósito «porque son datos
 * REALES».
 *
 * Se conserva porque sigue siendo útil contra una copia local, pero ahora exige
 * la bandera de `_guard-datos-reales.js`.
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { closeAllConnections } from "../lib/db/tenantDb.js";
import { exigirTenantDePruebas } from "./_guard-datos-reales.js";

const SLUG = "aumenta";

exigirTenantDePruebas(SLUG, {
  script: "clear-aumenta-leads.js",
  destruye: "TODOS los leads de Aumenta (truncate de la tabla, sin vuelta atrás).",
});

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
