import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { unauthorized, forbidden, notFound, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../../lib/citas/portalSession.js";
import { normalizeEmail } from "../../../../../../../../lib/citas/validation.js";
import { resolvePortalClient } from "../../../../../../../../lib/citas/portalClient.js";
import { readDocumentStream } from "../../../../../../../../lib/documents/documentStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/public/c/[tenantSlug]/citas-portal/documents/[id]
 *
 * Descarga UN documento del paciente. La condición de acceso es la MISMA que la
 * del listado, aplicada en la propia consulta: el documento tiene que ser de la
 * ficha resuelta desde SU sesión y estar compartido con él (o haberlo subido
 * él). Así, aunque alguien pruebe con el id de otro documento, la fila no sale.
 */
export const GET = withPublicTenant(async (request, ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal no habilitado");

    const { id } = await ctx.params;
    if (!UUID_RE.test(id ?? "")) return notFound("Documento no encontrado");

    let email;
    try {
      ({ email } = await verifyPortalSession(readBearer(request), slug));
    } catch {
      return unauthorized("Sesión no válida o caducada");
    }
    const normalized = normalizeEmail(email);
    if (!normalized) return unauthorized("Sesión no válida o caducada");

    const client = await resolvePortalClient(tenantModels, normalized);
    if (!client) return notFound("Documento no encontrado");

    const { Document } = tenantModels;
    const row = await Document.findOne({
      where: {
        id,
        clientId: client.id,
        source: "ficha",
        [Op.or]: [{ clientVisible: true }, { uploadedByClient: true }],
      },
    });
    if (!row) return notFound("Documento no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(tenant.slug, row.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo no encontrado");
      throw err;
    }

    const safeName = String(row.fileName || "documento").replace(/[\r\n"]/g, "_");

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
