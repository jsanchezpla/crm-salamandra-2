import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import { UUID_RE } from "../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clients/[id]/plans — Sprint nutri-laura Recetario C4
//
// Devuelve todos los planes nutricionales (activos + archivados) asignados a
// este cliente, ordenados por createdAt DESC. Cada item incluye un resumen
// con la plantilla origen y un count rápido de comidas.
//
// Ruta colocada bajo /api/clients/ porque conceptualmente pertenece a la
// vista de cliente; tenant-checks van por la gate `hasModule('nutricion')`.
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Client, Plan, PlanMeal } = tenantModels;

    const client = await Client.findByPk(id);
    if (!client) return notFound("Cliente no encontrado");

    // Eager-load del template origen (nombre) + meals (solo id para contar).
    const plans = await Plan.findAll({
      where: { clientId: id, type: "assigned" },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Plan,
          as: "template",
          required: false,
          attributes: ["id", "name", "archivedAt"],
        },
        {
          model: PlanMeal,
          as: "meals",
          required: false,
          attributes: ["id", "name"],
          separate: false,
        },
      ],
    });

    const items = plans.map((p) => {
      const j = p.toJSON();
      const meals = j.meals || [];
      return {
        id: j.id,
        name: j.name,
        description: j.description,
        visibleToClient: j.visibleToClient,
        assignedAt: j.assignedAt,
        archivedAt: j.archivedAt,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        status: j.archivedAt ? "archived" : "active",
        mealCount: meals.length,
        templateId: j.templateId,
        templateName: j.template?.name ?? null,
        templateArchived: !!j.template?.archivedAt,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return serverError(err);
  }
});
