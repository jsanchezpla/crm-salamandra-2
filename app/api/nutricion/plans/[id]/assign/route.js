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
// POST /api/nutricion/plans/[id]/assign — asignar plantilla a paciente
// Body: { clientId, nameOverride? }
// Deep-copy plantilla + meals/options/foods → nuevo Plan type='assigned'.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan, Client } = tenantModels;
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

    // UN PACIENTE, UN MENÚ ACTIVO (2026-07-22). Antes el antiduplicado miraba el
    // PAR (plantilla, paciente): asignar una plantilla DISTINTA al mismo
    // paciente colaba y le dejaba dos menús activos a la vez — la nutricionista
    // veía menús viejos que creía sustituidos y no sabía cuál estaba vigente.
    // Ahora el menú nuevo SUSTITUYE al anterior: los activos del paciente se
    // archivan (siguen consultables en el histórico de su ficha, no se borran).
    const previousActive = await Plan.findAll({
      where: { type: "assigned", clientId, archivedAt: null },
    });

    const nameOverride = typeof body.nameOverride === "string" && body.nameOverride.trim()
      ? body.nameOverride.trim()
      : `${template.name} — ${client.name}`;

    const newPlanId = await tenantSequelize.transaction(async (t) => {
      for (const old of previousActive) {
        await old.update({ archivedAt: new Date() }, { transaction: t });
      }
      const newPlan = await Plan.create(
        {
          name: nameOverride,
          description: template.description,
          // Los comentarios por día viajan con la copia: sin esto el paciente
          // recibía el menú sin las notas de cada día de la plantilla.
          dayComments: template.dayComments || {},
          // Si la plantilla decide no enseñar macros, el plan del paciente
          // tampoco: la decisión se toma una vez y viaja con la copia.
          showMacros: Boolean(template.showMacros),
          type: "assigned",
          templateId: id,
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
      return newPlan.id;
    });

    const tree = await loadPlanTree(Plan, tenantModels, newPlanId);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.assigned",
      entityId: newPlanId,
      before: { templateId: id, replacedPlanIds: previousActive.map((p) => p.id) },
      after: { id: newPlanId, clientId, name: nameOverride },
      ip,
    });

    // `replacedCount` deja que la UI avise ("se archivó el menú anterior")
    // en vez de que el cambio ocurra a espaldas de la nutricionista.
    return created({ ...tree, replacedCount: previousActive.length });
  } catch (err) {
    return serverError(err);
  }
});
