import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  normalizeTime,
  timeToMinutes,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { findOverlap } from "../route.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/citas/availability/bulk
 *
 * Body: { slots: [{ eventTypeId?, dayOfWeek, startTime, endTime }, ...] }
 *
 * Crea N bloques de disponibilidad de golpe. Valida cada uno y detecta
 * solapamientos entre los propios slots del body así como con los existentes.
 * Si algún slot es inválido o solapa, NO se crea ninguno (todo o nada).
 */
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear disponibilidad");

    const { Availability, EventType } = tenantModels;
    const tenantSequelize = Availability.sequelize;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    if (!Array.isArray(body.slots) || body.slots.length === 0) {
      return error("slots debe ser un array no vacío");
    }
    if (body.slots.length > 200) return error("slots excede el límite (máx 200)");

    // Validación individual
    const cleaned = [];
    for (let i = 0; i < body.slots.length; i++) {
      const s = body.slots[i];
      const dayOfWeek = Number(s.dayOfWeek);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        return error(`slot[${i}]: dayOfWeek inválido (0..6)`);
      }
      const startTime = normalizeTime(s.startTime);
      const endTime = normalizeTime(s.endTime);
      if (!startTime || !endTime) return error(`slot[${i}]: startTime/endTime inválidos`);
      if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        return error(`slot[${i}]: endTime debe ser mayor que startTime`);
      }
      const eventTypeId = s.eventTypeId == null || s.eventTypeId === "" ? null : s.eventTypeId;
      cleaned.push({ dayOfWeek, startTime, endTime, eventTypeId });
    }

    // Validar eventTypeIds existentes
    const uniqueEtIds = [...new Set(cleaned.map((s) => s.eventTypeId).filter(Boolean))];
    for (const etId of uniqueEtIds) {
      const exists = await EventType.findByPk(etId);
      if (!exists) return error(`eventTypeId no existe: ${etId}`, 404);
    }

    // Detectar solapamiento dentro del propio body por (eventTypeId, dayOfWeek)
    const groups = new Map();
    for (let i = 0; i < cleaned.length; i++) {
      const s = cleaned[i];
      const key = `${s.eventTypeId ?? "null"}-${s.dayOfWeek}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ idx: i, ...s });
    }
    for (const [, list] of groups) {
      list.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      for (let i = 1; i < list.length; i++) {
        if (timeToMinutes(list[i].startTime) < timeToMinutes(list[i - 1].endTime)) {
          return error(`Solapamiento entre slot[${list[i - 1].idx}] y slot[${list[i].idx}]`, 409);
        }
      }
    }

    // Solapamiento contra existentes
    for (let i = 0; i < cleaned.length; i++) {
      const overlap = await findOverlap(Availability, cleaned[i]);
      if (overlap) {
        return error(`slot[${i}] solapa con existente (${overlap.startTime}–${overlap.endTime})`, 409);
      }
    }

    // Insertar todo en transacción
    const createdRows = await tenantSequelize.transaction(async (t) => {
      const result = [];
      for (const s of cleaned) {
        const row = await Availability.create(s, { transaction: t });
        result.push(row);
      }
      return result;
    });

    for (const row of createdRows) {
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
    }

    return ok({ created: createdRows.length, rows: createdRows.map((r) => r.toJSON()) }, 201);
  } catch (err) {
    return serverError(err);
  }
});
