/**
 * lib/team/rastro.js — ¿qué queda de una persona en el schema del cliente?
 * (26/08/2026, para el botón de borrar de Equipo.)
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que lo mide y la
 * prueba que lo vigila. Decidir si una ficha se puede borrar es una regla de
 * producto, y una regla de producto no se escribe suelta dentro de un JSX.)
 *
 * ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
 *
 * Equipo tenía baja lógica (`status = 'inactive'`) y nada más. Para la ficha
 * creada por error o la persona que estuvo dos días, eso deja basura para
 * siempre en la plantilla. Pero borrar de verdad es peligroso: 37 columnas de
 * 34 tablas apuntan a `team_members`, y una sesión clínica o una factura sin
 * autor no se recupera.
 *
 * Así que antes de enseñar el botón se hace una RADIOGRAFÍA: cuántas filas de
 * todo el schema siguen apuntando a esa persona. Si queda una sola, no hay
 * botón — el modal enseña qué hay y la ficha se queda inactiva.
 *
 * ── DE DÓNDE SALE LA LISTA DE COLUMNAS ─────────────────────────────────────
 *
 * Del CATÁLOGO de PostgreSQL, no de una lista escrita a mano: se preguntan las
 * FKs que apuntan a `team_members`. Una lista a mano se queda vieja en cuanto
 * alguien añade una tabla, y quien paga ese despiste es el dato que se queda
 * huérfano (`docs/decisions/2026-08-10-las-listas-copiadas-a-mano-mienten.md`).
 *
 * ⚠️ Y se pregunta por TODOS los schemas, no solo por el del cliente que se
 * está mirando. Medido el 26/08/2026: la MISMA columna tiene FK en unos
 * schemas y no en otros —`bookings.team_member_id` la tiene en 8 y NO en
 * `nutri_laura`— porque el alta de un tenant lanza `sync()` antes que las
 * migraciones. Mirar solo el schema propio dejaría fuera las citas de Laura y
 * borraríamos a una profesional con la agenda llena. Qué columnas apuntan a
 * una persona es una propiedad del PRODUCTO; que en un schema concreto falte
 * la FK es un accidente de cómo nació ese schema.
 *
 * ── Y LAS QUE NO TIENEN FK EN NINGÚN SITIO ─────────────────────────────────
 *
 * Quedan tres. Van declaradas abajo con la prueba de por qué, porque esas el
 * catálogo no puede darlas: son UUID pelados, sin asociación en el modelo.
 */

/**
 * Columnas que guardan el id de un miembro del equipo SIN FK en ningún schema.
 * Cada una con la prueba que la mete aquí, medida en producción el 26/08/2026.
 *
 * NO están las que SUENAN a equipo y guardan un id de `master.users`, que es
 * otra cosa: `team_blocks.created_by_id` (14 filas, 14 de usuario y 0 de
 * equipo), `documents.owner_user_id` (8/8), `recipes.created_by` (1/1),
 * `blocked_days.created_by_id`, `calendar_tasks.created_by`,
 * `tickets.created_by` y `leads.assigned_to` (vacías). Meterlas bloquearía el
 * botón por un parecido en el nombre.
 */
export const COLUMNAS_SIN_FK = Object.freeze([
  {
    tabla: "assets",
    columna: "assigned_to",
    // 3 filas en producción, las 3 casan con un team_member y ninguna con un
    // usuario. El modelo la declara como UUID pelado, sin `belongsTo`.
    porque: "el material que tiene asignado, sin FK que lo sujete",
  },
  {
    tabla: "booking_change_requests",
    columna: "proposed_team_member_id",
    // Vacía hoy, pero el endpoint la valida contra TeamMember.findByPk antes
    // de escribirla (app/api/citas/bookings/[id]/reschedule-request): que hoy
    // esté vacía no es una garantía de mañana.
    porque: "cambios de cita que la proponen a ella",
  },
  {
    tabla: "booking_change_requests",
    columna: "requested_by_team_member_id",
    // Se escribe con `myMemberId` en ese mismo endpoint.
    porque: "cambios de cita que pidió ella",
  },
]);

