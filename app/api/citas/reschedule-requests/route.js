import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../lib/utils/apiResponse.js";
import { serializeChangeRequest } from "../../../../lib/citas/rescheduleRequests.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["pending", "approved", "rejected", "all"]);

// GET /api/citas/reschedule-requests?status=pending — solicitudes de cambio de
// cita para el centro (admin). Devuelve la lista + el nº de pendientes (badge).
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const role = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo el centro (admin) ve las solicitudes");

    const { BookingChangeRequest } = ctx.tenantModels;
    if (!BookingChangeRequest) return ok({ requests: [], pendingCount: 0 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    if (!VALID_STATUS.has(status)) return error("status inválido");

    const where = status === "all" ? {} : { status };
    const rows = await BookingChangeRequest.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 100,
    });
    const pendingCount = await BookingChangeRequest.count({ where: { status: "pending" } });

    return ok({ requests: rows.map(serializeChangeRequest), pendingCount });
  } catch (err) {
    return serverError(err);
  }
});
