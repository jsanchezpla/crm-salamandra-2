/**
 * ¿Quién está mirando la agenda pública? (06/08/2026)
 *
 * Lo usan las dos rutas de disponibilidad —los huecos de un día y los días con
 * hueco del mes— para saber si quien pregunta tiene profesional asignada y
 * enseñarle solo sus horarios. Vive aparte de `horarioProfesional.js` para que
 * ese siga siendo lógica pura, sin base de datos ni tokens, y se pueda probar
 * con `node scripts/_smoke-horario-profesional.mjs`.
 *
 * ── DE DÓNDE SALE EL EMAIL ──────────────────────────────────────────────────
 * Del TOKEN de la sesión del portal, nunca de la URL: es un dato personal y en
 * una query string acaba en los registros del servidor, en el historial del
 * navegador y en el `Referer` de cualquier recurso externo. Y de paso, del
 * token viene FIRMADO — por la URL podría escribirlo cualquiera y usar esto
 * para averiguar con quién va una paciente.
 */
import { Op } from "sequelize";
import { profesionalDe, recortarAlHorario } from "./horarioProfesional.js";
import { verifyPortalSession, readBearer } from "./portalSession.js";

/**
 * @returns id de la profesional asignada, o `null` ante cualquier duda: sin
 * sesión, sin ficha, sin asignar o si la tabla no está en este schema. `null`
 * significa «agenda del centro», que es como ha funcionado siempre.
 */
export async function profesionalDeQuienPregunta(tenantModels, request, slug) {
  try {
    const token = readBearer(request);
    if (!token) return null;
    const sesion = await verifyPortalSession(token, slug);
    const email = sesion?.email;
    if (!email) return null;
    const { Client } = tenantModels;
    if (!Client) return null;
    const client = await Client.findOne({
      where: { email: { [Op.iLike]: email.trim() } },
      attributes: ["assignedTeamMemberId"],
    });
    return profesionalDe(client);
  } catch {
    return null;
  }
}

/**
 * Las disponibilidades del centro recortadas al horario de esa profesional.
 *
 * Best-effort a propósito: si algo falla aquí se devuelven los huecos del
 * centro sin tocar. Una paciente sin poder pedir cita es mucho peor que una
 * que ve algún hueco de más y se lo reajustan por teléfono.
 *
 * `horarioPropio: false` (interruptor `sinHorarioPropio` de Citas, 03/09/2026,
 * `lib/citas/horarioPropio.js`): el centro no lleva horario por persona, así
 * que no hay a qué recortar y se enseña la agenda del centro.
 */
export async function recortarSiTieneProfesional(tenantModels, aplicables, profesionalId, dayOfWeek, { horarioPropio = true } = {}) {
  if (!profesionalId || !horarioPropio) return aplicables;
  try {
    const { TeamMemberHours } = tenantModels;
    const horas = TeamMemberHours
      ? await TeamMemberHours.findAll({ where: { teamMemberId: profesionalId, dayOfWeek } })
      : [];
    return recortarAlHorario(aplicables, horas.map((h) => h.toJSON()), dayOfWeek);
  } catch (err) {
    process.stderr.write(`[citas] no se pudo recortar al horario: ${err.message}\n`);
    return aplicables;
  }
}
