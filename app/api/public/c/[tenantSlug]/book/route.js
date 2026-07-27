import { Op } from "sequelize";
import { puntuarSpam } from "../../../../../../lib/formularios/antispam.js";
import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { created, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { bookingReceivedTemplate } from "../../../../../../lib/email/templates/citas/bookingReceived.js";
import { bookingConfirmedTemplate } from "../../../../../../lib/email/templates/citas/bookingConfirmed.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
} from "../../../../../../lib/citas/validation.js";
import { findBookingOverlap, lockBookingSlot } from "../../../../../../lib/citas/booking.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { verifyPortalSession, readBearer } from "../../../../../../lib/citas/portalSession.js";
import {
  createCheckoutSession,
  CHECKOUT_WINDOW_MS,
  HOLD_WINDOW_MS,
} from "../../../../../../lib/payments/checkout.js";
import { tenantHasStripe } from "../../../../../../lib/payments/stripeConfig.js";
import {
  getMadridDayOfWeek,
  getMadridParts,
  getMadridTodayMidnight,
  pickAvailabilitiesForEventType,
  timeStrToMinutes,
} from "../../../../../../lib/citas/slots.js";

/** Origen público desde el que se sirvió la petición (para las URLs de Stripe). */
function baseUrl(request) {
  return new URL(request.url).origin;
}

/**
 * POST /api/public/c/[tenantSlug]/book
 *
 * Body: { eventTypeId, scheduledAt, clientName, clientEmail, clientPhone, additionalData? }
 *
 * Crea un Booking desde la landing pública. Solo modalidad 'online'.
 *
 * Si el tipo de cita tiene precio, la reserva nace como PROVISIONAL (bloquea el
 * hueco, `paymentStatus: 'pending'`, con caducidad) y se devuelve la URL de
 * Stripe. La cita solo se confirma cuando el webhook recibe el cobro.
 */
