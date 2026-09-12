/**
 * lib/projects/moverTarjeta.js — mover una tarjeta del Kanban a otra columna
 * y/o posición (12/09/2026, extraído de app/api/tasks/[id]/move/route.js).
 *
 * (Fichero nuevo en /lib, regla #2: esta lógica vivía ENTERA dentro del route
 * del tenant y ahora la necesita también el calendario global, que mueve
 * tarjetas de los proyectos de cualquier cliente desde otro host. Copiarla
 * habría dejado dos maneras de reordenar una columna que acabarían diciendo
 * cosas distintas; así las dos puertas pasan por el mismo sitio.)
 *
 * ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
 * Valida el destino (columna del MISMO proyecto, posición dentro de rango) y
 * reordena en una transacción:
 *   - Si cambia de columna: en la columna ORIGEN, todas las tareas con
 *     order > task.order pasan a order - 1.
 *   - En la columna DESTINO, todas las tareas con order >= targetOrder
 *     pasan a order + 1 (excluyendo a la propia si permanece en la columna).
 *   - Finalmente: task.boardColumnId = target, task.order = targetOrder.
 *
 * NO decide quién puede mover (el route del tenant mira admin o lead; el global,
 * la cuenta de Salamandra) ni audita: eso lo hace quien llama, cada uno con su
 * `userId` y su `desde`. Los mensajes y los códigos de error son EXACTAMENTE los
 * que daba el route, para que el tenant no note el cambio.
 *
 * Importa `errorTypes.js`, no `errors.js`: lo carga el global, cuya prueba
 * ligera no puede arrastrar `next/server`.
 *
 * ── TRANSACCIÓN DE FUERA (12/09/2026) ───────────────────────────────────────
 * El global compacta las posiciones de las dos columnas ANTES de mover (ver
 * `compactarColumna` en lib/calendario-global/proyectos.js). Si eso iba en su
 * propia transacción y luego el movimiento se rechazaba («targetOrder fuera de
 * rango»), el orden del cliente quedaba reescrito por una petición fallida,
 * sin auditoría. Por eso admite `transaction`: si llega, TODO lo de aquí —las
 * lecturas de validación incluidas— va dentro de esa y no se abre otra, y quien
 * llama decide el commit; un rechazo deshace también lo que hizo antes. Si no
 * llega, es exactamente lo de siempre: el route del tenant no la pasa.
 */

import { Op } from "sequelize";
import { ValidationError } from "../utils/errorTypes.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mueve `task` (instancia de Task ya cargada) a `targetBoardColumnId` en la
 * posición `targetOrder`. Actualiza la instancia: al volver, `task.boardColumnId`
 * y `task.order` son los nuevos.
 *
 * `transaction` (opcional): la de quien llama; ver la cabecera.
 *
 * @returns {{ before: { boardColumnId, order }, after: { boardColumnId, order } }}
 */
export async function moverTarjeta({ tenantModels, tenantSequelize, task, targetBoardColumnId, targetOrder, transaction = null }) {
  const { Task, BoardColumn } = tenantModels;
  // Sin transacción de fuera, las lecturas van sin `transaction`, como siempre.
  const enLaDeFuera = transaction ? { transaction } : {};

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
    ...enLaDeFuera,
  });
  if (!targetCol) {
    throw new ValidationError("La columna destino no pertenece a este proyecto");
  }

  // Cuántas tareas hay en la columna destino
  const destCount = await Task.count({
    where: { projectId: task.projectId, boardColumnId: targetBoardColumnId },
    ...enLaDeFuera,
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

  const reordenar = async (t) => {
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
  };

  if (transaction) await reordenar(transaction);
  else await tenantSequelize.transaction(reordenar);

  return {
    before,
    after: { boardColumnId: targetBoardColumnId, order: tgtOrder },
  };
}
