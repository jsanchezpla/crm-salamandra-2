/**
 * migrate-talleres-grupos.js — los talleres dejan de ser un bloqueo de agenda y
 * pasan a ser CITAS, con varios grupos por actividad (01/09/2026, Aumenta por
 * Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Los talleres no dejan de ser citas múltiples a las que van varios pacientes
 * a la vez y que pueden estar impartidas por varios terapeutas la misma cita.
 * […] No como bloqueos sino como un tipo más de cita.» Y, a media
 * conversación: «en los talleres hay que poder poner varios grupos distintos
 * para la misma actividad».
 *
 * ── QUÉ TOCA, Y POR QUÉ EN DOS CONJUNTOS DE SCHEMAS ─────────────────────────
 * Cuatro tablas nuevas donde hay `talleres` (módulo Clínica):
 *   · `taller_grupos`             — el grupo: cuándo, cuánto dura, cómo se cobra
 *   · `taller_grupo_terapeutas`   — quién lo lleva (VARIOS)
 *   · `taller_cita_terapeutas`    — quién dio UNA tarde concreta
 *   · `taller_asistencias`        — quién fue a esa tarde, y si faltó, por qué
 *
 * Y columnas en tablas que YA existen, cada una sobre los schemas que tengan
 * ESA tabla (regla 12 y la lección del 01/09/2026: la columna se migra por
 * dónde existe la TABLA, no por quién tiene el módulo — el modelo la declara
 * para todos y Sequelize la pide en cada SELECT):
 *   · `taller_inscripciones.grupo_id`, `.cuota_id`
 *   · `taller_sesiones.grupo_id`, `.booking_id`
 *   · `bookings.taller_grupo_id`       ← módulo Citas, otro conjunto
 *   · `event_types.taller_grupo_id`    ← módulo Citas, otro conjunto
 *
 * Las dos últimas son las que obligan a separar: hay tenants con Citas y sin
 * Clínica (nutri_laura), y `Booking`/`EventType` declaran esas columnas para
 * todos. Sin ellas, cada lectura de su agenda daría 42703.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Por lo mismo de siempre: los modelos ya piden estas columnas por nombre.
 *
 * ── EL BACKFILL: NADIE SE QUEDA SIN GRUPO ───────────────────────────────────
 * Cada taller que ya existía se queda con UN grupo, heredando su horario de
 * texto libre, y sus inscripciones y sesiones se enganchan a él. En producción
 * eso son 45 inscripciones de «Habilidades sociales» que siguen exactamente
 * donde estaban, solo que ahora cuelgan de un grupo que se puede partir en dos.
 *
 * El TIPO DE CITA de cada grupo NO se crea aquí: crear filas de `event_types`
 * —con su slug único y sus doce columnas— es trabajo de un backfill con los
 * modelos delante, y va en `scripts/backfill-talleres-tipos-cita.js`.
 *
 * Idempotente (IF NOT EXISTS en todo; el backfill solo actúa donde falta).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-talleres-grupos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-talleres-grupos.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}

/**
 * Una FK que puede no poder crearse. Las fotos doradas de las demos
 * (`crm_*_golden`) se copian SIN claves primarias, así que ahí PostgreSQL
 * rechaza el REFERENCES; con la FK dentro del CREATE TABLE, la migración moría
 * en la primera dorada y la tabla no llegaba a existir en ninguna.
 */
