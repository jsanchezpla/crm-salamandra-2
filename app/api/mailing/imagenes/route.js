import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { exigirMailing } from "../../../../lib/mailing/comun.js";
import { guardarImagen, MAX_IMAGEN_BYTES } from "../../../../lib/mailing/imagenStorage.js";
import { urlBase, urlDeImagen } from "../../../../lib/mailing/enlaces.js";

/**
 * POST /api/mailing/imagenes — subir una imagen para un bloque del correo.
 * Multipart con el campo `fichero`. Devuelve la URL PÚBLICA con la que el
 * correo la enlaza (`/api/public/c/<slug>/mailing/imagen/<uuid>.<ext>`).
 *
 * Solo imágenes, 2 MB, tipo comprobado por los bytes (lib/mailing/imagenStorage.js).
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("Sube el fichero como multipart/form-data");
  }
  const fichero = form.get("fichero");
  if (!fichero || typeof fichero.arrayBuffer !== "function") throw new ValidationError("Falta el fichero");
  if (fichero.size > MAX_IMAGEN_BYTES) throw new ValidationError(`La imagen no puede pasar de ${Math.round(MAX_IMAGEN_BYTES / 1024 / 1024)} MB`);
  const buffer = Buffer.from(await fichero.arrayBuffer());
  const r = await guardarImagen(ctx.slug, buffer);
  if (r.error) throw new ValidationError(r.error);
  return ok({ url: urlDeImagen(urlBase(request), ctx.slug, r.nombre), nombre: r.nombre, mime: r.mime, bytes: r.bytes });
});
