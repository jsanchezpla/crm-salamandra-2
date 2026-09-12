import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";
import { moverTarjeta } from "../../../../../lib/projects/moverTarjeta.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/[id]/move
//
// Body: { targetBoardColumnId, targetOrder }
//
// Mueve una tarea a otra columna y/o posición. La validación del destino y el
// reordenado en transacción viven desde el 12/09/2026 en
// lib/projects/moverTarjeta.js, porque el calendario global también mueve
// tarjetas y tiene que hacerlo igual. Aquí se quedan lo que es del tenant: el
// permiso (admin o lead del proyecto), la auditoría y la respuesta, sin cambios.
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Task } = tenantModels;
  const { id } = await params;

  if (!UUID_RE.test(id)) throw new ValidationError("id inválido");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);

  const task = await Task.findByPk(id);
  if (!task) throw new NotFoundError("Tarea no encontrada");

  const isLead = isAdmin
    ? true
    : await isLeadOfProject({ projectId: task.projectId, userId, tenantModels });
  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Solo administradores o el lead del proyecto pueden mover tareas");
  }

  const body = (await request.json()) ?? {};
  const { targetBoardColumnId, targetOrder } = body;

  const { before, after } = await moverTarjeta({
    tenantModels,
    tenantSequelize,
    task,
    targetBoardColumnId,
    targetOrder,
  });

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "task.moved",
    entity: "Task",
    entityId: id,
    before,
    after,
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({
    id: task.id,
    boardColumnId: task.boardColumnId,
    order: task.order,
  });
});
