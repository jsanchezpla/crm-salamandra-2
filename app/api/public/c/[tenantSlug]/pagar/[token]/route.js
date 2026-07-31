import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verificarTokenPago } from "../../../../../../../lib/citas/tokenPago.js";
import { getStripe, getTenantStripeConfig } from "../../../../../../../lib/payments/stripeConfig.js";

/**
 * GET /api/public/c/[tenantSlug]/pagar/[token]
 *
 * Lo que necesita la página donde el paciente vuelve a meter su tarjeta, cuando
 * la profesional se la ha pedido por correo.
 *
 * ── QUÉ DEVUELVE Y QUÉ NO ────────────────────────────────────────────────────
 * Solo lo imprescindible para pintar la pantalla: qué servicio, cuándo, cuánto,
 * y el `clientSecret` de SU retención. Nada de teléfono, notas, ni el email
 * completo — quien tenga el enlace puede pagar esa cita, que es para lo que se
 * le dio, pero no tiene por qué poder leer la ficha de nadie.
 *
 * El token va en la URL, así que es lo más expuesto que hay (historial,
 * referrer, alguien mirando la pantalla). Por eso lo único que abre es un
 * formulario de pago de una cita concreta, caduca en 7 días, y no sirve para
 * cancelar ni para ver el resto de citas de esa persona.
 */
export const GET = withPublicTenant(
  async (_request, { params }, ctx) => {
    try {
      const { slug, tenantModels, hasModule } = ctx;
      if (!hasModule("citas")) return notFound("Módulo no disponible");

      const { token } = await params;

      let bookingId;
      try {
        ({ bookingId } = await verificarTokenPago(token, slug));
      } catch {
        // Mismo mensaje para firma mala, caducado y de otro tenant: distinguirlos
        // solo le sirve a quien esté probando tokens.
        return error("Este enlace ya no es válido. Pídele uno nuevo a tu profesional.", 401);
      }

      const { Booking, EventType, PaymentSession } = tenantModels;
      const cita = await Booking.findByPk(bookingId, {
        include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }],
      });
      if (!cita) return notFound("Cita no encontrada");

      // Si ya no hay nada que pagar, se dice con claridad en vez de enseñar un
      // formulario que fallaría al enviarlo.
      if (cita.status === "cancelled") {
        return error("Esta cita se canceló. No hay nada que pagar.", 409, { estado: "cancelada" });
      }
      if (["paid", "refunded"].includes(cita.paymentStatus)) {
        return error("Esta cita ya está pagada.", 409, { estado: "pagada" });
      }
      if (cita.paymentStatus === "authorized") {
        return error("Ya tienes la tarjeta puesta para esta cita.", 409, { estado: "lista" });
      }
      if (cita.paymentStatus !== "authorizing" || !cita.paymentSessionId) {
        return error("Este enlace ya no es válido. Pídele uno nuevo a tu profesional.", 409);
      }

      const ps = await PaymentSession.findByPk(cita.paymentSessionId);
      if (!ps || ps.status !== "authorizing" || !ps.stripePaymentIntentId) {
        return error("Este enlace ya no es válido. Pídele uno nuevo a tu profesional.", 409);
      }

      const cfg = getTenantStripeConfig(ctx);
      const stripe = await getStripe(ctx);
      if (!stripe || !cfg.publishableKey) {
        return error("El pago online no está disponible ahora mismo.", 503);
      }

      const pi = await stripe.paymentIntents.retrieve(ps.stripePaymentIntentId);
      if (pi?.status !== "requires_payment_method" && pi?.status !== "requires_confirmation") {
        return error("Este enlace ya no es válido. Pídele uno nuevo a tu profesional.", 409);
      }

      return ok({
        cita: {
          eventTypeName: cita.eventType?.name ?? null,
          scheduledAt: new Date(cita.scheduledAt).toISOString(),
          duration: cita.duration,
          modality: cita.modality,
          clientName: cita.clientName,
        },
        importe: ps.amount,
        clientSecret: pi.client_secret,
        publishableKey: cfg.publishableKey,
      });
    } catch (err) {
      return serverError(err);
    }
  },
  // El token es un secreto en la URL: se limita cuánto se puede probar a ciegas.
  { rateLimit: { limit: 30, windowMs: 10 * 60_000, key: "citas-pagar" } }
);
