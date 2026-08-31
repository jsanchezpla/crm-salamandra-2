/**
 * migrate-fichaje-tipo-extra.js — las horas extra apuntadas a mano
 * (31/08/2026): valor nuevo 'extra' en el enum `tipo` de `fichajes`.
 *
 * ALTER TYPE ... ADD VALUE IF NOT EXISTS es idempotente y no toca ninguna
 * fila. El tipo lo nombra Sequelize `enum_fichajes_tipo` dentro de cada
 * schema. Los schemas los da scripts/_schema-targets.js (fotos doradas
 * incluidas).
 *
 * Uso VPS:  docker cp + docker exec crm-salamandra-app-1 node scripts/migrate-fichaje-tipo-extra.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "fichajes");
  for (const sinTabla of skipped) process.stdout.write(`  · ${sinTabla} sin tabla fichajes, nada que blindar\n`);

  for (const schema of schemas) {
    await s.query(`ALTER TYPE "${schema}"."enum_fichajes_tipo" ADD VALUE IF NOT EXISTS 'extra'`);
    process.stdout.write(`  ✓ ${schema}\n`);
  }
  process.stdout.write(`\n✓ enum de tipo de fichaje con 'extra' en ${schemas.length} esquemas.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
