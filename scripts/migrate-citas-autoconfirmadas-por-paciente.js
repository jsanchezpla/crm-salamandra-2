/**
 * migrate-citas-autoconfirmadas-por-paciente.js
 *
 * Añade `clients.auto_confirm_bookings` (BOOLEAN NOT NULL DEFAULT false).
 *
 * Para qué (Rodrigo, 06/08/2026): un centro puede exigir que TODA reserva
 * pública espere su visto bueno. Eso tiene sentido con quien llega de nuevas y
 * es trabajo tirado con la paciente de siempre, la que viene los martes a la
 * misma hora. Con esta columna la profesional la exime una a una desde su ficha,
 * y sus citas entran ya confirmadas.
 *
 * Apagado para todo el mundo al aplicarse: exime, nunca al revés. Nadie nota
 * ningún cambio hasta que alguien encienda el interruptor a mano.
 *
 * Sin slugs a mano: recorre los schemas que tengan `clients`, leyendo la lista
 * de `master.tenants` en tiempo de ejecución. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-citas-autoconfirmadas-por-paciente.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-citas-autoconfirmadas-por-paciente.js
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
  process.stdout.write(" Citas autoconfirmadas, paciente a paciente\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ningún schema tiene tabla de clientes todavía.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."clients"
           ADD COLUMN IF NOT EXISTS auto_confirm_bookings BOOLEAN NOT NULL DEFAULT false`
      );
      log(`✓ ${schema}: columna lista`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
