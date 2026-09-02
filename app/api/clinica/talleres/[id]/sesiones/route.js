import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { limpiarContentSections } from "../../../../../../lib/clinica/plantillas.js";
import { MAX_TRANSCRIPCION } from "../../../../../../lib/clinica/registroCompleto.js";
import { apartadoDeNota, apartadosComunes, valoresComunes } from "../../../../../../lib/clinica/tallerSesion.js";
import { propagarSesionDeTaller } from "../../../../../../lib/clinica/propagarTaller.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { asistentesQueVinieron } from "../../../../../../lib/clinica/citaDeTaller.js";

/**
 * /api/clinica/talleres/[id]/sesiones — las sesiones de un taller
 * (01/09/2026, Aumenta por Rodrigo).
 *
 *   GET  → las sesiones del taller, de la más reciente a la más vieja, con
 *          cuántos pacientes tiene cada una.
 *   POST → registrar una sesión: el registro COMÚN del grupo, y de paso el
 *          registro de cada asistente en su ficha (con su nota individual).
 *
 * El porqué de que el registro sea uno y se copie a los ocho está en
 * `models/tenant/TallerSesion.model.js`; el reparto exacto, en
 * `lib/clinica/tallerSesion.js`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica");
}

/** Lo que la pantalla necesita de una sesión, sin su cuerpo entero. */
function serializaFila(s, cuantos) {
  const j = s.toJSON ? s.toJSON() : s;
  return {
    id: j.id,
    tallerId: j.tallerId,
    grupoId: j.grupoId ?? null,
    bookingId: j.bookingId ?? null,
    sessionDate: j.sessionDate,
    duration: j.duration ?? null,
    teamMemberId: j.teamMemberId ?? null,
    teamMemberName: j.profesional?.displayName ?? null,
    status: j.status,
    statusLabel: j.status === "published" ? "Cerrada" : "Registrada",
    asistentes: cuantos ?? 0,
  };
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { Taller, TallerSesion, TeamMember, ClinicSession } = ctx.tenantModels;
    if (!TallerSesion) return error("Los talleres no están disponibles en este cliente", 503);

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const taller = await Taller.findByPk(id, { attributes: ["id", "name"] });
    if (!taller) return notFound("Taller no encontrado");

    // `?grupoId=…` — las sesiones de UN grupo. Sin él, las de toda la
    // actividad, que es como se leía antes de que hubiera grupos.
    const grupoId = new URL(request.url).searchParams.get("grupoId");
    const filas = await TallerSesion.findAll({
      where: grupoId && UUID_RE.test(grupoId) ? { tallerId: id, grupoId } : { tallerId: id },
      include: TeamMember
        ? [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName"], required: false }]
        : [],
      order: [["sessionDate", "DESC"]],
      limit: 200,
    });

    /*
     * Cuántos pacientes tiene cada sesión, en UNA consulta para toda la lista y
     * no una por fila. Se cuenta lo que de verdad hay escrito —las sesiones de
     * los pacientes—, no lo que se marcó en su día: si a alguien se le quitó de
     * la lista, aquí ya no sale.
     */
    const cuenta = new Map();
    if (ClinicSession && filas.length) {
      const ids = filas.map((f) => f.id);
      const filasCuenta = await ClinicSession.findAll({
        where: { tallerSesionId: { [Op.in]: ids } },
        attributes: ["tallerSesionId", "patientId"],
        raw: true,
      });
      for (const f of filasCuenta) {
        cuenta.set(f.tallerSesionId, (cuenta.get(f.tallerSesionId) ?? 0) + 1);
      }
    }

    return ok({
      taller: { id: taller.id, name: taller.name },
      sesiones: filas.map((f) => serializaFila(f, cuenta.get(f.id))),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { Taller, TallerSesion, TallerInscripcion } = ctx.tenantModels;
    if (!TallerSesion) return error("Los talleres no están disponibles en este cliente", 503);

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const taller = await Taller.findByPk(id);
    if (!taller) return notFound("Taller no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const fecha = body.sessionDate ? new Date(body.sessionDate) : new Date();
    if (Number.isNaN(fecha.getTime())) return error("La fecha de la sesión no es válida", 422);

    /*
     * ── UNA CITA, UN REGISTRO (01/09/2026) ──────────────────────────────────
     * Desde que los talleres son citas, el registro se escribe desde la cita de
     * esa tarde. Y aquí manda la misma regla que en una sesión individual: si
     * esa cita YA tiene registro, se devuelve el que hay en vez de crear otro.
     * Un segundo registro de la misma tarde partiría el grupo en dos —cada
     * asistente colgaría de uno— y nadie se enteraría hasta leer el informe.
     */
    const bookingId =
      typeof body.bookingId === "string" && UUID_RE.test(body.bookingId) ? body.bookingId : null;
    if (bookingId) {
      const yaHay = await TallerSesion.findOne({ where: { bookingId } });
      if (yaHay) return ok({ id: yaHay.id, yaExistia: true });
    }

    // El grupo: el que mande la pantalla, o el de la cita si viene por ahí.
    let grupoId = typeof body.grupoId === "string" && UUID_RE.test(body.grupoId) ? body.grupoId : null;
    if (!grupoId && bookingId) {
      const { Booking } = ctx.tenantModels;
      const cita = Booking ? await Booking.findByPk(bookingId, { attributes: ["tallerGrupoId"] }) : null;
      grupoId = cita?.tallerGrupoId ?? null;
    }

    /*
     * Quién la dio: lo que mande la pantalla, y si no manda nada, quien está
     * escribiendo. Es lo mismo que hace el resto del módulo con
     * `resolveCurrentTeamMemberId`, y evita el caso tonto de una sesión de
     * taller sin firmar registrada por alguien que está delante.
     */
    let teamMemberId = typeof body.teamMemberId === "string" && body.teamMemberId.trim()
      ? body.teamMemberId.trim()
      : null;
    if (teamMemberId && !UUID_RE.test(teamMemberId)) return error("teamMemberId inválido", 422);
    if (!teamMemberId) teamMemberId = taller.teamMemberId ?? (await resolveCurrentTeamMemberId(request, ctx.tenantModels));

    // El cuerpo común, con la nota individual fuera de la lista de apartados
    // (ver la cabecera de tallerSesion.js: si se colara ahí, la propagación le
    // escribiría a los ocho el mismo texto encima de su nota).
    const limpio = limpiarContentSections(body.contentSections);
    const comunes = apartadosComunes(limpio.apartados);
    const contentSections = { ...valoresComunes(limpio), apartados: comunes };
    if (limpio.plantilla) contentSections.plantilla = limpio.plantilla;

    const fila = await TallerSesion.create({
      tallerId: id,
      grupoId,
      bookingId,
      teamMemberId,
      sessionDate: fecha,
      duration: body.duration != null && body.duration !== "" ? Number(body.duration) : null,
      contentSections,
      internalNotes: typeof body.internalNotes === "string" && body.internalNotes.trim() ? body.internalNotes.trim() : null,
      // De qué texto salió el registro (03/09/2026): la transcripción del
      // audio y/o las notas que leyó la IA, si se usó. Acotada como en el
      // registro normal.
      aiTranscription:
        typeof body.aiTranscription === "string" && body.aiTranscription.trim()
          ? body.aiTranscription.trim().slice(0, MAX_TRANSCRIPCION)
          : null,
      audioDurationSec:
        Number.isFinite(Number(body.audioDurationSec)) && Number(body.audioDurationSec) > 0
          ? Math.round(Number(body.audioDurationSec))
          : null,
      teamBlockId: typeof body.teamBlockId === "string" && UUID_RE.test(body.teamBlockId) ? body.teamBlockId : null,
      status: body.status === "published" ? "published" : "registered",
      createdById: request.headers.get("x-user-id") || null,
    });

    /*
     * Los asistentes. Si la pantalla no manda ninguno, van los que están
     * apuntados al taller HOY: es lo que pasa el 90 % de las veces y ahorra
     * marcar ocho casillas para decir «vinieron todos». Quien falte se quita
     * desde el formulario.
     */
    let asistentes = Array.isArray(body.asistentes) ? body.asistentes : null;
    /*
     * Con cita, la lista sale de la ASISTENCIA que se pasó en ella: solo los
     * que constan como que vinieron. Es lo correcto y además evita el trabajo
     * doble — quien pasa lista en la cita no tiene que volver a marcarla aquí.
     * Los que faltaron no reciben registro: no se le puede dejar a un niño en
     * su historia clínica una sesión a la que no fue.
     */
    if (!asistentes && bookingId) {
      const vinieron = await asistentesQueVinieron({ tenantModels: ctx.tenantModels, bookingId });
      if (vinieron.length) asistentes = vinieron.map((patientId) => ({ patientId, nota: "" }));
    }
    // Sin cita (registro escrito desde la pestaña de Talleres): los apuntados
    // hoy al GRUPO, y si la sesión no es de ningún grupo, los del taller.
    if (!asistentes && TallerInscripcion) {
      const apuntados = await TallerInscripcion.findAll({
        where: grupoId ? { grupoId, leftAt: null } : { tallerId: id, leftAt: null },
        attributes: ["patientId"],
        raw: true,
      });
      asistentes = apuntados.map((a) => ({ patientId: a.patientId, nota: "" }));
    }

    const reparto = await propagarSesionDeTaller({
      tenantModels: ctx.tenantModels,
      sesionTaller: fila,
      asistentes: asistentes ?? [],
      etiquetaNota: body.etiquetaNota,
    });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.taller_sesion.created",
      entity: "TallerSesion",
      entityId: fila.id,
      // Un RESUMEN: ni el cuerpo del registro ni los nombres. Son datos de
      // salud y `master.audit_logs` la comparten todos los clientes.
      after: { tallerId: id, sessionDate: fila.sessionDate, pacientes: reparto.creadas },
    });

    return created({ id: fila.id, ...reparto });
  } catch (err) {
    return serverError(err);
  }
});
