import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { logDocumentsAudit, canViewFolder } from "@/lib/documents/helpers.js";
import {
  carpetasCompartidasCon,
  sincronizaMiembrosDeCarpeta,
  miembrosDeCarpeta,
} from "@/lib/documents/carpetasCompartidas.js";

/**
 * /api/documents/folders/[id]/miembros — con quién está compartida una carpeta
 * (01/09/2026, Rodrigo: «las carpetas creadas en Documentos tienen que poder
 * ser vistas por quien se quiera. Un selector de equipo»).
 *
 *   GET   quién la ve, con nombre
 *   PUT   { teamMemberIds }  deja la lista exactamente así
 *
 * ── QUIÉN PUEDE QUÉ ─────────────────────────────────────────────────────────
 * VER la lista, cualquiera que pueda ver la carpeta: saber con quién compartes
 * un sitio es parte de estar en él.
 *
 * CAMBIARLA, solo el DUEÑO. Es la misma regla que renombrarla o borrarla
 * (`app/api/documents/folders/[id]/route.js`), y por lo mismo: repartir el
 * acceso a una carpeta es disponer de ella. Si el día de mañana hace falta que
 * dirección pueda repartir la de otro, se añade aquí y en aquellas dos, no
 * suelto por una pantalla.
 *
 * ── UNA CARPETA `shared` NO SE COMPARTE CON NADIE ──────────────────────────
 * Ya la ve todo el centro: una lista encima no añadiría a nadie y dejaría el
 * dato mintiendo el día que la carpeta vuelva a ser privada. Se contesta que
 * no, con esas palabras, para que la pantalla lo pueda decir.
 *
 * ── ESTO ABRE LECTURA, NO ESCRITURA ────────────────────────────────────────
 * Estar en la lista deja ver la carpeta, sus subcarpetas y sus documentos, y
 * descargarlos. Subir, renombrar y borrar siguen siendo del dueño.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tope defensivo, no regla de negocio: el campo viaja desde el navegador.
const MAX_MIEMBROS = 50;

function gate(ctx) {
  if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("El archivo de documentos exige el módulo Documentos avanzado");
  return null;
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { DocumentFolder } = ctx.tenantModels;
    const folder = await DocumentFolder.findByPk(id);
    if (!folder) return notFound("Carpeta no encontrada");

    const { todas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });
    if (!canViewFolder(folder, userId, todas)) return forbidden("Sin acceso a esta carpeta");

    return ok({
      miembros: await miembrosDeCarpeta({ tenantModels: ctx.tenantModels, folderId: id }),
      // Para que la pantalla sepa si puede tocar la lista o solo mirarla.
      puedoCompartir: folder.ownerUserId === userId && folder.visibility !== "shared",
      visibility: folder.visibility,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { DocumentFolder } = ctx.tenantModels;
    const folder = await DocumentFolder.findByPk(id);
    if (!folder) return notFound("Carpeta no encontrada");
    if (folder.ownerUserId !== userId) {
      return forbidden("Solo quien creó la carpeta puede decidir quién la ve");
    }
    if (folder.visibility === "shared") {
      return error("Esta carpeta ya la ve todo el equipo: no hace falta compartirla con nadie", 409);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido", 400); }
    const pedidos = Array.isArray(body?.teamMemberIds) ? body.teamMemberIds : [];
    if (pedidos.length > MAX_MIEMBROS) return error(`Máximo ${MAX_MIEMBROS} personas por carpeta`, 422);
    const limpios = pedidos.filter((x) => typeof x === "string" && UUID_RE.test(x));

    const { miembros, quitados } = await sincronizaMiembrosDeCarpeta({
      tenantModels: ctx.tenantModels,
      folderId: id,
      teamMemberIds: limpios,
      addedById: userId,
    });

    // Repartir el acceso a una carpeta se audita: es un cambio de quién ve qué.
    // Solo el RESUMEN (cuántos), nunca la lista — el log vive en master y los
    // nombres del equipo no se duplican ahí.
    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document_folder.shared",
      entity: "DocumentFolder",
      entityId: id,
      before: null,
      after: { miembros: miembros.length, quitados },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok({
      miembros: await miembrosDeCarpeta({ tenantModels: ctx.tenantModels, folderId: id }),
      quitados,
    });
  } catch (err) {
    return serverError(err);
  }
});
