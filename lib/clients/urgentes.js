/**
 * lib/clients/urgentes.js — las carpetas de «Fichas a completar».
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la pantalla y su endpoint, y
 * las cuentas tienen que salir del MISMO sitio que las filas. Si la carpeta
 * dijera 27 y al abrirla salieran 25, nadie volvería a fiarse del número.)
 *
 * ── De dónde sale ──────────────────────────────────────────────────────────
 *
 * Al migrar Aumenta desde Organízate (agosto 2026) quedaron miles de huecos:
 * pacientes sin terapeuta, familias sin teléfono, citas sin profesional. No es
 * culpa de la migración —así estaba el origen—, pero alguien tiene que
 * cerrarlos y hasta ahora no había ningún sitio donde verlos juntos.
 *
 * ── Por qué DOS bloques y no una lista ─────────────────────────────────────
 *
 * Los huecos son ~3.700. Una lista de tareas que no se puede terminar deja de
 * ser una lista de tareas: se convierte en papel pintado, y el día que aparezca
 * algo de verdad urgente estará enterrado entre bajas de hace tres años que
 * nadie cerró.
 *
 *   · `bloquea`  — rompe algo esta semana. Son decenas. Debe llegar a cero.
 *   · `completar`— la ficha está a medias. Son miles. Es una campaña, no una
 *                  alarma.
 *
 * ── Por qué se puede marcar «revisado» ─────────────────────────────────────
 *
 * Hay huecos que son CORRECTOS: un paciente en lista de espera no tiene
 * terapeuta, y no es un error. Sin poder decir «esto ya lo he mirado y está
 * bien», esas filas se quedan para siempre y la pantalla no se vacía nunca.
 * Por eso cada fila se puede archivar, y el contador de la carpeta baja.
 */

/** Cuántas filas se le mandan a la pantalla. El TOTAL siempre es el de verdad. */
const MAX_FILAS = 200;

/** Una carpeta por tipo de hueco. `bloquea` decide en qué bloque sale. */
export const CARPETAS = [
  {
    key: "citas_sin_terapeuta",
    label: "Con citas del curso y sin terapeuta",
    ayuda: "Tienen hora reservada y nadie asignado para darla.",
    bloquea: true,
    entidad: "patient",
  },
  {
    key: "citas_sin_contacto",
    label: "Con citas del curso y sin forma de contacto",
    ayuda: "Si se cae una sesión o cambia el horario, no hay a quién avisar.",
    bloquea: true,
    entidad: "patient",
  },
  {
    key: "sin_tutor_ni_contacto",
    label: "Sin tutor y sin ningún dato de contacto",
    ayuda: "La ficha no tiene ni padre ni madre ni teléfono: está muda.",
    bloquea: true,
    entidad: "client",
  },
  {
    key: "sin_terapeuta",
    label: "Pacientes sin terapeuta",
    ayuda: "Se enseña la fecha de su última cita: muchos son altas antiguas que no renovaron.",
    bloquea: false,
    entidad: "patient",
  },
  {
    key: "sin_tutor",
    label: "Familias sin tutor (pero localizables)",
    ayuda: "No consta padre ni madre, aunque sí un teléfono o un correo con el que llamar.",
    bloquea: false,
    entidad: "client",
  },
  {
    key: "sin_contacto",
    label: "Familias sin teléfono ni correo",
    ayuda: "Ni en la ficha ni en ninguno de sus tutores.",
    bloquea: false,
    entidad: "client",
  },
  {
    key: "sin_correo",
    label: "Familias sin correo (no pueden entrar al portal)",
    ayuda: "El acceso al portal se resuelve por correo: sin él, no hay portal.",
    bloquea: false,
    entidad: "client",
  },
  {
    key: "sin_citas",
    label: "Pacientes activos sin ninguna cita del curso",
    ayuda: "O ya no vienen y hay que darlos de baja, o falta reservarles hora.",
    bloquea: false,
    entidad: "patient",
  },
];

/** Familias sin ningún dato de contacto, ni en la ficha ni en sus tutores. */
const SQL_MUDA = `
  coalesce(c.phone,'') = '' AND coalesce(c.email,'') = ''
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.guardians) = 'array' THEN c.guardians ELSE '[]'::jsonb END
    ) g
    WHERE coalesce(g->>'email','') <> '' OR coalesce(g->>'phone','') <> ''
  )`;

const SQL_SIN_TUTOR = `
  (jsonb_typeof(c.guardians) <> 'array' OR jsonb_array_length(c.guardians) = 0)`;

