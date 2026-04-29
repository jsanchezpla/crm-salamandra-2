import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function computeCostTotals({ taxBase, vatRate }) {
  const base = round2(Number(taxBase ?? 0));
  const rate = round2(Number(vatRate ?? 0));
  const taxAmount = round2(base * (rate / 100));
  const total = round2(base + taxAmount);
  return { taxBase: base, vatRate: rate, taxAmount, total };
}

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Client } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id, {
      include: [
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Client, as: "client", attributes: ["id", "name"] },
      ],
    });
    if (!cost) return notFound("Coste no encontrado");
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Cost } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");

    const body = await request.json();
    const allowed = [
      "type", "category", "description", "incurredAt",
      "employeeId", "clientId", "inventoryProductId",
      "attachmentUrl", "vatDeductible",
    ];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    // Si cambian taxBase o vatRate, recalcular taxAmount y total
    if ("taxBase" in body || "vatRate" in body) {
      const totals = computeCostTotals({
        taxBase: body.taxBase ?? cost.taxBase,
        vatRate: body.vatRate ?? cost.vatRate,
      });
      Object.assign(updates, totals);
    }

    await cost.update(updates);
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { Cost } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");
    await cost.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
