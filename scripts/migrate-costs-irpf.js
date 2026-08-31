/**
 * migrate-costs-irpf.js — el gasto aprende de retenciones (31/08/2026).
 *
 * Dos columnas opcionales en `costs`: `irpf_rate` (el % de retención de la
 * factura del profesional) e `irpf_amount` (los euros retenidos, calculados
 * siempre en lib/billing/totalesGasto.js). Hasta hoy lo que la pantalla
 * llamaba IRPF era una estimación informativa que no se guardaba.
 *
 * Aditiva e idempotente (ADD COLUMN IF NOT EXISTS, sin default). Los schemas
 * los da scripts/_schema-targets.js (fotos doradas incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-costs-irpf.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "costs");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla costs, nada que blindar\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TABLE "${schema}"."costs" ADD COLUMN IF NOT EXISTS "irpf_rate" DECIMAL(5,2)`);
    await s.query(`ALTER TABLE "${schema}"."costs" ADD COLUMN IF NOT EXISTS "irpf_amount" DECIMAL(12,2)`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ costs con irpf_rate e irpf_amount en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
