import archiver from "archiver";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { ficherosDelDocx, reportWordFilename } from "@/lib/clinica/reportWord.js";
import { includesDelInforme, nombreDePaciente } from "@/lib/clinica/argumentosDelPdf.js";

/**
 * GET /api/clinica/reports/[id]/word — el informe en un .docx EDITABLE
 * (09/09/2026, AV-0099).
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 * Laura Garrido (Aumenta): quiere «sacar el informe en documento editable» en
 * vez de solo en PDF, «para no tener que pasar por una web de conversión con
 * datos personales dentro». Hasta hoy, retocar un informe fuera del CRM pasaba
 * por subir un PDF con el nombre, la edad y el diagnóstico de un menor a un
 * conversor gratuito. Esto lo quita de en medio.
 *
 * ── NO ESCRIBE NADA ────────────────────────────────────────────────────────
 * Ni fichero, ni fila, ni estado, ni correo: es la misma clase de ruta que
 * «Ver PDF». Por eso tampoco lleva el guard de la demo (no manda correo, no
 * gasta IA, no toca master) y no se audita: quien llega aquí ya podía leer el
 * informe entero por `/api/clinica/reports/[id]`.
 *
 * ── SIEMPRE COMO DESCARGA ──────────────────────────────────────────────────
 * Un .docx no se enseña en el navegador, y con `inline` unos navegadores lo
 * bajan igual y otros lo abren en un visor de terceros. Se manda `attachment` y
 * se acabó.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** La misma puerta que el resto de informes: Clínica, o Pacientes a secas. */
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/** El ZIP del .docx, en memoria: son unos pocos KB de XML. */
function empaquetar(ficheros) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const trozos = [];
    archive.on("data", (t) => trozos.push(t));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(trozos)));
    for (const f of ficheros) archive.append(Buffer.from(f.contenido, "utf8"), { name: f.nombre });
    archive.finalize();
  });
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport } = ctx.tenantModels;
    const report = await ClinicalReport.findByPk(id, { include: includesDelInforme(ctx.tenantModels) });
    if (!report) return notFound("Informe no encontrado");

    const t = report.therapist ?? null;
    const patientName = nombreDePaciente(report.patient);
    const ficheros = ficherosDelDocx(report, ctx.tenant, {
      patientName,
      tenantName: ctx.tenant?.name ?? null,
      therapistName: t?.displayName ?? null,
      therapistPosition: t?.position ?? null,
      therapistQualification: t?.qualification ?? null,
      therapistCollegiate: t?.collegiateNumber ?? null,
    });

    let buffer;
    try {
      buffer = await empaquetar(ficheros);
    } catch (err) {
      process.stderr.write(`[clinica:word] .docx falló: ${err.message}\n`);
      return error("No se pudo generar el documento del informe", 500);
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": TIPO_DOCX,
        "Content-Disposition": contentDisposition("attachment", reportWordFilename(report, patientName)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        // Lleva datos de salud: ni un intermediario ni el navegador lo guardan.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
