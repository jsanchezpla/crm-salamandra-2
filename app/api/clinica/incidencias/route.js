import { Op, fn, col } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { madridToday } from "../../../../lib/utils/madridDate.js";
import { veTodasLasIncidencias, whereIncidenciasVisibles } from "../../../../lib/clinica/alcanceIncidencias.js";
import { includesDeIncidencias, whereDeIncidencias } from "../../../../lib/clinica/filtroIncidencias.js";
import {
  serializeIncidencia,
  isValidCategory,
  isValidStatus,
  isValidPriority,
  responsablesDe,
  sincronizarResponsables,
  isValidVerification,
  statusDeVerificacion,
} from "../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

const INCLUDES = includesDeIncidencias;

/**
 * GET /api/clinica/incidencias — lista con filtros.
 * ?status= ?category= ?patientId= ?assignedToId= ?reportedById= ?mine=1
 * Devuelve tambien `yoSoy`: el miembro del equipo que esta mirando (o null).
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  const M = ctx.tenantModels;
  const { Incidencia } = M;
  const sp = new URL(request.url).searchParams;

  // Los filtros y el alcance viven en lib/clinica/filtroIncidencias.js desde el
  // 11/09/2026: son los mismos para la lista y para el Excel (AV-0125).
  const { where, yoSoy, misVistas, verVistas, esAdmin } = await whereDeIncidencias({ request, sp, M, ctx });

  const rows = await Incidencia.findAll({
    where,
    include: INCLUDES(M),
    order: [["incidenceDate", "DESC"], ["createdAt", "DESC"]],
    limit: 500,
  });

  // Conteo por estado (para las pestañas), sin filtro de estado ni de pestaña:
  // las de siempre se cuentan por estado y las faltas aparte (las abiertas,
  // que son las que hay que gestionar).
  const baseWhere = { ...where };
  delete baseWhere.status;
  delete baseWhere.falta;
  const all = await Incidencia.findAll({ where: baseWhere, attributes: ["status", "falta"], raw: true });
  const counts = { pending: 0, in_progress: 0, resolved: 0, faltas: 0 };
  for (const r of all) {
    if (r.falta) {
      if (r.status !== "resolved") counts.faltas += 1;
    } else {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
  }

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

  // Nº de documentos adjuntos por incidencia (para el clip del listado), en
  // una sola consulta agrupada en vez de una por fila.
  const docCounts = {};
  if (M.Document && rows.length) {
    const cuenta = await M.Document.findAll({
      attributes: ["incidenciaId", [fn("COUNT", col("id")), "n"]],
      where: { incidenciaId: rows.map((r) => r.id) },
      group: ["incidencia_id"],
      raw: true,
    });
    for (const c of cuenta) docCounts[c.incidenciaId] = Number(c.n);
  }

  // Quién es responsable de qué, para poder decir en cada línea si el botón de
  // «Visto» le corresponde a quien mira (y si ya lo pulsó). Una consulta para
  // todas las filas, no una por fila.
  const soyResponsableDe = new Set();
  if (M.IncidenciaAssignee && yoSoy && rows.length) {
    const mias = await M.IncidenciaAssignee.findAll({
      where: { teamMemberId: yoSoy, incidenciaId: rows.map((r) => r.id) },
      attributes: ["incidenciaId"],
      raw: true,
    });
    for (const m of mias) soyResponsableDe.add(m.incidenciaId);
  }
  const vistas = new Set(misVistas);

  return ok({
    incidencias: rows.map((r) => ({
      ...serializeIncidencia(r),
      docsCount: docCounts[r.id] ?? 0,
      puedeMarcarVisto: soyResponsableDe.has(r.id),
      visto: vistas.has(r.id),
    })),
    counts,
    // Cuántas ha dado por vistas EN TOTAL (no solo con estos filtros), para
    // poder ofrecer verlas sin que haya que adivinar que existen.
    vistasTotales: misVistas.length,
    verVistas,
    therapists,
    patients,
    // Quien mira, si esta en la plantilla. `null` = no tiene ficha de equipo.
    yoSoy,
    // Para que la pantalla diga si está viendo todas o solo las suyas.
    alcance: esAdmin ? "todas" : "mias",
  });
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
  // Fecha por defecto: HOY en hora española (el servidor corre en UTC).
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : madridToday();

  const patientId = body.patientId && UUID_RE.test(body.patientId) ? body.patientId : null;
  const responsables = responsablesDe(body);
  const assignedToId = responsables[0] ?? null;

  // clientId: foto del paciente (si se indica y tiene ficha de cliente).
  let clientId = null;
  if (patientId) {
    const p = await Patient.findByPk(patientId, { attributes: ["id", "clientId"] });
    clientId = p?.clientId ?? null;
  }

  // Quién la registra: por defecto quien está usando el CRM, pero recepción
  // apunta incidencias que le cuenta otra persona, así que se puede cambiar.
  let reportedById = await resolveCurrentTeamMemberId(request, M);
  if (body.reportedById !== undefined) {
    reportedById = body.reportedById && UUID_RE.test(body.reportedById) ? body.reportedById : null;
  }

  // La verificación manda sobre el estado: ver lib/clinica/incidencias.js.
  const verification = isValidVerification(body.verification) ? body.verification : null;

  const created = await Incidencia.create({
    incidenceDate: date,
    title: title.slice(0, 200),
    description: body.description ? String(body.description).slice(0, 5000) : null,
    category: body.category,
    subcategory: body.subcategory ? String(body.subcategory).slice(0, 120) : null,
    priority,
    status: statusDeVerificacion(verification),
    verification,
    resolution: body.resolution ? String(body.resolution).slice(0, 5000) : null,
    resolvedAt: verification === "resuelta" ? new Date() : null,
    patientId,
    clientId,
    assignedToId,
    reportedById: reportedById || null,
    comments: [],
  });

  await sincronizarResponsables(created, responsables, M);

  const full = await Incidencia.findByPk(created.id, { include: INCLUDES(M) });
  return ok(serializeIncidencia(full));
});
