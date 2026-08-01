import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { MAX_FILE_SIZE_BYTES } from "../../../../lib/documents/documentStorage.js";
import { buscarContrato, guardarContrato, serializarContrato } from "../../../../lib/documents/contratoServicios.js";

/**
 * Contrato de Prestación de Servicios visto desde la ficha del PACIENTE
 * (la puerta de siempre de Aumenta).
 *
 * Desde el 01/08/2026 la lógica vive en `lib/documents/contratoServicios.js` y
 * la comparte con `/api/documents/contrato-servicios`, que es por donde lo sube
 * un centro que no tiene módulo clínico (nutri_laura). Son dos puertas al MISMO
 * documento: el contrato es uno por centro.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { Document } = ctx.tenantModels;
    return ok({ template: serializarContrato(await buscarContrato(Document)) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    // Rol fresco de BD (no el congelado del JWT): revocación de admin al instante.
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede fijar el contrato estándar");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);

    // Tope por Content-Length ANTES de bufferizar el cuerpo entero en memoria
    // (si no, un fichero enorme cargaría del todo antes de rechazarlo → OOM).
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }

    const res = await guardarContrato({
      tenantModels: ctx.tenantModels,
      tenantSlug: ctx.tenant.slug,
      file: form.get("file"),
      nombre: form.get("name") || "Contrato estándar",
      ownerUserId,
    });
    if (res.error) return error(res.error, res.status ?? 400);

    return created(serializarContrato(res.doc));
  } catch (err) {
    return serverError(err);
  }
});
