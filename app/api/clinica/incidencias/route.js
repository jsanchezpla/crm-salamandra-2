import { Op, fn, col } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { madridToday } from "../../../../lib/utils/madridDate.js";
import { veTodasLasIncidencias, whereIncidenciasVisibles } from "../../../../lib/clinica/alcanceIncidencias.js";
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

const INCLUDES = (M) => [
  { model: M.Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
  { model: M.TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
  { model: M.TeamMember, as: "reportedBy", attributes: ["id", "displayName", "avatarColor"], required: false },
  // Multi-responsable (sprint 2026-07-29): una incidencia puede tener varias
  // personas al cargo. `assignedTo` se conserva como espejo del primero para
  // no romper los filtros y las vistas que ya lo usan.
  {
    model: M.TeamMember, as: "assignees",
    attributes: ["id", "displayName", "avatarColor"],
    through: { attributes: [] },
    required: false,
  },
];

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

  const where = {};
  const status = sp.get("status");
  if (status && isValidStatus(status)) where.status = status;
  /*
   * ── LA PESTAÑA «FALTAS» (03/09/2026, AV-0038 de Aumenta) ─────────────────
   * Las incidencias que abre sola la agenda al marcar una falta llevan
   * `falta` (lib/clinica/faltas.js) y viven en su pestaña: `?faltas=1` las
   * devuelve SOLO a ellas, y sin el parámetro las de siempre las excluyen.
   * Dos listas, no una con etiqueta: es lo que pidió Olga («un apartado
   * distinto de incidencias por las faltas»).
   */
  const soloFaltas = sp.get("faltas") === "1";
  where.falta = soloFaltas ? { [Op.ne]: null } : null;
  const category = sp.get("category");
  if (category && isValidCategory(category)) where.category = category;
  const patientId = sp.get("patientId");
  if (patientId && UUID_RE.test(patientId)) where.patientId = patientId;

  /*
   * BUSCAR POR TEXTO (02/09/2026, AV-0011 de Aumenta): «encontrar una por
   * asunto, paciente o cualquier palabra, sin leerlas todas». 34 incidencias
   * en dos días, y las faltas automáticas la hacen crecer sola.
   *
   * La misma regla que el buscador de Clientes y el de facturas —todas las
   * palabras, cada una en cualquier campo, sin importar tildes—, sobre el
   * asunto y la descripción, O el nombre del paciente (por su tabla, como
   * hacen las facturas). Entra como AND para no pisar los demás filtros.
   */
  const q = (sp.get("q") || "").trim();
  if (q) {
    const porTexto = await filtroPorNombre(Incidencia.sequelize, q, ["Incidencia.title", "Incidencia.description"]);
    const alternativas = porTexto ? [porTexto] : [];
    if (M.Patient) {
      // Best-effort, como en lib/clients/familiasPorPaciente.js: un centro sin
      // tabla de pacientes (42P01) sigue buscando por asunto y descripción.
      try {
        const porPaciente = await filtroPorNombre(M.Patient.sequelize, q, ["Patient.first_name", "Patient.last_name"]);
        if (porPaciente) {
          const pacientes = await M.Patient.findAll({ where: porPaciente, attributes: ["id"], limit: 300, raw: true });
          if (pacientes.length) alternativas.push({ patientId: { [Op.in]: pacientes.map((p) => p.id) } });
        }
      } catch (e) {
        if (e?.original?.code !== "42P01" && e?.parent?.code !== "42P01") throw e;
      }
    }
    if (alternativas.length) (where[Op.and] ||= []).push(alternativas.length === 1 ? alternativas[0] : { [Op.or]: alternativas });
  }

  // Quién la registró (31/08/2026, Rodrigo): la pareja del filtro de
  // responsable — «las que he mandado yo u otra persona a una persona
  // concreta» son los dos filtros combinados. Este es columna directa: a
  // diferencia del responsable, quien registra es siempre UNO.
  const reportedById = sp.get("reportedById");
  if (reportedById && UUID_RE.test(reportedById)) where.reportedById = reportedById;

  /*
   * Quien mira, para que la pantalla pueda abrirse en LAS MIAS (01/09/2026,
   * Rodrigo: «que de forma predeterminada salgan las que me atanen a mi»). Se
   * devuelve abajo, en `yoSoy`, porque el navegador no tiene forma de saber que
   * miembro del equipo es: /api/auth/me da el usuario, no la ficha de equipo.
   */
  const yoSoy = await resolveCurrentTeamMemberId(request, M);

  // ── Quién ve qué (02/09/2026, Aumenta AV-0018) ────────────────────────────
  // Dirección ve todas; el resto, solo las que registró o tiene asignadas. La
  // regla vive en `lib/clinica/alcanceIncidencias.js` y entra como AND para no
  // pisar el `where.id` que ponen los filtros de abajo. Para quien no es
  // dirección, `mine=1` sobra: su alcance YA es «las mías».
  const esAdmin = veTodasLasIncidencias(ctx);
  if (!esAdmin) (where[Op.and] ||= []).push(await whereIncidenciasVisibles(M, yoSoy));

  let assignedToId = sp.get("assignedToId");
  if (sp.get("mine") === "1" && esAdmin) {
    /*
     * Sin ficha de equipo —direccion, o quien entra con un usuario que no esta
     * en la plantilla— «las mias» no significa nada, y antes esto ponia un id
     * imposible que devolvia CERO incidencias: la pantalla se abria vacia y
     * parecia que no habia ninguna. Ahora, en ese caso, no se filtra.
     */
    assignedToId = yoSoy || null;
  }
  if (assignedToId && UUID_RE.test(assignedToId)) {
    // Filtra por la tabla PIVOTE, no por `assignedToId`: ese campo solo guarda
    // al responsable PRINCIPAL, así que quien fuera segundo responsable no veía
    // la incidencia en "mis incidencias" — justo lo que el multi-responsable
    // venía a resolver. La migración rellenó la pivote con los responsables
    // antiguos, así que las incidencias de siempre siguen saliendo.
    if (M.IncidenciaAssignee) {
      const enlaces = await M.IncidenciaAssignee.findAll({
        where: { teamMemberId: assignedToId },
        attributes: ["incidenciaId"],
      });
      where.id = { [Op.in]: enlaces.map((e) => e.incidenciaId) };
    } else {
      where.assignedToId = assignedToId; // tenant sin migrar
    }
  }

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

  return ok({
    incidencias: rows.map((r) => ({ ...serializeIncidencia(r), docsCount: docCounts[r.id] ?? 0 })),
    counts,
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
