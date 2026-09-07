import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import {
  CAMPOS_MARCA,
  MAX_MARCA_BYTES,
  guardarImagenDeMarca,
  borrarImagenDeMarca,
  esRefDeMarca,
  slugDeRef,
  leerImagenDeMarca,
} from "../../../../../lib/billing/marcaImagen.js";

/**
 * POST /api/billing/settings/imagen — subir el logo o el SELLO del centro
 * (07/09/2026, AV-0069 de Aumenta).
 *
 * Hasta hoy los tres campos de marca eran cajas de texto que pedían la
 * dirección de una imagen ya publicada en internet; quien tenía el sello en un
 * PNG en su ordenador no podía ponerlo. Aquí se sube el fichero, se guarda con
 * `lib/billing/marcaImagen.js` y se devuelve la referencia que va al ajuste.
 *
 * Recibe `FormData` con `file` y `campo` (logo | sello | logoPresupuesto).
 * Guarda el ajuste él mismo: si solo devolviera la referencia y la pantalla
 * tuviera que acordarse de guardarla, un fichero subido y no guardado sería
 * basura en disco que nadie sabe de quién es.
 */
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    // Las demos son públicas y con sesión de admin: no se les llena el disco.
    if (isDemoTenant(tenant)) {
      return error("En la demo no se pueden subir imágenes de marca", 403);
    }

    const form = await request.formData();
    const campo = String(form.get("campo") || "");
    const columna = CAMPOS_MARCA[campo];
    if (!columna) {
      return error(`El campo tiene que ser uno de: ${Object.keys(CAMPOS_MARCA).join(", ")}`, 422);
    }

    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return error("Falta el fichero", 422);
    // El tamaño se mira ANTES de leerlo entero en memoria.
    if (Number(file.size) > MAX_MARCA_BYTES) {
      return error(`La imagen no puede pasar de ${Math.round(MAX_MARCA_BYTES / 1024 / 1024)} MB`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const guardada = await guardarImagenDeMarca(tenant.slug, buffer);
    if (guardada.error) return error(guardada.error, 422);

    const { TenantBillingSettings } = tenantModels;
    let row = await TenantBillingSettings.findOne();
    if (!row) row = await TenantBillingSettings.create({});

    // La anterior se borra DESPUÉS de guardar la nueva, y solo si era nuestra:
    // si el ajuste tenía una URL de internet, no hay nada que borrar.
    const anterior = row[columna];
    await row.update({ [columna]: guardada.ref });
    if (esRefDeMarca(anterior) && anterior !== guardada.ref) await borrarImagenDeMarca(anterior);

    return ok({ campo, columna, ref: guardada.ref, bytes: guardada.bytes, mime: guardada.mime });
  } catch (e) {
    return serverError(e);
  }
});

/**
 * GET /api/billing/settings/imagen?ref=/marca/<slug>/<uuid>.png — la imagen,
 * para poder VERLA en la pantalla de Configuración.
 *
 * El PDF no pasa por aquí: lee los bytes del disco directamente. Esto existe
 * solo para que quien acaba de subir su sello lo vea y sepa que ha entrado —
 * sin esto, el `<img>` de la pantalla apuntaría a una ruta que nadie sirve y
 * el centro vería un icono roto justo después de subirlo bien.
 *
 * Solo la suya: la referencia tiene que ser de ESTE centro.
 */
export const GET = withTenant(async (request, _ctx, { tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const ref = new URL(request.url).searchParams.get("ref") || "";
    if (!esRefDeMarca(ref) || slugDeRef(ref) !== tenant.slug) {
      return error("Esa imagen no es de este centro", 404);
    }
    const bytes = leerImagenDeMarca(ref);
    if (!bytes) return error("La imagen ya no está", 404);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": ref.endsWith(".png") ? "image/png" : "image/jpeg",
        // Lo que se sirve es lo que decimos que es, y no se adivina.
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        // El nombre lleva un uuid, así que el contenido nunca cambia.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return serverError(e);
  }
});
