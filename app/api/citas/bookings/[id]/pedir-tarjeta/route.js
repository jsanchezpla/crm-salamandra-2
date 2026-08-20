import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { autorizarPago, tenantPuedeAutorizar } from "../../../../../../lib/payments/autorizacion.js";
import { estorbaParaPedirOtraTarjeta, estaEsperandoAlPaciente } from "../../../../../../lib/citas/cobroCita.js";
import { firmarTokenPago } from "../../../../../../lib/citas/tokenPago.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { pedirTarjetaTemplate } from "../../../../../../lib/email/templates/citas/pedirTarjeta.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";
import { esCorreoTransaccional } from "../../../../../../lib/clients/comunicaciones.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Cuánto se le guarda la hora mientras vuelve a poner la tarjeta.
 *
 * ── POR QUÉ ESTO NO ES OPCIONAL ──────────────────────────────────────────────
 * Al pedirle la tarjeta otra vez, la cita vuelve a `paymentStatus:'authorizing'`,
 * y ese estado SOLO ocupa su hueco mientras `holdExpiresAt` siga en el futuro
 * (ver `noEsCarritoAbandonado`). Dejarlo a null haría desaparecer la solicitud
 * de la lista de espera y liberaría la hora en el mismo momento en que la
 * profesional decide esperar a esa persona — justo lo contrario de lo que ella
 * acaba de pedir.
 *
 * Se le da la misma vida que al enlace del correo: mientras el enlace sirva, la
 * hora es suya. Cuando el enlace muere, la hora vuelve al mercado, que es
 * coherente — nadie pagó y nadie volvió a pedirlo.
 */
