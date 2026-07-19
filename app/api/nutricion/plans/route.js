import { Op } from "sequelize";
import { NextResponse } from "next/server";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import {
  created,
  error,
  forbidden,
  serverError,
} from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";

const MAX_LIMIT = 100;

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity: "Plan",
      entityId,
      before,
      after,
      ip,
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/plans — lista paginada (solo metadata, sin árbol)
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Plan } = tenantModels;
    const { searchParams } = new URL(request.url);

    const type = (searchParams.get("type") ?? "").trim();
    if (type !== "template" && type !== "assigned") {
      return error("type requerido (template | assigned)");
    }

    const q = (searchParams.get("q") ?? "").trim();
    const clientId = (searchParams.get("clientId") ?? "").trim();
    const includeArchived = searchParams.get("includeArchived") === "true";

    let limit = parseInt(searchParams.get("limit") ?? "50", 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 50;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    let page = parseInt(searchParams.get("page") ?? "1", 10);
    if (!Number.isInteger(page) || page <= 0) page = 1;
    const offset = (page - 1) * limit;

    const where = { type };
    if (!includeArchived) where.archivedAt = null;
    if (q) where.name = { [Op.iLike]: `%${q}%` };
    if (type === "assigned" && clientId) where.clientId = clientId;
    // Asignados de una plantilla concreta (panel de asignación del editor de
    // menú): filtrar en BD evita traer los 100 más recientes y filtrar en cliente.
    const templateId = (searchParams.get("templateId") ?? "").trim();
    if (type === "assigned" && templateId) where.templateId = templateId;

    const withSummary = searchParams.get("withSummary") === "true";

    const { Client, PlanMeal, PlanMealOption } = tenantModels;

    const include = [];
    if (withSummary) {
      // Para la tarjeta de plantilla / fila de asignado necesitamos
      // contar meals y options, y mostrar el nombre del cliente o de la
      // plantilla origen. Lo hacemos en este mismo endpoint para no
      // forzar N+1 desde el frontend.
      include.push({
        model: PlanMeal,
        as: "meals",
        required: false,
        attributes: ["id", "name", "order"],
        separate: false,
        include: [
          {
            model: PlanMealOption,
            as: "options",
            required: false,
            attributes: ["id"],
            separate: false,
          },
        ],
      });
      if (type === "assigned") {
        include.push({
          model: Client,
          as: "client",
          required: false,
          attributes: ["id", "name"],
        });
        include.push({
          model: Plan,
          as: "template",
          required: false,
          attributes: ["id", "name"],
        });
      }
    }

    const { rows, count } = await Plan.findAndCountAll({
      where,
      limit,
      offset,
      order: [["updatedAt", "DESC"]],
      include,
      distinct: true,
    });

    let items = rows.map((r) => r.toJSON());

    if (withSummary) {
      // Para plantillas, calcular cuántas asignaciones activas tiene cada una
      // en una sola query agrupada (en vez de N+1).
      let assignmentsByTemplate = new Map();
      if (type === "template" && items.length > 0) {
        const ids = items.map((p) => p.id);
        const assignedRows = await Plan.findAll({
          where: {
            type: "assigned",
            templateId: ids,
            archivedAt: null,
          },
          attributes: ["templateId"],
        });
        for (const r of assignedRows) {
          const k = r.templateId;
          assignmentsByTemplate.set(k, (assignmentsByTemplate.get(k) ?? 0) + 1);
        }
      }

      items = items.map((p) => {
        const meals = (p.meals || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const mealsSummary = meals.map((m) => ({
          id: m.id,
          name: m.name,
          optionCount: (m.options || []).length,
        }));
        const out = {
          ...p,
          mealsSummary,
          mealCount: meals.length,
        };
        delete out.meals;
        if (type === "template") {
          out.activeAssignmentsCount = assignmentsByTemplate.get(p.id) ?? 0;
        } else if (type === "assigned") {
          out.clientName = p.client?.name ?? null;
          out.templateName = p.template?.name ?? null;
        }
        return out;
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans — crear plantilla con las comidas estándar.
//
// Nutrinotas (2026-07-18): un menú nuevo nace con las 5 categorías del día
// (Desayuno, Almuerzo, Comida, Merienda, Cena), cada una con su opción por
// defecto, para que solo haya que meter comidas dentro. Con `skipDefaultMeals:
// true` en el body se crea vacío — lo usan los smoke scripts, que montan su
// propia estructura. (duplicate/assign/reapply NO pasan por este endpoint:
// hacen deep-copy con Plan.create directamente, sin doble sembrado.)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_MEALS = ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena"];

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Plan, PlanMeal, PlanMealOption } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return error("name requerido (mínimo 2 caracteres)");
    const description = body.description === undefined || body.description === null
      ? null
      : String(body.description).slice(0, 10000);

    const row = await tenantSequelize.transaction(async (t) => {
      const plan = await Plan.create(
        {
          name,
          description,
          type: "template",
          visibleToClient: false,
          // templateId, clientId, assignedAt todos NULL → satisface CHECK
        },
        { transaction: t }
      );
      if (body.skipDefaultMeals !== true) {
        for (const [i, mealName] of DEFAULT_MEALS.entries()) {
          const meal = await PlanMeal.create(
            { planId: plan.id, name: mealName, order: i },
            { transaction: t }
          );
          await PlanMealOption.create(
            { mealId: meal.id, name: "Opción 1", order: 0, isDefault: true },
            { transaction: t }
          );
        }
      }
      return plan;
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.created",
      entityId: row.id,
      before: null,
      after: row.toJSON(),
      ip,
    });

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
