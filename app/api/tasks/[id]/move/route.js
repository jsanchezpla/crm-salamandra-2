import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";
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
// Mueve una tarea a otra columna y/o posición. Lógica defensiva:
//   - Si cambia de columna: en la columna ORIGEN, todas las tareas con
//     order > task.order pasan a order - 1.
//   - En la columna DESTINO, todas las tareas con order >= targetOrder
//     pasan a order + 1 (excluyendo a la propia si permanece en la columna).
//   - Finalmente: task.boardColumnId = target, task.order = targetOrder.
//
// Todo en una transacción para que no quede inconsistente. La columna destino
// debe pertenecer al MISMO proyecto que la tarea.
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Task, BoardColumn } = tenantModels;
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

  if (!targetBoardColumnId || !UUID_RE.test(targetBoardColumnId)) {
    throw new ValidationError("targetBoardColumnId inválido");
  }
  const tgtOrder = Number(targetOrder);
  if (!Number.isInteger(tgtOrder) || tgtOrder < 0) {
    throw new ValidationError("targetOrder debe ser un entero ≥ 0");
  }

  // Columna destino existe y pertenece al mismo proyecto
  const targetCol = await BoardColumn.findOne({
    where: { id: targetBoardColumnId, projectId: task.projectId },
    attributes: ["id"],
  });
  if (!targetCol) {
    throw new ValidationError("La columna destino no pertenece a este proyecto");
  }

  // Cuántas tareas hay en la columna destino
  const destCount = await Task.count({
    where: { projectId: task.projectId, boardColumnId: targetBoardColumnId },
  });

  // Si la tarea SE QUEDA en la misma columna, el rango válido es [0, destCount-1].
  // Si CAMBIA de columna, el rango válido es [0, destCount] (se inserta al final
  // como destCount).
  const sameColumn = task.boardColumnId === targetBoardColumnId;
  const maxOrder = sameColumn ? Math.max(destCount - 1, 0) : destCount;
  if (tgtOrder > maxOrder) {
    throw new ValidationError(
      `targetOrder fuera de rango (0..${maxOrder} para esta columna)`
    );
  }

  const sourceBoardColumnId = task.boardColumnId;
  const sourceOrder = task.order;

  const before = {
    boardColumnId: sourceBoardColumnId,
    order: sourceOrder,
  };

  await tenantSequelize.transaction(async (t) => {
    if (sameColumn) {
      if (tgtOrder === sourceOrder) {
        // No-op: la tarea ya está en esa posición.
        return;
      }
      if (tgtOrder < sourceOrder) {
        // Subir: [tgt, sourceOrder-1] +1
        await Task.increment("order", {
          by: 1,
          where: {
            projectId: task.projectId,
            boardColumnId: targetBoardColumnId,
            id: { [Op.ne]: task.id },
            order: { [Op.gte]: tgtOrder, [Op.lt]: sourceOrder },
          },
          transaction: t,
        });
      } else {
        // Bajar: (sourceOrder, tgt] -1
        await Task.decrement("order", {
          by: 1,
          where: {
            projectId: task.projectId,
            boardColumnId: targetBoardColumnId,
            id: { [Op.ne]: task.id },
            order: { [Op.gt]: sourceOrder, [Op.lte]: tgtOrder },
          },
          transaction: t,
        });
      }
      await task.update({ order: tgtOrder }, { transaction: t });
    } else {
      // Cambio de columna: compactar origen + abrir hueco en destino + mover.
      if (sourceBoardColumnId != null) {
        await Task.decrement("order", {
          by: 1,
          where: {
            projectId: task.projectId,
            boardColumnId: sourceBoardColumnId,
            id: { [Op.ne]: task.id },
            order: { [Op.gt]: sourceOrder },
          },
          transaction: t,
        });
      }
      await Task.increment("order", {
        by: 1,
        where: {
          projectId: task.projectId,
          boardColumnId: targetBoardColumnId,
          id: { [Op.ne]: task.id },
          order: { [Op.gte]: tgtOrder },
        },
        transaction: t,
      });
      await task.update(
        { boardColumnId: targetBoardColumnId, order: tgtOrder },
        { transaction: t }
      );
    }
  });

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "task.moved",
    entity: "Task",
    entityId: id,
    before,
    after: { boardColumnId: targetBoardColumnId, order: tgtOrder },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({
    id: task.id,
    boardColumnId: task.boardColumnId,
    order: task.order,
  });
});
