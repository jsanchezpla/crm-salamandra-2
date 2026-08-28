/**
 * migrate-team-colegiada.js
 *
 * Añade a cada MIEMBRO DEL EQUIPO los dos datos con los que FIRMA un informe:
 *
 *   - team_members.collegiate_number VARCHAR(40) NULL.
 *   - team_members.qualification     VARCHAR(120) NULL.
 *
 * Los pide el informe clínico rediseñado (28/08/2026, Aumenta): el documento que
 * la familia presenta en el colegio o para la beca del Ministerio cierra con el
 * nº de colegiada y la titulación de quien lo firma, y hasta hoy el CRM no
 * guardaba ninguno de los dos.
 *
 * SIN BACKFILL y sin DEFAULT, por el mismo motivo que
 * migrate-team-members-block-color: el NULL significa algo. Aquí significa «este
 * dato no lo tenemos», y el generador del PDF se salta la fila que falte. Un
 * valor inventado no se quedaría en la base: saldría IMPRESO bajo una firma
 * profesional. Hoy en producción no lo tiene nadie.
 *
 * El modelo referencia collegiateNumber y qualification en todos los tenants con
 * tabla team_members, por eso se añaden SIEMPRE (si faltaran → 42703).
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-team-colegiada.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-team-colegiada.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: equipo → nº de colegiada y titulación\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "team_members");
  if (schemas.length === 0) log("· Ningún schema con tabla team_members.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."team_members"
           ADD COLUMN IF NOT EXISTS collegiate_number VARCHAR(40)`
      );
      await s.query(
        `ALTER TABLE "${schema}"."team_members"
           ADD COLUMN IF NOT EXISTS qualification VARCHAR(120)`
      );
      log(`✓ ${schema}: team_members.collegiate_number y .qualification listos`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n · Las dos nacen vacías: quien no tenga el dato no lo imprime en su informe.\n");
  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
