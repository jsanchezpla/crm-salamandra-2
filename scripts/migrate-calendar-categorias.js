/**
 * migrate-calendar-categorias.js — el Calendario clasifica y reparte
 * (01/09/2026, Rodrigo). Dos tablas nuevas y una columna:
 *
 *   · `calendar_categories` — el catálogo de «de qué va» cada evento, con su
 *     nombre y su color, que pone cada centro. Es la misma idea que los tipos
 *     de cita de Citas, aplicada a la otra agenda.
 *   · `calendar_tasks.category_id` — a qué categoría pertenece el evento.
 *     `ON DELETE SET NULL`: borrar una categoría no se lleva las reuniones.
 *   · `calendar_task_owners` — QUIÉN SE ENCARGA, una fila por persona (un
 *     evento puede tener varios responsables). No confundir con
 *     `calendar_task_attendees`, que es a quién AFECTA.
 *
 * Y un backfill: cada evento que ya tenía responsable (`team_member_id`)
 * estrena su fila en `calendar_task_owners`. Sin él, abrir un evento viejo
 * después de desplegar lo enseñaría «sin responsable» —el dato seguiría en su
 * columna, pero la pantalla ya lee la lista— y bastaría con guardar una vez
 * para perderlo de verdad. La columna se conserva como espejo del principal
 * (ver `models/tenant/CalendarTaskOwner.model.js`).
 *
 * Aditiva e idempotente. Se aplica a todo schema que tenga `calendar_tasks`;
 * los responsables solo donde además haya `team_members` (sin equipo no hay a
 * quién encargarle nada, y la FK no tendría diana). Al ir por `LIKE 'crm_%'`
 * entra también en los schemas `_golden` de las demos, que no tienen claves:
 * allí las tablas se crean SIN FKs (la lección del 29/08, «las fotos doradas
 * se migran solas»).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-calendar-categorias.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-calendar-categorias.js
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

async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}

/** ¿Tiene esta tabla PK/única sobre la que colgar una FK? Las fotos doradas no. */
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
    process.stdout.write(`\n▶ Calendario · categorías y responsables · ${schemas.length} schema(s)\n\n`);

    let tocados = 0;
    for (const schema of schemas) {
      if (!(await tableExists(s, schema, "calendar_tasks"))) {
        log(`· ${schema}: sin calendar_tasks, se salta`);
        continue;
      }
      const hecho = [];

      // ── 1. El catálogo de categorías ──────────────────────────────────────
      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."calendar_categories" (
          ${idCol},
          name VARCHAR(255) NOT NULL,
          description TEXT,
          color VARCHAR(7),
          active BOOLEAN NOT NULL DEFAULT true,
          "order" INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS "calendar_categories_active_order_idx"
           ON "${schema}"."calendar_categories" (active, "order")`
      );
      hecho.push("calendar_categories");

      // ── 2. La columna del evento ──────────────────────────────────────────
      if (!(await columnExists(s, schema, "calendar_tasks", "category_id"))) {
        const conFk = await tieneClave(s, schema, "calendar_categories");
        await s.query(
          `ALTER TABLE "${schema}"."calendar_tasks" ADD COLUMN category_id UUID` +
            (conFk
              ? ` REFERENCES "${schema}"."calendar_categories"(id) ON DELETE SET NULL`
              : "")
        );
        hecho.push("calendar_tasks.category_id");
      }
      await s.query(
        `CREATE INDEX IF NOT EXISTS "calendar_tasks_category_id_idx"
           ON "${schema}"."calendar_tasks" (category_id)`
      );

      // ── 3. Los responsables, y el backfill del que ya había ───────────────
      if (await tableExists(s, schema, "team_members")) {
        const conFks =
          (await tieneClave(s, schema, "calendar_tasks")) && (await tieneClave(s, schema, "team_members"));
        const fkTarea = conFks ? ` REFERENCES "${schema}"."calendar_tasks"(id) ON DELETE CASCADE` : "";
        const fkMiembro = conFks ? ` REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE` : "";

        await s.query(
          `CREATE TABLE IF NOT EXISTS "${schema}"."calendar_task_owners" (
            ${idCol},
            task_id UUID NOT NULL${fkTarea},
            team_member_id UUID NOT NULL${fkMiembro},
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT calendar_task_owners_unique UNIQUE (task_id, team_member_id)
          )`
        );
        await s.query(
          `CREATE INDEX IF NOT EXISTS "calendar_task_owners_member_idx"
             ON "${schema}"."calendar_task_owners" (team_member_id)`
        );
        hecho.push("calendar_task_owners");

        // El responsable de siempre pasa a ser el primero de la lista. Con
        // ON CONFLICT: relanzar la migración no duplica ni revienta.
        const insercion = uuidDefault
          ? `INSERT INTO "${schema}"."calendar_task_owners" (task_id, team_member_id)`
          : `INSERT INTO "${schema}"."calendar_task_owners" (id, task_id, team_member_id)`;
        const seleccion = uuidDefault
          ? `SELECT t.id, t.team_member_id`
          : `SELECT md5(random()::text || clock_timestamp()::text)::uuid, t.id, t.team_member_id`;
        const [, meta] = await s.query(
          `${insercion}
           ${seleccion}
             FROM "${schema}"."calendar_tasks" t
             JOIN "${schema}"."team_members" m ON m.id = t.team_member_id
            WHERE t.team_member_id IS NOT NULL
           ON CONFLICT DO NOTHING`
        );
        const n = meta?.rowCount ?? 0;
        if (n > 0) hecho.push(`${n} responsable(s) rescatado(s)`);
      } else {
        hecho.push("sin team_members: no hay responsables que crear");
      }

      log(`✓ ${schema}: ${hecho.join(", ")}`);
      tocados++;
    }

    process.stdout.write(`\n✓ Migración completada · ${tocados} schema(s) con Calendario\n\n`);
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
