/**
 * migrate-interactions-notes-team.js
 *
 * Conecta con el equipo interno dos registros que hasta ahora sabían con qué
 * cliente estaban pero no quién de los nuestros los hizo:
 *
 *   - interactions.team_member_id — quién registró la llamada/email/reunión.
 *     Sin esto no se puede ver "las interacciones de tal comercial".
 *   - client_notes.team_member_id — quién escribió la nota en la ficha.
 *
 * Ambas: UUID NULL, FK a team_members(id) ON DELETE SET NULL, + índice.
 *
 * Sin relleno hacia atrás (no hay pista fiable del autor de los registros
 * viejos). Los nuevos se anotan con el usuario logueado.
 *
 * Selecciona schemas por EXISTENCIA de tabla, tabla a tabla. Aditiva e
 * idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-interactions-notes-team.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-interactions-notes-team.js
 */

import { Sequelize } from "sequelize";

import { acotarSchemas } from "./_solo-este-tenant.js";

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

// Todas las tablas del schema (para elegir por existencia sin depender de un
// _schema-targets que ancla en una sola tabla).
async function schemasConTabla(s, tabla) {
  const [rows] = await s.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = :tabla AND table_schema LIKE 'crm_%'
      ORDER BY table_schema`,
    { replacements: { tabla } }
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.table_schema));
}

const TABLAS = ["interactions", "client_notes"];

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: interacciones y notas enlazadas con el equipo\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  for (const tabla of TABLAS) {
    const schemas = await schemasConTabla(s, tabla);
    if (schemas.length === 0) { log(`· Ningún schema con tabla ${tabla}.`); continue; }

    for (const schema of schemas) {
      try {
        // Columna SIEMPRE (el modelo la referencia en todo tenant con la
        // tabla); FK condicional vía addFk (no-op si falta team_members).
        await s.transaction(async (t) => {
          await s.query(
            `ALTER TABLE "${schema}"."${tabla}" ADD COLUMN IF NOT EXISTS team_member_id UUID`,
            { transaction: t }
          );
          await addFk(s, schema, tabla, "team_member_id", "team_members", `${tabla}_team_member_id_fkey`, t);
          await s.query(
            `CREATE INDEX IF NOT EXISTS ${tabla}_team_member_idx ON "${schema}"."${tabla}" (team_member_id)`,
            { transaction: t }
          );
        });
        log(`✓ ${schema}: ${tabla}.team_member_id listo`);
      } catch (err) {
        log(`✗ ${schema}.${tabla}: ${err.message} — se salta`);
      }
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
