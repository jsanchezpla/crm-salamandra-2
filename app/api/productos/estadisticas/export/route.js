import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { rangoPedido } from "../../../../../lib/utils/rangoFechas.js";
import {
  calcularEstadisticasProductos,
  gateEstadisticasProductos,
} from "../../../../../lib/productos/estadisticas.js";
import { buildVentasXlsx, buildVentasPdf, nombreDeFichero } from "../../../../../lib/productos/ventasExport.js";

/**
 * GET /api/productos/estadisticas/export?formato=xlsx|pdf&desde=&hasta=
 * — el bloque «Ventas» de Productos avanzado, para llevárselo (03/09/2026).
 *
 * El Excel para trabajar los números y el PDF para la reunión. Los dos salen
 * del MISMO cálculo que pinta la pantalla (`calcularEstadisticasProductos`),
 * con la misma puerta: Productos avanzado y dirección. Igual que
 * `app/api/clinica/estadisticas/export`.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gateEstadisticasProductos(ctx);
    if (veto) return veto;
    const { veto: vetoRango, rango } = rangoPedido(request);
    if (vetoRango) return vetoRango;

    const formato = (new URL(request.url).searchParams.get("formato") || "xlsx").toLowerCase();
    if (!["xlsx", "pdf"].includes(formato)) return error("formato debe ser 'xlsx' o 'pdf'", 422);

    const datos = await calcularEstadisticasProductos(ctx.tenantModels, rango, {
      conInventario: ctx.hasModule("inventory"),
    });
    if (!datos.disponible) return error("Las ventas salen de los pedidos, y este cliente no tiene el módulo Pedidos montado", 409);

    const buffer =
      formato === "pdf"
        ? await buildVentasPdf(datos, { tenantName: ctx.tenant.name, brand: ctx.tenant.settings?.brand })
        : await buildVentasXlsx(datos, { tenantName: ctx.tenant.name });

    // Buffer → ArrayBuffer propio: pasar el Buffer de Node tal cual a Response
    // puede arrastrar el pool interno entero de Node y enviar basura detrás.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : XLSX_MIME,
        "Content-Disposition": `attachment; filename="${nombreDeFichero(datos)}.${formato}"`,
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
