import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/columns/[columnId]/reorder-tasks
//
// Reordena las tareas de UNA columna en UNA transacción. Patrón estilo
// nutricion C5 (/plans/[id]/meals/reorder): el body lleva la columna completa
// como `[{ id, order }, ...]` con `order` = 0..N-1 sin huecos.
//
// Body:
//   { "order": [ { "id": "<taskUuid>", "order": 0 }, ... ] }
//
// Razones de patrón:
//   - Defensivo: detecta huecos, duplicados, IDs externos al proyecto.
//   - Consistente con sprint Recetario C5 nutricion.
//   - Atómica: 1 sola operación con TODA la columna actualizada.
//   - Para hasta 100 tareas por columna no impacta perf vs el alternativo
//     `taskIds: [...]` y nos da validación gap-free.
//
// Estrategia 2 pasadas (defensiva contra futuros UNIQUE(project_id,
// board_column_id, order)):
//   1) UPDATE order = -1 - i
//   2) UPDATE order = target_order final
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Project, Task, BoardColumn } = tenantModels;
  const { id: projectId, columnId } = await params;

  if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");
  if (!UUID_RE.test(columnId)) throw new ValidationError("columnId inválido");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const isLead = isAdmin
    ? true
    : await isLeadOfProject({ projectId, userId, tenantModels });
  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Solo administradores o el lead del proyecto pueden reordenar tareas");
  }

  const project = await Project.findByPk(projectId, { attributes: ["id"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const column = await BoardColumn.findOne({
    where: { id: columnId, projectId },
    attributes: ["id"],
  });
  if (!column) throw new NotFoundError("Columna no encontrada en este proyecto");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  if (!body || !Array.isArray(body.order)) {
    throw new ValidationError("order requerido (array de { id, order })");
  }

  // ── Validación del array ─────────────────────────────────────────────────
  const seenIds = new Set();
  const seenOrders = new Set();
  const requested = [];

  for (let i = 0; i < body.order.length; i++) {
    const row = body.order[i];
    if (!row || typeof row !== "object") {
      throw new ValidationError(`order[${i}] inválido`);
    }
    if (typeof row.id !== "string" || !UUID_RE.test(row.id)) {
      throw new ValidationError(`order[${i}].id inválido`);
    }
    if (seenIds.has(row.id)) {
      throw new ValidationError(`order[${i}].id duplicado en el body`);
    }
    seenIds.add(row.id);
    const n = Number(row.order);
    if (!Number.isInteger(n) || n < 0) {
      throw new ValidationError(`order[${i}].order inválido (entero ≥ 0)`);
    }
    if (seenOrders.has(n)) {
      throw new ValidationError(`order[${i}].order duplicado (${n})`);
    }
    seenOrders.add(n);
    requested.push({ id: row.id, order: n });
  }

  const N = requested.length;
  for (let k = 0; k < N; k++) {
    if (!seenOrders.has(k)) {
      throw new ValidationError(
        `order debe ser una secuencia 0..${N - 1} sin huecos (falta ${k})`
      );
    }
  }

  // ── Validación contra BD ─────────────────────────────────────────────────
  // Debe contener EXACTAMENTE las tareas de esa columna del proyecto.
  const tasksInCol = await Task.findAll({
    where: { projectId, boardColumnId: columnId },
    attributes: ["id", "order"],
    raw: true,
  });
  if (tasksInCol.length !== N) {
    throw new ValidationError(
      `El array debe contener TODAS las tareas de la columna (${tasksInCol.length} en BD, ${N} en el body)`
    );
  }
  const colIds = new Set(tasksInCol.map((t) => t.id));
  for (const r of requested) {
    if (!colIds.has(r.id)) {
      throw new ValidationError(`La tarea ${r.id} no pertenece a esta columna`);
    }
  }

  const before = tasksInCol
    .map((t) => ({ id: t.id, order: t.order }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  await tenantSequelize.transaction(async (t) => {
    // Pasada 1: order = -1 - i (libera el rango destino).
    for (let i = 0; i < requested.length; i++) {
      await Task.update(
        { order: -1 - i },
        { where: { id: requested[i].id, projectId, boardColumnId: columnId }, transaction: t }
      );
    }
    // Pasada 2: order = target.
    for (const r of requested) {
      await Task.update(
        { order: r.order },
        { where: { id: r.id, projectId, boardColumnId: columnId }, transaction: t }
      );
    }
  });

  const after = (
    await Task.findAll({
      where: { projectId, boardColumnId: columnId },
      attributes: ["id", "title", "order"],
      order: [["order", "ASC"]],
    })
  ).map((t) => t.toJSON());

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.column.tasks_reordered",
    entity: "BoardColumn",
    entityId: columnId,
    before,
    after: after.map((t) => ({ id: t.id, order: t.order })),
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ items: after });
});
