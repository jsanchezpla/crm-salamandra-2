import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import {
  serializeIncidencia,
  isValidCategory,
  isValidStatus,
  isValidPriority,
} from "../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

const INCLUDES = (M) => [
  { model: M.Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
  { model: M.TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
  { model: M.TeamMember, as: "reportedBy", attributes: ["id", "displayName", "avatarColor"], required: false },
];

/**
 * GET /api/clinica/incidencias — lista con filtros.
 * ?status= ?category= ?patientId= ?assignedToId= ?mine=1
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const M = ctx.tenantModels;
  const { Incidencia } = M;
  const sp = new URL(request.url).searchParams;

  const where = {};
  const status = sp.get("status");
  if (status && isValidStatus(status)) where.status = status;
  const category = sp.get("category");
  if (category && isValidCategory(category)) where.category = category;
  const patientId = sp.get("patientId");
  if (patientId && UUID_RE.test(patientId)) where.patientId = patientId;

  let assignedToId = sp.get("assignedToId");
  if (sp.get("mine") === "1") {
    assignedToId = (await resolveCurrentTeamMemberId(request, M)) || "00000000-0000-0000-0000-000000000000";
  }
  if (assignedToId && UUID_RE.test(assignedToId)) where.assignedToId = assignedToId;

  const rows = await Incidencia.findAll({
    where,
    include: INCLUDES(M),
    order: [["incidenceDate", "DESC"], ["createdAt", "DESC"]],
    limit: 500,
  });

  // Conteo por estado (para las pestañas), sin filtro de estado.
  const baseWhere = { ...where };
  delete baseWhere.status;
  const all = await Incidencia.findAll({ where: baseWhere, attributes: ["status"], raw: true });
  const counts = { pending: 0, in_progress: 0, resolved: 0 };
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;

  // Opciones para los selectores del formulario (una sola llamada).
  const therapists = (
    await M.TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"], order: [["displayName", "ASC"]] })
  ).map((t) => ({ id: t.id, name: t.displayName }));
  const patientRows = await M.Patient.findAll({
    attributes: ["id", "firstName", "lastName"],
    order: [["lastName", "ASC"], ["firstName", "ASC"]],
    limit: 1000,
  });
  const patients = patientRows.map((p) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") }));

  return ok({ incidencias: rows.map(serializeIncidencia), counts, therapists, patients });
});

/**
 * POST /api/clinica/incidencias — crear. Cualquier usuario con el módulo puede
 * registrar una incidencia. reportedBy y clientId se autocompletan.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const M = ctx.tenantModels;
  const { Incidencia, Patient } = M;

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const title = String(body.title ?? "").trim();
  if (!title) return error("El título es obligatorio");
  if (!isValidCategory(body.category)) return error("Categoría inválida");

  const priority = isValidPriority(body.priority) ? body.priority : "medium";
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

  const patientId = body.patientId && UUID_RE.test(body.patientId) ? body.patientId : null;
  const assignedToId = body.assignedToId && UUID_RE.test(body.assignedToId) ? body.assignedToId : null;

  // clientId: foto del paciente (si se indica y tiene ficha de cliente).
  let clientId = null;
  if (patientId) {
    const p = await Patient.findByPk(patientId, { attributes: ["id", "clientId"] });
    clientId = p?.clientId ?? null;
  }

  const reportedById = await resolveCurrentTeamMemberId(request, M);

  const created = await Incidencia.create({
    incidenceDate: date,
    title: title.slice(0, 200),
    description: body.description ? String(body.description).slice(0, 5000) : null,
    category: body.category,
    subcategory: body.subcategory ? String(body.subcategory).slice(0, 120) : null,
    priority,
    status: "pending",
    patientId,
    clientId,
    assignedToId,
    reportedById: reportedById || null,
    comments: [],
  });

  const full = await Incidencia.findByPk(created.id, { include: INCLUDES(M) });
  return ok(serializeIncidencia(full));
});