/**
 * Tablas que SON la ficha, no historia de nadie. Se van CON ella.
 * (26/08/2026, el mismo día: lo cazó el primer uso real.)
 *
 * ── POR QUÉ EXISTE ESTA LISTA ──────────────────────────────────────────────
 *
 * La primera ficha que se intentó borrar de verdad —la cuenta de prueba de
 * Aumenta— salió BLOQUEADA por 21 filas de `team_member_modules`. Y esas 21
 * filas se escriben SOLAS al crearle el login (`syncMemberModules`, una por
 * módulo del cliente), así que la regla tal como estaba condenaba a lo
 * siguiente: **cualquier ficha que alguna vez tuvo acceso al CRM era
 * imposible de borrar para siempre**. Justo el caso para el que se hizo el
 * botón.
 *
 * No son historia: son la ficha. Y no es una opinión, lo dicen las dos
 * fuentes que mandan:
 *
 *   · `models/tenant/TeamMemberModule.model.js` en su cabecera: «Esta tabla es
 *     puramente informativa/organizativa: NO bloquea nada» (el acceso real
 *     vive en `master.users.moduleAccess`, que al dar de baja ya se borra).
 *   · Las tres están declaradas `onDelete: "CASCADE"` en `lib/db/tenantDb.js`
 *     y, medido en producción el 26/08/2026, son CASCADE en LOS 12 schemas que
 *     las tienen, sin una sola excepción. Es decir: la base de datos ya estaba
 *     preparada para llevárselas, y era esta función la que se negaba.
 *
 * `team_blocks` es el caso que cantaba: esa misma mañana se puso en CASCADE
 * razonando «sus vacaciones se van con ella», y aquí se contaban como rastro
 * que bloquea. Las dos mitades de la misma función decían cosas distintas.
 *
 * Y no hay historia escondida dentro de ellas: el horario se reescribe ENTERO
 * en cada guardado (`app/api/team/[id]/hours/route.js` hace `destroy` +
 * `bulkCreate`), así que las versiones viejas ya se destruyen en cada edición
 * normal; y lo que de verdad había que conservar ya está copiado fuera a
 * propósito — `models/tenant/Fichaje.model.js` guarda
 * `entradaPrevistaAt`/`salidaPrevistaAt` en CADA fichaje «para poder comparar
 * sin depender de `team_member_hours`, que es el horario de HOY y cambia».
 *
 * ⚠️ Para entrar aquí no basta con que una tabla apunte a `team_members`: hace
 * falta que la fila NO tenga sentido sin esa persona. Una sesión clínica lo
 * tiene (es del paciente, y lleva su firma); su horario, no.
 *
 * ⚠️ LO ÚNICO QUE PODRÍA SACAR A `team_blocks` DE AQUÍ, y está a medio
 * escribir: `lib/fichaje/totales.js` → `avisosDelMes(..., { ausencias })` ya
 * acepta un mapa de ausencias y emitiría «fichó un día que estaba de
 * ausencia», que es un aviso dentro de un documento laboral. Hoy está
 * DESENCHUFADO —su único llamante, `app/api/fichaje/route.js`, pasa solo
 * `{ festivos }`, y `docs/modules/fichaje.md` lo dice— y aunque se enchufara,
 * quien tiene fichajes no llega a este botón (`fichajes` es RESTRICT y cuenta
 * como rastro que bloquea). Pero si algún día alguien hace un informe de «días
 * de ausencia consumidos», `team_blocks` pasa a ser historia y sale de esta
 * lista.
 */
export const TABLAS_SUYAS = Object.freeze([
  "team_member_modules", // el espejo informativo de sus accesos
  "team_member_hours",   // su horario de trabajo
  "team_blocks",         // sus vacaciones y ausencias
]);

/**
 * Tabla → cómo se llama eso en cristiano, en singular y plural.
 *
 * Es SOLO para leer: si falta una tabla, sale su nombre técnico y ya. Lo que
 * decide si se puede borrar nunca depende de este diccionario — si dependiera,
 * añadir una tabla y olvidarse de bautizarla aquí abriría un agujero.
 */
