/**
 * migrate-payments-metodo-opcional.js — un cobro puede estar SIN DECIDIR
 * (`payments.method` deja de ser NOT NULL, 10/09/2026).
 *
 * El cobro que genera la cuota del mes nace PENDIENTE: todavía no ha entrado
 * dinero, así que nadie sabe aún por dónde va a entrar. Hasta hoy la columna
 * era obligatoria y el generador rellenaba el hueco con 'transfer', de modo que
 * una cuota sin método pactado acababa dejando escrito «Banco» en un cobro que
 * a lo mejor se paga en efectivo (Rodrigo, 10/09/2026: «que se quede sin
 * decidir y que luego ya cuando registren el cobro pongan lo que toca»).
 *
 * Quitar el NOT NULL no cambia NADA de lo que ya existe: los cobros de hoy
 * siguen con su método, y el CRM sigue exigiéndolo en el momento de registrar
 * el dinero —un cobro `completed` sin método sería dinero que entró y no está
 * en ninguna cesta del arqueo—. El hueco solo lo puede tener un pendiente.
 *
 * Solo ESTRUCTURA: ni una fila cambia. Recorre los schemas con
 * `_schema-targets.js` (`byTable` sobre `payments`), fotos doradas incluidas.
 * Idempotente. Correr ANTES de deploy.sh: el código nuevo inserta NULL.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-payments-metodo-opcional.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-payments-metodo-opcional.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."payments" ALTER COLUMN method DROP NOT NULL`);
  const [col] = await s.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'payments' AND column_name = 'method'`,
    { replacements: { schema } }
  );
  if (col[0]?.is_nullable !== "YES") throw new Error(`${schema}: payments.method SIGUE siendo NOT NULL`);
  log(`✓ ${schema}: payments.method admite «sin decidir»`);
}

async function main() {
  process.stdout.write("\n▶ Migración: el método de un cobro pendiente puede quedar sin decidir\n");
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
