/**
 * update-spain-enzymes-brand.js — Actualiza la paleta de colores del tenant Spain Enzymes
 *
 * Granate clásico + crema cálida. Idempotente: se puede correr todas las veces que haga falta.
 *
 * Uso local:  node --env-file=.env.local scripts/update-spain-enzymes-brand.js
 * Uso VPS:    docker compose exec app node scripts/update-spain-enzymes-brand.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

const SLUG = "spain_enzymes";

const BRAND = {
  primaryColor: "#7B1E2C",   // granate
  secondaryColor: "#5C1620", // granate más oscuro (hovers, acentos)
  accentColor: "#F8F1EA",    // crema cálida (fondo de página)
  logoUrl: null,
};

async function main() {
  process.stdout.write("\n▶ Actualizando paleta de Spain Enzymes...\n");

  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`  ✗ Tenant "${SLUG}" no encontrado. Ejecuta primero seed-spain-enzymes.js\n`);
    process.exit(1);
  }

  const settings = { ...(tenant.settings || {}), brand: { ...BRAND } };
  await tenant.update({ settings });

  invalidateTenantCache(SLUG);

  process.stdout.write(`  ✓ Brand actualizado: primary=${BRAND.primaryColor}, secondary=${BRAND.secondaryColor}, accent=${BRAND.accentColor}\n`);
  process.stdout.write("  · Recarga el dashboard (Ctrl+F5) para ver los cambios.\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
