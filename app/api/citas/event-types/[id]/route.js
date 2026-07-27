import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  isValidSlug,
  isValidHexColor,
  normalizeModalities,
  validateModalityFields,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/event-types/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { EventType, Booking } = tenantModels;
    const row = await EventType.findByPk(id);
    if (!row) return notFound("Tipo de cita no encontrado");

    const bookingCount = await Booking.count({ where: { eventTypeId: id } });
    return ok({ ...row.toJSON(), bookingCount });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/event-types/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar tipos de cita");

    const { id } = await params;
    const { EventType } = tenantModels;
    const row = await EventType.findByPk(id);
    if (!row) return notFound("Tipo de cita no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const before = row.toJSON();
    const updates = {};

    if ("name" in body) {
      const v = normalizeString(body.name);
      if (!v) return error("name no puede ser vacío");
      updates.name = v;
    }
    if ("description" in body) updates.description = normalizeString(body.description);
    if ("slug" in body) {
      const v = normalizeString(body.slug);
      if (!v) return error("slug no puede ser vacío");
      if (!isValidSlug(v)) return error("slug inválido (solo a-z, 0-9, '-')");
      if (v !== row.slug) {
        const dup = await EventType.findOne({ where: { slug: v, id: { [Op.ne]: row.id } } });
        if (dup) return error("Ya existe un tipo de cita con ese slug", 409);
      }
      updates.slug = v;
    }
    if ("duration" in body) {
      const v = Number(body.duration);
      if (!Number.isInteger(v) || v <= 0 || v > 480) {
        return error("duration debe ser entero entre 1 y 480");
      }
      updates.duration = v;
    }
    if ("bufferBefore" in body) {
      const v = Number(body.bufferBefore);
      if (!Number.isInteger(v) || v < 0) return error("bufferBefore inválido");
      updates.bufferBefore = v;
    }
    if ("bufferAfter" in body) {
      const v = Number(body.bufferAfter);
      if (!Number.isInteger(v) || v < 0) return error("bufferAfter inválido");
      updates.bufferAfter = v;
    }
    if ("color" in body) {
      const v = normalizeString(body.color);
      if (v && !isValidHexColor(v)) return error("color inválido (formato #rrggbb)");
      updates.color = v;
    }
    if ("modalities" in body) {
      const v = normalizeModalities(body.modalities);
      if (!v) return error("modalities debe ser un array no vacío con valores válidos");
      updates.modalities = v;
    }
    if ("location" in body) updates.location = normalizeString(body.location);
    if ("phoneNumber" in body) updates.phoneNumber = normalizeString(body.phoneNumber);
    if ("meetUrl" in body) updates.meetUrl = normalizeString(body.meetUrl);

    // Validar campos por modalidad con el estado resultante
    const modalitiesFinal = updates.modalities ?? row.modalities;
    const locationFinal = "location" in updates ? updates.location : row.location;
    const phoneFinal = "phoneNumber" in updates ? updates.phoneNumber : row.phoneNumber;
    const meetFinal = "meetUrl" in updates ? updates.meetUrl : row.meetUrl;
    const fieldErr = validateModalityFields({
      modalities: modalitiesFinal,
      location: locationFinal,
      phoneNumber: phoneFinal,
      meetUrl: meetFinal,
    });
    if (fieldErr) return error(fieldErr);

    if ("additionalDataLabel" in body) updates.additionalDataLabel = normalizeString(body.additionalDataLabel);
    if ("additionalDataRequired" in body) updates.additionalDataRequired = Boolean(body.additionalDataRequired);

    if ("minNoticeHours" in body) {
      const v = Number(body.minNoticeHours);
      if (!Number.isInteger(v) || v < 0) return error("minNoticeHours inválido");
      updates.minNoticeHours = v;
    }
    if ("maxAdvanceDays" in body) {
      const v = Number(body.maxAdvanceDays);
      if (!Number.isInteger(v) || v <= 0) return error("maxAdvanceDays inválido");
      updates.maxAdvanceDays = v;
    }
    // Precio EN CÉNTIMOS. null o "" lo deja gratuito (deja de pedir pago).
    if ("price" in body) {
      if (body.price === null || body.price === "") {
        updates.price = null;
      } else {
        const v = Number(body.price);
        if (!Number.isInteger(v) || v < 0) {
          return error("price debe ser un número entero de céntimos (0 o más)");
        }
        // 0 == gratis == null: una sola representación (ver POST).
        updates.price = v === 0 ? null : v;
      }
    }
    if ("active" in body) updates.active = Boolean(body.active);
    if ("order" in body) {
      const v = Number(body.order);
      if (!Number.isInteger(v)) return error("order inválido");
      updates.order = v;
    }

    await row.update(updates);
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.event_type_updated",
      entity: "EventType",
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
// DELETE /api/citas/event-types/[id]
//   - soft (active=false) si tiene bookings asociados
//   - hard si no tiene bookings
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede eliminar tipos de cita");

    const { id } = await params;
    const { EventType, Booking, Availability } = tenantModels;
    const row = await EventType.findByPk(id);
    if (!row) return notFound("Tipo de cita no encontrado");

    const before = row.toJSON();
    const bookingCount = await Booking.count({ where: { eventTypeId: id } });

    if (bookingCount > 0) {
      // Soft delete: desactivar
      if (row.active) {
        await row.update({ active: false });
      }
      await logCitasAudit({
        tenantId: tenant.id,
        userId,
        action: "citas.event_type_deleted",
        entity: "EventType",
        entityId: row.id,
        before,
        after: { ...before, active: false, softDelete: true, bookingCount },
        ip,
      });
      return ok({ softDelete: true, bookingCount });
    }

    // Hard delete: eliminar availabilities específicas y el evento
    await Availability.destroy({ where: { eventTypeId: id } });
    await row.destroy();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.event_type_deleted",
      entity: "EventType",
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
