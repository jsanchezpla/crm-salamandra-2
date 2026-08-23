// @vivo — Extra del escaparate fuera de la cadena pero hecho para sobrevivirla: se adaptó a resolver terapeutas y tipos de cita en runtime precisamente… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-demo-familia-pagador.js — escenario de demostración para el tenant `demo`:
 * un CLIENTE PAGADOR con VARIOS PACIENTES, cada uno con sus propias citas.
 *
 *   Pedro Giménez Torres  (cliente que paga)
 *     ├─ Juan Giménez López   · hijo · 12 años     → citas con la 1ª profesional
 *     └─ María Sánchez Giménez · sobrina · 14 años → citas con el 2º profesional
 *
 * Los profesionales y tipos de cita se resuelven por nombre en tiempo de
 * ejecución (ver resolveRefs): sus UUID cambian en cada `db:rebuild:demo`.
 *
 * Demuestra la cadena Cliente(pagador) → Pacientes → Citas ya integrada.
 * Idempotente: se identifica por client.custom_fields->>'showcase' y se
 * reconstruye en cada ejecución. SOLO toca el tenant demo. Requiere haber corrido
 * antes migrate-patients-multi-per-client.js (quita el candado 1 cliente=1 paciente).
 *
 * Uso: node --env-file=.env.local scripts/seed-demo-familia-pagador.js
 */
import { Sequelize } from "sequelize";

const SC = "crm_demo";
const MARK = "familia-pagador";
const uuid = () => "gen_random_uuid()";
function L(m) { process.stdout.write("  " + m + "\n"); }

// Referencias resueltas EN RUNTIME. Antes iban hardcodeadas, pero
// `db:rebuild:demo` regenera los UUID del escaparate en cada ejecución (y los
// nombres del seed han cambiado con el tiempo), así que el seed reventaba con
// un fallo de FK en cualquier máquina que no fuese aquella donde se anotaron.
async function resolveRefs(t) {
  const [ets] = await s.query(`SELECT id, name FROM "${SC}".event_types`, { transaction: t });
  const [tms] = await s.query(
    `SELECT id, display_name FROM "${SC}".team_members ORDER BY display_name`,
    { transaction: t }
  );
  if (!ets.length) throw new Error("crm_demo.event_types vacío — corre antes `npm run db:rebuild:demo`");
  if (tms.length < 2) throw new Error("crm_demo.team_members necesita 2+ miembros — corre antes `npm run db:rebuild:demo`");

  const find = (rows, field, re) => rows.find((r) => re.test(r[field]));
  const primera = find(ets, "name", /primera/i) || ets[0];
  const seguimiento = find(ets, "name", /seguimiento/i) || ets[ets.length - 1];
  const monica = find(tms, "display_name", /^mónica/i) || tms[0];
  const roberto = find(tms, "display_name", /^roberto/i) || tms.find((m) => m.id !== monica.id);

  return {
    ET_PRIMERA: primera.id,
    ET_SEGUIMIENTO: seguimiento.id,
    TM_MONICA: monica.id,
    TM_ROBERTO: roberto.id,
    nombreMonica: monica.display_name,
    nombreRoberto: roberto.display_name,
  };
}

const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

