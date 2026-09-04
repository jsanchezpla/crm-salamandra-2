/**
 * migrate-incidencias-visto.js — el «Visto» de cada responsable
 * (04/09/2026, Rodrigo: «un botón de Visto para que una terapeuta marque que
 * ha resuelto su parte de la incidencia, pero que no signifique que está
 * resuelta para todas»).
 *
 * Añade a `incidencia_assignees`, en cada schema que tenga la tabla (fotos
 * doradas de las demos incluidas, por `byTable`):
 *   - `visto_at` TIMESTAMPTZ, NULL = sigue pendiente para esa persona.
 *
 * ── POR QUÉ EN LA PIVOTE Y NO EN LA INCIDENCIA ──────────────────────────────
 * Porque el dato es de la PAREJA incidencia↔persona, no de la incidencia. Una
 * incidencia con tres responsables tiene tres respuestas posibles a «¿ya está
 * lo tuyo?», y `incidencias.status` solo sabe guardar una — la de todas. Meter
 * ahí el visto obligaría a elegir entre cerrarla para quien aún no ha hecho su
 * parte o dejarla sonando a quien ya la hizo, que es exactamente el problema.
 *
 * Aditiva y sin backfill: NULL es «pendiente», que es el estado en el que
 * están hoy todas las filas y el que corresponde. Nadie estrena el módulo con
 * incidencias dadas por vistas sin haberlas visto.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Por existencia de tabla, sin mirar
 * módulos (regla #12): el modelo IncidenciaAssignee declara la columna para
 * todos los tenants y sin ella el primer SELECT daría 42703.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE, como `migrate-billing-cuotas`: el modelo pide la
 * columna por nombre en cuanto arranca el contenedor nuevo.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-incidencias-visto.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-incidencias-visto.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."incidencia_assignees" ADD COLUMN IF NOT EXISTS visto_at TIMESTAMPTZ`,
      { transaction: t }
    );
    // Índice por (persona, visto_at): la consulta que más se repite es «las
    // que tengo pendientes» —la campana, la Bandeja y la portada la hacen en
    // cada carga— y sin él barre todas las asignaciones de la persona.
    await s.query(
      `CREATE INDEX IF NOT EXISTS incidencia_assignees_pendientes_idx
         ON "${schema}"."incidencia_assignees" (team_member_id, visto_at)`,
      { transaction: t }
    );
    log(`✓ ${schema}: columna visto_at e índice asegurados`);
  });

  // Comprobación real, no la fe en el ALTER.
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'incidencia_assignees' AND column_name = 'visto_at'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna visto_at NO está`);
}

async function main() {
  process.stdout.write("\n▶ Migración: el «Visto» de cada responsable de una incidencia\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "incidencia_assignees");
  if (skipped.length) log(`· sin tabla incidencia_assignees, se saltan: ${skipped.join(", ")}`);
  for (const schema of schemas) await processSchema(s, schema);
  process.stdout.write(`\n✓ Hecho: ${schemas.length} schema(s)\n\n`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
