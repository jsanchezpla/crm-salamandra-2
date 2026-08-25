/**
 * backfill-patients-terapeutas.js
 *
 * Copia el terapeuta que ya tiene cada paciente (`patients.main_therapist_id`) a
 * la tabla `patient_therapists`, para que la lista sea la verdad desde el
 * primer día en vez de irse llenando según alguien edite fichas.
 *
 * ⚠️ ESTO ESCRIBE. DRY RUN por defecto: sin `--confirm` solo cuenta.
 *
 * ── NO ES OBLIGATORIO, Y ESO IMPORTA ───────────────────────────────────────
 *
 * El código funciona sin esto. Un paciente sin filas en la tabla se lee como
 * «tiene al de la columna» (la caída al espejo de `lib/clinica/terapeutas.js`),
 * así que se puede desplegar, dejarlo y no correrlo nunca. Lo que da correrlo es
 * uniformidad: todos los pacientes representados igual, y consultas futuras que
 * puedan mirar solo la tabla sin acordarse de la columna.
 *
 * ── QUÉ HACE EXACTAMENTE ───────────────────────────────────────────────────
 *
 * Una fila por paciente que HOY tenga `main_therapist_id`, con `specialty` a
 * nulo (la columna vieja no sabía de especialidades) y `assigned_at` puesto a la
 * fecha de alta del paciente si la hay, o a la de creación de su ficha: es lo
 * más cercano a «desde cuándo la lleva» que se puede saber sin inventar.
 *
 * No toca ni una fila existente (`ON CONFLICT DO NOTHING`), no borra nada, no
 * cambia `main_therapist_id` y es idempotente: correrlo dos veces no hace nada
 * la segunda.
 *
 * ── POR QUÉ ENUMERA POR `master.tenants` ───────────────────────────────────
 *
 * Porque el hermano mayor de este script, `backfill-patients-client.js`, mira
 * `information_schema` con `table_schema LIKE 'crm_%'`, y eso incluye las FOTOS
 * DORADAS de las demos (`crm_demo_golden`…). Escribir en una foto dorada es
 * escribir en el punto de restauración de una demo: no se ve hasta que alguien
 * la restaura. `byTable` lee los slugs de `master.tenants`, y las fotos no son
 * tenants, así que quedan fuera solas.
 *
 * Uso:
 *   node --env-file=.env.local scripts/backfill-patients-terapeutas.js
 *   node --env-file=.env.local scripts/backfill-patients-terapeutas.js --confirm
 *   ssh crm-vps 'docker exec crm-salamandra-app-1 node scripts/backfill-patients-terapeutas.js'
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

const CONFIRM = process.argv.includes("--confirm");

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(CONFIRM
    ? " Relleno: terapeuta de la ficha → lista (ESCRIBIENDO)\n"
    : " Relleno: terapeuta de la ficha → lista (SIMULACIÓN)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "patients");
  let total = 0;

  for (const schema of schemas) {
    try {
      if (!(await tableExists(s, schema, "patient_therapists"))) {
        log(`· ${schema}: sin patient_therapists — falta correr migrate-patients-terapeutas.js`);
        continue;
      }

      // Los que faltan: tienen terapeuta en la columna y ninguna fila todavía.
      const [[{ n }]] = await s.query(
        `SELECT count(*)::int AS n
           FROM "${schema}"."patients" p
          WHERE p.main_therapist_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "${schema}"."patient_therapists" pt
               WHERE pt.patient_id = p.id AND pt.team_member_id = p.main_therapist_id)`
      );

      if (n === 0) { log(`✓ ${schema}: nada que copiar`); continue; }
      total += n;

      if (!CONFIRM) { log(`· ${schema}: copiaría ${n} paciente(s)`); continue; }

      const [, meta] = await s.query(
        `INSERT INTO "${schema}"."patient_therapists"
                (patient_id, team_member_id, specialty, assigned_at)
         SELECT p.id, p.main_therapist_id, NULL,
                COALESCE(p.enrollment_date::timestamptz, p.created_at, now())
           FROM "${schema}"."patients" p
          WHERE p.main_therapist_id IS NOT NULL
         ON CONFLICT (patient_id, team_member_id) DO NOTHING`
      );
      log(`✓ ${schema}: ${meta?.rowCount ?? n} fila(s) copiadas`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write(CONFIRM
    ? `\n ✓ Hecho.\n\n`
    : `\n Simulación terminada: ${total} fila(s) en total. Repite con --confirm para aplicar.\n\n`);
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
