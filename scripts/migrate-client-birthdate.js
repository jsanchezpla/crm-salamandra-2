/**
 * migrate-client-birthdate.js
 *
 * `clients.birth_date`: la fecha de nacimiento del cliente.
 *
 * No existía. La tenía `patients`, y en un centro de nutrición —nutri_laura— el
 * paciente ES el cliente: no había dónde guardarla. Sin ella, el contrato del
 * área privada no podía saber si quien va a firmar es menor de edad, que es lo
 * que decide si hace falta además el consentimiento de su tutor legal.
 *
 * DATE y no TIMESTAMP a propósito: una fecha de nacimiento no tiene hora, y con
 * zona horaria de por medio un 1 de enero se convierte en 31 de diciembre en
 * cuanto el servidor no está en Madrid.
 *
 * El «Domicilio» que entra en el mismo sprint NO necesita migración: vive en
 * `customFields` (JSONB), al lado del código postal y la ciudad. Ver la
 * advertencia de `lib/clients/formularioAlta.js` sobre `Client.address`.
 *
 * Aditiva e idempotente: se puede lanzar cien veces.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-client-birthdate.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-client-birthdate.js
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
  process.stdout.write(" Fecha de nacimiento del cliente (clients.birth_date)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ningún schema con `clients`.");

  for (const schema of schemas) {
    try {
      await s.query(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS birth_date DATE`);
      log(`✓ ${schema}: birth_date al día`);
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
