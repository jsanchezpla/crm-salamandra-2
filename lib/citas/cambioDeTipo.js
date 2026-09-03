/**
 * lib/citas/cambioDeTipo.js — cambiar DE QUÉ TIPO es una cita que ya existe
 * (03/09/2026, Aumenta por Rodrigo: «en el modal de la cita debería poderse
 * cambiar el tipo de cita desde Admin»).
 *
 * (Fichero nuevo en /lib, regla #2: la regla de quién puede cambiar el tipo y
 * a cuál la necesitan el PATCH de la cita —que es la valla de verdad— y el
 * modal —que decide si pinta el desplegable y con qué tipos—. Si cada uno
 * llevara la suya, el día que una cambie la pantalla ofrecerá cambios que el
 * servidor rechaza, o al revés.)
 *
 * ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
 * En Aumenta hay entrevistas iniciales apuntadas con OTRO tipo de cita —el de
 * la cuota que luego pagará la familia— y así no salen como entrevista ni le
 * ofrecen a la terapeuta la plantilla de entrevista al preparar el registro.
 * Hasta hoy la única salida era borrar la cita y crearla de nuevo, perdiendo
 * el registro de sesión, el cobro y el histórico de la agenda.
 *
 * ── LAS REGLAS ──────────────────────────────────────────────────────────────
 *   · Solo DIRECCIÓN (admin / superadmin). Es lo que se pidió, y tiene
 *     sentido: el tipo decide qué se factura y qué plantilla de registro se
 *     abre, y eso lo cuadra administración, no cada terapeuta en su agenda.
 *   · Una cita de TALLER no cambia de tipo, ni una cita normal se convierte en
 *     taller. Un taller es otra estructura (lista de asistentes, terapeutas de
 *     esa tarde, registro común) y «cambiar el tipo» no la monta ni la
 *     desmonta: se pasaría a tener un taller sin asistentes o un niño con
 *     ocho registros. Eso se hace creando la cita de taller.
 *   · Una sesión de un BONO no cambia de tipo: el bono es DE un tipo de cita y
 *     la numeración «3 de 10» dejaría de significar nada.
 *   · La duración de la cita NO se toca. Es suya, no del tipo: cambiar de
 *     «Logopedia 45» a «Entrevista inicial» no mueve el hueco de la agenda ni
 *     puede crear un solape por detrás. Si hace falta, la hora se ajusta desde
 *     la propia ficha, como siempre.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

const plano = (x) => (x?.toJSON ? x.toJSON() : x ?? {});

/** ¿Este rol puede cambiar el tipo de una cita? */
export function puedeCambiarTipoDeCita(role) {
  return ADMIN_ROLES.has(String(role ?? ""));
}

/**
 * ¿Se puede pasar ESTA cita a ESE tipo? Devuelve `{ ok: true }` o
 * `{ ok: false, motivo, status }`, con el `status` HTTP que le toca al
 * rechazo para que el endpoint no tenga que traducirlo.
 *
 * @param role      rol de quien lo pide
 * @param booking   la cita tal como está (fila de Sequelize o JSON)
 * @param tipoNuevo el tipo al que se quiere pasar (fila o JSON), o null si
 *                  no existe
 */
export function puedeCambiarTipo({ role, booking, tipoNuevo }) {
  if (!puedeCambiarTipoDeCita(role)) {
    return { ok: false, status: 403, motivo: "Solo dirección puede cambiar el tipo de una cita" };
  }
  const cita = plano(booking);
  const tipo = plano(tipoNuevo);
  if (!tipo.id) return { ok: false, status: 400, motivo: "Ese tipo de cita no existe" };
  if (cita.eventTypeId && String(cita.eventTypeId) === String(tipo.id)) {
    return { ok: true, sinCambio: true };
  }
  if (cita.tallerGrupoId) {
    return { ok: false, status: 409, motivo: "Una cita de taller no cambia de tipo: es el grupo el que la define" };
  }
  if (tipo.tallerGrupoId) {
    return { ok: false, status: 409, motivo: "Una cita no se convierte en taller cambiándole el tipo: crea la cita del taller desde la agenda" };
  }
  if (cita.packId) {
    return { ok: false, status: 409, motivo: "Esta cita es una sesión de un bono, y el bono es de su tipo de cita" };
  }
  return { ok: true };
}

/**
 * Los tipos que se ofrecen en el desplegable de la ficha de la cita: los del
 * catálogo menos los de taller (a esos no se llega cambiando el tipo). Si el
 * tipo ACTUAL de la cita no está en la lista —porque se desactivó después—,
 * se añade para que el desplegable no enseñe otro como si fuera el suyo.
 */
export function tiposParaCambiar(tipos, booking) {
  const lista = (Array.isArray(tipos) ? tipos : []).filter((t) => t?.id && !t.tallerGrupoId);
  const cita = plano(booking);
  const actual = cita.eventType ? plano(cita.eventType) : null;
  if (actual?.id && !actual.tallerGrupoId && !lista.some((t) => String(t.id) === String(actual.id))) {
    lista.unshift({ id: actual.id, name: actual.name, tallerGrupoId: null, inactivo: true });
  }
  return lista;
}
