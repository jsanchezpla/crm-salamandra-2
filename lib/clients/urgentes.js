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
 *
 * ── Las fichas archivadas no cuentan (25/08/2026, Lau) ─────────────────────
 *
 * La pantalla reclamaba huecos sin mirar si la ficha estaba dada de baja.
 * Medido en producción ese día: de las 171 filas del bloque rojo —el que tiene
 * que llegar a cero—, 134 eran gente de baja; en «Sin tutor y sin ningún dato
 * de contacto», 117 de 118. Quien la usa a diario se daba de bruces una y otra
 * vez con la misma gente que ya había dado de baja.
 *
 * Y no hacía falta inventar ningún archivo: YA existía. `clients.status` tiene
 * 120 fichas en `inactive` y `patients.status` 124 en `paused`, emparejadas una
 * a una, y las puso el propio import al traer el `activo = false` de Organízate
 * (`scripts/import-aumenta.js`). Lo único que faltaba era que esta pantalla lo
 * mirase.
 *
 * ── LA EXCEPCIÓN, que es la parte que hay que entender (Jorge) ─────────────
 *
 * La regla NO es «fuera las bajas»: es **fuera las bajas que no tengan hora
 * cogida**. Porque hay 11 pacientes en pausa con 304 citas confirmadas
 * reservadas del 1/9/2026 al 28/6/2027: están de baja y tienen el curso entero
 * ocupado en la agenda. Una de las dos cosas está mal, y esconderlos dejaría
 * esas 304 horas bloqueadas sin que nadie pudiera enterarse.
 *
 * Así que quien tiene cita futura sigue saliendo aunque esté de baja, y sale
 * MARCADO (`de_baja` en cada fila) para que la pantalla lo pueda decir. En la
 * práctica eso deja las dos carpetas de «con citas» exactamente como estaban
 * —sus bajas tienen todas hora— y limpia las demás.
 *
 * Se puede ver lo escondido con `incluirBajas`, que es lo que enciende la
 * casilla de la pantalla. El total de la carpeta cambia con ella: si el número
 * y las filas salieran de criterios distintos, volvemos al problema de la
 * cabecera.
 */