/**
 * Las filas de una carpeta.
 *
 * Todo en SQL contra el schema del tenant y no con Sequelize: son cruces entre
 * pacientes, citas y el JSONB de tutores, y armarlos con includes daría una
 * consulta peor y menos legible.
 */
/**
 * @param {boolean} [opts.conPacientes] ¿existe la tabla `patients` en el schema?
 *   No basta con saltarse las carpetas de pacientes: DOS carpetas de familias
 *   cuentan pacientes en una subconsulta para su columna de detalle, así que en
 *   un tenant sin esa tabla reventaban igual.
 */
export async function filasDe(sequelize, esquema, carpeta, { limite = 5000, conPacientes = true } = {}) {
  // El "3 paciente(s)" de la columna de detalle. Sin tabla no hay nada que
  // contar, y una familia sin ese dato se enseña igual de bien.
  const CUENTA_PACIENTES = conPacientes
    ? `(SELECT count(*)::text FROM ${esquema}.patients p WHERE p.client_id = c.id) || ' paciente(s)'`
    : `NULL`;
  const q = async (sql) => (await sequelize.query(sql))[0];

  switch (carpeta) {
    case "citas_sin_terapeuta":
      return q(`
        SELECT p.id, p.first_name || ' ' || p.last_name AS nombre,
               c.id AS client_id, c.name AS familia,
               (SELECT min(b.scheduled_at) FROM ${esquema}.bookings b
                 WHERE b.patient_id = p.id AND b.scheduled_at > now())::date::text AS dato
        FROM ${esquema}.patients p
        LEFT JOIN ${esquema}.clients c ON c.id = p.client_id
        WHERE p.main_therapist_id IS NULL
          AND EXISTS (SELECT 1 FROM ${esquema}.bookings b WHERE b.patient_id = p.id AND b.scheduled_at > now())
        ORDER BY dato NULLS LAST LIMIT ${limite}`);

    case "citas_sin_contacto":
      return q(`
        SELECT p.id, p.first_name || ' ' || p.last_name AS nombre,
               c.id AS client_id, c.name AS familia,
               (SELECT min(b.scheduled_at) FROM ${esquema}.bookings b
                 WHERE b.patient_id = p.id AND b.scheduled_at > now())::date::text AS dato
        FROM ${esquema}.patients p
        JOIN ${esquema}.clients c ON c.id = p.client_id
        WHERE ${SQL_MUDA}
          AND EXISTS (SELECT 1 FROM ${esquema}.bookings b WHERE b.patient_id = p.id AND b.scheduled_at > now())
        ORDER BY dato NULLS LAST LIMIT ${limite}`);

    case "sin_tutor_ni_contacto":
      return q(`
        SELECT c.id, c.name AS nombre, c.id AS client_id, NULL AS familia,
               ${CUENTA_PACIENTES} AS dato
        FROM ${esquema}.clients c
        WHERE ${SQL_SIN_TUTOR} AND ${SQL_MUDA}
        ORDER BY c.name LIMIT ${limite}`);

    case "sin_terapeuta":
      // La última cita es EL dato que pidió Rodrigo: distingue al que no ha
      // renovado del que está esperando que le asignen a alguien.
      return q(`
        SELECT p.id, p.first_name || ' ' || p.last_name AS nombre,
               c.id AS client_id, c.name AS familia,
               coalesce((SELECT max(b.scheduled_at) FROM ${esquema}.bookings b
                          WHERE b.patient_id = p.id AND b.scheduled_at <= now())::date::text,
                        'sin citas') AS dato
        FROM ${esquema}.patients p
        LEFT JOIN ${esquema}.clients c ON c.id = p.client_id
        WHERE p.main_therapist_id IS NULL
        ORDER BY dato DESC NULLS LAST LIMIT ${limite}`);

    // Sin tutor pero CON algún contacto: las que además están mudas ya salen
    // arriba, en la carpeta urgente. Si no se excluyeran, las mismas 118
    // familias aparecerían dos veces y los totales engañarían.
    case "sin_tutor":
      return q(`
        SELECT c.id, c.name AS nombre, c.id AS client_id, NULL AS familia,
               coalesce(nullif(c.phone,''), nullif(c.email,'')) AS dato
        FROM ${esquema}.clients c WHERE ${SQL_SIN_TUTOR} AND NOT (${SQL_MUDA})
        ORDER BY c.name LIMIT ${limite}`);

    // Igual: las que encima no tienen tutor son las urgentes de arriba.
    case "sin_contacto":
      return q(`
        SELECT c.id, c.name AS nombre, c.id AS client_id, NULL AS familia,
               ${CUENTA_PACIENTES} AS dato
        FROM ${esquema}.clients c WHERE ${SQL_MUDA} AND NOT (${SQL_SIN_TUTOR})
        ORDER BY c.name LIMIT ${limite}`);

    case "sin_correo":
      return q(`
        SELECT c.id, c.name AS nombre, c.id AS client_id, NULL AS familia,
               coalesce(nullif(c.phone,''), 'sin teléfono') AS dato
        FROM ${esquema}.clients c
        WHERE coalesce(c.email,'') = ''
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(c.guardians)='array' THEN c.guardians ELSE '[]'::jsonb END
            ) g WHERE coalesce(g->>'email','') <> '')
        ORDER BY c.name LIMIT ${limite}`);

    case "sin_citas":
      return q(`
        SELECT p.id, p.first_name || ' ' || p.last_name AS nombre,
               c.id AS client_id, c.name AS familia,
               coalesce((SELECT max(b.scheduled_at) FROM ${esquema}.bookings b
                          WHERE b.patient_id = p.id)::date::text, 'nunca') AS dato
        FROM ${esquema}.patients p
        LEFT JOIN ${esquema}.clients c ON c.id = p.client_id
        WHERE p.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM ${esquema}.bookings b WHERE b.patient_id = p.id AND b.scheduled_at > now())
        ORDER BY dato DESC LIMIT ${limite}`);

    default:
      return [];
  }
}

