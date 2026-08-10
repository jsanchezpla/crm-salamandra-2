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
    // El corte va por el módulo de DESTINO —Facturación—, que es de quien
    // son estos datos. Antes ponía `!hasModule("team") && !hasModule("billing")`:
    // una Y que, con Equipo encendido, no cortaba nunca. Y como el alta de un
    // cliente hace sync() de TODOS los modelos, las tablas de facturas y
    // gastos existen en cualquier schema, así que el resumen contestaba 200
    // con ceros: a Laura (nutri_laura, con Equipo y sin Facturación) le salía
    // en la ficha de su gente un bloque «Facturación 0,00 €» de un módulo que
    // no ha comprado. El vecino /api/team/[id]/projects ya estaba bien hecho y
    // sirve de patrón: gatea solo por el módulo de destino.
    //
    // No se exige ADEMÁS `team` a propósito: el bloque solo lo pinta la
    // pantalla de Equipo, que ya está detrás de su módulo (GET /api/team lo
    // exige para poder listar a nadie), y el mismo resumen por persona se
    // sirve en /api/billing/analytics/employees pidiendo solo `billing`.
    // Pedirlos los dos no cerraría ninguna puerta nueva y dejaría dos reglas
    // distintas para el mismo dato.
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
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
