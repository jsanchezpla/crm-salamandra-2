import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
  VALID_MODALITIES,
} from "../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["confirmed", "completed", "cancelled", "no_show"]);

/**
 * Comprueba si una franja [start, end) solapa con bookings activos
 * (status NO IN ['cancelled', 'no_show']). Excluye opcionalmente un id.
 */
export async function findBookingOverlap(Booking, { scheduledAt, duration, excludeId = null }) {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const where = {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    scheduledAt: { [Op.lt]: end },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const candidates = await Booking.findAll({ where });
  for (const b of candidates) {
    const bStart = new Date(b.scheduledAt);
    const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
    if (bStart < end && bEnd > start) return b;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/bookings — listado paginado
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Booking, EventType } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("from") || searchParams.get("to")) {
      where.scheduledAt = {};
      if (searchParams.get("from")) where.scheduledAt[Op.gte] = new Date(searchParams.get("from"));
      if (searchParams.get("to")) where.scheduledAt[Op.lte] = new Date(searchParams.get("to"));
    }
    if (searchParams.get("status")) {
      const s = searchParams.get("status");
      if (!VALID_STATUS.has(s)) return error("status inválido");
      where.status = s;
    }
    if (searchParams.get("eventTypeId")) where.eventTypeId = searchParams.get("eventTypeId");
    const q = (searchParams.get("search") || "").trim();
    if (q) {
      where[Op.or] = [
        { clientName: { [Op.iLike]: `%${q}%` } },
        { clientEmail: { [Op.iLike]: `%${q}%` } },
        { clientPhone: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const { count, rows } = await Booking.findAndCountAll({
      where,
      include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "slug", "color"] }],
      order: [["scheduledAt", "DESC"]],
      limit,
      offset,
    });

    return ok({
      bookings: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/citas/bookings — creación manual por admin
//   - NO valida minNoticeHours / maxAdvanceDays
//   - NO valida disponibilidad (admin puede crear donde quiera)
//   - SÍ valida solapamiento con otros bookings activos
//   - SÍ valida que modality esté en EventType.modalities
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear citas manuales");

    const { Booking, EventType } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const eventTypeId = body.eventTypeId;
    if (!eventTypeId || typeof eventTypeId !== "string") return error("eventTypeId es obligatorio");

    const eventType = await EventType.findByPk(eventTypeId);
    if (!eventType) return error("eventTypeId no existe", 404);

    const clientName = normalizeString(body.clientName);
    if (!clientName) return error("clientName es obligatorio");

    const clientEmail = normalizeEmail(body.clientEmail);
    if (!clientEmail || !isValidEmail(clientEmail)) return error("clientEmail inválido");

    const clientPhone = normalizeString(body.clientPhone);
    if (!clientPhone) return error("clientPhone es obligatorio");

    const additionalData = body.additionalData != null ? String(body.additionalData) : null;
    if (eventType.additionalDataRequired && (!additionalData || additionalData.trim() === "")) {
      return error("additionalData es obligatorio para este tipo de cita");
    }

    if (!body.scheduledAt) return error("scheduledAt es obligatorio");
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return error("scheduledAt inválido");

    const modality = String(body.modality || "").toLowerCase();
    if (!VALID_MODALITIES.includes(modality)) return error("modality inválida");
    if (!eventType.modalities.includes(modality)) {
      return error(`modality '${modality}' no está permitida para este tipo de cita`);
    }

    const duration = eventType.duration; // snapshot
    const meetUrl = modality === "online" ? eventType.meetUrl : null;

    // Solapamiento
    const overlap = await findBookingOverlap(Booking, { scheduledAt, duration });
    if (overlap) {
      return error(`Solapa con otra cita activa el ${overlap.scheduledAt.toISOString?.() ?? overlap.scheduledAt}`, 409);
    }

    const notes = body.notes != null ? String(body.notes) : null;

    const row = await Booking.create({
      eventTypeId,
      clientName,
      clientEmail,
      clientPhone,
      additionalData,
      scheduledAt,
      duration,
      modality,
      meetUrl,
      status: "confirmed",
      notes,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: null,
      after: { ...row.toJSON(), source: "manual" },
      ip,
    });

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
