import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import {
  UUID_RE,
  planTreeInclude,
  loadPlanTree,
  deepCopyPlanTree,
  sortPlanTree,
  attachRecipesToTree,
} from "../../../../../../lib/nutricion/plans.js";

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "Plan", entityId, before, after, ip,
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[id]/reapply-template — Sprint Recetario C4
//
// Re-aplica la plantilla origen sobre un plan asignado:
//   1) Archiva el plan asignado actual (archived_at = now()).
//   2) Deep-copy de la plantilla origen → nuevo plan type='assigned' con el
//      MISMO client_id y MISMO template_id, nuevo assigned_at.
//
// Reglas:
//   - El plan en el path debe existir, NO estar archivado y ser type='assigned'.
//   - La plantilla origen debe existir y NO estar archivada.
//   - NO bloquea por anti-duplicado (de hecho archivamos el "viejo" antes de
//     crear el nuevo, así que el INSERT del nuevo no choca con el plan vivo
//     anterior).
//
// Audit: action='nutricion.plan.reapplied' con metadata { oldPlanId, newPlanId }.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    // ── Validaciones del plan asignado ───────────────────────────────────────
    const assigned = await Plan.findByPk(id);
    if (!assigned || assigned.archivedAt) {
      return notFound("Plan no encontrado");
    }
    if (assigned.type !== "assigned") {
      return error("Solo se puede re-aplicar sobre planes asignados", 400);
    }
    if (!assigned.templateId) {
      return error("Este plan asignado no tiene plantilla origen registrada", 400);
    }

    // ── Validaciones de la plantilla origen ──────────────────────────────────
    const template = await Plan.findByPk(assigned.templateId, {
      include: planTreeInclude(tenantModels),
    });
    if (!template || template.archivedAt) {
      // 409 porque el conflicto es de estado (plantilla archivada), no de
      // recurso ausente.
      return error("La plantilla origen está archivada o no existe", 409);
    }
    if (template.type !== "template") {
      // Defensivo: si por alguna razón el templateId apunta a otra cosa.
      return error("La plantilla origen no es de tipo 'template'", 409);
    }

    const clientId = assigned.clientId;
    const templateId = assigned.templateId;

    // Nombre del paciente, como respaldo para bautizar el plan nuevo si el
    // anterior no llevaba el separador esperado. Best-effort: si el cliente ya
    // no existe, el nombre cae a "actualizado".
    const { Client } = tenantModels;
    const client = Client && clientId ? await Client.findByPk(clientId, { attributes: ["id", "name"] }) : null;

    // ── Transacción: archive viejo + crear nuevo + deep-copy ─────────────────
    const result = await tenantSequelize.transaction(async (t) => {
      const oldBefore = assigned.toJSON();
      await assigned.update({ archivedAt: new Date() }, { transaction: t });

      // El nombre conserva al paciente. OJO: assign crea los nombres con EM
      // DASH ("Plantilla — Paciente", U+2014) y esto los partía por guión
      // normal " - ", que NUNCA casaba: cada re-aplicación bautizaba el plan
      // como "Plantilla - actualizado" y perdía el nombre del paciente.
      // Se parte por el mismo separador con el que se construyen, y si aun así
      // no casa se usa el nombre real del cliente en vez de "actualizado".
      const SEP = " — ";
      const suffix = oldBefore?.name?.includes(SEP)
        ? oldBefore.name.split(SEP).slice(1).join(SEP)
        : client?.name || "actualizado";

      const newPlan = await Plan.create(
        {
          name: `${template.name}${SEP}${suffix}`,
          description: template.description,
          // Comentarios por día: viajan desde la plantilla como en /assign.
          dayComments: template.dayComments || {},
          showMacros: Boolean(template.showMacros),
          type: "assigned",
          templateId,
          clientId,
          visibleToClient: template.visibleToClient,
          assignedAt: new Date(),
        },
        { transaction: t }
      );

      const sortedSrc = sortPlanTree(template.toJSON());
      await attachRecipesToTree(tenantModels, sortedSrc);
      await deepCopyPlanTree({
        models: tenantModels,
        srcMeals: sortedSrc.meals,
        destPlanId: newPlan.id,
        transaction: t,
      });

      return { oldPlanId: assigned.id, newPlanId: newPlan.id, oldBefore };
    });

    const tree = await loadPlanTree(Plan, tenantModels, result.newPlanId);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.reapplied",
      entityId: result.newPlanId,
      before: { oldPlanId: result.oldPlanId, templateId },
      after: { newPlanId: result.newPlanId, clientId },
      ip,
    });

    return created(tree);
  } catch (err) {
    return serverError(err);
  }
});
