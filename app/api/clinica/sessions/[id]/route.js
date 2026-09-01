import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeSession } from "../../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../../lib/clinica/audit.js";
import { limpiarContentSections } from "../../../../../lib/clinica/plantillas.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const STATUSES = ["draft", "ai_pending", "registered", "published"];
// `prepText` y `parentFeedback` (registro en 3 partes, sprint Aumenta 2026-07):
// se pueden rellenar DESPUÉS — la preparación se escribe antes de la sesión y
// la devolución de la familia a veces llega días más tarde. Los adjuntos de
// preparación van por su propio endpoint (son ficheros, no texto).
// `internalNotes` (29/08/2026) va por el mismo motivo: lo que el equipo anota
// para sí mismo se escribe y se corrige cuando toca, no solo al crear.
// `aiTranscription` y `aiReviewedAt` (01/09/2026): desde que el botón de la IA
// acepta TEXTO PEGADO, una sesión sin audio puede rellenarse desde el cajón con
// lo que la profesional apuntó en un bloc de notas. Ese texto es de dónde salió
// el registro y merece guardarse —si no, lo que ella escribió y la IA no supo
// colocar se pierde— y la marca de que ahí ha intervenido la IA también.
// `aiTranscription` va con candado abajo: se escribe UNA vez y no se pisa.
// `bookingId` (01/09/2026): de qué CITA es este registro. Se parchea porque las
// sesiones preparadas antes de hoy no pudieron guardarlo, y son justo las que se
// duplicaban: la pantalla las ADOPTA la primera vez que se vuelve a su cita.
// Va con candado abajo, como `aiTranscription`: se escribe UNA vez y no se pisa.
// `therapistId` (01/09/2026, Rodrigo): QUIÉN dio la sesión. «Se ha apuntado un
// registro a nombre de un terapeuta cuando lo había hecho otro y no podemos
// cambiarlo.» Pasa de verdad —una compañera cubre una baja, o la sesión se
// escribe desde la ficha y sale firmada por el terapeuta principal del
// paciente—, y hasta hoy no había forma de corregirlo desde ninguna pantalla.
// Se valida abajo contra el equipo del centro: no basta con que tenga forma de
// id. Queda en el AuditLog con el antes y el después (`therapistId` está en la
// lista blanca de `auditSummary`), que es lo que hace que cambiar la firma de
// una nota clínica no sea un movimiento invisible.
const PATCH_FIELDS = ["sessionDate", "duration", "objectives", "activities", "performance", "observations", "status", "prepText", "parentFeedback", "internalNotes", "contentSections", "aiTranscription", "aiReviewedAt", "bookingId", "therapistId"];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicSession, TeamMember } = ctx.tenantModels;
  const s = await ClinicSession.findByPk(id, {
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
  });
  if (!s) return notFound("Sesión no encontrada");
  return ok(serializeSession(s));
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicSession } = ctx.tenantModels;
  const s = await ClinicSession.findByPk(id);
  if (!s) return notFound("Sesión no encontrada");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if ("status" in body && !STATUSES.includes(body.status)) return error("status inválido");
  const before = auditSummary(s); // solo identificadores: NO datos clínicos al log compartido
  const updates = {};
  for (const k of PATCH_FIELDS) if (k in body) updates[k] = body[k];
  if ("objectives" in updates && !Array.isArray(updates.objectives)) updates.objectives = [];
  // ── El texto del que salió el registro se escribe UNA vez ────────────────
  // Es la prueba de dónde vino una nota clínica: la transcripción de un audio
  // que ya no existe, o lo que se apuntó a mano. Dejar que un PATCH la
  // reescriba sería poder borrar esa prueba desde el navegador, y encima sin
  // que se note. Quien pegue notas nuevas sobre una sesión que ya tenía texto
  // se queda con el suyo; lo que la IA saque de ellas sí entra en el registro.
  if ("aiTranscription" in updates) {
    const yaTiene = String(s.aiTranscription ?? "").trim();
    const nuevo = String(updates.aiTranscription ?? "").trim();
    if (yaTiene || !nuevo) delete updates.aiTranscription;
    else updates.aiTranscription = nuevo;
  }
  // ── La cita de un registro también se escribe UNA vez ───────────────────
  // Reapuntar una sesión a OTRA cita movería una nota clínica de sitio desde
  // el navegador: la sesión del martes pasaría a ser la del jueves y nadie se
  // enteraría. Aquí solo se permite lo que hace falta —adoptar una sesión que
  // todavía no era de ninguna cita— y solo con un id con forma de id.
  if ("bookingId" in updates) {
    const nuevo = String(updates.bookingId ?? "").trim();
    if (String(s.bookingId ?? "").trim() || !UUID_RE.test(nuevo)) delete updates.bookingId;
    else updates.bookingId = nuevo;
  }
  // ── Quién dio la sesión: se cambia, pero solo a alguien del equipo ───────
  // Un id con forma de id no basta: sería poder firmar una nota clínica a
  // nombre de una fila que no existe —o de otro tenant— desde el navegador, y
  // la sesión se quedaría sin nombre en la ficha y en el PDF. Se busca en
  // `team_members` de ESTE schema, que es el aislamiento de verdad.
  //
  // Sí se admite alguien de baja o que ya no está («inactive»): las 4.045
  // sesiones importadas de Aumenta las escribió gente que se fue, y corregir
  // una firma hacia una persona que ya no trabaja allí es exactamente uno de
  // los casos que hay que poder arreglar.
  if ("therapistId" in updates) {
    const nuevo = String(updates.therapistId ?? "").trim();
    if (!UUID_RE.test(nuevo)) return error("therapistId inválido");
    if (nuevo === String(s.therapistId ?? "")) delete updates.therapistId;
    else {
      const { TeamMember } = ctx.tenantModels;
      const existe = await TeamMember.findByPk(nuevo, { attributes: ["id"] });
      if (!existe) return error("Ese profesional no es del centro");
      updates.therapistId = nuevo;
    }
  }
  if ("aiReviewedAt" in updates) {
    const d = updates.aiReviewedAt ? new Date(updates.aiReviewedAt) : null;
    if (!d || Number.isNaN(d.getTime())) delete updates.aiReviewedAt;
    else updates.aiReviewedAt = d;
  }
  // Los apartados vienen de un navegador: se limpian antes de guardarlos.
  if ("contentSections" in updates) updates.contentSections = limpiarContentSections(updates.contentSections);
  if ("sessionDate" in updates && updates.sessionDate) updates.sessionDate = new Date(updates.sessionDate);
  if (Object.keys(updates).length === 0) return ok(serializeSession(s));
  await s.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.session.updated",
    entity: "ClinicSession",
    entityId: id,
    before,
    after: auditSummary(s),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializeSession(s));
});
