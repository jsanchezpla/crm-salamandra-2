/**
 * migrate-consultas-externas.js
 *
 * «Consultas externas» (07/08/2026, Rodrigo).
 *
 * Laura atiende a pacientes por acuerdos con empresas. Quiere guardar su
 * historia clínica y sus documentos en el MISMO sitio que el resto —para no
 * llevar dos archivos— pero esos pacientes no son de su consulta: no llevan
 * cuenta en la web, ni documentos compartidos, ni contratos.
 *
 * Qué crea, en `clients`:
 *   · `es_consulta_externa` (BOOLEAN NOT NULL DEFAULT false) — la marca.
 *   · `categoria_externa`   (VARCHAR 80) — la empresa con la que hay acuerdo.
 *
 * ⚠️ EL DEFAULT ES `false` Y NO NULL, y con `NOT NULL`: quien mira el listado
 * filtra por «no es externa», y una columna a NULL en 1.083 fichas ya cargadas
 * las haría desaparecer del CRM de golpe hasta que alguien las guardara una a
 * una. Con el default puesto, todo lo que existe sigue siendo lo que era.
 *
 * La CATEGORÍA se queda en texto libre a propósito, sin FK a una tabla de
 * empresas: la lista de empresas vive en los ajustes del tenant y se edita
 * desde Configuración. Si mañana se quita una empresa de esa lista, los
 * pacientes que la tenían conservan el dato en vez de quedarse huérfanos.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-consultas-externas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-consultas-externas.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function marcar(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."clients"
       ADD COLUMN IF NOT EXISTS es_consulta_externa BOOLEAN NOT NULL DEFAULT false`,
    { transaction: t }
  );
  await s.query(
    `ALTER TABLE "${schema}"."clients"
       ADD COLUMN IF NOT EXISTS categoria_externa VARCHAR(80)`,
    { transaction: t }
  );

  // El camino que se recorre en CADA listado: «las que no son externas, más las
  // mías». Parcial sobre las externas, que van a ser una minoría.
  await s.query(
    `CREATE INDEX IF NOT EXISTS clients_consulta_externa_idx
       ON "${schema}"."clients" (assigned_team_member_id)
       WHERE es_consulta_externa = true`,
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
  process.stdout.write(" Consultas externas\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `clients`");
  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await marcar(s, schema, t); });
      log(`✓ ${schema}: columnas listas`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write(" Nadie queda marcado: se hace paciente a paciente.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
