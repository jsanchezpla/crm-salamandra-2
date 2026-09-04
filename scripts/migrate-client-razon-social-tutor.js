/**
 * migrate-client-razon-social-tutor.js — la razón social por defecto de una
 * familia, guardada como QUIÉN (04/09/2026, Rodrigo: «en la razón social que se
 * ponga un desplegable con los tutores»).
 *
 * Añade a `clients`, en cada schema que tenga la tabla (fotos doradas de las
 * demos incluidas, por `byTable`):
 *   - `fiscal_guardian_id` UUID, NULL = se factura a nombre de la ficha; con
 *     valor, apunta a la entrada de `clients.guardians` a cuyo nombre se emite.
 *
 * ── POR QUÉ UN ID Y NO UN NOMBRE ────────────────────────────────────────────
 * `fiscal_name` sigue existiendo y sigue valiendo: es la razón social escrita a
 * mano, que es lo correcto cuando quien paga es una empresa o una fundación.
 * Lo que no servía era usarla para «facturar a nombre del padre»: hay que
 * reescribir el nombre a mano, no arrastra el DNI —y sin DNI la factura no se
 * puede emitir a ese nombre— y se queda vieja en silencio si luego se corrige
 * la ficha de tutores. Un id sigue a la persona. Es la misma lección de la foto
 * fiscal de las facturas (`lib/billing/datosFiscales.js`).
 *
 * SIN FK a propósito: los tutores viven dentro de un JSONB, no en una tabla, y
 * `lib/billing/razonSocial.js` ya cae a la ficha cuando el tutor guardado ya no
 * está. Es el mismo trato que `invoices.guardian_id`, del 02/09/2026.
 *
 * Aditiva y sin backfill: NULL es «a nombre de la ficha», que es exactamente lo
 * que hacen hoy todas las familias. Nadie estrena esto facturando a un nombre
 * que no ha elegido.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Por existencia de tabla, sin mirar
 * módulos (regla #12): el modelo Client declara la columna para todos los
 * tenants y sin ella el primer SELECT de Clientes daría 42703.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo la pide por nombre en cuanto arranca el
 * contenedor nuevo, y `clients` la lee TODO el CRM.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-client-razon-social-tutor.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-client-razon-social-tutor.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(
    `ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS fiscal_guardian_id UUID`
  );
  log(`✓ ${schema}: columna fiscal_guardian_id asegurada`);

  // Comprobación real, no la fe en el ALTER.
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'clients' AND column_name = 'fiscal_guardian_id'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna fiscal_guardian_id NO está`);
}

async function main() {
  process.stdout.write("\n▶ Migración: la razón social por defecto de la familia (un tutor)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "clients");
  if (skipped.length) log(`· sin tabla clients, se saltan: ${skipped.join(", ")}`);
  for (const schema of schemas) await processSchema(s, schema);
  process.stdout.write(`\n✓ Hecho: ${schemas.length} schema(s)\n\n`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
