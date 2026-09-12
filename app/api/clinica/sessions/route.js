import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeSession } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";
import { limpiarContentSections, CLAVE_PLANTILLA } from "../../../../lib/clinica/plantillas.js";
import { estadoDeLasCitas } from "../../../../lib/clinica/borradorDeCita.js";
import { limpiarTitulo } from "../../../../lib/clinica/registroDeDiagnostico.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const STATUSES = ["draft", "ai_pending", "registered", "published"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 42P01 = la tabla no existe; 42703 = la columna no existe (tenant sin la migración). */
const sinTablaOColumna = (err) => ["42P01", "42703"].includes(err?.parent?.code ?? err?.original?.code);

/**
 * ── A QUÉ DIAGNÓSTICO se ata un registro: lo decide el SERVIDOR (12/09/2026) ──
 *
 * Un registro de diagnóstico es una sesión de siempre con `diagnosticoId`, y
 * ese id es lo que hace que el texto clínico de un niño aparezca en el
 * expediente —y en el informe— de un diagnóstico. No puede escribirlo el
 * navegador a su aire:
 *
 *   · Con CITA (`bookingId`), manda la cita: `bookings.diagnostico_id`. Da
 *     igual lo que diga el cuerpo, porque la cita ya sabe de qué expediente
 *     es y la pantalla podría venir con una cola de URL vieja. Eso sí, la cita
 *     tiene que ser DE ESTE PACIENTE (revisión 12/09/2026): `bookingId` no se
 *     comprueba contra el paciente en ningún otro sitio, y una cita ajena
 *     pegada a mano ataría esta sesión al expediente de otro niño.
 *   · Sin cita (o con una cita que no es de ningún diagnóstico), se acepta el
 *     del cuerpo SOLO si el expediente existe y es del MISMO paciente: un id
 *     de otro paciente pegado en la URL colaría la sesión de este niño en el
 *     expediente de aquel, y eso es un incidente de datos de salud, no un
 *     error de formulario.
 *
 * Devuelve `{ diagnosticoId }` o `{ error }` con la frase del 422.
 */
