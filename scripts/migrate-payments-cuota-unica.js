/**
 * migrate-payments-cuota-unica.js — un solo cobro por cuota y mes (06/09/2026).
 *
 * El candado contra el doble clic de `sincronizarCobroDelMes` y del lote
 * (`cuotas/generar`) hacía un `SELECT … FOR UPDATE` sobre una fila que aún no
 * existe, así que no bloqueaba nada: dos peticiones a la vez (dos pestañas, o
 * el alta de la cuota y «Generar el mes» al mismo tiempo) podían crear dos
 * cobros pendientes de la misma cuota y el mismo mes. La base de datos es la
 * única que puede impedirlo de verdad: índice ÚNICO parcial sobre
 * `(cuota_id, period_month)` donde `cuota_id` no es nulo (el cobro apuntado a
 * mano sigue naciendo a NULL y no le afecta). El código captura la violación
 * (23505) y la cuenta como «ya tenía cobro de este mes».
 *
 * Antes de crear el índice se cuentan los duplicados de cada schema: si hay,
 * el índice no se crearía y se dice cuáles son para arreglarlos a mano (en
 * Aumenta, el 06/09/2026, cero). Recorre los schemas con `_schema-targets.js`
 * (`byTable` sobre `payments`), fotos doradas incluidas. Idempotente
 * (IF NOT EXISTS), no escribe filas. Correr ANTES de deploy.sh.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-payments-cuota-unica.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-payments-cuota-unica.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

export const INDICE = "payments_cuota_periodo_unica";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: un solo cobro por cuota y mes (índice único)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "payments");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin payments (módulo billing no migrado) — se omite\n`);
  }

  let conDuplicados = 0;
  for (const schema of schemas) {
    const [dup] = await s.query(
      `SELECT cuota_id, period_month, count(*)::int AS n
         FROM "${schema}"."payments"
        WHERE cuota_id IS NOT NULL
        GROUP BY 1, 2
       HAVING count(*) > 1`
    );
    if (dup.length) {
      conDuplicados += 1;
      process.stdout.write(
        `  ✗ ${schema}: ${dup.length} cuota(s) con más de un cobro en el mismo mes — el índice NO se crea aquí hasta dejar uno solo\n`
      );
      for (const d of dup.slice(0, 10)) {
        process.stdout.write(`      cuota ${d.cuota_id} · ${String(d.period_month).slice(0, 7)} · ${d.n} cobros\n`);
      }
      continue;
    }
    await s.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS payments_cuota_periodo_unica
         ON "${schema}"."payments" (cuota_id, period_month)
        WHERE cuota_id IS NOT NULL`
    );
    process.stdout.write(`  ✓ ${schema}: ${INDICE}\n`);
  }

  await s.close();
  process.stdout.write(conDuplicados ? `\n⚠ ${conDuplicados} schema(s) sin índice por duplicados\n` : "\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
