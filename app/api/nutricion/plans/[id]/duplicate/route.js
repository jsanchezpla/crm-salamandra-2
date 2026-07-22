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
// POST /api/nutricion/plans/[id]/duplicate — deep-copy de una plantilla
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const src = await Plan.findByPk(id, { include: planTreeInclude(tenantModels) });
    if (!src || src.archivedAt) return notFound("Plantilla no encontrada");
    if (src.type !== "template") {
      return error("Solo se pueden duplicar plantillas", 422);
    }

    let body = {};
    try { body = (await request.json()) || {}; } catch { /* body opcional */ }
    const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
    const newName = nameRaw || `${src.name} - Copia`;

    const newPlanId = await tenantSequelize.transaction(async (t) => {
      const newPlan = await Plan.create(
        {
          name: newName,
          description: src.description,
          // Comentarios por día: sin esto, duplicar un menú perdía las notas
          // de cada día de la semana.
          dayComments: src.dayComments || {},
          type: "template",
          visibleToClient: src.visibleToClient,
        },
        { transaction: t }
      );
      // Sort meals/options/foods of the source by `order` antes de copiar
      const sorted = sortPlanTree(src.toJSON());
      await attachRecipesToTree(tenantModels, sorted);
      await deepCopyPlanTree({
        models: tenantModels,
        srcMeals: sorted.meals,
        destPlanId: newPlan.id,
        transaction: t,
      });
      return newPlan.id;
    });

    const tree = await loadPlanTree(Plan, tenantModels, newPlanId);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.duplicated",
      entityId: newPlanId,
      before: { sourcePlanId: id },
      after: { id: newPlanId, name: newName },
      ip,
    });

    return created(tree);
  } catch (err) {
    return serverError(err);
  }
});
