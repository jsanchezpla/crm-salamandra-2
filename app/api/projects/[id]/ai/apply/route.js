import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error } from "../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";
import { loadProjectSnapshot, normalizeOperations } from "../../../../../../lib/projects/ai/editOps.js";
import { normalizeChecklistItems } from "../../../../../../lib/projects/checklist.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPS = 100;

/**
 * El paso que faltaba de «Reorganizar con IA».
 *
 * NO ES QUE SE ROMPIERA: no existía en ningún commit. El modal proponía los
 * cambios, dejaba desmarcar los que no interesaban y al pulsar «Aplicar
 * cambios» pedía este endpoint, que devolvía un 404. Lo único escrito era su
 * hermano `/ai/edit`, que genera la propuesta pero no toca nada.
 *
 * Donde más dolía era en la DEMO, que es pública y es el escaparate: allí la
 * propuesta se simula sin clave de IA, así que cualquiera a quien se le
 * estuviera enseñando el CRM llegaba hasta el último botón y se comía el error.
 *
 * ── AQUÍ NO SE LLAMA A LA IA ───────────────────────────────────────────────
 * Ni clave, ni `vetoAi`, ni guard de demo. Este endpoint solo escribe en el
 * schema del tenant lo que una persona acaba de revisar y confirmar: no gasta
 * dinero, no manda correo y no toca master, que es lo que esos guards protegen.
 * Y es justo lo que permite que la demo funcione de punta a punta.
 *
 * ── LO QUE LLEGA DEL NAVEGADOR NO SE CREE ──────────────────────────────────
 * Las operaciones vuelven a pasar por `normalizeOperations` contra un snapshot
 * RECIÉN LEÍDO de la base de datos, no contra el que generó la propuesta. Dos
 * motivos, y el segundo es el importante:
 *
 *   · Entre proponer y aplicar pasa un rato, y alguien puede haber borrado esa
 *     tarea desde otra pestaña. Lo que ya no existe se descarta y se cuenta en
 *     `skipped`, sin reventar.
 *   · El cuerpo lo manda el cliente. Sin re-validar, cualquiera podría inventar
 *     operaciones sobre ids de OTRO proyecto y colarlas por aquí.
 *
 * ── TODO O NADA ────────────────────────────────────────────────────────────
 * Una transacción para las operaciones. Media reorganización aplicada es peor
 * que ninguna: nadie sabría en qué estado quedó el tablero, y deshacerlo a mano
 * es más trabajo que volver a pedirlo.
 *
 * Body:  { operations: [...] }
 * Salida: { applied, skipped, warnings }
 */

/**
 * El orden en que se aplican, que NO es el que llega.
 *
 * `normalizeOperations` valida contra la foto de ANTES, así que puede dar por
 * buena una tarea nueva en una fase que otra operación de la misma tanda borra.
 * Aplicando en este orden eso no puede fallar: las bajas van al final, y borrar
 * una fase deja sus tareas sin fase —incluidas las que se acaban de crear— en
 * vez de chocar con la clave ajena.
 */
const ORDEN = [
  "updateProject",
  "createPhase",
  "updatePhase",
  "addMember",
  "removeMember",
  "createTask",
  "updateTask",
  "deleteTask",
  "deletePhase",
];