export const POST = withPublicTenant(async (request, _ctx, tenantContext) => {
  try {
    const { slug, tenant, tenantModels, hasModule } = tenantContext;
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const { EventType, Availability, Booking } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Antispam (arreglo 2026-07-23): la reserva pública no tenía honeypot ni
    // trampa de tiempo ni dedup (el formulario sí). A un bot se le responde
    // "ok" y no se guarda nada; un error le diría qué corregir.
    const { puntos } = puntuarSpam(body);
    if (puntos >= 2) {
      return created({ ok: true, mensaje: "Solicitud recibida" });
    }

    const eventTypeId = normalizeString(body.eventTypeId);
    if (!eventTypeId) return error("eventTypeId es obligatorio");

    const eventType = await EventType.findOne({ where: { id: eventTypeId, active: true } });
    if (!eventType) return notFound("EventType no encontrado o inactivo");
    if (!Array.isArray(eventType.modalities) || !eventType.modalities.includes("online")) {
      return notFound("EventType no disponible online");
    }

    const clientName = normalizeString(body.clientName);
    if (!clientName) return error("clientName es obligatorio", 422);

    // Email del cliente. Si llega un sessionToken válido del portal SSO
    // (Authorization: Bearer), se FUERZA el email al de la sesión verificada,
    // ignorando el del body — así un cliente logueado no puede reservar con
    // otro email y la cita aparece luego en su "Mis citas". Sin bearer válido →
    // flujo público normal (email del body).
    let clientEmail = normalizeEmail(body.clientEmail);
    try {
      const bearer = readBearer(request);
      if (bearer) {
        const session = await verifyPortalSession(bearer, slug);
        if (session?.email) clientEmail = normalizeEmail(session.email);
      }
    } catch {
      // bearer inválido/caducado → seguimos con el email del body (no rompemos
      // la reserva pública); se valida justo debajo.
    }
    if (!clientEmail || !isValidEmail(clientEmail)) return error("clientEmail inválido", 422);

    const clientPhone = normalizeString(body.clientPhone);
    if (!clientPhone) return error("clientPhone es obligatorio", 422);

    // Recorte de longitud (arreglo 2026-07-23): additionalData es TEXT sin tope
    // y el endpoint es público; sin recorte se puede escribir MB por reserva.
    const additionalData = body.additionalData != null ? String(body.additionalData).trim().slice(0, 2000) : null;
    if (eventType.additionalDataRequired && (!additionalData || additionalData === "")) {
      return error("additionalData es obligatorio para este tipo de cita", 422);
    }

    if (!body.scheduledAt) return error("scheduledAt es obligatorio", 422);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return error("scheduledAt inválido", 422);

    const now = new Date();

    // Validar antelación mínima
    const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
    if (scheduledAt.getTime() < now.getTime() + minNoticeMs) {
      return error("La cita no respeta la antelación mínima", 422);
    }

    const todayStart = getMadridTodayMidnight(now);
    const maxBoundary = new Date(todayStart.getTime() + eventType.maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (scheduledAt > maxBoundary) {
      return error("La cita excede el máximo de días de antelación", 422);
    }

    // Validar que cae dentro de una Availability del día
    const dayOfWeek = getMadridDayOfWeek(scheduledAt);
    const allDayAvailabilities = await Availability.findAll({ where: { dayOfWeek } });
    const applicable = pickAvailabilitiesForEventType(
      allDayAvailabilities.map((a) => a.toJSON()),
      eventType.id,
      dayOfWeek
    );
    if (applicable.length === 0) {
      return error("No hay disponibilidad ese día", 422);
    }

    const { hour: hMadrid, minute: mMadrid } = getMadridParts(scheduledAt);
    const scheduledMin = hMadrid * 60 + mMadrid;
    const endMin = scheduledMin + eventType.duration;

    let withinSlot = false;
    for (const av of applicable) {
      const s = timeStrToMinutes(av.startTime);
      const e = timeStrToMinutes(av.endTime);
      if (s == null || e == null) continue;
      if (scheduledMin >= s && endMin <= e) {
        withinSlot = true;
        break;
      }
    }
    if (!withinSlot) {
      return error("La hora seleccionada no está dentro de la disponibilidad", 422);
    }

    // El solapamiento y el dedup se comprueban más abajo, DENTRO de la
    // transacción que reserva el hueco (ver "Reserva del hueco"): comprobarlos
    // aquí sueltos era una carrera — entre la lectura y el INSERT cabía otra
    // petición que leía lo mismo y concluía lo mismo.

    // Determina si el booking nace 'confirmed' (default histórico) o
    // 'pending' (lista de espera). El flag vive en master.tenant_modules
    // del módulo citas del tenant. Default: true (auto-confirm) — solo
    // tenants que opten explícitamente por confirmación manual cambian
    // a false. `hasFeatureFlag` devuelve false si el flag está ausente,
    // pero aquí necesitamos distinguir "ausente (=true por defecto)" de
    // "puesto a false", así que leemos la fila directamente.
    let autoConfirm = true;
    try {
      const { TenantModule } = getMasterModels();
      const mod = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: "citas" },
        attributes: ["featureFlags"],
      });
      if (mod?.featureFlags?.autoConfirmPublicBookings === false) {
        autoConfirm = false;
      }
    } catch {
      // Si la lectura falla, conservamos el comportamiento histórico
      // (auto-confirm). No queremos romper el flujo de reserva por un
      // problema de lectura del flag.
    }

    // Enlace con la ficha de cliente (2026-07-22). Quien reserva desde el
    // portal viene identificado por el email de su cuenta de WordPress, así
    // que si ya es paciente podemos atar la cita a su ficha en el momento y no
    // depender de comparar cadenas de email al mostrarla.
    //
    // Best-effort: si no hay ficha (todavía no es cliente) o el tenant no
    // tiene módulo de clientes, la cita se crea igual sin enlazar. Reservar
    // NUNCA puede fallar por esto.
    let clientId = null;
    try {
      const { Client } = tenantModels;
      if (Client && clientEmail) {
        const ficha = await Client.findOne({
          where: { email: { [Op.iLike]: clientEmail } },
          attributes: ["id"],
          order: [["createdAt", "ASC"]],
        });
        if (ficha) clientId = ficha.id;
      }
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      if (code !== "42P01" && code !== "42703") {
        console.error(`[book] no se pudo enlazar la cita con su ficha: ${err.message}`);
      }
    }

    // ── ¿Esta cita se cobra? ────────────────────────────────────────────────
    // Solo si su tipo tiene precio. Sin precio (null o 0) el flujo es el de
    // siempre, así que los tenants que no cobran no notan absolutamente nada.
    const precio = Number.isInteger(eventType.price) && eventType.price > 0 ? eventType.price : null;

    if (precio && !tenantHasStripe(tenantContext)) {
      // Hay precio pero el profesional no ha terminado de configurar el cobro.
      // Mejor decirlo que crear una cita "gratis" que él cree cobrada.
      return error(
        "Este servicio requiere pago online, pero el profesional aún no lo tiene activado. Contacta con él.",
        503
      );
    }

    // ── Reserva del hueco (serializada) ─────────────────────────────────────
    // Ambas ventanas se calculan de UNA VEZ, aquí. Antes el hold usaba su propio
    // `Date.now()` y la sesión de Stripe otro posterior, así que la de Stripe
    // terminaba siempre más tarde: el hueco quedaba libre mientras el pago aún
    // era posible. Ahora el hold dura más que la sesión, a propósito.
    const ahora = Date.now();
    const stripeCaducaEn = new Date(ahora + CHECKOUT_WINDOW_MS);
    const holdCaducaEn = new Date(ahora + HOLD_WINDOW_MS);

    let row;
    try {
      row = await tenantContext.tenantSequelize.transaction(async (t) => {
        // Serializa contra otras reservas y contra los cambios de hora del panel.
        // A partir de aquí, la comprobación de hueco es de fiar.
        await lockBookingSlot(tenantContext.tenantSequelize, { transaction: t });

        const overlap = await findBookingOverlap(Booking, {
          scheduledAt,
          duration: eventType.duration,
          transaction: t,
        });
        if (overlap) {
          const e = new Error("OCUPADO");
          e.code = "OCUPADO";
          throw e;
        }

        // Dedup (arreglo 2026-07-23): misma persona reservando lo mismo en los
        // últimos 5 min (doble clic / reintento) → se responde ok sin duplicar.
        const hace5min = new Date(ahora - 5 * 60 * 1000);
        const yaReservado = await Booking.findOne({
          where: {
            scheduledAt,
            createdAt: { [Op.gte]: hace5min },
            [Op.or]: [{ clientEmail }, { clientPhone }],
          },
          attributes: ["id"],
          transaction: t,
        });
        if (yaReservado) {
          const e = new Error("DUPLICADO");
          e.code = "DUPLICADO";
          throw e;
        }

        return await Booking.create(
          {
            eventTypeId: eventType.id,
            clientName,
            clientEmail,
            clientPhone,
            additionalData,
            scheduledAt,
            duration: eventType.duration,
            modality: "online",
            meetUrl: eventType.meetUrl,
            // Con pago, la cita nace SIEMPRE 'pending' y solo pasa a 'confirmed'
            // cuando Stripe confirma el cobro — da igual lo que diga autoConfirm:
            // confirmar antes de cobrar sería regalar el hueco.
            status: precio ? "pending" : autoConfirm ? "confirmed" : "pending",
            // Reserva provisional: bloquea el hueco mientras se paga, con margen
            // por encima de la ventana de Stripe. Si no se paga, caduca sola
            // (ocupaHuecoWhere), sin depender de ningún proceso de limpieza.
            paymentStatus: precio ? "pending" : "none",
            amount: precio,
            holdExpiresAt: precio ? holdCaducaEn : null,
            clientId,
          },
          { transaction: t }
        );
      });
    } catch (err) {
      if (err?.code === "OCUPADO") {
        return error("Esa hora ya no está disponible, por favor elige otra", 409);
      }
      if (err?.code === "DUPLICADO") {
        return created({ ok: true, mensaje: "Solicitud recibida" });
      }
      throw err;
    }

    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: null,
      after: { ...row.toJSON(), source: "landing" },
      ip,
    });

    // ── Cita con pago: crear la sesión de Stripe y devolver su URL ──────────
    // El importe NO viene del cliente: se toma de EventType.price, ya validado
    // arriba. Ver la nota de seguridad en lib/payments/checkout.js.
    if (precio) {
      let checkoutUrl;
      try {
        const res = await createCheckoutSession(tenantContext, {
          entityType: "booking",
          entityId: row.id,
          amount: precio,
          description: `${eventType.name} — ${tenant.name}`,
          customerEmail: row.clientEmail,
          successUrl: `${baseUrl(request)}/widget/c/${tenant.slug}/mi-perfil`,
          cancelUrl: `${baseUrl(request)}/widget/c/${tenant.slug}`,
          metadata: { bookingId: row.id },
          // El MISMO instante que se usó para el hold, no un `Date.now()` nuevo.
          expiresAt: stripeCaducaEn,
        });
        checkoutUrl = res.checkoutUrl;
        await row.update({ paymentSessionId: res.paymentSession.id });
      } catch (err) {
        // Si no se puede cobrar, la reserva provisional no debe quedarse
        // bloqueando el hueco 30 minutos: se retira ya.
        await row.destroy().catch(() => {});
        process.stderr.write(`[citas:book] checkout falló: ${err.message}\n`);
        return error("No se pudo iniciar el pago. Inténtalo de nuevo en un momento.", 502);
      }

      // Sin email todavía: la cita aún no existe para el cliente hasta que pague.
      // El de confirmación lo dispara el webhook al cobrarse.
      return created({
        booking: {
          id: row.id,
          scheduledAt: row.scheduledAt.toISOString(),
          duration: row.duration,
          eventTypeName: eventType.name,
          eventTypeColor: eventType.color,
          clientEmail: row.clientEmail,
        },
        paymentRequired: true,
        amount: precio,
        checkoutUrl,
        expiresAt: row.holdExpiresAt.toISOString(),
      });
    }

    // Email best-effort según modo del tenant:
    //   - autoConfirm=true  → booking nace confirmed → bookingConfirmed inmediato
    //   - autoConfirm=false → booking nace pending   → bookingReceived (Laura
    //     confirma luego desde /confirm que dispara bookingConfirmed)
    try {
      let tpl;
      if (autoConfirm) {
        const cancelUrl = row.cancellationToken
          ? `/widget/c/${tenant.slug}/cancel/${row.cancellationToken}`
          : null;
        tpl = bookingConfirmedTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: row.clientName,
          eventTypeName: eventType.name,
          scheduledAt: row.scheduledAt,
          duration: row.duration,
          modality: row.modality,
          meetUrl: row.meetUrl,
          cancelUrl,
          location: eventType.location ?? null,
        });
      } else {
        tpl = bookingReceivedTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: row.clientName,
          eventTypeName: eventType.name,
          scheduledAt: row.scheduledAt,
        });
      }
      await sendEmail({ to: row.clientEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });
    } catch (mailErr) {
      process.stderr.write(`[citas:book] email fail (autoConfirm=${autoConfirm}): ${mailErr.message}\n`);
    }

    return created({
      booking: {
        id: row.id,
        scheduledAt: row.scheduledAt.toISOString(),
        duration: row.duration,
        eventTypeName: eventType.name,
        eventTypeColor: eventType.color,
        meetUrl: row.meetUrl,
        cancellationToken: row.cancellationToken,
        clientEmail: row.clientEmail,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
