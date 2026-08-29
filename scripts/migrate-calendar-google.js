/**
 * migrate-calendar-google.js — el Calendario convoca a una lista y se espeja en
 * Google Calendar (29/08/2026, Rodrigo). Dos tablas nuevas:
 *
 *   · `calendar_task_attendees` — a quién AFECTA cada evento, una fila por
 *     miembro (el desplegable «Afecta a», con su «Todos»). Es el «modelo
 *     aparte» que la decisión de la videollamada (27/08) dejó anunciado.
 *     `google_event_id` es la copia de ese evento en el Google de ESA persona.
 *   · `google_calendar_connections` — la cuenta de Google que cada miembro
 *     conectó: tokens (cifrados por la app), correo y el id del calendario
 *     «CRM Salamandra» que se le creó.
 *
 * Aditiva e idempotente. Se aplica a todo schema que tenga `calendar_tasks` Y
 * `team_members` (byTable, no byModule — el criterio del incidente del
 * 21/07/2026): sin equipo no hay a quién convocar, y las FK no tendrían diana.
 * Al ir por `LIKE 'crm_%'` entra también en los schemas `_golden` de las demos.
 *
 * FKs con ON DELETE explícito (la lección del 26/08): borrar el evento o al
 * miembro se lleva sus filas de convocatoria y su conexión — sin ellos no
 * significan nada, y los eventos de su Google son suyos y se quedan.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-calendar-google.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-calendar-google.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

/*
 * ¿Tiene esta tabla una clave primaria o única sobre la que colgar una FK?
 * Los schemas `_golden` (las fotos limpias de las demos) NO: la foto copia
 * datos y forma, no restricciones. Ahí las tablas se crean SIN FKs — una foto
 * no necesita integridad referencial, necesita la misma forma para que la
 * siguiente instantánea/reposición no se quede atrás (decisión del 29/08,
 * «las fotos doradas se migran solas»).
 */
async function tieneClave(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname=$1 AND t.relname=$2 AND c.contype IN ('p','u')`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

    const [rows] = await s.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
    );
    const schemas = acotarSchemas(rows.map((r) => r.schema_name));
    process.stdout.write(`\n▶ Calendario ↔ Google Calendar · ${schemas.length} schema(s)\n\n`);

    let tocados = 0;
    for (const schema of schemas) {
      if (!(await tableExists(s, schema, "calendar_tasks"))) {
        log(`· ${schema}: sin calendar_tasks, se salta`);
        continue;
      }
      if (!(await tableExists(s, schema, "team_members"))) {
        log(`· ${schema}: sin team_members, se salta`);
        continue;
      }

      // En una foto dorada las dianas no tienen PK: mismas tablas, sin FKs.
      const conFks = (await tieneClave(s, schema, "calendar_tasks")) && (await tieneClave(s, schema, "team_members"));
      const fkTarea = conFks ? ` REFERENCES "${schema}"."calendar_tasks"(id) ON DELETE CASCADE` : "";
      const fkMiembro = conFks ? ` REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE` : "";

      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."calendar_task_attendees" (
          ${idCol},
          task_id UUID NOT NULL${fkTarea},
          team_member_id UUID NOT NULL${fkMiembro},
          google_event_id VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT calendar_task_attendees_unique UNIQUE (task_id, team_member_id)
        )`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS "calendar_task_attendees_member_idx"
           ON "${schema}"."calendar_task_attendees" (team_member_id)`
      );

      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."google_calendar_connections" (
          ${idCol},
          team_member_id UUID NOT NULL UNIQUE${fkMiembro},
          google_email VARCHAR(255),
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          token_expires_at TIMESTAMPTZ,
          calendar_id VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      log(`✓ ${schema}: calendar_task_attendees, google_calendar_connections${conFks ? "" : " (foto dorada: sin FKs)"}`);
      tocados++;
    }

    process.stdout.write(`\n✓ Migración completada · ${tocados} schema(s) con Calendario y Equipo\n\n`);
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
