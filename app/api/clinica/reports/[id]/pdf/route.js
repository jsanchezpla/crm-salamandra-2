import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildReportPdfBuffer, reportPdfFilename } from "@/lib/clinica/reportPdf.js";
import { argumentosDelPdf, includesDelInforme, nombreDePaciente } from "@/lib/clinica/argumentosDelPdf.js";

/**
 * GET /api/clinica/reports/[id]/pdf — ver el PDF del informe SIN entregárselo a
 * nadie.
 *
 * ── POR QUÉ HACÍA FALTA (26/08/2026, Jorge) ────────────────────────────────
 * El PDF existía desde el sprint de julio y se generaba en un solo sitio: al
 * pulsar «Enviar al paciente», que además lo publica en el área privada de la
 * familia. O sea que la única forma de ver cómo queda un informe era mandárselo
 * a una familia de verdad.
 *
 * Y se nota en los números: en `crm_aumenta` hay CERO informes clínicos, con
 * 22.045 sesiones y 1.174 pacientes en el mismo schema. Los 22 que existen en
 * toda la plataforma están en las cuatro demos, inventados. Aumenta pidió
 * rediseñar un PDF **que nadie de allí ha visto todavía**, y esa conversación no
 * se puede tener a ciegas: primero hay que poder mirarlo.
 *
 * Esta ruta NO escribe nada — ni fichero, ni fila, ni estado, ni correo. Es el
 * mismo generador (`lib/clinica/reportPdf.js`) y los mismos datos que usa
 * «Enviar», pero devueltos y ya está. Por eso tampoco lleva el guard de la demo:
 * no manda correo, no gasta IA y no toca master.
 *
 * Sale `inline`, para que se abra en una pestaña y se lea; el visor del
 * navegador ya trae su botón de descargar. Con `?descargar=1` baja como fichero,
 * que es lo que hace falta para mandárselo a alguien por otro camino o para
 * enseñárselo al centro.
 *
 * Se audita igual que leer el informe, o sea NADA: el GET de al lado tampoco lo
 * hace. Esto no entrega el informe a nadie, y quien llega aquí ya podía leer su
 * contenido entero por `/api/clinica/reports/[id]`.
 *
 * Y NO se exige que el paciente tenga cliente pagador, aunque «Enviar» sí lo
 * exija: allí hace falta para saber a qué familia se le publica el documento en
 * su área privada. Eso es cosa de entregar, no de ver — un informe huérfano de
 * cliente se lee en pantalla, así que también se tiene que poder ver su PDF.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La misma puerta que el resto de informes: Clínica, o Pacientes a secas. */
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport } = ctx.tenantModels;
    const report = await ClinicalReport.findByPk(id, { include: includesDelInforme(ctx.tenantModels) });
    if (!report) return notFound("Informe no encontrado");

    const patientName = nombreDePaciente(report.patient);

    let buffer;
    try {
      /*
       * Los argumentos se arman en `lib/clinica/argumentosDelPdf.js` y NO aquí
       * (28/08/2026). Esta ruta y la de «Enviar al paciente» los tenían
       * copiados uno a uno: un dato añadido en una sola de las dos hacía que la
       * profesional previsualizara un documento y la familia recibiera otro.
       */
      buffer = await buildReportPdfBuffer(await argumentosDelPdf(report, ctx));
    } catch (err) {
      process.stderr.write(`[clinica:pdf] PDF falló: ${err.message}\n`);
      return error("No se pudo generar el PDF del informe", 500);
    }

    const { searchParams } = new URL(request.url);
    const comoSale = searchParams.get("descargar") ? "attachment" : "inline";

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(comoSale, reportPdfFilename(report, patientName)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        // Lleva datos de salud: ni un intermediario ni el navegador deben
        // guardarlo. Igual que el PDF de una factura.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
