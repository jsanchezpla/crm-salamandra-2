import { Readable } from "node:stream";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { readDocumentStream } from "@/lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/clients/[id]/contract/firmado/[documentoId] — la COPIA FIRMADA.
 *
 * ── POR QUÉ HACE FALTA (06/08/2026, Rodrigo) ────────────────────────────────
 * El CRM sabía decir quién había firmado y a quién le faltaba, pero el PDF con
 * los datos, el clausulado y la firma dentro no se podía abrir desde la ficha:
 * se generaba, se archivaba… y era invisible para el equipo. Quien necesitaba
 * ver lo que la familia había firmado —una reclamación, una duda sobre el
 * anexo de desistimiento— no tenía dónde mirar. La paciente sí lo tiene, en su
 * área privada; el centro no.
 *
 * ── POR QUÉ UNA RUTA PROPIA Y NO LA DEL MÓDULO DOCUMENTOS ──────────────────
 * `/api/documents/[id]/download` exige `documents_avanzado`, que es el archivo
 * documental completo y se vende aparte. Esto no es el archivo: es el contrato
 * de ESTA ficha, y cualquiera que tenga clientes tiene que poder verlo. Por eso
 * cuelga del cliente y se gatea con `clients`, igual que sus adjuntos.
 *
 * `?ver=1` lo abre en el navegador (inline) en vez de descargarlo: para echarle
 * un vistazo no hace falta acabar con veinte PDF en la carpeta de descargas.
 *
 * El filtro por `clientId` + `source` es el aislamiento: con el id de otro
 * documento —o de otra familia— esta ruta no devuelve nada.
 */
export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!ctx.hasModule("clients")) return forbidden("Módulo clients no activo");

    const { id, documentoId } = await rc.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(documentoId)) return error("id inválido", 422);

    const { Document } = ctx.tenantModels;
    const doc = await Document.findOne({
      where: { id: documentoId, clientId: id, source: "contrato_firmado" },
    });
    if (!doc) return notFound("Documento firmado no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, doc.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("El archivo ya no está en el disco");
      throw err;
    }

    const verEnPantalla = new URL(request.url).searchParams.get("ver") === "1";
    const safeName = String(doc.fileName || "contrato-firmado.pdf").replace(/[\r\n"]/g, "_");

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/pdf",
        "Content-Disposition": `${verEnPantalla ? "inline" : "attachment"}; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        // Lleva datos personales y la firma: que no se quede en ninguna caché
        // intermedia.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
