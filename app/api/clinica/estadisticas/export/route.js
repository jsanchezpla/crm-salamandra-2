import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calcularEstadisticas, gateEstadisticas, rangoPedido } from "../../../../../lib/clinica/estadisticas.js";
import { buildEstadisticasXlsx, buildEstadisticasPdf } from "../../../../../lib/clinica/estadisticasExport.js";

/**
 * GET /api/clinica/estadisticas/export?formato=xlsx|pdf&desde=&hasta=
 *
 * El Excel para trabajar los números y el PDF para llevarlos a la reunión.
 * Los dos salen del MISMO cálculo que pinta la pantalla.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gateEstadisticas(ctx);
    if (veto) return veto;
    const { veto: vetoRango, rango } = rangoPedido(request);
    if (vetoRango) return vetoRango;

    const formato = (new URL(request.url).searchParams.get("formato") || "xlsx").toLowerCase();
    if (!["xlsx", "pdf"].includes(formato)) return error("formato debe ser 'xlsx' o 'pdf'", 422);

    const stats = await calcularEstadisticas(ctx.tenantModels, rango);
    const base = `Estadisticas ${stats.desde} a ${stats.hasta}`;

    const buffer =
      formato === "pdf"
        ? await buildEstadisticasPdf(stats, { tenantName: ctx.tenant.name, brand: ctx.tenant.settings?.brand })
        : await buildEstadisticasXlsx(stats, { tenantName: ctx.tenant.name });

    // Buffer → ArrayBuffer propio: pasar el Buffer de Node tal cual a Response
    // puede arrastrar el pool interno entero de Node y enviar basura detrás.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : XLSX_MIME,
        "Content-Disposition": `attachment; filename="${base}.${formato}"`,
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
