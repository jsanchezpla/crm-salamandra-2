import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { formPublico } from "../../../../../../lib/formularios/fields.js";

/**
 * GET /api/public/c/[tenantSlug]/event-types
 *
 * Devuelve los EventType del tenant con active=true y 'online' en modalities.
 * Filtra los campos sensibles (meetUrl, location, phoneNumber, buffers).
 */
export const GET = withPublicTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { EventType, Form } = tenantModels;
    const rows = await EventType.findAll({
      where: { active: true },
      order: [["order", "ASC"], ["createdAt", "ASC"]],
    });

    // Formulario propio del tipo de cita (04/08/2026): se rellena tras elegir
    // fecha y hora. Se cargan de una vez los que hagan falta en lugar de uno
    // por tipo de cita. Sin módulo `formularios` (o sin la migración) el mapa
    // queda vacío y el widget no pinta nada: no es un error, es que no aplica.
    const formIds = [...new Set(rows.map((r) => r.formId).filter(Boolean))];
    const formularios = new Map();
    if (formIds.length && Form) {
      try {
        const filas = await Form.findAll({ where: { id: formIds, active: true } });
        for (const f of filas) formularios.set(f.id, formPublico(f));
      } catch {
        // Tabla ausente: la agenda se enseña igual, solo que sin formularios.
      }
    }

    const data = rows
      .filter((r) => Array.isArray(r.modalities) && r.modalities.includes("online"))
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        duration: r.duration,
        color: r.color,
        additionalDataLabel: r.additionalDataLabel,
        additionalDataRequired: r.additionalDataRequired,
        minNoticeHours: r.minNoticeHours,
        maxAdvanceDays: r.maxAdvanceDays,
        // Precio en céntimos (null = gratuita). El widget lo muestra y, si hay
        // precio, la reserva pasará por el checkout.
        price: r.price ?? null,
        // Bono de sesiones y pago a plazos (04/08/2026). Con `sessionsCount`
        // a 1 el widget se comporta exactamente como siempre.
        sessionsCount: r.sessionsCount ?? 1,
        instalmentPrice: r.instalmentPrice ?? null,
        instalmentMonths: r.instalmentMonths ?? null,
        // Preguntas que hay que responder al reservar ESTE tipo de cita. null =
        // ninguna, que es como se comportan todos los de hoy.
        form: r.formId ? (formularios.get(r.formId) ?? null) : null,
        // La primera visita: se entra sin firmar contratos (04/08/2026). El
        // portal la necesita para ofrecerla ANTES de la pantalla de firma.
        isInitialAssessment: Boolean(r.isInitialAssessment),
        order: r.order,
      }));

    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
