import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { tipoSegunRol } from "../../../../../lib/citas/dinero.js";
import {
  normalizeString,
  isValidSlug,
  isValidHexColor,
  normalizeModalities,
  validateModalityFields,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { normalizarPreguntas } from "../../../../../lib/citas/preguntasCita.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/event-types/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { EventType, Booking } = tenantModels;
    const row = await EventType.findByPk(id);
    if (!row) return notFound("Tipo de cita no encontrado");

    const bookingCount = await Booking.count({ where: { eventTypeId: id } });
    /*
     * Sin la tarifa si no es dirección. Es la puerta de atrás del listado:
     * tapar solo aquel dejaría sacar el precio de uno en uno por este.
     *
     * ⚠️ SEGÚN EL ROL, y no es un matiz (28/08/2026). Hasta hoy tapaba SIEMPRE:
     * el comentario decía «si no es dirección» pero el `if` nunca se escribió.
     * Como el formulario de Tipos de cita se rellena con lo que devuelve esto,
     * «Precio (€)» se abría VACÍO también para un admin, y al guardar —aunque
     * solo se cambiara el color— ese vacío viajaba como «sin precio» y BORRABA
     * la tarifa. Ni avisaba ni fallaba: guardaba bien.
     *
     * Los únicos 3 tipos con precio de toda la producción son de Laura, que es
     * quien cobra las citas por la web: no era un campo en blanco, era su
     * reserva pública dejando de cobrar sin que nadie se enterase.
     */
    const rol = request.headers.get("x-user-role");
    return ok({ ...tipoSegunRol(row.toJSON(), rol), bookingCount });
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
    // Bono de sesiones, pago a plazos y formulario propio (04/08/2026).
    if ("sessionsCount" in body) {
      const v = Number(body.sessionsCount);
      if (!Number.isInteger(v) || v < 1 || v > 200) return error("sessionsCount debe ser un entero entre 1 y 200");
      updates.sessionsCount = v;
    }
    // La cuota y los meses van SIEMPRE juntos: una cuota sin meses no se puede
    // cobrar y unos meses sin cuota tampoco. Se validan con el estado final,
    // porque puede llegar solo uno de los dos en un PATCH parcial.
    if ("instalmentPrice" in body || "instalmentMonths" in body) {
      const cuotaBruta = "instalmentPrice" in body ? body.instalmentPrice : row.instalmentPrice;
      const mesesBrutos = "instalmentMonths" in body ? body.instalmentMonths : row.instalmentMonths;

      const vacio = (v) => v === null || v === "" || v === undefined;
      if (vacio(cuotaBruta) && vacio(mesesBrutos)) {
        updates.instalmentPrice = null;
        updates.instalmentMonths = null;
      } else {
        const cuota = Number(cuotaBruta);
        const meses = Number(mesesBrutos);
        if (!Number.isInteger(cuota) || cuota <= 0) {
          return error("instalmentPrice debe ser un número entero de céntimos mayor que 0");
        }
        if (!Number.isInteger(meses) || meses < 2 || meses > 36) {
          return error("instalmentMonths debe ser un entero entre 2 y 36");
        }
        updates.instalmentPrice = cuota;
        updates.instalmentMonths = meses;
      }
    }
    // Preguntas propias de este tipo de cita (04/08/2026). Se normalizan en el
    // servidor: lo que llegue mal formado se descarta en vez de guardarse roto.
    if ("formQuestions" in body) {
      updates.formQuestions = normalizarPreguntas(body.formQuestions);
    }
    if ("formId" in body) {
      const v = normalizeString(body.formId);
      if (!v) {
        updates.formId = null;
      } else {
        // Que exista y sea de ESTE cliente: el id llega del navegador.
        const { Form } = tenantModels;
        const formulario = Form ? await Form.findByPk(v) : null;
        if (!formulario) return error("Ese formulario no existe", 422);
        updates.formId = v;
      }
    }
    // «Esta es la valoración inicial» (04/08/2026). Como mucho una por cliente:
    // al marcar una se desmarca la anterior, porque el portal tiene que poder
    // preguntar «¿entras a una valoración inicial?» y saber a cuál se refiere.
    // La BD lo garantiza con un índice único parcial; aquí se desmarca ANTES
    // para que el centro no tenga que acordarse de hacerlo a mano.
    let desmarcarOtras = false;
    if ("isInitialAssessment" in body) {
      const marcar = Boolean(body.isInitialAssessment);
      updates.isInitialAssessment = marcar;
      desmarcarOtras = marcar && !row.isInitialAssessment;
    }
    if ("active" in body) updates.active = Boolean(body.active);
    // Oculto: fuera de la agenda pública, visible solo para quien tenga bono
    // activo de este tipo (`lib/citas/tiposVisibles.js`).
    if ("isHidden" in body) updates.isHidden = Boolean(body.isHidden);
    if ("order" in body) {
      const v = Number(body.order);
      if (!Number.isInteger(v)) return error("order inválido");
      updates.order = v;
    }

    if (desmarcarOtras) {
      await EventType.update(
        { isInitialAssessment: false },
        { where: { isInitialAssessment: true, id: { [Op.ne]: row.id } } }
      );
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