const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/citas/bookings/[id]/pedir-tarjeta
 *
 * Le pide al paciente que vuelva a introducir una tarjeta: crea una retención
 * NUEVA y le manda el enlace por correo.
 *
 * Es la tercera salida de la lista de espera cuando el dinero se ha perdido
 * (caducó o lo rechazaron), junto a "confirmar sin cobrar" y "rechazar".
 *
 * ── SE CREA UNA AUTORIZACIÓN NUEVA, NO SE REINTENTA LA VIEJA ─────────────────
 * Un PaymentIntent cancelado queda MUERTO: Stripe no deja capturarlo ni
 * reutilizarlo. Así que esto no "revive" nada, empieza de cero — con su propia
 * PaymentSession, para que el histórico de intentos quede completo y se pueda
 * ver qué pasó con cada uno.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede pedir la tarjeta");

    const { id } = await params;
    const { Booking, EventType } = tenantModels;
    const row = await Booking.findByPk(id, { include: [{ model: EventType, as: "eventType" }] });
    if (!row) return notFound("Cita no encontrada");

    if (row.status !== "pending") {
      return error(
        `Solo se puede pedir la tarjeta de una solicitud pendiente (esta está '${row.status}')`,
        409
      );
    }
    if (new Date(row.scheduledAt).getTime() <= Date.now()) {
      return error("Esta cita ya ha pasado", 409);
    }
    if (!Number.isInteger(row.amount) || row.amount <= 0) {
      return error("Esta cita no tiene importe: no hay nada que cobrar", 409);
    }
    if (estaEsperandoAlPaciente(row)) {
      return error(
        "El paciente ya tiene un formulario de tarjeta abierto. Espera a que termine antes de pedirle otro.",
        409
      );
    }
    if (!tenantPuedeAutorizar(ctx)) {
      return error("El cobro online no está configurado del todo", 503);
    }
    // Comprobación PROPIA, no `tieneRetencionPendiente`: esa lista mete
    // 'failed' a propósito y cortaba aquí toda cita con la tarjeta rechazada,
    // que es justo el caso para el que existe este botón. Ver el porqué en
    // `lib/citas/cobroCita.js`.
    //
    // Va DESPUÉS de comprobar que hay Stripe configurado porque le pregunta a
    // Stripe: al revés, a un cliente sin cobro online se le contestaba «no se ha
    // podido comprobar» pudiendo decirle lo que de verdad le pasa.
    const estorbo = await estorbaParaPedirOtraTarjeta(ctx, row);
    if (estorbo.estorba) {
      return error(estorbo.mensaje, 409);
    }
    if (!row.clientEmail) {
      return error("Esta cita no tiene email al que escribir", 409);
    }

    // ── Retención nueva ─────────────────────────────────────────────────────
    const motivo = row.paymentStatus === "failed" ? "rechazada" : "caducada";
    let datosPago;
    try {
      datosPago = await autorizarPago(ctx, {
        entityType: "booking",
        entityId: row.id,
        amount: row.amount,
        description: `${row.eventType?.name ?? "Cita"} — ${tenant.name}`,
        customerEmail: row.clientEmail,
        metadata: { bookingId: row.id, reintento: true, motivo },
      });
    } catch (err) {
      process.stderr.write(`[citas:pedir-tarjeta] falló crear la retención: ${err.message}\n`);
      return error("No se pudo preparar el pago. Inténtalo de nuevo en un momento.", 502);
    }

    let enlace;
    try {
      const token = await firmarTokenPago({ bookingId: row.id, tenant: tenant.slug });
      enlace = `${new URL(request.url).origin}/widget/c/${tenant.slug}/pagar/${token}`;
    } catch {
      return error(
        "Falta configurar el secreto de los enlaces de pago (CITAS_PORTAL_SESSION_SECRET).",
        503
      );
    }

    await row.update({
      paymentStatus: "authorizing",
      paymentSessionId: datosPago.paymentSession.id,
      authorizationExpiresAt: null,
      holdExpiresAt: new Date(Date.now() + VENTANA_MS),
    });

    // El correo va al final y es best-effort en lo que respecta al 200: si falla,
    // la retención ya está creada y el enlace se puede reenviar. Pero se le dice
    // a la profesional, porque un "hecho" sobre un correo que no salió la deja
    // esperando una respuesta que nadie va a dar.
    let correoOk = true;
    try {
      if (!esCorreoTransaccional("pedirTarjeta")) throw new Error("NO_DECLARADO_TRANSACCIONAL");
      const tpl = pedirTarjetaTemplate({
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        clientName: row.clientName,
        eventTypeName: row.eventType?.name ?? "tu cita",
        scheduledAt: row.scheduledAt,
        importe: row.amount,
        enlace,
        motivo,
      });
      const cfgResend = getTenantResendConfig({ tenant });
      const envio = await sendEmail({
        to: row.clientEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        from: cfgResend.fromEmail || undefined,
        replyTo: cfgResend.replyTo || undefined,
        apiKey: cfgResend.apiKey || undefined,
      });
      correoOk = !!envio?.ok && !envio?.dryRun;
    } catch (mailErr) {
      correoOk = false;
      if (mailErr.message === "NO_DECLARADO_TRANSACCIONAL") {
        process.stdout.write(`[citas:pedir-tarjeta] sin correo: la plantilla ya no es transaccional\n`);
      } else {
        process.stderr.write(`[citas:pedir-tarjeta] email falló: ${mailErr.message}\n`);
      }
    }

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_tarjeta_pedida",
      entity: "Booking",
      entityId: row.id,
      before: { paymentStatus: motivo === "rechazada" ? "failed" : "void", importe: row.amount },
      after: { paymentStatus: "authorizing", motivo, correoEnviado: correoOk },
      ip,
    });

    await row.reload();
    return ok({
      booking: row.toJSON(),
      correoEnviado: correoOk,
      // Se devuelve para que ella pueda pasárselo por WhatsApp si el correo no
      // sale. Es el mismo enlace que ya tiene el paciente en su bandeja: no
      // añade exposición, y evita que una solicitud se muera por un correo
      // perdido en spam.
      enlace,
    });
  } catch (err) {
    return serverError(err);
  }
});
