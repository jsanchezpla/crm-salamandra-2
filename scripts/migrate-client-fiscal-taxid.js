/**
 * migrate-client-fiscal-taxid.js
 *
 * `clients.fiscal_tax_id`: el NIF o CIF a nombre del cual se emite la factura,
 * cuando no es el del titular de la ficha.
 *
 * ── POR QUÉ NO VALE `tax_id` ────────────────────────────────────────────────
 * El Centro Aumenta pidió poder decir «la factura va a nombre del padre, con SU
 * DNI» o «a nombre de una empresa, con su CIF». La tentación es meterlo en
 * `tax_id`, que ya existe. No se puede: en un centro clínico ese campo es el
 * DNI/NIE del titular de la ficha, y de ahí lo lee el CONTRATO que la familia
 * firma en el área privada (`lib/clients/datosFicha.js`). Meter ahí el CIF de
 * una empresa dejaría un contrato de prestación de servicios a un menor
 * identificado con el CIF de una sociedad.
 *
 * Son dos cosas distintas —quién es esta persona / a quién se le factura— y
 * necesitan dos columnas.
 *
 * ── QUIÉN LA LEE ────────────────────────────────────────────────────────────
 * Nadie directamente: todo el módulo de facturación pasa por `nifDeCliente()`
 * (lib/billing/nifCliente.js), que devuelve `fiscal_tax_id` si lo hay y
 * `tax_id` si no. Ese respaldo es OBLIGATORIO: en spain_enzymes y demo los
 * clientes son empresas cuyo `tax_id` YA es su CIF, y sin él sus facturas
 * empezarían a salir sin NIF de un día para otro.
 *
 * Aditiva e idempotente: se puede lanzar cien veces. Va en CORE y decide por
 * existencia de tabla, así que en un schema sin `clients` es un no-op.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-client-fiscal-taxid.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-client-fiscal-taxid.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" NIF/CIF de facturación (clients.fiscal_tax_id)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ningún schema con `clients`.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS fiscal_tax_id VARCHAR(50)`
      );
      log(`✓ ${schema}: fiscal_tax_id al día`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
