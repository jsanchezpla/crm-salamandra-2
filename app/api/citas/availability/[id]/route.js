import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  normalizeTime,
  timeToMinutes,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { findOverlap } from "../route.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/availability/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar disponibilidad");

    const { id } = await params;
    const { Availability, EventType } = tenantModels;
    const row = await Availability.findByPk(id);
    if (!row) return notFound("Disponibilidad no encontrada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const updates = {};
    const before = row.toJSON();

    if ("dayOfWeek" in body) {
      const v = Number(body.dayOfWeek);
      if (!Number.isInteger(v) || v < 0 || v > 6) return error("dayOfWeek inválido (0..6)");
      updates.dayOfWeek = v;
    }
    if ("startTime" in body) {
      const v = normalizeTime(body.startTime);
      if (!v) return error("startTime inválido (HH:MM)");
      updates.startTime = v;
    }
    if ("endTime" in body) {
      const v = normalizeTime(body.endTime);
      if (!v) return error("endTime inválido (HH:MM)");
      updates.endTime = v;
    }
    if ("eventTypeId" in body) {
      const v = body.eventTypeId == null || body.eventTypeId === "" ? null : body.eventTypeId;
      if (v !== null) {
        const eventType = await EventType.findByPk(v);
        if (!eventType) return error("eventTypeId no existe", 404);
      }
      updates.eventTypeId = v;
    }

    // Resultado final para validar coherencia y solapamiento
    const dayFinal = updates.dayOfWeek ?? row.dayOfWeek;
    const startFinal = updates.startTime ?? row.startTime;
    const endFinal = updates.endTime ?? row.endTime;
    const etFinal = "eventTypeId" in updates ? updates.eventTypeId : row.eventTypeId;

    if (timeToMinutes(endFinal) <= timeToMinutes(startFinal)) {
      return error("endTime debe ser mayor que startTime");
    }

    const overlap = await findOverlap(Availability, {
      eventTypeId: etFinal,
      dayOfWeek: dayFinal,
      startTime: startFinal,
      endTime: endFinal,
      excludeId: row.id,
    });
    if (overlap) {
      return error(`Solapa con un bloque existente (${overlap.startTime}–${overlap.endTime})`, 409);
    }

    await row.update(updates);
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.availability_updated",
      entity: "Availability",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/citas/availability/[id]
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede eliminar disponibilidad");

    const { id } = await params;
    const { Availability } = tenantModels;
    const row = await Availability.findByPk(id);
    if (!row) return notFound("Disponibilidad no encontrada");

    const before = row.toJSON();
    await row.destroy();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.availability_deleted",
      entity: "Availability",
      entityId: id,
      before,
      after: null,
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
