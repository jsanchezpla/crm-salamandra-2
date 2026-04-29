import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getEmployeeBillingSummary } from "../../../../../lib/billing/billingSummary.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/team/[id]/billing-summary?from=&to=
 *
 * Resumen de facturación del empleado. Si el viewer no es admin/superadmin,
 * se omiten monthlySalary y projectedSalaryCost.
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("team") && !hasModule("billing")) return forbidden("Módulo no activo");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? null;
    const to = searchParams.get("to") ?? null;

    const role = request.headers.get("x-user-role");
    const isAdmin = ADMIN_ROLES.has(role);

    const data = await getEmployeeBillingSummary({ tenantModels, employeeId: id, from, to });
    if (!isAdmin && data.employee) {
      delete data.employee.monthlySalary;
      delete data.projectedSalaryCost;
    }
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
