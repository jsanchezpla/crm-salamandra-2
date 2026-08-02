import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeCoordination } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const TYPES = ["family", "school", "psychiatrist", "neuropediatrician", "other_therapist", "orientator", "other"];
const SCOPES = ["internal", "external"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El contacto externo con el que se coordinó, comprobando que pertenece a la
 * agenda DE ESE paciente.
 *
 * Sin esa comprobación, mandar el id del contacto de otro niño enlazaría el
 * acta con la orientadora de una familia distinta: una fuga de datos clínicos
 * entre familias, y de las difíciles de ver porque el acta se guardaría sin
 * error. Devuelve null ante cualquier duda; el enlace es opcional.
 */
async function contactoValido(models, patientId, contactoId) {
  if (!contactoId || !patientId) return null;
  if (!UUID_RE.test(String(contactoId)) || !UUID_RE.test(String(patientId))) return null;
  const { ExternalContact } = models;
  if (!ExternalContact) return null;
  const c = await ExternalContact.findOne({
    where: { id: String(contactoId), patientId: String(patientId) },
    attributes: ["id"],
  });
  return c ? c.id : null;
}
function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Coordination, TeamMember, Patient } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const where = {};
  if (sp.get("patientId")) where.relatedPatientId = sp.get("patientId");
  // Filtros del listado general del módulo (sprint 2026-07, punto 7).
  if (TYPES.includes(sp.get("type"))) where.coordinationType = sp.get("type");
  if (SCOPES.includes(sp.get("scope"))) where.scope = sp.get("scope");
  const rows = await Coordination.findAll({
    where,
    include: [
      { model: TeamMember, as: "createdBy", attributes: ["id", "displayName", "position", "avatarColor"] },
      // El paciente puede faltar (una reunión de equipo no es de nadie), por eso
      // `required: false`: con el include obligatorio esas filas desaparecerían.
      { model: Patient, as: "relatedPatient", attributes: ["id", "firstName", "lastName"], required: false },
    ],
    order: [["coordinationDate", "DESC"]],
    limit: 300,
  });
  return ok({ coordinations: rows.map(serializeCoordination), total: rows.length });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Coordination } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!TYPES.includes(body.coordinationType)) return error("coordinationType inválido");
  // `createdById` deja de ser obligatorio (sprint 2026-07, punto 7): la pantalla
  // no tiene por qué saber el id de TeamMember de quien está usando el CRM. Si no
  // viene, se resuelve del usuario de la sesión.
  const createdById = body.createdById || (await resolveCurrentTeamMemberId(request, ctx.tenantModels));
  // Nombre suelto para cuando no hay ficha de equipo a la que apuntar: alguien
  // que ya no está, un profesional de fuera, o un acta traída de otro programa.
  // Antes esto era un 422 y no se podía registrar la reunión de ninguna manera.
  const createdByName = typeof body.createdByName === "string" && body.createdByName.trim()
    ? body.createdByName.trim().slice(0, 200)
    : null;
  if (!createdById && !createdByName) {
    return error("Falta quién registra la coordinación: elige a alguien del equipo o escribe su nombre", 422);
  }
  const payload = {
    coordinationType: body.coordinationType,
    coordinationDate: body.coordinationDate ? new Date(body.coordinationDate) : new Date(),
    participants: toArr(body.participants),
    topics: toArr(body.topics),
    agreements: toArr(body.agreements),
    nextActions: toArr(body.nextActions),
    relatedPatientId: body.relatedPatientId || null,
    createdById: createdById || null,
    createdByName,
    // Interna (entre el propio equipo) o externa (colegio, psiquiatra…). Con
    // externa, `externalEntity` dice con quién: es lo que se busca luego.
    scope: SCOPES.includes(body.scope) ? body.scope : null,
    externalEntity: typeof body.externalEntity === "string" && body.externalEntity.trim() ? body.externalEntity.trim().slice(0, 200) : null,
    // Con quién se coordinó, apuntando a la agenda del paciente. Se valida que
    // el contacto sea DE ESE paciente: enlazar un acta con la orientadora de
    // otro niño sería una fuga de datos entre familias.
    externalContactId: await contactoValido(ctx.tenantModels, body.relatedPatientId, body.externalContactId),
    // Cliente/pagador del paciente relacionado (foto al crear la coordinación).
    clientId: await clientIdOfPatient(ctx.tenantModels, body.relatedPatientId),
  };
  const c = await Coordination.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.coordination.created",
    entity: "Coordination",
    entityId: c.id,
    after: auditSummary(c),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeCoordination(c));
});