/**
 * Todas las carpetas con sus filas, quitando lo ya revisado.
 *
 * Se cargan las filas y se cuentan DESPUÉS de descontar lo archivado, para que
 * el número de la carpeta y lo que se ve al abrirla no puedan discrepar.
 */
/**
 * ¿Existe `patients` en este schema?
 *
 * Tres de las seis carpetas preguntan por pacientes. El comentario del endpoint
 * decía que a quien no tenga ese módulo «le saldrán vacías por sí solas», y no:
 * una tabla que no existe NO sale vacía, revienta la consulta con 500 y se lleva
 * por delante la pantalla entera. Le pasó a nutri_laura, que tiene clientes y
 * citas pero no pacientes.
 *
 * Se mira la TABLA y no el módulo a propósito: un tenant puede tener el módulo
 * activado y el schema todavía sin crear —es el incidente del 2026-07-21— y
 * entonces una comprobación por módulo diría que sí y volvería a romper.
 */
async function hayPacientes(sequelize, esquema) {
  const [filas] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = :esquema AND table_name = 'patients' LIMIT 1`,
    { replacements: { esquema } }
  );
  return filas.length > 0;
}

export async function carpetasCon(sequelize, esquema, DataReview) {
  const conPacientes = await hayPacientes(sequelize, esquema);
  const revisadas = new Set();
  if (DataReview) {
    try {
      for (const r of await DataReview.findAll({ attributes: ["checkKey", "entityId"] })) {
        revisadas.add(`${r.checkKey}|${String(r.entityId).toLowerCase()}`);
      }
    } catch { /* tabla aún sin migrar: no se filtra nada */ }
  }

  const out = [];
  for (const c of CARPETAS) {
    // Sin tabla de pacientes, sus carpetas ni se preguntan: no se enseñan
    // vacías, es que no aplican. Un centro que no lleva pacientes no tiene
    // «pacientes sin terapeuta» — enseñarle esa carpeta a cero sería contarle
    // un problema que no puede tener.
    if (c.entidad === "patient" && !conPacientes) continue;

    const filas = (await filasDe(sequelize, esquema, c.key, { conPacientes }))
      .filter((f) => !revisadas.has(`${c.key}|${String(f.id).toLowerCase()}`));
    // El total es el de TODAS las filas; lo que se manda a la pantalla se
    // recorta. Contar sobre lo recortado hacía que una carpeta con 616 dijera
    // «500», que es justo la clase de número que hace desconfiar del resto.
    out.push({ ...c, total: filas.length, filas: filas.slice(0, MAX_FILAS) });
  }
  return out;
}

/** Marca (o desmarca) una fila como revisada. */
export async function marcarRevisado(DataReview, { checkKey, entityId, entidad, teamMemberId, nota }) {
  const ya = await DataReview.findOne({ where: { checkKey, entityId } });
  if (ya) { await ya.destroy(); return { revisado: false }; }
  await DataReview.create({ checkKey, entityId, entityType: entidad, reviewedById: teamMemberId ?? null, note: nota ?? null });
  return { revisado: true };
}

export const ES_CARPETA = (k) => CARPETAS.some((c) => c.key === k);
