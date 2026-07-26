import { NextResponse } from "next/server";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/formularios/[id] — detalle de una solicitud. */
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { FormSubmission } = tenantModels;
    const row = await FormSubmission.findByPk(id);
    if (!row) return notFound("Solicitud no encontrada");

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH /api/formularios/[id] — descartar, recuperar o anotar.
 *
 * Body:
 *   { status: "rejected", rejectionReason?: "…" }  descartar
 *   { status: "pending" }                          recuperar una descartada
 *   { internalNotes: "…" }                         nota interna
 *
 * TRANSICIONES PERMITIDAS, y el motivo de las prohibidas:
 *   pending  → rejected   ✔
 *   rejected → pending    ✔  (rectificar un descarte por error)
 *   accepted → cualquiera ✘  ya existe una ficha de cliente creada a partir de
 *                            esta solicitud; devolverla a pendiente dejaría el
 *                            camino abierto a crear una segunda ficha de la
 *                            misma persona.
 */
export const PATCH = withTenant(async (request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { FormSubmission } = tenantModels;
    const row = await FormSubmission.findByPk(id);
    if (!row) return notFound("Solicitud no encontrada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const cambios = {};

    if (body.internalNotes !== undefined) {
      cambios.internalNotes = body.internalNotes === null
        ? null
        : String(body.internalNotes).slice(0, 5000);
    }

    if (body.status !== undefined) {
      if (row.status === "accepted") {
        return error(
          "Esta solicitud ya se aceptó y tiene una ficha de cliente creada. No se puede cambiar de estado.",
          409
        );
      }
      if (body.status === "rejected") {
        cambios.status = "rejected";
        cambios.rejectedAt = new Date();
        cambios.rejectionReason = body.rejectionReason
          ? String(body.rejectionReason).slice(0, 2000)
          : null;
      } else if (body.status === "pending") {
        cambios.status = "pending";
        cambios.rejectedAt = null;
        cambios.rejectionReason = null;
      } else {
        return error("Estado no permitido. Solo se puede descartar o recuperar.", 422);
      }
      cambios.handledBy = request.headers.get("x-user-email") || row.handledBy || null;
      cambios.handledByTeamId = (await resolveCurrentTeamMemberId(request, tenantModels)) || row.handledByTeamId || null;
    }

    if (Object.keys(cambios).length === 0) return error("Nada que cambiar", 422);

    await row.update(cambios);
    return NextResponse.json({ ok: true, submission: row.toJSON() });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * DELETE /api/formularios/[id] — eliminar DEL TODO una solicitud descartada.
 *
 * Solo se permite borrar las que están en 'rejected':
 *   - las 'pending' hay que triarlas (descartar o aceptar), no borrarlas a ciegas;
 *   - las 'accepted' tienen una ficha de cliente creada detrás.
 * Es un borrado físico e irreversible (la solicitud ya estaba descartada).
 */
export const DELETE = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { FormSubmission } = tenantModels;
    const row = await FormSubmission.findByPk(id);
    if (!row) return notFound("Solicitud no encontrada");

    if (row.status !== "rejected") {
      return error("Solo se pueden eliminar del todo las solicitudes descartadas.", 409);
    }

    await row.destroy();
    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return serverError(err);
  }
});
