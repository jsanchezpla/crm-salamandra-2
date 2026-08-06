/**
 * migrate-nutricionista-asignada.js
 *
 * La paciente pasa a tener SU profesional (06/08/2026, Rodrigo).
 *
 * Hasta hoy la agenda pública enseñaba los mismos huecos a todo el mundo: las
 * disponibilidades cuelgan del TIPO DE CITA, no de quién pasa consulta. En una
 * consulta de una sola nutricionista eso da igual; con equipo, no: cada
 * paciente lleva su seguimiento con la suya, y verle los huecos a otra es
 * ofrecerle una cita que no le corresponde.
 *
 * Qué hace:
 *   `clients.assigned_team_member_id` → a qué miembro del equipo se le asignó
 *   esta persona. Se rellena al ACEPTAR su solicitud en la bandeja, que es el
 *   momento en que se decide con quién va.
 *
 * NULL = sin asignar, y entonces ve la agenda de siempre. Es el estado de todo
 * lo que ya existe y el de cualquier centro de una sola profesional: nadie
 * tiene que asignar nada para que esto siga funcionando como hasta ahora.
 *
 * La FK va con ON DELETE SET NULL: si alguien se va del equipo, sus pacientes
 * se quedan sin asignar —que es la verdad— en vez de bloquear el borrado o,
 * peor, apuntar a alguien que ya no está.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricionista-asignada.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricionista-asignada.js
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function asignar(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."clients"
       ADD COLUMN IF NOT EXISTS assigned_team_member_id UUID`,
    { transaction: t }
  );

  // La FK solo si existe el equipo: hay schemas sin `team_members` (el módulo
  // se vende aparte) y ahí la columna se queda suelta, que es inofensivo.
  if (await tableExists(s, schema, "team_members")) {
    await s.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_assigned_team_member_fk') THEN
           ALTER TABLE "${schema}"."clients"
             ADD CONSTRAINT clients_assigned_team_member_fk
             FOREIGN KEY (assigned_team_member_id)
             REFERENCES "${schema}"."team_members"(id)
             ON DELETE SET NULL;
         END IF;
       END $$;`,
      { transaction: t }
    );
  }

  // Índice para el camino que se recorre en cada reserva: «los pacientes de
  // esta profesional». Parcial, que la inmensa mayoría estará a NULL.
  await s.query(
    `CREATE INDEX IF NOT EXISTS clients_assigned_team_member_idx
       ON "${schema}"."clients" (assigned_team_member_id)
       WHERE assigned_team_member_id IS NOT NULL`,
    { transaction: t }
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ Falta DATABASE_URL\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" La paciente y su profesional\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `clients`");
  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await asignar(s, schema, t); });
      log(`✓ ${schema}: columna lista`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write(" Nadie queda asignado: se hace al aceptar cada solicitud.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
