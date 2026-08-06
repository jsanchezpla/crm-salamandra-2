/**
 * migrate-vacaciones.js
 *
 * «Vacaciones»: tramos en los que alguien no pasa consulta (06/08/2026, Rodrigo).
 *
 * Hasta hoy solo se podía cerrar el CENTRO un DÍA entero (`blocked_days`, los
 * festivos). No había forma de decir «Laura se va del 10 al 21» ni «el viernes
 * sale a las 14:00»: la agenda seguía ofreciendo sus huecos y alguien reservaba.
 *
 * Qué crea:
 *   `team_blocks` → tramos bloqueados, con hora y por persona.
 *     · `team_member_id` NULL = no está NADIE: cierra el centro entero en ese
 *       tramo, como un festivo pero con hora.
 *     · `start_at` / `end_at` son instantes, no fecha y hora sueltas: así un
 *       tramo de tres semanas es UNA fila y el cambio de hora no descuadra nada.
 *
 * Por qué tabla aparte y no una cita: hay mucho código leyendo `bookings`
 * —recordatorios, WhatsApp, cobros, «Mi perfil» de la paciente— y una reserva
 * fantasma llamada «Vacaciones» se colaría en todos.
 *
 * Solo se crea donde hay `bookings`: sin módulo de citas no hay agenda que
 * bloquear.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-vacaciones.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-vacaciones.js
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function crear(s, schema, t) {
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."team_blocks" (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       team_member_id UUID,
       start_at TIMESTAMPTZ NOT NULL,
       end_at TIMESTAMPTZ NOT NULL,
       label VARCHAR(120) NOT NULL DEFAULT 'Vacaciones',
       notes TEXT,
       created_by_id UUID,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction: t }
  );

  // Un tramo que acaba antes de empezar taparía huecos al azar. Se veta en BD
  // además de en el modelo: por aquí también entran scripts y arreglos a mano.
  await s.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_blocks_fin_despues_inicio') THEN
         ALTER TABLE "${schema}"."team_blocks"
           ADD CONSTRAINT team_blocks_fin_despues_inicio CHECK (end_at > start_at);
       END IF;
     END $$;`,
    { transaction: t }
  );

  // La FK solo si existe el equipo: hay schemas con citas y sin `team_members`.
  // ON DELETE CASCADE porque unas vacaciones sin quien las disfruta no
  // significan nada: si se borra a la persona, su bloqueo se va con ella. (Al
  // revés que en `clients`, donde la paciente sigue existiendo sin profesional.)
  if (await tableExists(s, schema, "team_members")) {
    await s.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_blocks_member_fk') THEN
           ALTER TABLE "${schema}"."team_blocks"
             ADD CONSTRAINT team_blocks_member_fk
             FOREIGN KEY (team_member_id)
             REFERENCES "${schema}"."team_members"(id)
             ON DELETE CASCADE;
         END IF;
       END $$;`,
      { transaction: t }
    );
  }

  // El camino de cada cálculo de huecos: «bloqueos que pisan este rango».
  await s.query(
    `CREATE INDEX IF NOT EXISTS team_blocks_end_at_idx ON "${schema}"."team_blocks" (end_at)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS team_blocks_member_idx ON "${schema}"."team_blocks" (team_member_id)`,
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
  process.stdout.write(" Vacaciones: tramos sin consulta\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `bookings`");
  const { schemas } = await byTable(s, "bookings");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await crear(s, schema, t); });
      log(`✓ ${schema}: tabla lista`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write(" Nace vacía: los bloqueos se crean desde Citas → Tipos de cita.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
