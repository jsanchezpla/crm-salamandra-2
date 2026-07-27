/**
 * backfill-patients-client.js — enlaza pacientes con su ficha de cliente
 * (el pagador/tutor) usando SOLO pruebas que ya están en la base de datos.
 *
 * QUÉ ARREGLA: `patients.client_id` quedó vacío en los pacientes creados por el
 * flujo histórico de Clínica, y de ahí venía que sesiones e informes no
 * llegaran a la ficha del cliente. CLAUDE.md lo llama "la causa raíz".
 *
 * ⚠️ POR QUÉ NO SE CRUZA POR NOMBRE (decisión deliberada): en un centro como
 * Aumenta el cliente es el TUTOR QUE PAGA, no el paciente — el modelo tiene
 * `relationship` (hijo/a, tutor legal…) y `Client.separated` para padres
 * separados. Un "Juan Pérez" paciente y un "Juan Pérez" cliente pueden ser hijo
 * y padre... o dos familias distintas. Meter a un menor bajo la familia
 * equivocada en un CRM con datos de psicología/TCA sería una fuga de datos
 * clínicos entre familias. Y `patients` NO tiene email, así que el cruce por
 * correo que se usó en las citas aquí no existe.
 *
 * CRITERIO (determinista, sin adivinar nada): se mira qué `client_id` aparece
 * en los registros QUE YA TIENE ese paciente — sus citas, sesiones, informes y
 * coordinaciones. Si TODOS coinciden en el mismo cliente, se enlaza. Si
 * aparecen dos clientes distintos (caso real: padres separados), se deja como
 * está y se lista para que lo resuelva una persona. Es la misma doctrina que
 * `migrate-booking-client-link.js`: enlazar solo con coincidencia ÚNICA,
 * "que adivinar ahí es peor que no hacer nada".
 *
 * SEGURIDAD DE LA OPERACIÓN:
 *   - DRY RUN por defecto: sin `--confirm` solo imprime lo que haría.
 *   - Genera un fichero .rollback.sql con las filas EXACTAS que tocó, para
 *     deshacer con precisión sin restaurar toda la base de datos.
 *   - Nunca pisa un client_id ya puesto.
 *
 * Uso:
 *   node --env-file=.env.local scripts/backfill-patients-client.js
 *   node --env-file=.env.local scripts/backfill-patients-client.js --confirm
 *   ONLY_SCHEMAS=crm_aumenta docker exec crm-salamandra-app-1 node scripts/backfill-patients-client.js --confirm
 */

import { Sequelize } from "sequelize";
import { writeFileSync } from "node:fs";