async function diagnosticoDelRegistro(tenantModels, { patientId, bookingId, pedido }) {
  const { Booking, Diagnostico } = tenantModels;
  if (bookingId && Booking) {
    try {
      const cita = await Booking.findByPk(bookingId, { attributes: ["id", "patientId", "diagnosticoId"] });
      if (cita?.diagnosticoId && String(cita.patientId ?? "") === String(patientId)) {
        return { diagnosticoId: cita.diagnosticoId };
      }
    } catch (err) {
      if (!sinTablaOColumna(err)) throw err;
    }
  }
  const id = typeof pedido === "string" ? pedido.trim() : "";
  if (!id) return { diagnosticoId: null };
  if (!UUID_RE.test(id)) return { error: "diagnosticoId inválido" };
  let expediente = null;
  if (Diagnostico) {
    try {
      expediente = await Diagnostico.findByPk(id, { attributes: ["id", "patientId"] });
    } catch (err) {
      if (!sinTablaOColumna(err)) throw err;
    }
  }
  if (!expediente) return { error: "Ese diagnóstico no existe" };
  if (String(expediente.patientId) !== String(patientId)) return { error: "Ese diagnóstico no es de este paciente" };
  return { diagnosticoId: expediente.id };
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicSession, TeamMember, Booking } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const where = {};
  if (sp.get("patientId")) where.patientId = sp.get("patientId");
  if (sp.get("therapistId")) where.therapistId = sp.get("therapistId");
  // De qué CITA (01/09/2026): lo pregunta el modal de la cita para saber si
  // esa cita ya tiene registro —y decir «Seguir con la sesión» en vez de
  // «Preparar sesión»— sin tener que traerse las 22.045 del paciente.
  if (sp.get("bookingId")) where.bookingId = sp.get("bookingId");
  /*
   * Escrito con qué PLANTILLA (04/09/2026, AV-0042 de Aumenta). La ficha del
   * paciente pide las ENTREVISTAS INICIALES aparte, porque ya no viven en la
   * pestaña de sesiones sino con los informes, y ahí no pueden depender de que
   * la sesión esté entre las últimas del listado: la entrevista es el registro
   * más antiguo del paciente, y 50 de los 587 pacientes con historia de Aumenta
   * pasan de 100 sesiones. Filtra por la clave dentro del JSONB
   * (`content_sections->>'plantilla'`), que es donde se guarda.
   */
  const plantilla = (sp.get("plantilla") ?? "").trim();
  if (plantilla) where.contentSections = { [CLAVE_PLANTILLA]: plantilla };
  // De qué DIAGNÓSTICO (12/09/2026): los registros de un expediente. Se acota
  // a UUID porque va a una columna uuid: otra cosa sería un 500 de Postgres.
  const diagnosticoId = (sp.get("diagnosticoId") ?? "").trim();
  if (diagnosticoId) {
    if (!UUID_RE.test(diagnosticoId)) return error("diagnosticoId inválido");
    where.diagnosticoId = diagnosticoId;
  }
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "100", 10) || 100));
  const rows = await ClinicSession.findAll({
    where,
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    order: [["sessionDate", "DESC"]],
    limit,
  });
  /*
   * CÓMO ACABÓ LA CITA de cada registro (02/09/2026, AV-0026 de Aumenta): un
   * borrador preparado para una cita que fue falta no es una sesión por
   * completar, y la ficha del paciente necesita saberlo para no rotularlo
   * «Borrador». Una consulta para toda la lista; `null` en las 22.045 de
   * siempre, que no salen de ninguna cita, y en un tenant sin `citas`.
   */
  const estados = await estadoDeLasCitas({ Booking, sesiones: rows });
  return ok({
    sessions: rows.map((r) => ({ ...serializeSession(r), bookingStatus: estados.get(r.bookingId) ?? null })),
    total: rows.length,
  });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicSession } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.patientId) return error("patientId es obligatorio");
  // Sin firma, firma quien escribe (07/09/2026, AV-0060): la ficha de equipo
  // del usuario que llama. Y con firma, que sea del centro (el PATCH ya lo
  // exigía; el POST no).
  let therapistId = typeof body?.therapistId === "string" && body.therapistId.trim() ? body.therapistId.trim() : null;
  if (!therapistId) therapistId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  if (!therapistId) return error("therapistId es obligatorio");
  if (ctx.tenantModels.TeamMember) {
    const existe = await ctx.tenantModels.TeamMember.findByPk(therapistId, { attributes: ["id"] });
    if (!existe) return error("Ese profesional no es del centro");
  }
  const obs = body.observations && typeof body.observations === "object" && !Array.isArray(body.observations) ? body.observations : {};
  const bookingId = typeof body.bookingId === "string" && UUID_RE.test(body.bookingId.trim()) ? body.bookingId.trim() : null;
  // El expediente de diagnóstico, si lo hay: lo decide el servidor (arriba).
  const diagnostico = await diagnosticoDelRegistro(ctx.tenantModels, { patientId: body.patientId, bookingId, pedido: body.diagnosticoId });
  if (diagnostico.error) return error(diagnostico.error, 422);
  const payload = {
    patientId: body.patientId,
    therapistId,
    sessionDate: body.sessionDate ? new Date(body.sessionDate) : new Date(),
    duration: body.duration != null && body.duration !== "" ? Number(body.duration) : null,
    objectives: Array.isArray(body.objectives) ? body.objectives : [],
    activities: body.activities?.trim() || null,
    performance: body.performance?.trim() || null,
    observations: {
      familyComments: obs.familyComments ?? "",
      nextSessionNotes: obs.nextSessionNotes ?? "",
      homeworkTasks: obs.homeworkTasks ?? "",
      incidents: obs.incidents ?? "",
    },
    // Campos del flujo de audio→IA (opcionales): transcripción, estructura cruda,
    // duración del audio y cuándo la IA terminó de procesar.
    aiTranscription: typeof body.aiTranscription === "string" && body.aiTranscription.trim() ? body.aiTranscription.trim() : null,
    aiStructured: body.aiStructured && typeof body.aiStructured === "object" ? body.aiStructured : null,
    audioDurationSec: body.audioDurationSec != null && body.audioDurationSec !== "" ? Number(body.audioDurationSec) : null,
    aiReviewedAt: body.aiReviewedAt ? new Date(body.aiReviewedAt) : null,
    // Registro en 3 partes (sprint Aumenta 2026-07): la preparación previa y la
    // devolución de la familia son OPCIONALES; los adjuntos de preparación
    // llegan aparte (necesitan que la sesión ya exista) por
    // /api/clinica/sessions/[id]/prep-files.
    prepText: typeof body.prepText === "string" && body.prepText.trim() ? body.prepText.trim() : null,
    parentFeedback:
      typeof body.parentFeedback === "string" && body.parentFeedback.trim() ? body.parentFeedback.trim() : null,
    // Notas internas (29/08/2026, Aumenta): solo para el equipo, nunca salen al
    // informe ni al portal de la familia.
    internalNotes:
      typeof body.internalNotes === "string" && body.internalNotes.trim() ? body.internalNotes.trim() : null,
    // Apartados del registro (29/08/2026): la foto de con qué apartados se
    // escribió y el cuerpo de los que no son de fábrica. Los de siempre siguen
    // llegando por sus campos de arriba — el formulario los reparte con
    // `repartirValoresDeSesion`, así que este cuerpo es el de siempre MÁS esto.
    contentSections: limpiarContentSections(body.contentSections),
    // De qué CITA sale este registro (01/09/2026). Sin FK a `bookings`: borrar
    // una cita del calendario no puede llevarse por delante la nota clínica de
    // la sesión que sí se dio. Null cuando la sesión se escribe desde la ficha
    // del paciente, que es lo normal en las 22.045 de Aumenta.
    bookingId,
    // De qué DIAGNÓSTICO es este registro (12/09/2026, segunda entrega): el
    // de la cita, o el del cuerpo comprobado contra el paciente
    // (`diagnosticoDelRegistro`). Null en los registros de siempre.
    diagnosticoId: diagnostico.diagnosticoId,
    // El título de la entrada del expediente («Sesión de diagnóstico 3»,
    // «Pruebas WISC-V»): libre, hasta 160; vacío se guarda como null y el
    // expediente enseña el de por defecto con su número.
    titulo: limpiarTitulo(body.titulo),
    status: STATUSES.includes(body.status) ? body.status : "registered",
    // Cliente/pagador del paciente (foto al crear la sesión).
    clientId: await clientIdOfPatient(ctx.tenantModels, body.patientId),
  };
  const s = await ClinicSession.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.session.created",
    entity: "ClinicSession",
    entityId: s.id,
    after: auditSummary(s),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeSession(s));
});