export const NOMBRES = Object.freeze({
  assets: ["material asignado", "materiales asignados"],
  booking_change_requests: ["cambio de cita", "cambios de cita"],
  bookings: ["cita", "citas"],
  calendar_tasks: ["tarea de calendario", "tareas de calendario"],
  cash_closes: ["arqueo de caja", "arqueos de caja"],
  client_notes: ["nota de cliente", "notas de cliente"],
  client_notices: ["aviso a un cliente", "avisos a clientes"],
  clients: ["ficha de cliente", "fichas de cliente"],
  clinic_sessions: ["sesión clínica", "sesiones clínicas"],
  clinical_reports: ["informe clínico", "informes clínicos"],
  coordinations: ["coordinación", "coordinaciones"],
  costs: ["gasto", "gastos"],
  fichajes: ["fichaje", "fichajes"],
  form_submissions: ["solicitud de formulario", "solicitudes de formulario"],
  incentive_items: ["incentivo", "incentivos"],
  incidencia_assignees: ["incidencia asignada", "incidencias asignadas"],
  incidencias: ["incidencia", "incidencias"],
  interactions: ["interacción", "interacciones"],
  intervention_plans: ["plan de intervención", "planes de intervención"],
  invoices: ["factura", "facturas"],
  patient_therapists: ["paciente asignado", "pacientes asignados"],
  patients: ["paciente", "pacientes"],
  performance_metrics: ["métrica de desempeño", "métricas de desempeño"],
  plans: ["pauta", "pautas"],
  project_members: ["proyecto", "proyectos"],
  quotes: ["presupuesto", "presupuestos"],
  rates: ["tarifa", "tarifas"],
  stock_movements: ["movimiento de stock", "movimientos de stock"],
  talleres: ["taller", "talleres"],
  task_assignees: ["tarea asignada", "tareas asignadas"],
  tasks: ["tarea", "tareas"],
  team_blocks: ["bloqueo de agenda", "bloqueos de agenda"],
  team_member_hours: ["tramo de horario", "tramos de horario"],
  team_member_modules: ["módulo marcado", "módulos marcados"],
  tickets: ["ticket", "tickets"],
  waitlist_entries: ["entrada en lista de espera", "entradas en lista de espera"],
});

/** «3 sesiones clínicas», «1 cita». La concordancia a mano: canta mucho fallarla. */
export function enCristiano(tabla, n) {
  const par = NOMBRES[tabla];
  if (!par) return `${n} en ${tabla}`;
  return `${n} ${n === 1 ? par[0] : par[1]}`;
}

/*
 * Un identificador de PostgreSQL de los de verdad. Cinturón sobre tirantes:
 * estos nombres salen del catálogo, no de nadie de fuera, pero se interpolan
 * en SQL y la regla de seguridad dice que el SQL crudo se mira dos veces.
 */
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const esIdent = (x) => typeof x === "string" && IDENT.test(x);

/**
 * Las columnas que apuntan a `team_members` EN TODO EL PRODUCTO: las FKs de
 * cualquier schema `crm_%` más las tres declaradas arriba.
 */
