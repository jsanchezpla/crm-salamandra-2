import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";

/**
 * PATCH /api/citas/packs/[id] — anular o reactivar un bono (05/08/2026).
 *
 * Un bono no se borra: se anula. Deja de dar derecho a citas y de destapar su
 * tipo oculto, pero la fila se queda con lo que se cobró, quién lo dio y cuándo
 * — y las citas que ya se dieron conservan su número. Borrarlo dejaría sesiones
 * numeradas apuntando a un bono que nadie recuerda.
 *
 * Se anula cuando el acuerdo se rompe: una devolución, un bono dado a la persona
 * equivocada, una transferencia que nunca llegó.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ESTADOS = new Set(["active", "anulado"]);

export const PATCH = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede tocar los bonos");

    const { SessionPack, EventType } = tenantModels;
    if (!SessionPack) return notFound("Bono no encontrado");

    const { id } = (await ctx?.params) ?? {};
    const pack = await SessionPack.findByPk(id);
    if (!pack) return notFound("Bono no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const updates = {};

    if ("status" in body) {
      const status = String(body.status);
      // 'agotado' no se pone a mano: lo dice el recuento de las citas, no una
      // persona. Dejarlo escribir aquí sería poder mentirle al contador.
      if (!ESTADOS.has(status)) return error("El estado solo puede ser 'active' o 'anulado'", 422);
      updates.status = status;
    }

    if ("notes" in body) {
      updates.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
    }

    if (!Object.keys(updates).length) return error("Nada que cambiar", 422);

    const antes = { status: pack.status, notes: pack.notes };
    await pack.update(updates);

    const tipo = EventType ? await EventType.findByPk(pack.eventTypeId) : null;

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: updates.status === "anulado" ? "citas.pack_anulado" : "citas.pack_actualizado",
      entity: "SessionPack",
      entityId: pack.id,
      before: { status: antes.status },
      after: { status: pack.status, eventType: tipo?.name ?? null },
      ip,
    });

    return ok({ id: pack.id, status: pack.status });
  } catch (err) {
    return serverError(err);
  }
});
