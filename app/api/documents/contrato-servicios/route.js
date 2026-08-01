import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { MAX_FILE_SIZE_BYTES } from "../../../../lib/documents/documentStorage.js";
import { buscarContrato, guardarContrato, serializarContrato } from "../../../../lib/documents/contratoServicios.js";

/**
 * /api/documents/contrato-servicios — el Contrato de Prestación de Servicios
 * del centro (01/08/2026).
 *
 *   GET  → el contrato vigente (o null)
 *   POST → lo sube o lo reemplaza (solo admin)
 *
 * Gated al módulo **Documentos básico**: es lo único que puede hacer un cliente
 * que solo tiene el básico (nutri_laura). El archivo completo —carpetas,
 * buscador, subida general— exige `documents_avanzado`.
 *
 * Antes esto solo se podía subir desde la ficha de un PACIENTE, así que un
 * centro sin módulo clínico no tenía manera; y sin contrato subido, el portal
 * no le pide la firma a ninguna familia.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule(MODULE_KEYS.DOCUMENTS) ? null : forbidden("Módulo Documentos no activo");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { Document } = ctx.tenantModels;
    return ok({ contrato: serializarContrato(await buscarContrato(Document)) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    // Rol fresco de BD (lo reescribe withTenant): quitarle admin a alguien
    // surte efecto al instante.
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede subir el contrato del centro");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);

    // Tope por Content-Length ANTES de bufferizar el cuerpo entero en memoria.
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }

    const res = await guardarContrato({
      tenantModels: ctx.tenantModels,
      tenantSlug: ctx.tenant.slug,
      file: form.get("file"),
      nombre: form.get("name"),
      ownerUserId,
    });
    if (res.error) return error(res.error, res.status ?? 400);

    return created(serializarContrato(res.doc));
  } catch (err) {
    return serverError(err);
  }
});
