/**
 * migrate-clients-estado-pausa.js
 *
 * Añade 'paused' («En pausa») al enum de `clients.status`
 * (`enum_clients_status`) en cada schema que tenga la tabla.
 *
 * ── POR QUÉ (15/09/2026, Rodrigo, Aumenta) ─────────────────────────────────
 * Pacientes y familias pasan a tener tres estados por lo que ha pasado con
 * ellos: Activo (viene este curso), En pausa (vino el curso pasado) y Baja
 * (nada desde antes). El paciente ya tenía los tres; la ficha de la familia
 * tenía Activo, No vino y Baja, y le faltaba la pausa. La regla vive en
 * `lib/clients/estadoPorActividad.js`; el estado a todo el centro lo pone
 * `scripts/estados-por-actividad.js`.
 *
 * `ADD VALUE IF NOT EXISTS` en AUTOCOMMIT, como migrate-informe-beca.js. El
 * `ALTER TABLE` de después no cambia nada (el defecto ya es 'active'): está para
 * que `_migration-order.js`, que no lee `ALTER TYPE`, sepa de qué tabla es.
 * Aditiva e idempotente: no cambia ni una fila.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo declara 'paused' y el selector de la
 * ficha lo ofrece; con el código por delante, elegirlo reventaría con
 * «invalid input value for enum».
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clients-estado-pausa.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clients-estado-pausa.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: «En pausa» en el estado de las fichas\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ningún schema con `clients`.");

  for (const schema of schemas) {
    try {
      // AUTOCOMMIT a propósito: nada de transaction() aquí.
      await s.query(`ALTER TYPE "${schema}"."enum_clients_status" ADD VALUE IF NOT EXISTS 'paused'`);
      await s.query(`ALTER TABLE "${schema}"."clients" ALTER COLUMN status SET DEFAULT 'active'`);
      log(`✓ ${schema}: 'paused' listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada (no cambia ni una fila)\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
