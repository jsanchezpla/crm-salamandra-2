import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  slugify,
  isValidSlug,
  isValidHexColor,
  normalizeModalities,
  validateModalityFields,
} from "../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/event-types — listar
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { EventType } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.has("active")) {
      where.active = searchParams.get("active") === "true";
    }

    const eventTypes = await EventType.findAll({
      where,
      order: [["order", "ASC"], ["createdAt", "ASC"]],
    });

    return ok(eventTypes.map((e) => e.toJSON()));
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/citas/event-types — crear (admin)
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear tipos de cita");

    const { EventType } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const name = normalizeString(body.name);
    if (!name) return error("name es obligatorio");

    let slug = normalizeString(body.slug);
    if (slug) {
      if (!isValidSlug(slug)) return error("slug inválido (solo a-z, 0-9, '-')");
    } else {
      slug = slugify(name);
      if (!slug) return error("No se pudo generar slug a partir de name");
    }

    const duration = Number(body.duration);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 480) {
      return error("duration debe ser entero entre 1 y 480 minutos");
    }

    const bufferBefore = body.bufferBefore == null ? 0 : Number(body.bufferBefore);
    const bufferAfter = body.bufferAfter == null ? 0 : Number(body.bufferAfter);
    if (!Number.isInteger(bufferBefore) || bufferBefore < 0) return error("bufferBefore inválido");
    if (!Number.isInteger(bufferAfter) || bufferAfter < 0) return error("bufferAfter inválido");

    const color = normalizeString(body.color);
    if (color && !isValidHexColor(color)) return error("color inválido (formato #rrggbb)");

    const modalities = normalizeModalities(body.modalities);
    if (!modalities) return error("modalities debe ser un array no vacío con valores válidos");

    const location = normalizeString(body.location);
    const phoneNumber = normalizeString(body.phoneNumber);
    const meetUrl = normalizeString(body.meetUrl);
    const fieldErr = validateModalityFields({ modalities, location, phoneNumber, meetUrl });
    if (fieldErr) return error(fieldErr);

    const additionalDataLabel = normalizeString(body.additionalDataLabel);
    const additionalDataRequired = Boolean(body.additionalDataRequired);

    const minNoticeHours = body.minNoticeHours == null ? 24 : Number(body.minNoticeHours);
    const maxAdvanceDays = body.maxAdvanceDays == null ? 60 : Number(body.maxAdvanceDays);
    if (!Number.isInteger(minNoticeHours) || minNoticeHours < 0) return error("minNoticeHours inválido");
    if (!Number.isInteger(maxAdvanceDays) || maxAdvanceDays <= 0) return error("maxAdvanceDays inválido");

    const active = body.active == null ? true : Boolean(body.active);
    const order = body.order == null ? 0 : Number(body.order);
    if (!Number.isInteger(order)) return error("order inválido");

    // Precio EN CÉNTIMOS (null = cita gratuita, sin pago online). La conversión
    // desde euros la hace la UI con lib/payments/money.js.
    let price = body.price == null || body.price === "" ? null : Number(body.price);
    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      return error("price debe ser un número entero de céntimos (0 o más)");
    }
    // 0 y null significan lo mismo (gratis). Se normaliza a null para que exista
    // UNA sola forma de decirlo y nadie tenga que acordarse de comprobar las dos.
    if (price === 0) price = null;

    // Bono de sesiones: 1 = cita suelta (lo de siempre), N = bono de N citas.
    const sessionsCount = body.sessionsCount == null ? 1 : Number(body.sessionsCount);
    if (!Number.isInteger(sessionsCount) || sessionsCount < 1 || sessionsCount > 200) {
      return error("sessionsCount debe ser un entero entre 1 y 200");
    }

    // Pago a plazos: precio INDEPENDIENTE del de arriba (financiar cuesta más).
    // La cuota y los meses van juntos o no va ninguno.
    const vacio = (v) => v == null || v === "";
    let instalmentPrice = null;
    let instalmentMonths = null;
    if (!vacio(body.instalmentPrice) || !vacio(body.instalmentMonths)) {
      instalmentPrice = Number(body.instalmentPrice);
      instalmentMonths = Number(body.instalmentMonths);
      if (!Number.isInteger(instalmentPrice) || instalmentPrice <= 0) {
        return error("instalmentPrice debe ser un número entero de céntimos mayor que 0");
      }
      if (!Number.isInteger(instalmentMonths) || instalmentMonths < 2 || instalmentMonths > 36) {
        return error("instalmentMonths debe ser un entero entre 2 y 36");
      }
    }

    // Formulario a rellenar tras elegir fecha y hora. Se comprueba que exista:
    // el id llega del navegador.
    const formId = normalizeString(body.formId) || null;
    if (formId) {
      const { Form } = tenantModels;
      const formulario = Form ? await Form.findByPk(formId) : null;
      if (!formulario) return error("Ese formulario no existe", 422);
    }

    // Unicidad de slug
    const dup = await EventType.findOne({ where: { slug } });
    if (dup) return error("Ya existe un tipo de cita con ese slug", 409);

    const row = await EventType.create({
      name,
      description: normalizeString(body.description),
      slug,
      duration,
      bufferBefore,
      bufferAfter,
      color,
      modalities,
      location,
      phoneNumber,
      meetUrl,
      additionalDataLabel,
      additionalDataRequired,
      minNoticeHours,
      maxAdvanceDays,
      price,
      sessionsCount,
      instalmentPrice,
      instalmentMonths,
      formId,
      active,
      order,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.event_type_created",
      entity: "EventType",
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
