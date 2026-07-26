import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { UUID_RE } from "../../../../../../lib/nutricion/plans.js";
import {
  MAX_PHOTO_SIZE_BYTES,
  ALLOWED_PHOTO_MIME_TYPES,
  isAllowedPhotoMime,
  validatePhotoMagicBytes,
  saveRecipePhoto,
  readRecipePhotoStream,
  deleteRecipePhoto,
  photoContentType,
} from "../../../../../../lib/nutricion/recipePhotoStorage.js";

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "Recipe", entityId, before, after, ip });
  } catch {
    /* silent */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/recipes/[id]/photo — subir/reemplazar la foto (multipart).
//   FormData: { file }. JPEG/PNG/WebP, máx 5 MB, validación por magic bytes.
//   Patrón calcado de app/api/documents/route.js: guard de Content-Length antes
//   de formData, escribir disco → UPDATE BD → si BD falla borrar el fichero
//   nuevo; el fichero ANTERIOR solo se borra tras persistir el nuevo.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return notFound("Receta no encontrada");

    // Guard barato ANTES de parsear el multipart entero.
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_PHOTO_SIZE_BYTES + 64 * 1024) {
      return error(`La foto supera el máximo de ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("multipart/form-data inválido");
    }
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return error("Falta el campo 'file'");
    if (!isAllowedPhotoMime(file.type)) {
      return error(`Formato no admitido (${file.type || "desconocido"}). Válidos: ${ALLOWED_PHOTO_MIME_TYPES.join(", ")}`, 415);
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      return error(`La foto supera el máximo de ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validatePhotoMagicBytes(buffer, file.type)) {
      return error("El contenido del fichero no coincide con una imagen válida", 415);
    }

    const previousPath = recipe.photoPath;
    const photoId = randomUUID();
    const newPath = await saveRecipePhoto(tenant.slug, id, photoId, buffer, file.type);

    try {
      await recipe.update({ photoPath: newPath });
    } catch (err) {
      // BD falló: no dejar el fichero nuevo huérfano en disco.
      await deleteRecipePhoto(tenant.slug, newPath);
      throw err;
    }
    // Solo tras persistir: retirar la foto anterior (best-effort).
    if (previousPath) await deleteRecipePhoto(tenant.slug, previousPath);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.recipe.photo_uploaded",
      entityId: id,
      before: { photoPath: previousPath ?? null },
      after: { photoPath: newPath, bytes: buffer.length },
      ip,
    });

    return ok({ id, hasPhoto: true });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/recipes/[id]/photo — servir la foto (inline, stream).
//   Cache privada larga: el nombre de fichero (UUID) cambia en cada subida,
//   pero la URL pública no — la UI añade ?v=updatedAt como cache-buster.
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id, { attributes: ["id", "photoPath"] });
    if (!recipe || !recipe.photoPath) return notFound("La receta no tiene foto");

    let stream, size;
    try {
      ({ stream, size } = await readRecipePhotoStream(tenant.slug, recipe.photoPath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Foto no encontrada en disco");
      throw err;
    }

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": photoContentType(recipe.photoPath),
        "Content-Length": String(size),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/recipes/[id]/photo — quitar la foto.
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return notFound("Receta no encontrada");
    if (!recipe.photoPath) return noContent();

    const previousPath = recipe.photoPath;
    await recipe.update({ photoPath: null });
    await deleteRecipePhoto(tenant.slug, previousPath);

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.recipe.photo_deleted",
      entityId: id,
      before: { photoPath: previousPath },
      after: { photoPath: null },
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
