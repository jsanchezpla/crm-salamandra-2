import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import {
  serializeIncidencia,
  isValidCategory,
  isValidStatus,
  isValidPriority,
} from "../../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const INCLUDES = (M) => [
  { model: M.Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
  { model: M.TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
  { model: M.TeamMember, as: "reportedBy", attributes: ["id", "displayName", "avatarColor"], required: false },
];

export const GET = withTenant(async (_request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const M = ctx.tenantModels;
  const row = await M.Incidencia.findByPk(id, { include: INCLUDES(M) });
  if (!row) return notFound("Incidencia no encontrada");
  return ok(serializeIncidencia(row));
});

/**
 * PATCH /api/clinica/incidencias/[id]
 *   { title, description, category, subcategory, priority, incidenceDate,
 *     patientId, assignedToId }   editar campos
 *   { status: "in_progress" | "resolved" | "pending", resolution? }   cambiar estado
 *   { comment: "texto" }          añadir comentario al hilo
 */
export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const M = ctx.tenantModels;
  const { Incidencia, Patient, TeamMember } = M;
  const row = await Incidencia.findByPk(id);
  if (!row) return notFound("Incidencia no encontrada");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const changes = {};

  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) return error("El título no puede quedar vacío");
    changes.title = t.slice(0, 200);
  }
  if (body.description !== undefined) changes.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) return error("Categoría inválida");
    changes.category = body.category;
  }
  if (body.subcategory !== undefined) changes.subcategory = body.subcategory ? String(body.subcategory).slice(0, 120) : null;
  if (body.priority !== undefined) {
    if (!isValidPriority(body.priority)) return error("Prioridad inválida");
    changes.priority = body.priority;
  }
  if (body.incidenceDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.incidenceDate)) {
    changes.incidenceDate = body.incidenceDate;
  }
  if (body.assignedToId !== undefined) {
    changes.assignedToId = body.assignedToId && UUID_RE.test(body.assignedToId) ? body.assignedToId : null;
  }
  if (body.patientId !== undefined) {
    const pid = body.patientId && UUID_RE.test(body.patientId) ? body.patientId : null;
    changes.patientId = pid;
    // Recomputar la foto del cliente.
    if (pid) {
      const p = await Patient.findByPk(pid, { attributes: ["id", "clientId"] });
      changes.clientId = p?.clientId ?? null;
    } else {
      changes.clientId = null;
    }
  }

  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) return error("Estado inválido");
    changes.status = body.status;
    if (body.status === "resolved") {
      changes.resolvedAt = new Date();
      if (body.resolution !== undefined) changes.resolution = body.resolution ? String(body.resolution).slice(0, 5000) : null;
    } else {
      changes.resolvedAt = null;
    }
  }

  let commentEntry = null;
  if (body.comment !== undefined) {
    const text = String(body.comment).trim();
    if (text) {
      const tmId = await resolveCurrentTeamMemberId(request, M);
      let authorName = request.headers.get("x-user-email") || "—";
      if (tmId) {
        const tm = await TeamMember.findByPk(tmId, { attributes: ["displayName"] });
        if (tm?.displayName) authorName = tm.displayName;
      }
      commentEntry = { authorId: tmId || null, authorName, text: text.slice(0, 3000), at: new Date().toISOString() };
    }
  }

  if (Object.keys(changes).length === 0 && !commentEntry) return error("Nada que cambiar", 422);

  if (Object.keys(changes).length > 0) await row.update(changes);
  if (commentEntry) {
    // Append ATÓMICO en PostgreSQL: dos comentarios simultáneos se concatenan
    // en vez de pisarse (leer-modificar-escribir perdería uno de los dos).
    // ctx.slug está validado por el resolver ([a-z0-9_]) — sin inyección.
    await ctx.tenantSequelize.query(
      `UPDATE "crm_${ctx.slug}"."incidencias"
          SET comments = comments || :entry::jsonb, updated_at = now()
        WHERE id = :id`,
      { replacements: { entry: JSON.stringify([commentEntry]), id } }
    );
  }
  const full = await Incidencia.findByPk(id, { include: INCLUDES(M) });
  return ok(serializeIncidencia(full));
});

// DELETE — borrado físico. Solo dirección.
export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede eliminar incidencias");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const row = await ctx.tenantModels.Incidencia.findByPk(id);
  if (!row) return notFound("Incidencia no encontrada");
  await row.destroy();
  return ok({ deleted: id });
});
