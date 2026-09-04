import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { componerServicios } from "../../../../lib/productos/servicios.js";

/**
 * GET /api/productos/servicios[?mes=AAAA-MM]
 *
 * Los SERVICIOS del centro: una fila por cuota del catálogo con qué tipos de
 * cita la cubren, cuántos pacientes están apuntados, cuántas citas la llevan
 * ese mes y cuánto suma. Es la pestaña «Servicios» de Productos (04/09/2026,
 * Aumenta por Rodrigo).
 *
 * Solo dirección: son las tarifas y los ingresos de todo el centro, el mismo
 * criterio que las estadísticas de venta y que los importes de la agenda.
 *
 * Un centro sin `billing` no tiene catálogo de cuotas: se devuelve
 * `disponible: false` y la pantalla no enseña la pestaña, en vez de un 403 que
 * habría que interpretar.
 */
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const { tenantModels, hasModule, tenantHasModule } = ctx;
    if (!hasModule("productos")) return forbidden("Módulo Productos no activo");
    if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) {
      return forbidden("Solo dirección ve los servicios y sus importes");
    }
    if (!tenantHasModule("billing")) return ok({ disponible: false, servicios: [], sinCuota: [], totales: null });

    const { BillingConcept, Cuota, EventType, Booking } = tenantModels;

    const sp = new URL(request.url).searchParams;
    const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") ?? "") ? sp.get("mes") : new Date().toISOString().slice(0, 7);
    const [anio, m] = mes.split("-").map(Number);
    // El mes, en la hora del centro (el contenedor corre en Europe/Madrid).
    const desde = new Date(anio, m - 1, 1, 0, 0, 0, 0);
    const hasta = new Date(anio, m, 1, 0, 0, 0, 0);

    const [conceptos, cuotas, tipos] = await Promise.all([
      BillingConcept.findAll({ where: { active: true }, attributes: ["id", "name", "unitPrice"] }),
      Cuota.findAll({ where: { active: true }, attributes: ["id", "clientId", "patientId", "conceptIds", "amount"] }),
      // Los tipos de cita solo tienen sentido con el módulo; sin él, ninguno.
      tenantHasModule("citas") && EventType
        ? EventType.findAll({ where: { active: true }, attributes: ["id", "name", "conceptId"] })
        : [],
    ]);

    /*
     * Las citas del mes que llevan cuota puesta, contadas por concepto. Es lo
     * que convierte la tabla en una medida y no en una foto del catálogo: dice
     * cuántas sesiones de ese servicio hay apuntadas ESTE mes.
     */
    let citasPorConcepto = {};
    if (tenantHasModule("citas") && Booking) {
      const filas = await Booking.findAll({
        where: {
          cobroConceptId: { [Op.ne]: null },
          scheduledAt: { [Op.gte]: desde, [Op.lt]: hasta },
          status: { [Op.ne]: "cancelled" },
        },
        attributes: ["cobroConceptId"],
      });
      for (const f of filas) {
        const k = String(f.cobroConceptId);
        citasPorConcepto[k] = (citasPorConcepto[k] ?? 0) + 1;
      }
    }

    return ok({ disponible: true, mes, ...componerServicios({ conceptos, cuotas, tipos, citasPorConcepto }) });
  } catch (err) {
    // Un centro con `billing` recién activado puede no tener aún la tabla de
    // cuotas: se dice que no hay datos, no se rompe la pantalla de Productos.
    if (err?.original?.code === "42P01" || err?.parent?.code === "42P01") {
      return ok({ disponible: false, servicios: [], sinCuota: [], totales: null });
    }
    return serverError(err);
  }
});
