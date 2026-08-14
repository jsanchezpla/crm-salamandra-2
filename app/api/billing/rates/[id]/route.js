import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";


// GET /api/billing/rates/[id]
export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Rate, TeamMember } = tenantModels;
    const { id } = await params;

    const rate = await Rate.findByPk(id, {
      include: [{ model: TeamMember, as: "employee", attributes: ["id", "displayName"] }],
    });

    if (!rate) return notFound("Tarifa no encontrada");
    return ok(rate);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/rates/[id]
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Rate } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const rate = await Rate.findByPk(id);
    if (!rate) return notFound("Tarifa no encontrada");

    const allowed = ["pricePerSession", "packConfig", "validTo"];
    const updates = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await rate.update(updates);
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "rate.updated",
      entity: "Rate",
      entityId: rate.id,
      after: resumen(rate, ["serviceType", "pricePerSession", "validFrom", "validTo"]),
    });
    return ok(rate);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/rates/[id]
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Rate } = tenantModels;
    const { id } = await params;

    const rate = await Rate.findByPk(id);
    if (!rate) return notFound("Tarifa no encontrada");

    const antesBorrar = resumen(rate, ["serviceType", "pricePerSession", "validFrom", "validTo"]);
    const idBorrado = rate.id;
    await rate.destroy();
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "rate.deleted",
      entity: "Rate",
      entityId: idBorrado,
      before: antesBorrar,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