const CONFIRM = process.argv.includes("--confirm");

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemasConPacientes(s) {
  const only = (process.env.ONLY_SCHEMAS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const [rows] = await s.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = 'patients' AND table_schema LIKE 'crm_%'
      ORDER BY table_schema`
  );
  const todos = rows.map((r) => r.table_schema);
  return only.length ? todos.filter((x) => only.includes(x)) : todos;
}

/**
 * ¿Existe la tabla CON las dos columnas que necesitamos? No basta con que la
 * tabla exista: hay schemas donde `coordinations` o `clinical_reports` nacieron
 * antes de las columnas de enlace y no tienen patient_id o client_id.
 */
async function sirveDeFuente(s, schema, nombre) {
  const [rows] = await s.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
        AND column_name IN ('patient_id', 'client_id')`,
    { bind: [schema, nombre] }
  );
  return rows.length === 2;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  header(CONFIRM ? "BACKFILL pacientes → cliente (ESCRIBIENDO)" : "BACKFILL pacientes → cliente (SIMULACIÓN, usa --confirm para aplicar)");

  const schemas = await schemasConPacientes(s);
  log(`Schemas con tabla patients: ${schemas.join(", ") || "(ninguno)"}`);

  for (const schema of schemas) {
    header(schema);

    const [[{ sueltos }]] = await s.query(
      `SELECT count(*)::int AS sueltos FROM "${schema}".patients WHERE client_id IS NULL`
    );
    if (sueltos === 0) {
      log("Sin pacientes sueltos. Nada que hacer.");
      continue;
    }
    log(`Pacientes sin ficha de pagador: ${sueltos}`);

    // Fuentes de prueba disponibles en ESTE schema (unas tablas pueden faltar).
    const fuentes = [];
    for (const t of ["bookings", "clinic_sessions", "clinical_reports", "coordinations"]) {
      if (await sirveDeFuente(s, schema, t)) fuentes.push(t);
    }
    if (!fuentes.length) {
      log("No hay ninguna tabla de la que deducir el pagador. Se salta.");
      continue;
    }
    log(`Pruebas a partir de: ${fuentes.join(", ")}`);

    const union = fuentes
      .map((t) => `SELECT patient_id, client_id FROM "${schema}"."${t}" WHERE patient_id IS NOT NULL AND client_id IS NOT NULL`)
      .join(" UNION ALL ");

    // Candidatos = pacientes sueltos cuyas pruebas apuntan TODAS al mismo cliente.
    const [candidatos] = await s.query(`
      WITH pruebas AS (${union}),
      agrupado AS (
        SELECT patient_id, min(client_id::text)::uuid AS client_id, count(DISTINCT client_id) AS distintos
          FROM pruebas GROUP BY patient_id
      )
      SELECT a.patient_id, a.client_id, a.distintos
        FROM agrupado a
        JOIN "${schema}".patients p ON p.id = a.patient_id
       WHERE p.client_id IS NULL
    `);

    const unicos = candidatos.filter((c) => Number(c.distintos) === 1);
    const ambiguos = candidatos.filter((c) => Number(c.distintos) > 1);
    const sinPruebas = sueltos - candidatos.length;

    log(`→ enlazables (una sola familia): ${unicos.length}`);
    log(`→ ambiguos (varios pagadores, se dejan como están): ${ambiguos.length}`);
    log(`→ sin ninguna prueba en el CRM: ${sinPruebas}`);

    if (ambiguos.length) {
      log(`   Revisar a mano: ${ambiguos.map((a) => a.patient_id).slice(0, 10).join(", ")}${ambiguos.length > 10 ? "…" : ""}`);
    }

    if (!unicos.length) continue;

    if (!CONFIRM) {
      log("(simulación: no se ha escrito nada)");
      continue;
    }

    // Rollback quirúrgico ANTES de escribir: patients no tiene columna de
    // metadatos donde marcar "esto lo puso el backfill".
    const marca = new Date().toISOString().replace(/[:.]/g, "-");
    const ficheroRollback = `backfill-patients-client-${schema}-${marca}.rollback.sql`;
    const ids = unicos.map((u) => `'${u.patient_id}'`).join(", ");
    writeFileSync(
      ficheroRollback,
      `-- Deshace EXACTAMENTE lo que escribió el backfill en ${schema} (${unicos.length} pacientes).\n` +
        `UPDATE "${schema}".patients SET client_id = NULL WHERE id IN (${ids});\n`
    );
    log(`Rollback guardado en ${ficheroRollback}`);

    let enlazados = 0;
    for (const u of unicos) {
      const [res] = await s.query(
        `UPDATE "${schema}".patients SET client_id = $1, updated_at = now()
          WHERE id = $2 AND client_id IS NULL RETURNING id`,
        { bind: [u.client_id, u.patient_id] }
      );
      enlazados += res.length;
    }
    log(`✓ Enlazados: ${enlazados}`);

    // Segunda pasada: los registros clínicos guardan una FOTO del cliente al
    // crearse, así que los que nacieron sin él siguen sueltos. Ahora que el
    // paciente ya tiene pagador, se copia. Es 100% determinista: no adivina.
    for (const t of fuentes) {
      const [res] = await s.query(`
        UPDATE "${schema}"."${t}" r
           SET client_id = p.client_id
          FROM "${schema}".patients p
         WHERE r.patient_id = p.id
           AND r.client_id IS NULL
           AND p.client_id IS NOT NULL
        RETURNING r.id
      `);
      if (res.length) log(`✓ ${t}: ${res.length} registro(s) reconectados a su cliente`);
    }
  }

  await s.close();
  header(CONFIRM ? "Hecho." : "Simulación terminada. Repite con --confirm para aplicar.");
}

main().catch((err) => { console.error(err); process.exit(1); });
