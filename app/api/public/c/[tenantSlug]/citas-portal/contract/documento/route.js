import { Readable } from "node:stream";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { notFound, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../../../lib/documents/documentStorage.js";
import { gatePortal, resolvePortalContractSession, estadoContrato } from "../../../../../../../../lib/citas/portalContract.js";

/**
 * GET — el PDF del contrato que la familia va a firmar.
 *
 * Nadie debería firmar algo que no puede leer: la pantalla del contrato ofrece
 * abrirlo antes de dibujar la firma. Sirve el contrato ESTÁNDAR del centro; si
 * la familia ya tiene el suyo firmado en papel, se sirve ese (es el que la
 * afecta). Va por STREAM y solo con sesión del portal.
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return notFound("No hay contrato disponible");

    const { documento: elegido } = await estadoContrato(tenantModels, client, guardian);
    if (!elegido) return notFound("El centro todavía no ha subido el contrato");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(tenant.slug, elegido.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("No encontramos el archivo del contrato");
      throw err;
    }

    const safeName = String(elegido.fileName || "contrato.pdf").replace(/[\r\n"]/g, "_");
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": elegido.mimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