async function main() {
  await s.transaction(async (t) => {
    const refs = await resolveRefs(t);
    L(`terapeutas: ${refs.nombreMonica} y ${refs.nombreRoberto}`);

    // ── Limpieza idempotente ──────────────────────────────────────────────
    const [prev] = await s.query(
      `SELECT id FROM "${SC}".clients WHERE custom_fields->>'showcase' = $1`,
      { bind: [MARK], transaction: t }
    );
    if (prev.length) {
      const cid = prev[0].id;
      const [pats] = await s.query(`SELECT id FROM "${SC}".patients WHERE client_id = $1`, { bind: [cid], transaction: t });
      const pids = pats.map((p) => p.id);
      if (pids.length) {
        await s.query(`DELETE FROM "${SC}".bookings WHERE patient_id = ANY($1::uuid[])`, { bind: [pids], transaction: t });
        await s.query(`DELETE FROM "${SC}".patients WHERE client_id = $1`, { bind: [cid], transaction: t });
      }
      await s.query(`DELETE FROM "${SC}".clients WHERE id = $1`, { bind: [cid], transaction: t });
      L("limpieza: escenario anterior eliminado");
    }

    // ── Cliente pagador (Pedro) ───────────────────────────────────────────
    const [[client]] = await s.query(
      `INSERT INTO "${SC}".clients (id, type, name, email, phone, status, custom_fields, created_at, updated_at)
       VALUES (${uuid()}, 'individual', 'Pedro Giménez Torres', 'pedro.gimenez@example.com', '+34 620 114 887', 'active',
               jsonb_build_object('showcase', $1::text), now(), now())
       RETURNING id`,
      { bind: [MARK], transaction: t }
    );
    const pedro = client.id;
    L(`cliente pagador: Pedro Giménez Torres  (${pedro})`);

    // ── Pacientes (Juan, María) enlazados a Pedro ─────────────────────────
    async function addPatient(first, last, age, relationship, therapistId, reason, objectives) {
      const [[p]] = await s.query(
        `INSERT INTO "${SC}".patients
           (id, client_id, first_name, last_name, age, relationship, main_therapist_id, referral_reason,
            objectives, consents, contract_signed, status, enrollment_date, attendance_frequency, created_at, updated_at)
         VALUES (${uuid()}, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, '{}'::jsonb, true, 'active', '2026-02-03', 'Semanal', now(), now())
         RETURNING id`,
        { bind: [pedro, first, last, age, relationship, therapistId, reason, JSON.stringify(objectives)], transaction: t }
      );
      L(`  paciente: ${first} ${last} · ${relationship} · ${age} años  (${p.id})`);
      return p.id;
    }
    const juan = await addPatient("Juan", "Giménez López", 12, "hijo", refs.TM_MONICA,
      "Dificultades de atención y organización en el colegio.", ["Atención sostenida", "Planificación"]);
    const maria = await addPatient("María", "Sánchez Giménez", 14, "sobrina", refs.TM_ROBERTO,
      "Apoyo en regulación emocional derivada del centro escolar.", ["Regulación emocional", "Habilidades sociales"]);

    // ── Citas (bookings) por paciente, con profesional y pagador ──────────
    async function addBooking(patientId, therapistId, eventTypeId, when, duration, status, notes) {
      await s.query(
        `INSERT INTO "${SC}".bookings
           (id, event_type_id, client_name, client_email, client_phone, scheduled_at, duration, modality,
            status, cancellation_token, patient_id, team_member_id, notes, created_at, updated_at)
         VALUES (${uuid()}, $1, 'Pedro Giménez Torres', 'pedro.gimenez@example.com', '+34 620 114 887',
                 $2, $3, 'presencial', $4, ${uuid()}, $5, $6, $7, now(), now())`,
        { bind: [eventTypeId, when, duration, status, patientId, therapistId, notes], transaction: t }
      );
    }
    // Juan: una sesión pasada (completada) y una próxima (confirmada)
    await addBooking(juan, refs.TM_MONICA, refs.ET_PRIMERA, "2026-06-30T16:00:00+02:00", 60, "completed", "Primera consulta — Juan");
    await addBooking(juan, refs.TM_MONICA, refs.ET_SEGUIMIENTO, "2026-07-23T16:00:00+02:00", 45, "confirmed", "Seguimiento — Juan");
    // María: idem con el segundo profesional
    await addBooking(maria, refs.TM_ROBERTO, refs.ET_PRIMERA, "2026-07-02T17:30:00+02:00", 60, "completed", "Primera consulta — María");
    await addBooking(maria, refs.TM_ROBERTO, refs.ET_SEGUIMIENTO, "2026-07-24T17:30:00+02:00", 45, "confirmed", "Seguimiento — María");
    L(`citas: 2 para Juan (${refs.nombreMonica}) + 2 para María (${refs.nombreRoberto})`);
  });

  process.stdout.write("\n✓ Escenario 'familia pagador' sembrado en crm_demo\n");
  process.stdout.write("  Pedro (cliente) → Juan + María (pacientes) → sus citas\n\n");
  await s.close();
  process.exit(0);
}

main().catch(async (e) => {
  process.stderr.write(`\n✗ Error: ${e.message}\n${e.stack}\n`);
  await s.close();
  process.exit(1);
});
