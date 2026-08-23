/**
 * update-aumenta-brand.js — Cambia la paleta del tenant aumenta a la
 * combinación morado violeta vivo: primary #563EA6, secondary #15063F.
 *
 * Motivo: el primary anterior (#FF1F96) tenía contraste ~1.5:1 con el
 * texto del sidebar (white/50), lo que volvía los nombres de módulo
 * casi ilegibles.
 *
 * Uso: node --env-file=.env.local scripts/update-aumenta-brand.js
 */
import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

const SLUG = "aumenta";
const NEW_BRAND = {
  primaryColor: "#563EA6",
  secondaryColor: "#15063F",
  logoUrl: null,
};

async function main() {
  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`✗ Tenant '${SLUG}' no encontrado\n`);
    process.exit(1);
  }

  const before = tenant.settings?.brand ?? {};
  process.stdout.write(`\n▶ Brand actual de ${SLUG}:\n${JSON.stringify(before, null, 2)}\n`);

  await tenant.update({
    settings: {
      ...(tenant.settings ?? {}),
      brand: { ...before, ...NEW_BRAND },
    },
  });

  invalidateTenantCache(SLUG);

  const after = (await tenant.reload()).settings?.brand;
  process.stdout.write(`\n✓ Brand actualizado:\n${JSON.stringify(after, null, 2)}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`✗ Error: ${err.message}\n`);
  process.exit(1);
});
