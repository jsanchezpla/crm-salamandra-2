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
// POST /api/nutricion/plans/[id]/assign — asignar plantilla a paciente
// Body: { clientId, nameOverride? }
// Deep-copy plantilla + meals/options/foods → nuevo Plan type='assigned'.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan, Client, PlanMeal, PlanMealOption, PlanMealOptionFood } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!UUID_RE.test(clientId)) return error("clientId inválido");

    const client = await Client.findByPk(clientId);
    if (!client) return notFound("Cliente no encontrado");

    const template = await Plan.findByPk(id, { include: planTreeInclude(tenantModels) });
    if (!template || template.archivedAt) return notFound("Plantilla no encontrada");
    if (template.type !== "template") {
      return error("Solo se pueden asignar plantillas", 422);
    }

    // Antiduplicado: si ya hay un plan asignado ACTIVO para este (template, client)
    const existing = await Plan.findOne({
      where: {
        type: "assigned",
        templateId: id,
        clientId,
        archivedAt: null,
      },
    });
    if (existing) {
      return error(
        "Ya hay un plan asignado activo de esta plantilla a este cliente",
        409
      );
    }

    const nameOverride = typeof body.nameOverride === "string" && body.nameOverride.trim()
      ? body.nameOverride.trim()
      : `${template.name} — ${client.name}`;

    const newPlanId = await tenantSequelize.transaction(async (t) => {
      const newPlan = await Plan.create(
        {
          name: nameOverride,
          description: template.description,
          type: "assigned",
          templateId: id,
          clientId,
          visibleToClient: template.visibleToClient,
          assignedAt: new Date(),
        },
        { transaction: t }
      );
      const sortedSrc = sortPlanTree(template.toJSON());
      await deepCopyPlanTree({
        PlanMeal,
        PlanMealOption,
        PlanMealOptionFood,
        srcMeals: sortedSrc.meals,
        destPlanId: newPlan.id,
        transaction: t,
      });
      return newPlan.id;
    });

    const tree = await loadPlanTree(Plan, tenantModels, newPlanId);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.assigned",
      entityId: newPlanId,
      before: { templateId: id },
      after: { id: newPlanId, clientId, name: nameOverride },
      ip,
    });

    return created(tree);
  } catch (err) {
    return serverError(err);
  }
});
