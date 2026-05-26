import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import {
  normalizeTime,
  timeToMinutes,
} from "../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Comprueba si un bloque [startMin, endMin) solapa con alguno existente para
 * el mismo (eventTypeId, dayOfWeek). Excluye opcionalmente un id concreto.
 */
export async function findOverlap(Availability, { eventTypeId, dayOfWeek, startTime, endTime, excludeId = null }) {
  const where = { dayOfWeek };
  if (eventTypeId == null) {
    where.eventTypeId = null;
  } else {
    where.eventTypeId = eventTypeId;
  }
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await Availability.findAll({ where });
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  for (const slot of existing) {
    const s = timeToMinutes(slot.startTime);
    const e = timeToMinutes(slot.endTime);
    if (startMin < e && endMin > s) {
      return slot;
    }
  }
  return null;
}

function validateSlot(input) {
  const dayOfWeek = Number(input.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { ok: false, message: "dayOfWeek inválido (0..6)" };
  }
  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  if (!startTime || !endTime) {
    return { ok: false, message: "startTime/endTime inválidos (HH:MM)" };
  }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return { ok: false, message: "endTime debe ser mayor que startTime" };
  }
  const eventTypeId = input.eventTypeId ?? null;
  if (eventTypeId !== null && typeof eventTypeId !== "string") {
    return { ok: false, message: "eventTypeId inválido" };
  }
  return { ok: true, value: { dayOfWeek, startTime, endTime, eventTypeId } };
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/availability
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Availability } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.has("eventTypeId")) {
      const v = searchParams.get("eventTypeId");
      where.eventTypeId = v === "null" || v === "" ? null : v;
    }

    const rows = await Availability.findAll({
      where,
      order: [["dayOfWeek", "ASC"], ["startTime", "ASC"]],
    });

    return ok(rows.map((r) => r.toJSON()));
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/citas/availability
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear disponibilidad");

    const { Availability, EventType } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const v = validateSlot(body);
    if (!v.ok) return error(v.message);

    if (v.value.eventTypeId !== null) {
      const eventType = await EventType.findByPk(v.value.eventTypeId);
      if (!eventType) return error("eventTypeId no existe", 404);
    }

    const overlap = await findOverlap(Availability, v.value);
    if (overlap) {
      return error(`Solapa con un bloque existente (${overlap.startTime}–${overlap.endTime})`, 409);
    }

    const row = await Availability.create(v.value);

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.availability_created",
      entity: "Availability",
      entityId: row.id,
      before: null,
      after: row.toJSON(),
      ip,
    });

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
