import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { construirResumenCaja, rangoDelResumen } from "../../../../lib/billing/resumenCaja.js";

/**
 * GET /api/arqueo/resumen?desde=&hasta=[&cajaId=] — el resumen DIARIO de lo
 * cobrado por forma de pago (01/09/2026, petición de Aumenta: «poder ver un
 * resumen por día de los cobros efectuados en efectivo, tarjeta y banco»).
 *
 * Devuelve una fila por día con efectivo / tarjeta / banco, más las entradas y
 * salidas de caja de ese día y lo que debería quedar en el cajón. Sin fechas,
 * el mes en curso.
 *
 * Desde el 04/09/2026 el armado vive en `lib/billing/resumenCaja.js`: este
 * endpoint y el del Excel (`/api/arqueo/exports/resumen`) tienen que devolver
 * exactamente las mismas cifras para las mismas fechas, y la única forma de
 * garantizarlo es que las pidan al mismo sitio.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { searchParams } = new URL(request.url);
  const rango = rangoDelResumen(searchParams);
  if (rango.error) return error(rango.error, 422);

  const data = await construirResumenCaja({
    tenantModels,
    hasModule,
    desde: rango.desde,
    hasta: rango.hasta,
    cajaId: searchParams.get("cajaId") || null,
  });
  return ok(data);
});