async function fkBlanda(s, sql, schema, etiqueta) {
  try {
    await s.query(sql);
  } catch (e) {
    if (!/ya existe|already exists/i.test(e.message)) {
      log(`· ${schema}: sin FK ${etiqueta} (${e.message.split("\n")[0]})`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Las cuatro tablas nuevas
// ───────────────────────────────────────────────────────────────────────────

async function creaTablas(s, schema) {
  if (!(await tableExists(s, schema, "talleres"))) {
    log(`✗ ${schema}: no existe talleres. Se salta.`);
    return false;
  }

  // ── El GRUPO ─────────────────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."taller_grupos" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      taller_id UUID NOT NULL,
      name VARCHAR(120) NOT NULL,
      schedule VARCHAR(120),
      duration INTEGER NOT NULL DEFAULT 90,
      color VARCHAR(7),
      capacity INTEGER,
      concept_id UUID,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fkBlanda(
    s,
    `ALTER TABLE "${schema}"."taller_grupos"
       ADD CONSTRAINT taller_grupos_taller_fk
       FOREIGN KEY (taller_id) REFERENCES "${schema}"."talleres"(id) ON DELETE CASCADE`,
    schema,
    "taller_grupos→talleres"
  );
  await s.query(`CREATE INDEX IF NOT EXISTS taller_grupos_taller_idx ON "${schema}"."taller_grupos" (taller_id)`);
  await s.query(`CREATE INDEX IF NOT EXISTS taller_grupos_active_idx ON "${schema}"."taller_grupos" (active)`);

  // ── Quién lo imparte ─────────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."taller_grupo_terapeutas" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      grupo_id UUID NOT NULL,
      team_member_id UUID NOT NULL,
      coordina BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await fkBlanda(
    s,
    `ALTER TABLE "${schema}"."taller_grupo_terapeutas"
       ADD CONSTRAINT taller_grupo_terapeutas_grupo_fk
       FOREIGN KEY (grupo_id) REFERENCES "${schema}"."taller_grupos"(id) ON DELETE CASCADE`,
    schema,
    "taller_grupo_terapeutas→taller_grupos"
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_grupo_terapeutas_grupo_idx
       ON "${schema}"."taller_grupo_terapeutas" (grupo_id)`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_grupo_terapeutas_member_idx
       ON "${schema}"."taller_grupo_terapeutas" (team_member_id)`
  );
  // La misma persona no puede estar dos veces en el mismo grupo: sería su
  // nombre repetido en la cita y contada dos veces en Productividad.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS taller_grupo_terapeutas_unico
       ON "${schema}"."taller_grupo_terapeutas" (grupo_id, team_member_id)`
  );
  // Y solo UNO coordina: es de quien sale el color de la caja y quién figura
  // como dueño de la cita. Parcial, porque los demás son `false`.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS taller_grupo_terapeutas_un_coordinador
       ON "${schema}"."taller_grupo_terapeutas" (grupo_id) WHERE coordina`
  );

  // ── Quién dio UNA tarde ──────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."taller_cita_terapeutas" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL,
      team_member_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  if (await tableExists(s, schema, "bookings")) {
    await fkBlanda(
      s,
      `ALTER TABLE "${schema}"."taller_cita_terapeutas"
         ADD CONSTRAINT taller_cita_terapeutas_booking_fk
         FOREIGN KEY (booking_id) REFERENCES "${schema}"."bookings"(id) ON DELETE CASCADE`,
      schema,
      "taller_cita_terapeutas→bookings"
    );
  }
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_cita_terapeutas_booking_idx
       ON "${schema}"."taller_cita_terapeutas" (booking_id)`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_cita_terapeutas_member_idx
       ON "${schema}"."taller_cita_terapeutas" (team_member_id)`
  );
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS taller_cita_terapeutas_unico
       ON "${schema}"."taller_cita_terapeutas" (booking_id, team_member_id)`
  );

  // ── Quién fue, y si faltó, por qué ───────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."taller_asistencias" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL,
      patient_id UUID NOT NULL,
      grupo_id UUID,
      status VARCHAR(20) NOT NULL DEFAULT 'prevista',
      justified BOOLEAN,
      no_show_reason TEXT,
      incidencia_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  if (await tableExists(s, schema, "bookings")) {
    await fkBlanda(
      s,
      `ALTER TABLE "${schema}"."taller_asistencias"
         ADD CONSTRAINT taller_asistencias_booking_fk
         FOREIGN KEY (booking_id) REFERENCES "${schema}"."bookings"(id) ON DELETE CASCADE`,
      schema,
      "taller_asistencias→bookings"
    );
  }
  /*
   * `status` es VARCHAR con CHECK y no un ENUM de Postgres, a propósito: un
   * enum de verdad es propiedad del schema y obliga a un ALTER TYPE por cada
   * estado nuevo, que es lo que costó la migración del informe de beca
   * (26/08/2026). El modelo lo declara como ENUM de Sequelize —valida en Node—
   * y esto es el cinturón por debajo.
   */
  await s.query(`
    DO $$ BEGIN
      ALTER TABLE "${schema}"."taller_asistencias"
        ADD CONSTRAINT taller_asistencias_status_chk
        CHECK (status IN ('prevista','asistio','no_show'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_asistencias_booking_idx
       ON "${schema}"."taller_asistencias" (booking_id)`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_asistencias_patient_idx
       ON "${schema}"."taller_asistencias" (patient_id)`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_asistencias_grupo_idx
       ON "${schema}"."taller_asistencias" (grupo_id)`
  );
  // Un paciente no puede estar dos veces en la lista de la misma tarde: sería
  // su registro escrito dos veces y contado dos veces en la asistencia.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS taller_asistencias_unico
       ON "${schema}"."taller_asistencias" (booking_id, patient_id)`
  );

  log(`✓ ${schema}: taller_grupos · taller_grupo_terapeutas · taller_cita_terapeutas · taller_asistencias`);
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Columnas en tablas que ya existían
// ───────────────────────────────────────────────────────────────────────────

async function columnasInscripciones(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."taller_inscripciones" ADD COLUMN IF NOT EXISTS grupo_id UUID`);
  await s.query(`ALTER TABLE "${schema}"."taller_inscripciones" ADD COLUMN IF NOT EXISTS cuota_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_inscripciones_grupo_idx
       ON "${schema}"."taller_inscripciones" (grupo_id)`
  );
  /*
   * El único de «no estás dos veces a la vez en lo mismo» se muda de la
   * ACTIVIDAD al GRUPO. Estar en dos grupos de habilidades sociales —el de
   * siempre y uno de refuerzo— es raro pero legítimo, y el índice viejo lo
   * prohibía. Se borra el de antes si estaba.
   */
  await s.query(`DROP INDEX IF EXISTS "${schema}"."taller_inscripciones_unico"`);
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS taller_inscripciones_grupo_unico
       ON "${schema}"."taller_inscripciones" (grupo_id, patient_id)
       WHERE left_at IS NULL AND grupo_id IS NOT NULL`
  );
  log(`✓ ${schema}.taller_inscripciones: grupo_id, cuota_id`);
}

async function columnasSesiones(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."taller_sesiones" ADD COLUMN IF NOT EXISTS grupo_id UUID`);
  await s.query(`ALTER TABLE "${schema}"."taller_sesiones" ADD COLUMN IF NOT EXISTS booking_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_sesiones_grupo_fecha_idx
       ON "${schema}"."taller_sesiones" (grupo_id, session_date)`
  );
  // «¿Esta cita ya tiene registro?», que se pregunta al abrir cada taller de la
  // agenda. Parcial: la inmensa mayoría de las sesiones no vienen de una cita.
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_sesiones_booking_idx
       ON "${schema}"."taller_sesiones" (booking_id) WHERE booking_id IS NOT NULL`
  );
  log(`✓ ${schema}.taller_sesiones: grupo_id, booking_id`);
}

async function columnaBookings(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS taller_grupo_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS bookings_taller_grupo_idx
       ON "${schema}"."bookings" (taller_grupo_id) WHERE taller_grupo_id IS NOT NULL`
  );
  log(`✓ ${schema}.bookings: taller_grupo_id`);
}

async function columnaEventTypes(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."event_types" ADD COLUMN IF NOT EXISTS taller_grupo_id UUID`);
  await s.query(
    `CREATE INDEX IF NOT EXISTS event_types_taller_grupo_idx
       ON "${schema}"."event_types" (taller_grupo_id) WHERE taller_grupo_id IS NOT NULL`
  );
  log(`✓ ${schema}.event_types: taller_grupo_id`);
}

// ───────────────────────────────────────────────────────────────────────────
// Backfill: cada taller que ya existía se queda con un grupo
// ───────────────────────────────────────────────────────────────────────────

async function backfill(s, schema) {
  /*
   * `concept_id` y `team_member_id` PUEDEN NO ESTAR, y esto no es paranoia: en
   * local, `crm_demo` tiene `talleres` sin `concept_id` porque
   * `migrate-talleres-concepto` no le llegó. Un backfill que da por hecha una
   * columna de otra migración se cae —y se cayó— a mitad del recorrido,
   * dejando unos schemas migrados y otros no.
   */
  const hayConcepto = await columnExists(s, schema, "talleres", "concept_id");
  const hayResponsable = await columnExists(s, schema, "talleres", "team_member_id");

  // Un grupo por taller que no tenga ninguno. Hereda el horario de texto libre
  // («Martes 17:00») y se llama como se llamaría a mano el primer grupo.
  const [creados] = await s.query(`
    INSERT INTO "${schema}"."taller_grupos" (taller_id, name, schedule, concept_id, active)
    SELECT t.id, 'Grupo 1', t.schedule, ${hayConcepto ? "t.concept_id" : "NULL"}, t.active
      FROM "${schema}"."talleres" t
     WHERE NOT EXISTS (SELECT 1 FROM "${schema}"."taller_grupos" g WHERE g.taller_id = t.id)
    RETURNING id
  `);
  if (creados.length) log(`· ${schema}: ${creados.length} grupo(s) creado(s) para talleres que ya existían`);

  /*
   * Quien llevaba la ACTIVIDAD pasa a coordinar su primer grupo. Es la
   * traducción fiel de lo que había: `talleres.team_member_id` era «quién lo
   * imparte», y ahora eso se dice por grupo y admite varios.
   */
  if (hayResponsable) {
    const [terapeutas] = await s.query(`
      INSERT INTO "${schema}"."taller_grupo_terapeutas" (grupo_id, team_member_id, coordina)
      SELECT g.id, t.team_member_id, TRUE
        FROM "${schema}"."taller_grupos" g
        JOIN "${schema}"."talleres" t ON t.id = g.taller_id
       WHERE t.team_member_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "${schema}"."taller_grupo_terapeutas" x WHERE x.grupo_id = g.id
         )
      RETURNING id
    `);
    if (terapeutas.length) log(`· ${schema}: ${terapeutas.length} responsable(s) pasados a coordinar su grupo`);
  }

  // Las inscripciones que ya había se enganchan al único grupo de su taller. El
  // `= 1` es la salvaguarda: si un taller ya tuviera dos grupos, repartir sus
  // inscripciones sería inventarse quién va a cuál.
  const [inscripciones] = await s.query(`
    UPDATE "${schema}"."taller_inscripciones" i
       SET grupo_id = g.id
      FROM "${schema}"."taller_grupos" g
     WHERE i.grupo_id IS NULL
       AND g.taller_id = i.taller_id
       AND (SELECT COUNT(*) FROM "${schema}"."taller_grupos" x WHERE x.taller_id = i.taller_id) = 1
    RETURNING i.id
  `);
  if (inscripciones.length) log(`· ${schema}: ${inscripciones.length} inscripción(es) enganchadas a su grupo`);

  // `taller_sesiones` es de ayer (01/09/2026) y no ha llegado a todos: en
  // local, `crm_demo` tiene talleres y no la tiene.
  if (await tableExists(s, schema, "taller_sesiones")) {
    const [sesiones] = await s.query(`
      UPDATE "${schema}"."taller_sesiones" s
         SET grupo_id = g.id
        FROM "${schema}"."taller_grupos" g
       WHERE s.grupo_id IS NULL
         AND g.taller_id = s.taller_id
         AND (SELECT COUNT(*) FROM "${schema}"."taller_grupos" x WHERE x.taller_id = s.taller_id) = 1
      RETURNING s.id
    `);
    if (sesiones.length) log(`· ${schema}: ${sesiones.length} sesión(es) enganchadas a su grupo`);
  }
}

// ───────────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: los talleres pasan a ser citas, por grupos\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Cuatro conjuntos distintos, y la diferencia es justo la lección del
  // 01/09/2026: cada tabla se migra donde ESA tabla existe.
  const { schemas: conTalleres } = await byTable(sequelize, "talleres");
  const { schemas: conInscripciones } = await byTable(sequelize, "taller_inscripciones");
  const { schemas: conSesiones } = await byTable(sequelize, "taller_sesiones");
  const { schemas: conBookings } = await byTable(sequelize, "bookings");
  const { schemas: conEventTypes } = await byTable(sequelize, "event_types");

  log(
    `✓ ${conTalleres.length} con talleres · ${conInscripciones.length} con inscripciones · ` +
      `${conSesiones.length} con sesiones · ${conBookings.length} con bookings · ${conEventTypes.length} con event_types`
  );

  const conTablas = new Set();
  for (const schema of conTalleres) {
    header(schema);
    if (await creaTablas(sequelize, schema)) conTablas.add(schema);
  }

  for (const schema of conInscripciones) {
    header(`${schema} (inscripciones)`);
    await columnasInscripciones(sequelize, schema);
  }
  for (const schema of conSesiones) {
    header(`${schema} (sesiones)`);
    await columnasSesiones(sequelize, schema);
  }
  for (const schema of conBookings) {
    header(`${schema} (agenda)`);
    await columnaBookings(sequelize, schema);
  }
  for (const schema of conEventTypes) {
    header(`${schema} (tipos de cita)`);
    await columnaEventTypes(sequelize, schema);
  }

  // El backfill va al final, cuando ya existen tablas Y columnas.
  for (const schema of conTablas) {
    if (!conInscripciones.includes(schema)) continue;
    header(`${schema} (backfill)`);
    await backfill(sequelize, schema);
  }

  process.stdout.write("\n✓ Hecho\n");
  process.stdout.write("  Siguiente: node scripts/backfill-talleres-tipos-cita.js\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