export async function columnasQueApuntanAlEquipo(sequelize) {
  const [filas] = await sequelize.query(
    `SELECT DISTINCT cl.relname AS tabla, a.attname AS columna
       FROM pg_constraint c
       JOIN pg_class     cl ON cl.oid = c.conrelid
       JOIN pg_namespace n  ON n.oid  = cl.relnamespace
       JOIN pg_class     rf ON rf.oid = c.confrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a  ON a.attrelid = cl.oid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND rf.relname = 'team_members'
        AND n.nspname LIKE 'crm\\_%'`
  );
  const vistas = new Set();
  const salida = [];
  for (const f of [...filas, ...COLUMNAS_SIN_FK]) {
    if (!esIdent(f.tabla) || !esIdent(f.columna)) continue;
    const k = `${f.tabla}.${f.columna}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    salida.push({ tabla: f.tabla, columna: f.columna });
  }
  return salida.sort((a, b) => `${a.tabla}.${a.columna}`.localeCompare(`${b.tabla}.${b.columna}`));
}

/**
 * Cuenta, en el schema de ESTE cliente, cuántas filas siguen apuntando a esa
 * persona. Solo lecturas.
 *
 * Devuelve las filas en DOS montones, porque significan cosas distintas:
 *   · `filas` / `total` — historia de otros. Es lo que BLOQUEA el borrado.
 *   · `suyas` / `totalSuyas` — sus propios ajustes (`TABLAS_SUYAS`). No
 *     bloquean: se van con ella, y se enseñan para que quien borra sepa qué
 *     desaparece.
 *
 * @returns {{total, filas, suyas, totalSuyas, columnas}}
 */
export async function radiografiaDeLaFicha(sequelize, { schema, memberId }) {
  if (!esIdent(schema)) throw new Error("schema inválido");

  const candidatas = await columnasQueApuntanAlEquipo(sequelize);

  // Cuáles de esas columnas EXISTEN en este schema: cada cliente tiene las
  // tablas de los módulos que ha comprado, no las 34.
  const [presentes] = await sequelize.query(
    `SELECT c.table_name AS tabla, c.column_name AS columna
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = :schema
        AND c.table_name IN (:tablas) AND c.column_name IN (:columnas)`,
    {
      replacements: {
        schema,
        tablas: [...new Set(candidatas.map((c) => c.tabla))],
        columnas: [...new Set(candidatas.map((c) => c.columna))],
      },
    }
  );
  // El IN cruzado de arriba trae pares que no son de la lista (la tabla de una
  // columna con la columna de otra): aquí se queda solo con los pares reales.
  const buenos = new Set(candidatas.map((c) => `${c.tabla}.${c.columna}`));
  const mirar = presentes.filter((p) => buenos.has(`${p.tabla}.${p.columna}`));
  if (!mirar.length) return { total: 0, filas: [], suyas: [], totalSuyas: 0, columnas: 0 };

  const trozos = mirar.map(
    (m) =>
      `SELECT '${m.tabla}' AS tabla, '${m.columna}' AS columna,
              COUNT(*)::int AS n FROM "${schema}"."${m.tabla}" WHERE "${m.columna}" = :id`
  );
  const [cuentas] = await sequelize.query(trozos.join(" UNION ALL "), {
    replacements: { id: memberId },
  });

  const conFilas = cuentas
    .map((c) => ({ tabla: c.tabla, columna: c.columna, n: Number(c.n) || 0 }))
    .filter((c) => c.n > 0)
    .map((c) => ({ ...c, texto: enCristiano(c.tabla, c.n) }))
    .sort((a, b) => b.n - a.n || a.tabla.localeCompare(b.tabla));

  const esSuya = (f) => TABLAS_SUYAS.includes(f.tabla);
  const filas = conFilas.filter((f) => !esSuya(f));
  const suyas = conFilas.filter(esSuya);

  return {
    total: filas.reduce((s, f) => s + f.n, 0),
    filas,
    suyas,
    totalSuyas: suyas.reduce((s, f) => s + f.n, 0),
    columnas: mirar.length,
  };
}

/**
 * Borra los ajustes propios de la ficha (`TABLAS_SUYAS`) dentro de la MISMA
 * transacción en la que se borra ella.
 *
 * Se hace a mano aunque las tres FKs sean CASCADE hoy en los 12 schemas. El
 * motivo lo enseñó esta misma mañana `migrate-fks-equipo-alineadas.js`: el
 * `ON DELETE` de un schema depende de cómo NACIÓ ese schema (el alta lanza
 * `sync()` antes que las migraciones), así que fiarse de la regla de la FK es
 * fiarse de un accidente. Si un día un schema naciera con SET NULL, un bloqueo
 * de agenda sin persona significa «cierra la agenda de TODO el centro»
 * (`models/tenant/TeamBlock.model.js`). Borrándolas aquí, da igual la regla.
 *
 * @returns {Promise<Array<{tabla: string, n: number}>>} qué se llevó por delante
 */
export async function borrarLoSuyo(sequelize, { schema, memberId, transaction }) {
  if (!esIdent(schema)) throw new Error("schema inválido");
  const hecho = [];
  for (const tabla of TABLAS_SUYAS) {
    if (!esIdent(tabla)) continue;
    // La tabla puede no existir: cada cliente tiene las de sus módulos.
    const [[hay]] = await sequelize.query(`SELECT to_regclass(:t) IS NOT NULL AS hay`, {
      replacements: { t: `${schema}.${tabla}` },
      transaction,
    });
    if (!hay?.hay) continue;
    const [, meta] = await sequelize.query(
      `DELETE FROM "${schema}"."${tabla}" WHERE "team_member_id" = :id`,
      { replacements: { id: memberId }, transaction }
    );
    const n = typeof meta === "number" ? meta : (meta?.rowCount ?? 0);
    if (n > 0) hecho.push({ tabla, n });
  }
  return hecho;
}

/**
 * La regla, sin base de datos delante: ¿se puede borrar esta ficha?
 *
 * Las tres puertas, y las tres tienen que estar abiertas:
 *   1. INACTIVA. Borrar a alguien que sigue trabajando no es un borrado, es un
 *      accidente. Además pasar a inactivo ya le quita el login: lo revocan
 *      desde el servidor el PATCH y el DELETE de /api/team/[id].
 *   2. SIN LOGIN. Si aún cuelga un `userId`, la baja no terminó de hacerse.
 *   3. SIN RASTRO. Ni una fila suya en todo el schema.
 */
export function puedeBorrarseLaFicha({ status, userId, total }) {
  const impedimentos = [];
  if (status !== "inactive") {
    impedimentos.push({
      codigo: "activa",
      texto: "La ficha sigue activa. Primero hay que darla de baja.",
    });
  }
  if (userId) {
    impedimentos.push({
      codigo: "login",
      texto: "Todavía tiene acceso al CRM. Quítaselo antes de borrar la ficha.",
    });
  }
  if ((Number(total) || 0) > 0) {
    impedimentos.push({
      codigo: "rastro",
      texto: "Su nombre sigue colgando de registros que no se pueden quedar sin autor.",
    });
  }
  return { puede: impedimentos.length === 0, impedimentos };
}
