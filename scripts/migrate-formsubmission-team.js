/**
 * migrate-formsubmission-team.js
 *
 * Convierte "quién atendió la solicitud" de TEXTO a ENLACE real con el equipo.
 *
 * El módulo Formularios guardaba `handled_by` como texto libre (el email de
 * quien aceptaba o descartaba). Eso no es un vínculo: no se puede filtrar "las
 * solicitudes que atendió fulano" ni saltar a su ficha de equipo. Se añade un
 * enlace de verdad y el texto se conserva por compatibilidad.
 *
 *   - form_submissions.handled_by_team_id UUID NULL, FK a team_members(id)
 *     ON DELETE SET NULL, + índice.
 *
 * Sin relleno hacia atrás automático: el texto viejo es un email y casar
 * emails con miembros del equipo es justo el tipo de "adivinar por cadena" que
 * estamos quitando. Las nuevas acciones anotan el enlace directo.
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-formsubmission-team.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-formsubmission-team.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function addFk(s, schema, table, column, refTable, constraint, t) {
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."${table}"
         ADD CONSTRAINT ${constraint}
         FOREIGN KEY (${column}) REFERENCES "${schema}"."${refTable}"(id) ON DELETE SET NULL;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table  THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: quién atendió el formulario → enlace real\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "form_submissions");
  if (schemas.length === 0) log("· Ningún schema con tabla form_submissions.");

  for (const schema of schemas) {
    try {
      // La COLUMNA se añade SIEMPRE (UUID nullable inofensivo): el modelo la
      // referencia en todo tenant con form_submissions, tenga o no módulo de
      // equipo. La FK es lo único condicional; addFk hace no-op si no existe
      // team_members.
      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."form_submissions" ADD COLUMN IF NOT EXISTS handled_by_team_id UUID`,
          { transaction: t }
        );
        await addFk(s, schema, "form_submissions", "handled_by_team_id", "team_members", "form_submissions_handled_by_team_fkey", t);
        await s.query(
          `CREATE INDEX IF NOT EXISTS form_submissions_handled_by_team_idx ON "${schema}"."form_submissions" (handled_by_team_id)`,
          { transaction: t }
        );
      });
      log(`✓ ${schema}: form_submissions.handled_by_team_id listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
