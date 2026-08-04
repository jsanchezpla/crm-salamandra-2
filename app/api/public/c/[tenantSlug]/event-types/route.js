import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/public/c/[tenantSlug]/event-types
 *
 * Devuelve los EventType del tenant con active=true y 'online' en modalities.
 * Filtra los campos sensibles (meetUrl, location, phoneNumber, buffers).
 */
export const GET = withPublicTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { EventType } = tenantModels;
    const rows = await EventType.findAll({
      where: { active: true },
      order: [["order", "ASC"], ["createdAt", "ASC"]],
    });

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
        // Preguntas que hay que responder al reservar ESTE tipo de cita. Viven
        // en el propio tipo desde el 04/08/2026 (antes se enganchaba un
        // formulario del módulo Formularios, ver lib/citas/preguntasCita.js).
        // Array vacío = no pregunta nada, que es como están todas hoy.
        preguntas: normalizarPreguntas(r.formQuestions),
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
