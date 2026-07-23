/**
 * migrate-clinica-client-link.js
 *
 * Conecta los registros clínicos con el CLIENTE (pagador), no solo con el
 * paciente.
 *
 * Hasta ahora una sesión, un informe o una coordinación colgaban del PACIENTE,
 * y para llegar al cliente había que dar un segundo salto paciente→cliente que
 * es frágil (patients.client_id es nullable y en muchos casos está vacío). Es
 * el mismo tipo de puente débil que dejó citas de Aumenta sin conectar. Ahora
 * cada registro clínico apunta también, de forma directa, al cliente.
 *
 * Para cada tabla (clinic_sessions, clinical_reports, coordinations):
 *   - + client_id UUID NULL, FK a clients(id) ON DELETE SET NULL.
 *   - Índice por client_id (desde la ficha del cliente, ver su actividad clínica).
 *   - RELLENO HACIA ATRÁS: se copia el cliente del paciente correspondiente
 *     (join por patient_id / related_patient_id). Es una foto del momento; si
 *     un paciente cambia de pagador, los registros viejos conservan el de
 *     entonces, que es lo correcto para un histórico clínico.
 *
 * El lado INTERNO (equipo) ya lo tenían: las sesiones e informes guardan el
 * terapeuta y las coordinaciones el `created_by_id`.
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-client-link.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-client-link.js
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

// tabla → columna que apunta al paciente (para el relleno hacia atrás).
const TABLAS = [
  { tabla: "clinic_sessions", patientCol: "patient_id" },
  { tabla: "clinical_reports", patientCol: "patient_id" },
  { tabla: "coordinations", patientCol: "related_patient_id" },
];

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: clínica enlazada con el cliente\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Ancla en clinic_sessions: si un schema tiene el módulo clínica, la tiene.
  const { schemas } = await byTable(s, "clinic_sessions");
  if (schemas.length === 0) log("· Ningún schema con módulo clínica.");

  for (const schema of schemas) {
    try {
      const [[{ existe }]] = await s.query(
        `SELECT to_regclass('"${schema}"."clients"') IS NOT NULL AS existe`
      );
      if (!existe) { log(`· ${schema}: sin tabla clients, se salta`); continue; }
      const [[{ hayPacientes }]] = await s.query(
        `SELECT to_regclass('"${schema}"."patients"') IS NOT NULL AS "hayPacientes"`
      );

      let enlazadosTotal = 0;
      await s.transaction(async (t) => {
        for (const { tabla, patientCol } of TABLAS) {
          const [[{ hay }]] = await s.query(
            `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS hay`,
            { transaction: t }
          );
          if (!hay) continue;

          await s.query(
            `ALTER TABLE "${schema}"."${tabla}" ADD COLUMN IF NOT EXISTS client_id UUID`,
            { transaction: t }
          );
          await addFk(s, schema, tabla, "client_id", "clients", `${tabla}_client_id_fkey`, t);
          await s.query(
            `CREATE INDEX IF NOT EXISTS ${tabla}_client_idx ON "${schema}"."${tabla}" (client_id)`,
            { transaction: t }
          );

          // Relleno hacia atrás desde el cliente del paciente.
          if (hayPacientes) {
            const [res] = await s.query(
              `UPDATE "${schema}"."${tabla}" r
                  SET client_id = p.client_id
                 FROM "${schema}"."patients" p
                WHERE r.${patientCol} = p.id
                  AND r.client_id IS NULL
                  AND p.client_id IS NOT NULL
                RETURNING r.id`,
              { transaction: t }
            );
            enlazadosTotal += Array.isArray(res) ? res.length : 0;
          }
        }
      });

      log(`✓ ${schema}: columnas listas · ${enlazadosTotal} registros enlazados desde su paciente`);
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
