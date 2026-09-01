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
const PATCH_FIELDS = ["sessionDate", "duration", "objectives", "activities", "performance", "observations", "status", "prepText", "parentFeedback", "internalNotes", "contentSections", "aiTranscription", "aiReviewedAt"];

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
