import { NextResponse } from "next/server";
import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import {
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../../lib/db/masterDb.js";
import { UUID_RE } from "../../../../../../../lib/nutricion/plans.js";

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "Plan", entityId, before, after, ip,
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[id]/meals/reorder — Sprint Recetario C5
//
// Reordena las comidas de un plan en UNA transacción. Sustituye los N PATCH
// que el frontend usa hoy en `moveMeal` del PlanEditorModal (C3).
//
// Body:
//   { "order": [ { "id": "uuid", "order": 0 }, { "id": "uuid", "order": 1 }, ... ] }
//
// Reglas (todas pre-flight, antes de tocar BD):
//   - Todos los `id` son UUID y pertenecen al plan.
//   - El array contiene EXACTAMENTE todas las comidas del plan (no se
//     puede omitir ninguna ni añadir extras).
//   - Los `order` son enteros consecutivos desde 0 sin repetidos.
//
// Respuesta:
//   { ok: true, items: [ { id, order }, ... ] }  ordenados por order asc.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId } = await ctx.params;
    if (!UUID_RE.test(planId)) return error("planId inválido");

    const { Plan, PlanMeal } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const plan = await Plan.findByPk(planId);
    if (!plan || plan.archivedAt) return notFound("No encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    if (!body || !Array.isArray(body.order)) {
      return error("order requerido (array de { id, order })");
    }
    if (body.order.length === 0) {
      return error("order vacío");
    }

    // ── Validaciones del array ───────────────────────────────────────────────
    const seenIds = new Set();
    const seenOrders = new Set();
    const requested = [];
    for (let i = 0; i < body.order.length; i++) {
      const row = body.order[i];
      if (!row || typeof row !== "object") {
        return error(`order[${i}] inválido`);
      }
      if (typeof row.id !== "string" || !UUID_RE.test(row.id)) {
        return error(`order[${i}].id inválido`);
      }
      if (seenIds.has(row.id)) {
        return error(`order[${i}].id duplicado en el body`);
      }
      seenIds.add(row.id);
      const n = Number(row.order);
      if (!Number.isInteger(n) || n < 0) {
        return error(`order[${i}].order inválido (entero ≥0)`);
      }
      if (seenOrders.has(n)) {
        return error(`order[${i}].order duplicado en el body (${n})`);
      }
      seenOrders.add(n);
      requested.push({ id: row.id, order: n });
    }

    // Orders deben ser 0..N-1 consecutivos (sin huecos).
    const N = requested.length;
    for (let k = 0; k < N; k++) {
      if (!seenOrders.has(k)) {
        return error(`order debe ser una secuencia 0..${N - 1} sin huecos (falta ${k})`);
      }
    }

    // ── Validación contra el plan ────────────────────────────────────────────
    const meals = await PlanMeal.findAll({
      where: { planId },
      attributes: ["id", "order"],
    });
    if (meals.length !== N) {
      return error(
        `El array debe contener TODAS las comidas (${meals.length} en BD, ${N} en el body)`
      );
    }
    const mealIds = new Set(meals.map((m) => m.id));
    for (const r of requested) {
      if (!mealIds.has(r.id)) {
        return error(`La comida ${r.id} no pertenece al plan`);
      }
    }

    // ── Transacción: UPDATE cada comida ──────────────────────────────────────
    // Estrategia 2 pasadas para evitar choques con un futuro UNIQUE(plan_id,
    // order). 1ª pasada: order = -1 - i para todas. 2ª pasada: order = target.
    // Hoy no hay UNIQUE, pero el doble paso es defensivo y barato.
    const before = meals.map((m) => ({ id: m.id, order: m.order })).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );

    await tenantSequelize.transaction(async (t) => {
      for (let i = 0; i < requested.length; i++) {
        await PlanMeal.update(
          { order: -1 - i },
          { where: { id: requested[i].id, planId }, transaction: t }
        );
      }
      for (const r of requested) {
        await PlanMeal.update(
          { order: r.order },
          { where: { id: r.id, planId }, transaction: t }
        );
      }
    });

    const after = (await PlanMeal.findAll({
      where: { planId },
      attributes: ["id", "name", "order"],
      order: [["order", "ASC"]],
    })).map((m) => m.toJSON());

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.meals.reordered",
      entityId: planId,
      before,
      after: after.map((m) => ({ id: m.id, order: m.order })),
      ip,
    });

    return NextResponse.json({ ok: true, items: after });
  } catch (err) {
    return serverError(err);
  }
});