import { ESTADOS_FICHA, dejaDeReclamar } from "./estados.js";

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
    ayuda: "Si se cae una sesión o cambia el horario, no hay a quién avisar. Los que además no tienen terapeuta salen en la carpeta de arriba.",
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
    ayuda: "Se enseña la fecha de su última cita: muchos son altas antiguas que no renovaron. Los que tienen hora cogida salen arriba, en rojo.",
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
    ayuda: "El acceso al portal se resuelve por correo: sin él, no hay portal. Solo las que tienen tutor y alguna forma de contacto; a las demás les falta algo más gordo y salen más arriba.",
    bloquea: false,
    entidad: "client",
  },
  {
    key: "sin_citas",
    label: "Pacientes activos sin ninguna cita del curso",
    ayuda: "Tienen terapeuta pero no tienen hora: o ya no vienen y hay que darlos de baja, o falta reservársela.",
    bloquea: false,
    entidad: "patient",
  },
  // Las familias que pagaron la reserva de plaza del verano (02/09/2026,
  // Rodrigo: «ponlo en Fichas a completar para que esté en el CRM»). No es un
  // hueco de la ficha: es una lista de revisión que vive en
  // `clients.custom_fields.reservaPlaza` (la escribe
  // scripts/comprobar-reservas-septiembre.js --marcar). `opcional`: un centro
  // sin esa marca no ve la carpeta, ni a cero.
  {
    key: "reserva_plaza",
    label: "Con reserva de plaza pagada (curso 2026-27): septiembre con los 30 € descontados",
    ayuda: "Pagaron la reserva en verano y septiembre tiene que salir con ella descontada. Arriba van las que hay que mirar: a las que Organízate cobraba la cuota entera se les volvió a descontar el 02/09 (por si en realidad no debían tener descuento), y las que ya habían pagado entero tienen 30 € a compensar. «Está bien así» la saca de la lista.",
    bloquea: false,
    entidad: "client",
    opcional: true,
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
 * Qué es «estar de baja», y por qué se mira el estado de LOS DOS.
 *
 * Una familia archivada (`clients.status = 'inactive'`) y un paciente en pausa
 * o dado de alta (`patients.status`) son la misma cosa dicha desde los dos
 * lados: en Aumenta van emparejados 120 a 120. Pero hay 4 pacientes en pausa
 * cuya familia sigue viva —un hermano que para y otro que sigue—, así que con
 * mirar solo uno se escapan.
 *
 * ⚠️ `coalesce(c.status::text,'')` son dos precauciones, no una:
 *
 *   · el COALESCE, porque dos carpetas llegan a `clients` por un LEFT JOIN, y
 *     sin él un paciente sin familia da `NULL = 'inactive'` → NULL, y el
 *     `NOT (...)` de la exclusión también sale NULL: la fila desaparecería por
 *     no tener familia, que no es de lo que va esto. En la demo hay 6 así, y
 *     eso no daría ningún error — solo filas de menos.
 *   · el `::text`, porque `status` es un ENUM y `''` no es uno de sus valores.
 *     Sin el cast, PostgreSQL intenta meter la cadena vacía dentro del enum y
 *     revienta en la primera consulta: «la sintaxis de entrada no es válida
 *     para el enum enum_clients_status». Pasó el 25/08/2026 al probarlo contra
 *     la base, con las 13 pruebas de la lib en verde.
 */
/**
 * Los estados de ficha que dejan de reclamar datos. Salen de
 * `lib/clients/estados.js` y no escritos aquí a mano: desde el 26/08/2026 son
 * DOS —«Baja» y «No vino»—, y con la lista repetida en dos ficheros, añadir un
 * tercero dejaría a una de las dos pantallas persiguiendo el teléfono de
 * alguien que no viene.
 *
 * Son constantes nuestras, no texto de fuera: van directas al SQL porque su
 * lista es la misma que el ENUM de la columna, y eso lo fija
 * `_smoke-clientes-estados.mjs`.
 */
const ESTADOS_QUE_NO_RECLAMAN = ESTADOS_FICHA.filter(dejaDeReclamar)
  .map((e) => `'${e}'`)
  .join(", ");

const SQL_PACIENTE_DE_BAJA = `
  (p.status IN ('paused','discharged') OR coalesce(c.status::text,'') IN (${ESTADOS_QUE_NO_RECLAMAN}))`;

const SQL_FAMILIA_DE_BAJA = `(coalesce(c.status::text,'') IN (${ESTADOS_QUE_NO_RECLAMAN}))`;

/**
 * Una cita anulada NO es «tener hora cogida».
 *
 * Cancelar no borra la fila: `lib/citas/cancelBooking.js` solo le pone
 * `status='cancelled'`, y el import de Aumenta ya trajo canceladas de
 * Organízate. Sin este filtro, el flujo más normal del mundo —dar de baja a
 * alguien Y anularle las sesiones del curso— dejaba la ficha rebotando en la
 * pantalla, marcada «Archivada» y con un aviso falso: «tiene horas cogidas en
 * la agenda». Para la agenda ese hueco está libre.
 *
 * Es la misma lista que usa el resto del CRM para decidir si una cita ocupa
 * hueco (`ocupaHuecoWhere` en `lib/citas/booking.js`, `lib/home/summary.js`,
 * `lib/citas/caducidadRetencion.js`). Aquí va en SQL crudo porque aquella
 * devuelve un `where` de Sequelize.
 */
const SQL_CITA_CUENTA = `b.status NOT IN ('cancelled','no_show')`;

/**
 * El cuerpo de cada carpeta: de DÓNDE salen sus filas y CUÁLES son.
 *
 * ── POR QUÉ ESTÁ PARTIDO ASÍ (12/08/2026) ──────────────────────────────────
 * Hacía falta poder CONTAR sin traerse las filas, para que el menú pueda
 * esconder la entrada cuando no queda nada. Medido en el VPS, traerlas cuesta
 * 3.997 ms en Aumenta (173 que bloquean + 1.800 por completar): meter eso en
 * cada carga de página era regalarle cuatro segundos al cliente que más lo usa.
 *
 * Y la salida NO podía ser escribir las condiciones otra vez en un COUNT. La
 * regla de la cabecera —el total de la carpeta y las filas que se ven al abrirla
 * TIENEN que salir de la misma fuente— se rompe sola en cuanto hay dos copias
 * del `WHERE`: alguien arregla una y la otra se queda, y entonces la carpeta
 * dice 27 y al abrirla salen 25. Así que el `FROM` y el `WHERE` viven aquí una
 * sola vez, y encima se montan las dos consultas.
 *
 * `select` y `order` solo los usa el listado. `id` es la columna con la que se
 * archiva una fila, y la necesitan los dos.
 *
 * ── LAS CARPETAS NO SE SOLAPAN, Y HASTA EL 25/08/2026 ERA MENTIRA ──────────
 *
 * La pantalla promete «cada ficha aparece en una sola, para que no la arregles
 * dos veces». Dos carpetas lo cumplían —`sin_tutor` excluía a las mudas,
 * `sin_contacto` a las que no tienen tutor— y las otras seis no. Medido en
 * producción el 25/08: **1.965 filas para 1.225 fichas**. 726 fichas salían en
 * dos carpetas y 7 en tres. Cinco solapes, cuatro de ellos COMPLETOS:
 *
 *   · los 31 de «con citas y sin terapeuta» estaban TODOS entre los 614 de
 *     «pacientes sin terapeuta» (por construcción: uno es el otro más un `AND`);
 *   · las 118 de «sin tutor ni contacto» y las 102 de «sin teléfono ni correo»
 *     estaban TODAS entre las 265 de «sin correo» (quien no tiene ni teléfono
 *     ni correo, tampoco tiene correo);
 *   · 482 de los 813 de «activos sin ninguna cita» eran los mismos de
 *     «pacientes sin terapeuta»;
 *   · y 7 salían en las dos carpetas rojas de «con citas» a la vez.
 *
 * **La regla, ahora**: cada ficha sale en la PRIMERA carpeta de `CARPETAS` que
 * le aplique, y en ninguna más. Las de arriba son las urgentes, así que gana
 * siempre la más urgente. Si al rellenar ese hueco le queda otro, reaparece en
 * la carpeta que toque: es una cola, no una lista de todo a la vez.
 *
 * Y una traducción, porque hay carpetas de PACIENTE y carpetas de FAMILIA: el
 * hueco de «no hay forma de contacto» es de la familia, pero se enseña desde el
 * paciente cuando ese paciente tiene hora cogida (es lo urgente). Rellenar el
 * teléfono tacha las dos filas, así que la familia se calla mientras su hijo la
 * esté enseñando (`FAMILIA_YA_SALE_POR_UN_HIJO`).
 *
 * @param {boolean} [opts.conPacientes] ¿existe la tabla `patients` en el schema?
 *   No basta con saltarse las carpetas de pacientes: DOS carpetas de familias
 *   cuentan pacientes en una subconsulta para su columna de detalle, y desde el
 *   25/08 otras dos preguntan por sus pacientes para no repetir hueco, así que
 *   en un tenant sin esa tabla reventaban igual.
 * @param {boolean} [opts.conCitas] ¿y `bookings`? Sin agenda, «tiene hora
 *   cogida» es FALSE en todas partes en vez de una consulta a una tabla que no
 *   existe: las dos carpetas de «con citas» salen vacías —que es la verdad— y
 *   las demás no pierden a nadie.
 */
function cuerpoBase(esquema, carpeta, { conPacientes = true, conCitas = true } = {}) {
  // El "3 paciente(s)" de la columna de detalle. Sin tabla no hay nada que
  // contar, y una familia sin ese dato se enseña igual de bien.
  const CUENTA_PACIENTES = conPacientes
    ? `(SELECT count(*)::text FROM ${esquema}.patients p WHERE p.client_id = c.id) || ' paciente(s)'`
    : `NULL`;

  const PACIENTE_Y_FAMILIA = `p.id, p.first_name || ' ' || p.last_name AS nombre,
               c.id AS client_id, c.name AS familia`;
  const PROXIMA_CITA = conCitas
    ? `(SELECT min(b.scheduled_at) FROM ${esquema}.bookings b
                 WHERE b.patient_id = p.id AND b.scheduled_at > now() AND ${SQL_CITA_CUENTA})::date::text AS dato`
    : `NULL::text AS dato`;
  const TIENE_CITA_FUTURA = conCitas
    ? `EXISTS (SELECT 1 FROM ${esquema}.bookings b
                WHERE b.patient_id = p.id AND b.scheduled_at > now() AND ${SQL_CITA_CUENTA})`
    : `FALSE`;
  // Las dos columnas de detalle que miran hacia atrás. NO llevan el filtro de
  // anuladas a propósito: aquí la pregunta es «¿cuándo se le vio por última
  // vez?», y una cita anulada también es una fecha en la que hubo trato. Lo que
  // sí tiene que estar limpio es lo de arriba, que decide si la ficha sale.
  //
  // Sin agenda no hay fecha que enseñar, y el texto de relleno es el mismo que
  // ya se ve hoy cuando la persona no tiene ninguna.
  const ULTIMA_CITA_PASADA = conCitas
    ? `coalesce((SELECT max(b.scheduled_at) FROM ${esquema}.bookings b
                          WHERE b.patient_id = p.id AND b.scheduled_at <= now())::date::text,
                        'sin citas')`
    : `'sin citas'::text`;
  const ULTIMA_CITA_CUALQUIERA = conCitas
    ? `coalesce((SELECT max(b.scheduled_at) FROM ${esquema}.bookings b
                          WHERE b.patient_id = p.id)::date::text, 'nunca')`
    : `'nunca'::text`;
  const SOLO_FAMILIA = `c.id, c.name AS nombre, c.id AS client_id, NULL AS familia`;
  const SIN_TERAPEUTA = `p.main_therapist_id IS NULL`;

  /*
   * Las dos carpetas rojas de paciente, con nombre, para que las de abajo
   * puedan decir «yo no enseño lo que ya enseña esa». Escritas UNA vez: si
   * cada carpeta repitiera la condición de la anterior, la primera que alguien
   * tocara dejaría a la otra mintiendo — que es exactamente lo que pasó.
   */
  const EN_CITAS_SIN_TERAPEUTA = `(${SIN_TERAPEUTA} AND ${TIENE_CITA_FUTURA})`;
  const EN_CITAS_SIN_CONTACTO = `(${SQL_MUDA} AND ${TIENE_CITA_FUTURA} AND NOT ${EN_CITAS_SIN_TERAPEUTA})`;

  // La traducción de paciente → familia. Sin tabla de pacientes no hay ningún
  // hijo que pueda estar enseñando el hueco, así que es FALSE y la familia
  // habla por sí misma.
  const FAMILIA_YA_SALE_POR_UN_HIJO = conPacientes
    ? `EXISTS (SELECT 1 FROM ${esquema}.patients p
                WHERE p.client_id = c.id AND ${EN_CITAS_SIN_CONTACTO})`
    : `FALSE`;

  switch (carpeta) {
    // La primera de todas: no tiene nada por encima de lo que callarse.
    case "citas_sin_terapeuta":
      return {
        id: "p.id",
        select: `${PACIENTE_Y_FAMILIA}, ${PROXIMA_CITA}`,
        from: `${esquema}.patients p LEFT JOIN ${esquema}.clients c ON c.id = p.client_id`,
        where: EN_CITAS_SIN_TERAPEUTA,
        order: "dato NULLS LAST",
      };

    // Quien además no tiene terapeuta sale arriba: eran 7 que salían en las dos.
    case "citas_sin_contacto":
      return {
        id: "p.id",
        select: `${PACIENTE_Y_FAMILIA}, ${PROXIMA_CITA}`,
        from: `${esquema}.patients p JOIN ${esquema}.clients c ON c.id = p.client_id`,
        where: EN_CITAS_SIN_CONTACTO,
        order: "dato NULLS LAST",
      };

    // Familias mudas y sin tutor. Las que ya está enseñando un hijo con hora
    // cogida se callan: es el mismo teléfono el que falta.
    case "sin_tutor_ni_contacto":
      return {
        id: "c.id",
        select: `${SOLO_FAMILIA}, ${CUENTA_PACIENTES} AS dato`,
        from: `${esquema}.clients c`,
        where: `${SQL_SIN_TUTOR} AND ${SQL_MUDA} AND NOT ${FAMILIA_YA_SALE_POR_UN_HIJO}`,
        order: "c.name",
      };

    case "sin_terapeuta":
      // La última cita es EL dato que pidió Rodrigo: distingue al que no ha
      // renovado del que está esperando que le asignen a alguien.
      //
      // Los que tienen hora cogida salen arriba, en rojo (eran los 31 que
      // estaban también aquí). De la otra roja no hace falta defenderse: exige
      // tener terapeuta, así que nunca pisa a esta.
      return {
        id: "p.id",
        select: `${PACIENTE_Y_FAMILIA}, ${ULTIMA_CITA_PASADA} AS dato`,
        from: `${esquema}.patients p LEFT JOIN ${esquema}.clients c ON c.id = p.client_id`,
        where: `${SIN_TERAPEUTA} AND NOT ${EN_CITAS_SIN_TERAPEUTA}`,
        order: "dato DESC NULLS LAST",
      };

    // Sin tutor pero CON algún contacto: las que además están mudas ya salen
    // arriba, en la carpeta urgente. Si no se excluyeran, las mismas 118
    // familias aparecerían dos veces y los totales engañarían.
    case "sin_tutor":
      return {
        id: "c.id",
        select: `${SOLO_FAMILIA}, coalesce(nullif(c.phone,''), nullif(c.email,'')) AS dato`,
        from: `${esquema}.clients c`,
        where: `${SQL_SIN_TUTOR} AND NOT (${SQL_MUDA})`,
        order: "c.name",
      };

    // Igual: las que encima no tienen tutor son las urgentes de arriba, y las
    // que ya enseña un hijo con hora cogida, también.
    case "sin_contacto":
      return {
        id: "c.id",
        select: `${SOLO_FAMILIA}, ${CUENTA_PACIENTES} AS dato`,
        from: `${esquema}.clients c`,
        where: `${SQL_MUDA} AND NOT (${SQL_SIN_TUTOR}) AND NOT ${FAMILIA_YA_SALE_POR_UN_HIJO}`,
        order: "c.name",
      };

    // La última de las de familia, así que se calla ante las TRES de arriba:
    //
    //   · las mudas, que no tienen correo tampoco — por eso las 220 de las dos
    //     carpetas de arriba estaban TODAS aquí dentro (de 265 filas, 45 eran
    //     suyas de verdad);
    //   · y las que no tienen tutor, que salen en «Familias sin tutor». Este
    //     faltaba y lo cazó la revisión: una familia con tutores vacíos,
    //     teléfono puesto y sin correo cumplía las dos, y es justo el estado en
    //     el que queda una ficha de la carpeta roja en cuanto alguien le
    //     rellena el teléfono. O sea que se arreglaba una y aparecía dos veces.
    case "sin_correo":
      return {
        id: "c.id",
        select: `${SOLO_FAMILIA}, coalesce(nullif(c.phone,''), 'sin teléfono') AS dato`,
        from: `${esquema}.clients c`,
        where: `coalesce(c.email,'') = ''
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(c.guardians)='array' THEN c.guardians ELSE '[]'::jsonb END
            ) g WHERE coalesce(g->>'email','') <> '')
          AND NOT (${SQL_MUDA})
          AND NOT (${SQL_SIN_TUTOR})`,
        order: "c.name",
      };

    // Activos, con terapeuta y sin ninguna hora reservada. Sin el «con
    // terapeuta», 482 de estos 813 eran los mismos de «pacientes sin
    // terapeuta»: allí el hueco que hay que cerrar es otro y es antes.
    case "sin_citas":
      return {
        id: "p.id",
        select: `${PACIENTE_Y_FAMILIA}, ${ULTIMA_CITA_CUALQUIERA} AS dato`,
        from: `${esquema}.patients p LEFT JOIN ${esquema}.clients c ON c.id = p.client_id`,
        where: `p.status = 'active' AND NOT ${TIENE_CITA_FUTURA}
                AND NOT (${SIN_TERAPEUTA} AND NOT ${EN_CITAS_SIN_TERAPEUTA})`,
        order: "dato DESC",
      };
    // La lista de revisión de las reservas de plaza: sale de la marca que dejó
    // el cotejo en `custom_fields.reservaPlaza` (resumen ya escrito, aviso si
    // hay algo que mirar). No se calla por las carpetas de arriba: no es un
    // hueco, es otra pregunta, y una familia puede estar en las dos.
    case "reserva_plaza":
      return {
        id: "c.id",
        select: `${SOLO_FAMILIA}, c.custom_fields->'reservaPlaza'->>'resumen' AS dato,
                 c.custom_fields->'reservaPlaza'->>'aviso' AS aviso`,
        from: `${esquema}.clients c`,
        where: `c.custom_fields ? 'reservaPlaza'`,
        order: "(c.custom_fields->'reservaPlaza'->>'aviso') IS NULL, c.name",
      };

    default:
      return null;
  }
}

/**
 * El cuerpo de la carpeta MÁS las dos piezas que hacen falta para las bajas:
 *
 *   · `baja`     — la expresión que dice si ESA fila está dada de baja. Va al
 *                  SELECT como `de_baja` para que la pantalla pueda marcarla.
 *   · `sinBajas` — lo que se le suma al WHERE para dejarlas fuera, con la
 *                  excepción de quien tenga hora cogida (ver la cabecera).
 *
 * Se calcula aquí y no en cada `case` porque solo depende de la entidad de la
 * carpeta: repetirlo ocho veces es garantizar que algún día una se quede sin él.
 *
 * @param {boolean} [opts.conCitas] ¿existe la tabla `bookings` en el schema?
 *   Un centro con fichas pero sin agenda no la tiene, y preguntar por ella
 *   reventaría la carpeta entera. Sin agenda no puede haber «baja con hora
 *   cogida», así que la excepción se cae sola y la regla se queda estricta.
 */
function cuerpoDe(esquema, carpeta, { conPacientes = true, conCitas = true } = {}) {
  const base = cuerpoBase(esquema, carpeta, { conPacientes, conCitas });
  if (!base) return null;

  const esPaciente = CARPETAS.find((c) => c.key === carpeta)?.entidad === "patient";
  const baja = esPaciente ? SQL_PACIENTE_DE_BAJA : SQL_FAMILIA_DE_BAJA;

  const citaFutura = !conCitas
    ? null
    : esPaciente
      ? `EXISTS (SELECT 1 FROM ${esquema}.bookings b
                  WHERE b.patient_id = p.id AND b.scheduled_at > now() AND ${SQL_CITA_CUENTA})`
      : `EXISTS (SELECT 1 FROM ${esquema}.bookings b
                  WHERE b.client_id = c.id AND b.scheduled_at > now() AND ${SQL_CITA_CUENTA})`;

  return {
    ...base,
    baja,
    sinBajas: citaFutura ? `(NOT ${baja} OR ${citaFutura})` : `NOT ${baja}`,
  };
}

/**
 * Las filas de una carpeta.
 *
 * Todo en SQL contra el schema del tenant y no con Sequelize: son cruces entre
 * pacientes, citas y el JSONB de tutores, y armarlos con includes daría una
 * consulta peor y menos legible.
 */
export async function filasDe(
  sequelize,
  esquema,
  carpeta,
  { limite = 5000, conPacientes = true, conCitas = true, incluirBajas = false } = {}
) {
  const c = cuerpoDe(esquema, carpeta, { conPacientes, conCitas });
  if (!c) return [];
  // `de_baja` se manda SIEMPRE, también con las bajas escondidas: las que se
  // quedan por tener hora cogida son justo las que hay que poder marcar.
  const [filas] = await sequelize.query(
    `SELECT ${c.select}, (${c.baja}) AS de_baja
       FROM ${c.from}
      WHERE ${c.where}${incluirBajas ? "" : ` AND ${c.sinBajas}`}
      ORDER BY ${c.order} LIMIT ${limite}`
  );
  return filas;
}

/**
 * Cuántas filas tiene cada carpeta, SIN traérselas.
 *
 * Aquí lo archivado se descuenta en SQL con un `NOT EXISTS` contra
 * `data_reviews` —que tiene índice único por (check_key, entity_id)— en vez de
 * traerse las marcas y filtrar en JavaScript como hace `carpetasCon`. El
 * resultado es el mismo y compara UUID con UUID, sin el `toLowerCase()` que allí
 * hace falta.
 *
 * Si la tabla `data_reviews` todavía no está migrada, se cuenta sin descontar
 * nada: es lo mismo que hace el listado, que se traga el error y no filtra.
 *
 * @returns {Promise<{porCarpeta: Object, bloquea: number, completar: number}>}
 */
export async function cuentasDe(
  sequelize,
  esquema,
  { conPacientes, conCitas, conRevisiones = true, incluirBajas = false } = {}
) {
  // Se mira la TABLA y no el módulo, por lo mismo que el listado: un tenant
  // puede tener `pacientes` activo y el schema todavía sin crear.
  const tablas = conPacientes == null || conCitas == null ? await tablasDe(sequelize, esquema) : null;
  const hayPac = conPacientes ?? tablas.conPacientes;
  const hayCitas = conCitas ?? tablas.conCitas;
  const porCarpeta = {};
  let bloquea = 0;
  let completar = 0;

  for (const c of CARPETAS) {
    if (c.entidad === "patient" && !hayPac) continue;
    const cuerpo = cuerpoDe(esquema, c.key, { conPacientes: hayPac, conCitas: hayCitas });
    if (!cuerpo) continue;

    const sinArchivar = conRevisiones
      ? ` AND NOT EXISTS (SELECT 1 FROM ${esquema}.data_reviews r
            WHERE r.check_key = '${c.key}' AND r.entity_id = ${cuerpo.id})`
      : "";
    // El MISMO criterio que el listado, o el número de la carpeta y lo que se
    // ve al abrirla vuelven a poder discrepar: la regla de la cabecera.
    const sinBajas = incluirBajas ? "" : ` AND ${cuerpo.sinBajas}`;

    let n = 0;
    try {
      const [filas] = await sequelize.query(
        `SELECT count(*)::int AS n FROM ${cuerpo.from} WHERE ${cuerpo.where}${sinBajas}${sinArchivar}`
      );
      n = filas[0]?.n ?? 0;
    } catch {
      // Una carpeta que no se puede contar no puede tumbar el menú entero.
      n = 0;
    }

    porCarpeta[c.key] = n;
    if (c.bloquea) bloquea += n;
    else completar += n;
  }

  return { porCarpeta, bloquea, completar };
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
async function tablasDe(sequelize, esquema) {
  /*
   * ⚠️ NO se pregunta con `SELECT table_name FROM information_schema.tables`.
   *
   * El dialecto de Postgres de Sequelize reconoce esa forma como «listar
   * tablas» y le cambia la FORMA al resultado: en vez de filas devuelve los
   * nombres sueltos y repartidos entre los dos huecos de la tupla
   * (`[["bookings"],["patients"]]`), así que `filas.map(f => f.table_name)` da
   * `[undefined]` y el centro se queda sin sus carpetas de pacientes SIN dar
   * ningún error. Cazado el 25/08/2026 probándolo contra la base: `crm_aumenta`
   * tiene `patients` y la detección decía que no.
   *
   * El código de antes se libraba sin saberlo, porque pedía `SELECT 1`.
   *
   * `to_regclass` no tiene ese problema, contesta las dos tablas en una sola
   * fila y encima obliga a escribir el schema —que es la otra trampa de las
   * consultas crudas: el `searchPath` de Sequelize no llega hasta aquí (ver
   * `docs/modules/pacientes.md`)—.
   */
  const [filas] = await sequelize.query(
    `SELECT to_regclass(:pacientes) IS NOT NULL AS con_pacientes,
            to_regclass(:citas)     IS NOT NULL AS con_citas`,
    { replacements: { pacientes: `"${esquema}"."patients"`, citas: `"${esquema}"."bookings"` } }
  );
  return {
    conPacientes: Boolean(filas?.[0]?.con_pacientes),
    conCitas: Boolean(filas?.[0]?.con_citas),
  };
}

export async function carpetasCon(sequelize, esquema, DataReview, { incluirBajas = false } = {}) {
  const { conPacientes, conCitas } = await tablasDe(sequelize, esquema);
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

    const filas = (await filasDe(sequelize, esquema, c.key, { conPacientes, conCitas, incluirBajas }))
      .filter((f) => !revisadas.has(`${c.key}|${String(f.id).toLowerCase()}`));
    // El total es el de TODAS las filas; lo que se manda a la pantalla se
    // recorta. Contar sobre lo recortado hacía que una carpeta con 616 dijera
    // «500», que es justo la clase de número que hace desconfiar del resto.
    // Una carpeta opcional que no tiene nada no se enseña: a cero no diría nada
    // a un centro que nunca ha tenido esa lista.
    if (c.opcional && filas.length === 0) continue;
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
