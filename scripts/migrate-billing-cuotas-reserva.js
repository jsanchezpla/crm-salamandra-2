/**
 * migrate-billing-cuotas-reserva.js — la reserva de plaza ya pagada vive en la
 * cuota (`billing_cuotas.reserva_abonada` + `reserva_aplicada_en`, 09/09/2026).
 *
 * Aumenta: «en cuotas que estamos creando, deja pendiente 30 €».
 *
 * En verano las familias pagan 30 € de reserva de plaza para el curso
 * siguiente, y ese dinero se descuenta del PRIMER mes. El 01/09/2026 eso se
 * hizo con un script de una sola vez (`descontar-reservas-septiembre.js`), que
 * restó los 30 € a los cobros de septiembre ya generados. Pero la rebaja se
 * quedó en aquellos cobros y no en la cuota: cada cuota nueva que el centro da
 * de alta desde entonces genera el mes ENTERO, la familia paga lo suyo menos la
 * reserva, y quedan 30 € pendientes que nadie debe.
 *
 * Con estas dos columnas el descuento es de la cuota:
 *   · `reserva_abonada`     — cuánto pagó por adelantado (30 €, o 60 si son dos
 *                             hermanos). NULL = no pagó reserva, lo normal.
 *   · `reserva_aplicada_en` — el mes 'AAAA-MM' en el que ya se descontó. Es lo
 *                             que hace que se descuente UNA vez: octubre sale
 *                             con la cuota entera, como debe.
 *
 * Solo ESTRUCTURA: dos columnas a NULL para todo lo que ya existe. Recorre los
 * schemas con `_schema-targets.js` (`byTable` sobre `billing_cuotas`), fotos
 * doradas incluidas. Idempotente. Correr ANTES de deploy.sh: el modelo las lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-cuotas-reserva.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-cuotas-reserva.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

const COLUMNAS = [
  ["reserva_abonada", "DECIMAL(12,2)"],
  ["reserva_aplicada_en", "VARCHAR(7)"],
];

async function processSchema(s, schema) {
  for (const [nombre, tipo] of COLUMNAS) {
    await s.query(`ALTER TABLE "${schema}"."billing_cuotas" ADD COLUMN IF NOT EXISTS ${nombre} ${tipo}`);
  }
  const [cols] = await s.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'billing_cuotas'
        AND column_name IN ('reserva_abonada', 'reserva_aplicada_en')`,
    { replacements: { schema } }
  );
  if (cols.length !== COLUMNAS.length) {
    throw new Error(`${schema}: faltan columnas de la reserva (${cols.length}/${COLUMNAS.length})`);
  }
  log(`✓ ${schema}: reserva_abonada y reserva_aplicada_en aseguradas`);
}

async function main() {
  process.stdout.write("\n▶ Migración: la reserva de plaza ya pagada vive en la cuota (billing_cuotas)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "billing_cuotas");
  for (const schema of skipped) log(`· ${schema}: sin billing_cuotas — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
