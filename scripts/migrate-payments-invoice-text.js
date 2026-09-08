/**
 * migrate-payments-invoice-text.js — el texto con el que el cobro de una cuota
 * sale impreso en la factura (`payments.invoice_text`, 09/09/2026).
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * Un concepto del catálogo tiene DOS nombres, y son dos cosas distintas:
 *
 *   · `name`        — el interno, el que ve el centro: «Cuota Logopedia 45x1».
 *                     Es el que distingue una terapia de otra, y de él dependen
 *                     el prorrateo por sesiones, saber qué cita paga qué cuota
 *                     y las carpetas de «Fichas a completar».
 *   · `description` — «Texto en la factura», que es como se llama en
 *                     Configuración → Conceptos: «Terapia 45 min semanales».
 *
 * Es exactamente el par que tiene cada cuota en el Organízate de Aumenta
 * (Cursos → Zona pacientes: «Nombre» y «Concepto factura»), y allí el texto de
 * factura NUNCA dice la terapia: logopedia, psicología, pedagogía y T.O. de la
 * misma dosis facturan con la misma frase. La factura de una familia no tiene
 * por qué decir qué terapias hace su hijo.
 *
 * «Facturar el mes» construía la línea reutilizando la NOTA del cobro, que
 * lleva los nombres internos, así que la factura salía diciendo «Cuota
 * septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1». Con esta columna
 * el cobro guarda además su línea de factura ya compuesta —una FOTO, como
 * `bookings.cobro_texto`—, y la nota se queda como estaba para la pantalla de
 * Cobros. Un cobro sin este texto (los de antes, y los apuntados a mano) sigue
 * facturándose por su nota, que es lo de siempre.
 *
 * Solo ESTRUCTURA: una columna nueva, NULL para todo lo que ya existe; lo que
 * ya está generado lo rellena `scripts/backfill-payments-invoice-text.js`.
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `payments`),
 * fotos doradas incluidas. Idempotente. Correr ANTES de deploy.sh: el modelo
 * la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-payments-invoice-text.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-payments-invoice-text.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS invoice_text TEXT`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'payments' AND column_name = 'invoice_text'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna invoice_text NO está`);
  log(`✓ ${schema}: columna invoice_text asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: el texto de factura del cobro (payments.invoice_text)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "payments");
  for (const schema of skipped) log(`· ${schema}: sin payments — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
