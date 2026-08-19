/**
 * check-tenant-brand.js — Imprime el brand actual del tenant Spain Enzymes
 *
 * Uso: node --env-file=.env.local scripts/check-tenant-brand.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

async function main() {
  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: "spain_enzymes" } });
  if (!tenant) {
    process.stderr.write("✗ Tenant 'spain_enzymes' no encontrado\n");
    process.exit(1);
  }

  process.stdout.write("\n▶ Tenant Spain Enzymes\n");
  process.stdout.write(`  · id: ${tenant.id}\n`);
  process.stdout.write(`  · slug: ${tenant.slug}\n`);
  process.stdout.write(`  · name: ${tenant.name}\n`);
  process.stdout.write(`  · settings.brand: ${JSON.stringify(tenant.settings?.brand, null, 2)}\n\n`);

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
