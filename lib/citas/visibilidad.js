/**
 * lib/citas/visibilidad.js — ¿quién ve las citas de quién?
 *
 * (Fichero nuevo en /lib, regla #2: la decisión la comparten el listado, el
 * calendario y la ficha de una cita, y estaba copiada en los tres.)
 *
 * REGLA POR DEFECTO (la de siempre): un profesional NO admin solo ve SUS
 * citas. No es cosmética — se puso a propósito porque el listado y la lista de
 * espera enseñan nombre, email y teléfono del paciente, y sin el filtro
 * cualquier miembro del equipo veía los datos personales de toda la agenda.
 *
 * AGENDA COMPARTIDA (`settings.citas.agendaCompartida: true`): todo el equipo
 * ve las citas de todo el equipo. Lo pidió Aumenta en la reunión del 28/07 —
 * es un centro donde las terapeutas se cubren entre sí y necesitan ver la
 * agenda completa para cuadrar recuperaciones.
 *
 * Va POR TENANT y apagada por defecto: es una decisión de cada cliente sobre
 * los datos de SUS pacientes, no algo que el CRM deba dar por supuesto. Un
 * centro con varias sedes o con profesionales externos querrá lo contrario.
 *
 * ⚠️ EL MÓDULO SE PREGUNTA CON `tenantHasModule`, NUNCA CON `hasModule`
 * (19/08/2026). Esto no es estilo: es por dónde se escapó la agenda de
 * nutri_laura, y el fallo estuvo vivo desde que se escribió el filtro el 28/07.
 *
 * `hasModule(key)` cruza DOS cosas: que el TENANT tenga el módulo Y que el
 * USUARIO lo tenga en su `moduleAccess` (lib/tenant/tenantResolver.js). Eso está
 * bien para decidir si alguien entra en una pantalla, y está MAL para envolver
 * este filtro —porque el filtro vivía DENTRO de un `if (hasModule("team"))`—:
 *
 *   Rocío es `user` en nutri_laura con moduleAccess ["citas","clients",
 *   "nutricion"]: sin "team", que es justo por lo que no ve el menú de Equipo.
 *   Para ella `hasModule("team")` era `false`, el `if` no entraba y el
 *   `where.teamMemberId` no se ponía NUNCA. Veía las 10 citas del centro con
 *   nombre de paciente —incluida la supervisión que Laura se agendó a sí
 *   misma— y por `noPuedeTocarla` podía además mover y cancelar las de Laura.
 *
 * O sea: QUITARLE PERMISOS ERA LO QUE LE DABA LOS DATOS. Un control de acceso
 * que al cerrarse abre es peor que no tenerlo, porque nadie lo va a auditar.
 *
 * La regla, para no volver a equivocarse:
 *   «¿existe la tabla / tiene el CENTRO equipo?»  → `tenantHasModule`
 *   «¿puede esta persona abrir la pantalla de Equipo?» → `hasModule`
 *
 * Lo vigila `scripts/_smoke-citas-visibilidad.mjs`, que lee el código del listado,
 * el calendario, el detalle de una cita, la portada y la cola de citas sin
 * profesional, y falla si reaparece `hasModule("team")` en cualquiera de ellos.
 */

import { Op } from "sequelize";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿Este tenant comparte la agenda con todo el equipo? (default: no) */
export function agendaCompartida(tenant) {
  return tenant?.settings?.citas?.agendaCompartida === true;
}

/**
 * ¿Puede este usuario ver TODAS las citas del tenant?
 * Admin siempre; el resto, solo si el tenant comparte agenda.
 */
export function veTodaLaAgenda({ tenant, role }) {
  if (ADMIN_ROLES.has(role)) return true;
  return agendaCompartida(tenant);
}

/**
 * Ficha de equipo imposible. Se usa cuando NO se puede saber quién mira: así el
 * filtro sigue existiendo y no coincide con nadie, en vez de desaparecer.
 */
export const NADIE_DEL_EQUIPO = "00000000-0000-0000-0000-000000000000";

/**
 * El trozo de `where` de quien solo ve lo suyo (19/08/2026, Jorge: «tan solo que
 * no vea las de Laura, el resto que sí las vea»).
 *
 * «Lo suyo» son SUS citas Y LAS QUE NO SON DE NADIE. Una cita sin profesional
 * asignado no es de otra persona: es trabajo por repartir. En nutri_laura son la
 * MITAD de la agenda —entran por la web sin profesional—, y esconderlas dejaría a
 * la profesional mirando un calendario casi vacío, convencida de que el CRM le ha
 * perdido las citas. Es la misma excepción que ya hacía la rama de dirección
 * cuando filtra por profesional: «para no perderlas de vista».
 *
 * Lo único que cierra —y lo único que se pedía cerrar— son las citas de OTRA
 * persona, que son las que llevan el nombre de un paciente que no le toca.
 *
 * ⚠️ SIGUE FALLANDO EN CERRADO DONDE IMPORTA. Si no se puede resolver la ficha de
 * equipo de quien mira, entra `NADIE_DEL_EQUIPO`, que no es de nadie: entonces ve
 * las sin asignar y NINGUNA ajena. Un fallo técnico no destapa a un paciente.
 */
export function soloLoSuyo(miTeamMemberId) {
  return {
    [Op.or]: [{ [Op.eq]: miTeamMemberId ?? NADIE_DEL_EQUIPO }, { [Op.is]: null }],
  };
}

/**
 * La MISMA regla, de una en una: para el detalle de una cita y para la puerta de
 * editar, mover y cancelar, que se piden por id y no por lista.
 *
 * Tiene que decir exactamente lo mismo que `soloLoSuyo`. Si no, pasa lo de
 * siempre: la cita se ve en el calendario y al abrirla dice «no encontrada», que
 * no parece un permiso sino un CRM roto.
 */
export function esSuya(row, miTeamMemberId) {
  const de = row?.teamMemberId ?? null;
  if (de === null) return true;
  return Boolean(miTeamMemberId) && String(de) === String(miTeamMemberId);
}