const porOrdenDeAplicacion = (ops) =>
  ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => {
      const d = ORDEN.indexOf(a.op.op) - ORDEN.indexOf(b.op.op);
      return d !== 0 ? d : a.i - b.i; // dentro del grupo, el orden del usuario
    })
    .map((x) => x.op);

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();

  const { tenantModels, tenant, tenantSequelize } = ctx;
  const { Project, Phase, Task, TaskAssignee, BoardColumn, ProjectMember } = tenantModels;
  const { id: projectId } = await params;
  if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");

  // Mismo criterio que /ai/edit y que el PATCH del proyecto: admin O lead.
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId, userId, tenantModels }))) {
    throw new ForbiddenError(ADMIN_DENY);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body JSON inválido");
  }
  const pedidas = Array.isArray(body?.operations) ? body.operations : null;
  if (!pedidas) throw new ValidationError("Se esperaba una lista de operaciones");
  if (pedidas.length === 0) throw new ValidationError("No hay ningún cambio que aplicar");
  if (pedidas.length > MAX_OPS) {
    throw new ValidationError(`Demasiados cambios de una vez (máximo ${MAX_OPS})`);
  }

  // Snapshot FRESCO: es la frontera de seguridad, no una optimización.
  const { project, snapshot } = await loadProjectSnapshot({ projectId, tenantModels });
  if (project.archivedAt) throw new ValidationError("Proyecto archivado: no se puede modificar");

  const { operations, warnings } = normalizeOperations(pedidas, snapshot);
  const skipped = pedidas.length - operations.length;
  if (operations.length === 0) {
    return ok({ applied: 0, skipped, warnings });
  }

  // Columna donde caen las tareas nuevas: la primera del tablero. La IA propone
  // tareas sin columna —el snapshot no le pide que elija— y una tarea sin
  // columna no se ve en el Kanban, que es donde se va a mirar el resultado.
  const primeraColumna = await BoardColumn.findOne({
    where: { projectId },
    order: [["order", "ASC"]],
    attributes: ["id"],
  });

  const maxOrden = async (modelo, where) => {
    const fila = await modelo.findOne({
      where,
      attributes: [[tenantSequelize.fn("MAX", tenantSequelize.col("order")), "max"]],
      raw: true,
    });
    return fila?.max ?? -1;
  };

  // Los contadores de `order` se llevan en memoria: dos fases creadas en la
  // misma tanda con el mismo número chocarían con el índice UNIQUE
  // (project_id, order) de `phases`.
  let ordenFase = (await maxOrden(Phase, { projectId })) + 1;
  let ordenTarea = primeraColumna
    ? (await maxOrden(Task, { projectId, boardColumnId: primeraColumna.id })) + 1
    : 0;

  const hechas = { creadas: 0, editadas: 0, borradas: 0 };

  await tenantSequelize.transaction(async (t) => {
    for (const op of porOrdenDeAplicacion(operations)) {
      switch (op.op) {
        case "updateProject":
          await project.update(op.changes, { transaction: t });
          hechas.editadas++;
          break;

        case "createPhase":
          await Phase.create(
            {
              projectId,
              name: op.name,
              description: op.phaseDescription ?? null,
              startDate: op.startDate,
              endDate: op.endDate,
              order: ordenFase++,
            },
            { transaction: t }
          );
          hechas.creadas++;
          break;

        case "updatePhase":
          await Phase.update(op.changes, { where: { id: op.phaseId, projectId }, transaction: t });
          hechas.editadas++;
          break;

        case "deletePhase":
          // Primero se sueltan las tareas y después se borra la fase: la
          // vista previa promete «sus tareas quedan sin fase», no que
          // desaparezcan con ella.
          await Task.update(
            { phaseId: null },
            { where: { projectId, phaseId: op.phaseId }, transaction: t }
          );
          await Phase.destroy({ where: { id: op.phaseId, projectId }, transaction: t });
          hechas.borradas++;
          break;

        case "createTask": {
          const tarea = await Task.create(
            {
              projectId,
              boardColumnId: primeraColumna?.id ?? null,
              phaseId: op.phaseId ?? null,
              order: ordenTarea++,
              title: op.title,
              description: op.taskDescription ?? null,
              priority: op.priority,
              dueDate: op.dueDate,
              estimatedHours: op.estimatedHours,
              checklist: normalizeChecklistItems(op.checklist),
              tags: [],
            },
            { transaction: t }
          );
          if (op.assigneeIds.length > 0) {
            await TaskAssignee.bulkCreate(
              op.assigneeIds.map((tmId) => ({ taskId: tarea.id, teamMemberId: tmId })),
              { transaction: t }
            );
          }
          hechas.creadas++;
          break;
        }

        case "updateTask": {
          const { assigneeIds, ...campos } = op.changes;
          if (Object.keys(campos).length > 0) {
            await Task.update(campos, { where: { id: op.taskId, projectId }, transaction: t });
          }
          if (assigneeIds !== undefined) {
            // Se reemplaza el conjunto entero: `assigneeIds` es la lista final
            // que se enseñó en la vista previa, no un añadido.
            await TaskAssignee.destroy({ where: { taskId: op.taskId }, transaction: t });
            if (assigneeIds.length > 0) {
              await TaskAssignee.bulkCreate(
                assigneeIds.map((tmId) => ({ taskId: op.taskId, teamMemberId: tmId })),
                { transaction: t }
              );
            }
          }
          hechas.editadas++;
          break;
        }

        case "deleteTask":
          await Task.destroy({ where: { id: op.taskId, projectId }, transaction: t });
          hechas.borradas++;
          break;

        case "addMember":
          await ProjectMember.findOrCreate({
            where: { projectId, teamMemberId: op.teamMemberId },
            defaults: { projectId, teamMemberId: op.teamMemberId, role: op.role },
            transaction: t,
          });
          hechas.editadas++;
          break;

        case "removeMember":
          await ProjectMember.destroy({
            where: { projectId, teamMemberId: op.teamMemberId },
            transaction: t,
          });
          hechas.editadas++;
          break;
      }
    }
  });

  // Auditoría: DESPUÉS de la mutación y FUERA de la transacción (escribe en
  // master con otra conexión). Un resumen, no las filas: aquí puede haber
  // nombres de tareas y de personas.
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId: tenant.id,
      userId,
      action: "project.ai_reorganized",
      entity: "Project",
      entityId: projectId,
      before: null,
      after: {
        aplicadas: operations.length,
        descartadas: skipped,
        creadas: hechas.creadas,
        editadas: hechas.editadas,
        borradas: hechas.borradas,
      },
      ip: request.headers.get("x-forwarded-for"),
    });
  } catch {
    /* auditoría best-effort */
  }

  return ok({ applied: operations.length, skipped, warnings });
});
