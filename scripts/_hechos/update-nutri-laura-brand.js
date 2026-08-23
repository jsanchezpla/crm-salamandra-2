/**
 * update-nutri-laura-brand.js — Actualiza la paleta de colores del tenant nutri_laura
 *
 * Paleta cálida nutricional: verde (primary/secondary) sobre crema con tinta marrón.
 * Idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/update-nutri-laura-brand.js
 * Uso VPS:    docker compose exec app node scripts/update-nutri-laura-brand.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

const SLUG = "nutri_laura";

const BRAND = {
  primaryColor: "#A97873",   // rosa palo (mismo tono que la tinta de texto)
  secondaryColor: "#6E5A52", // marrón medio para hovers / acentos secundarios
  accentColor: "#F7F1EB",    // Fondo CRM
  inkColor: "#A97873",       // Texto general del CRM
  cardColor: "#FFFDFC",      // Fondo cards CRM
  // La galleta de tunutrilaura (el favicon del theme). Sin ella, la cabecera del
  // widget de reserva pinta la inicial del nombre dentro de un circulo: la
  // paciente veia una "T" donde deberia estar el logo. La sirve el propio
  // WordPress del cliente, que es donde vive la imagen de marca.
  logoUrl: "https://tunutrilaura.com/wp-content/themes/nutrilaura/assets/img/favicon-512.png",
};

async function main() {
  process.stdout.write("\n▶ Actualizando paleta de nutri_laura...\n");

  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`  ✗ Tenant "${SLUG}" no encontrado.\n`);
    process.exit(1);
  }

  const settings = { ...(tenant.settings || {}), brand: { ...BRAND } };
  await tenant.update({ settings });

  invalidateTenantCache(SLUG);

  process.stdout.write(`  ✓ Brand actualizado:\n`);
  for (const [k, v] of Object.entries(BRAND)) {
    process.stdout.write(`      ${k}: ${v}\n`);
  }
  process.stdout.write("  · Recarga el dashboard (Ctrl+F5) para ver los cambios.\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
