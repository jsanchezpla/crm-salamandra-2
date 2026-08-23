import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { citaSegunRol } from "../../../../../../lib/citas/dinero.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { enlaceCancelacion } from "../../../../../../lib/citas/cancelacion.js";
import { findBookingOverlap, lockBookingSlot } from "../../../../../../lib/citas/booking.js";
import {
  cobrarCitaAlConfirmar,
  soltarRetencionDeCita,
  tieneRetencionPendiente,
  estaEsperandoAlPaciente,
} from "../../../../../../lib/citas/cobroCita.js";
import { reembolsarCitaSiProcede } from "../../../../../../lib/citas/reembolsoCita.js";
import { MOTIVO_COBRO_DE_CITA_CANCELADA } from "../../../../../../lib/citas/politicaReembolso.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { avisarCitaPorWhatsapp } from "../../../../../../lib/citas/avisosWhatsapp.js";
import { citaPuedeAvisar } from "../../../../../../lib/clients/comunicaciones.js";
import { bookingConfirmedTemplate } from "../../../../../../lib/email/templates/citas/bookingConfirmed.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";


/**
 * PATCH /api/citas/bookings/[id]/confirm
 *
 * Confirma una cita y, si tiene la tarjeta retenida, LA COBRA.
 *
 * Body opcional: { sinCobrar?: boolean }
 *
 * ── LA REGLA DE ORO ──────────────────────────────────────────────────────────
 * SI NO HAY DINERO, LA CITA NO SE CONFIRMA. El cobro va ANTES de dar la cita por
 * buena, no después, para que no exista jamás el estado "confirmada pero el
 * cobro falló" — que es el que hace que la profesional cierre su agenda creyendo
 * que ha cobrado. Si la captura falla, la solicitud se queda esperando y ella ve
 * por qué.
 *
 * `sinCobrar: true` es la salida para cuando la retención ha caducado: hay una
 * persona real que pidió cita y la respuesta correcta no es rechazarla, es
 * aceptarla y cobrarle en consulta. Queda registrado en la auditoría.
 *
 * Idempotente:
 *   - Si ya está confirmed, devuelve 200 sin cambios.
 *   - Si está cancelled/completed/no_show, devuelve 403.
 *
 * ── POR QUÉ ESTO VA DENTRO DE UNA TRANSACCIÓN CON LOCK (2026-07-29) ───────────
 * Hasta ahora la comprobación de solape se hacía SUELTA: leer, comprobar,
 * escribir, sin transacción ni lock. Entre la lectura y la escritura cabe otra
 * petición que lee lo mismo y concluye lo mismo, así que dos confirmaciones
 * simultáneas de la misma hora pasaban las dos. Con citas gratuitas era una
 * molestia de agenda; cobrando son dos pacientes cobrados por la misma hora.
 *
 * La clave del lock se pide SIN `teamMemberId`, igual que en `/book`: el lock
 * solo sirve si todos los caminos que tocan la agenda usan LA MISMA clave. El
 * solape sí se calcula por profesional — son dos cosas distintas (a quién
 * bloqueo vs. con quién choco).
 *
 * El cobro se hace FUERA de la transacción: es una llamada de red a Stripe y
 * dentro mantendría bloqueadas las filas de la agenda mientras dura. Para que
 * nadie cobre dos veces en ese hueco, la transacción deja la cita marcada como
 * `capturing` antes de soltar el lock.
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, tenantSequelize, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    /*
     * Confirmar lo hace CUALQUIERA del equipo (06/08/2026, Rodrigo), igual que
     * apuntar y rechazar. Lo dejé en admin al abrir los otros dos porque esto
     * puede cobrar la tarjeta retenida; Rodrigo lo revisó y decidió abrirlo:
     * quien atiende la lista de espera es quien la resuelve, y partirla en «tú
     * puedes decir que no pero no que sí» no es una lista de espera.
     *
     * Sigue haciendo falta sesión y módulo de citas. Y todo lo que protege el
     * cobro no se ha tocado: la regla de oro de arriba —si no hay dinero, la
     * cita no se confirma—, la transacción con lock y la auditoría, que ya
     * apunta QUIÉN confirma cada una.
     */

    const { id } = await params;
    const { Booking, EventType } = tenantModels;

    let body = {};
    try { body = await request.json(); } catch { /* body opcional */ }
    const sinCobrar = body?.sinCobrar === true;

    let resultado;
    try {
      resultado = await tenantSequelize.transaction(async (t) => {
        // Serializa contra la reserva pública y contra otras confirmaciones.
        await lockBookingSlot(tenantSequelize, { transaction: t });

        const row = await Booking.findByPk(id, {
          include: [{ model: EventType, as: "eventType" }],
          transaction: t,
        });
        if (!row) {
          const e = new Error("NO_EXISTE");
          e.code = "NO_EXISTE";
          throw e;
        }

        // Idempotencia: ya confirmada. Se resuelve dentro del lock para no
        // responder "ya estaba" leyendo una foto anterior a la confirmación
        // que acaba de hacer otra petición.
        if (row.status === "confirmed") return { row, yaEstaba: true };

        if (row.status !== "pending") {
          const e = new Error("ESTADO");
          e.code = "ESTADO";
          e.estado = row.status;
          throw e;
        }

        // Confirmar una cita que ya pasó no tiene sentido y, cobrando, sería
        // cobrarle a alguien por una hora que nunca llegó a ocurrir.
        if (new Date(row.scheduledAt).getTime() <= Date.now()) {
          const e = new Error("PASADA");
          e.code = "PASADA";
          throw e;
        }

        const overlap = await findBookingOverlap(Booking, {
          scheduledAt: row.scheduledAt,
          duration: row.duration,
          excludeId: row.id,
          teamMemberId: row.teamMemberId,
          transaction: t,
        });
        if (overlap) {
          const e = new Error("SOLAPA");
          e.code = "SOLAPA";
          e.cuando = overlap.scheduledAt;
          throw e;
        }

        const estadoAnterior = row.status;

        // El paciente está tecleando su tarjeta AHORA. Confirmar en este
        // instante confirmaba la cita sin cobrar y dejaba el dinero muerto:
        // segundos después el webhook escribía 'authorized' sobre una cita ya
        // confirmada, un par que no captura nadie. Se para aquí.
        if (estaEsperandoAlPaciente(row)) {
          const e = new Error("TECLEANDO");
          e.code = "TECLEANDO";
          throw e;
        }

        // Con dinero retenido, la cita NO se confirma todavía: primero hay que
        // cobrarlo. Se marca `capturing` para que ninguna otra petición intente
        // capturar lo mismo mientras esta habla con Stripe.
        if (tieneRetencionPendiente(row) && !sinCobrar) {
          await row.update({ paymentStatus: "capturing" }, { transaction: t });
          return { row, estadoAnterior, hayQueCobrar: true };
        }

        // Confirmar SIN COBRAR teniendo dinero retenido seria dar la cita y
        // dejar el importe bloqueado en su tarjeta sin cobrarlo jamás. Se suelta
        // primero; el paciente pagará en consulta, que es lo que significa este
        // botón.
        const hayQueSoltar = sinCobrar && tieneRetencionPendiente(row);

        await row.update({ status: "confirmed" }, { transaction: t });
        return { row, estadoAnterior, hayQueCobrar: false, hayQueSoltar };
      });
    } catch (err) {
      if (err?.code === "NO_EXISTE") return notFound("Cita no encontrada");
      if (err?.code === "ESTADO") {
        return forbidden(`No se puede confirmar una cita en estado '${err.estado}'`);
      }
      if (err?.code === "PASADA") {
        return error("No se puede confirmar una cita cuya hora ya ha pasado", 409);
      }
      if (err?.code === "TECLEANDO") {
        return error(
          "El paciente está introduciendo su tarjeta ahora mismo. Espera unos segundos y vuelve a intentarlo.",
          409,
          { code: "TECLEANDO" }
        );
      }
      if (err?.code === "SOLAPA") {
        const cuando = err.cuando?.toISOString?.() ?? err.cuando;
        return forbidden(`La cita solapa con otra activa el ${cuando}`);
      }
      throw err;
    }

    const { row, yaEstaba, estadoAnterior, hayQueCobrar, hayQueSoltar } = resultado;
    if (yaEstaba) {
      process.stdout.write(`[citas:confirm] booking=${row.id} noop (ya confirmed)\n`);
      return ok(citaSegunRol(row.toJSON(), request.headers.get("x-user-role")));
    }

    // ── El cobro, fuera del lock ─────────────────────────────────────────────
    let cobro = null;
    if (hayQueCobrar) {
      cobro = await cobrarCitaAlConfirmar(ctx, row);

      if (!cobro.cobrado) {
        // NO se confirma y NO sale ningún correo. `cobrarCitaAlConfirmar` ya ha
        // dejado el estado del dinero como toca (void si caducó, failed si la
        // rechazaron), así que la cita se queda visible en la lista de espera
        // marcada, esperando a que ella decida.
        await logCitasAudit({
          tenantId: tenant.id,
          userId,
          action: "citas.booking_confirm_failed",
          entity: "Booking",
          entityId: row.id,
          before: { status: estadoAnterior },
          after: { cobro: cobro.code ?? "fallo", importe: row.amount ?? null },
          ip,
        });
        process.stderr.write(`[citas:confirm] booking=${row.id} NO confirmada: ${cobro.code}\n`);
        return error(cobro.mensaje, 409, { code: cobro.code });
      }

      // ── El dinero ya está cobrado. ¿Sigue habiendo cita? ──────────────────
      // Entre que soltamos el lock para hablar con Stripe y volvemos aquí caben
      // varios segundos, y en ellos el paciente puede haber cancelado desde el
      // enlace de su correo. Escribir 'confirmed' a ciegas resucitaba una cita
      // cancelada Y le dejaba el cobro hecho.
      //
      // Se relee dentro de una transacción: si ya no está en pie, no se
      // confirma y se devuelve el dinero, que es lo único honesto cuando has
      // cobrado por algo que la otra parte ya había cancelado. Esa devolución
      // es LA excepción a «no se devuelve nunca» y vive con su porqué en
      // `lib/citas/politicaReembolso.js` (20/08/2026, Jorge), no aquí.
      // OJO con qué cuenta como "ya no está en pie". La primera versión de esta
      // guarda exigía `status === 'pending'` y devolvía el dinero en cuanto no
      // lo fuera — incluida la cita que otra petición simultánea acababa de
      // dejar en 'confirmed'. Resultado: dos confirmaciones a la vez cobraban
      // bien y acto seguido se devolvían el cobro solas. Lo detectó la prueba de
      // carreras, no el ojo.
      //
      // Solo se devuelve el dinero si la cita ha DESAPARECIDO de la agenda
      // (cancelada o no presentado). Que ya esté confirmada es el resultado que
      // buscábamos, no un problema.
      const sigueEnPie = await tenantSequelize.transaction(async (t) => {
        const fresca = await Booking.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!fresca) return false;
        if (fresca.status === "cancelled" || fresca.status === "no_show") return false;
        if (fresca.status === "pending") {
          await fresca.update({ status: "confirmed" }, { transaction: t });
        }
        return true;
      });

      if (!sigueEnPie) {
        await row.reload();
        const dev = await reembolsarCitaSiProcede(ctx, row, {
          quienCancela: "profesional",
          motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
        });
        process.stderr.write(
          `[citas:confirm] booking=${row.id} COBRADA PERO YA NO ESTABA EN PIE (${row.status}) — ${dev.motivo}\n`
        );
        await logCitasAudit({
          tenantId: tenant.id,
          userId,
          action: "citas.booking_confirm_tarde",
          entity: "Booking",
          entityId: row.id,
          before: { status: estadoAnterior },
          after: {
            status: row.status,
            cobrado: cobro.importe ?? null,
            devuelto: dev.reembolsado ? dev.importe : null,
            desenlace: dev.motivo,
            ...(dev.error ? { error: dev.error } : {}),
          },
          ip,
        });
        // El mensaje lo dicta lo que ha pasado con el dinero, no lo que
        // esperábamos que pasara: la devolución es best-effort y hasta el
        // 20/08/2026 esta frase prometía un importe que no volvía nunca.
        return error(
          `La cita dejó de estar disponible mientras se procesaba el cobro. ${dev.motivo}.`,
          409,
          { code: "CANCELADA_A_MEDIAS" }
        );
      }
    }

    // Confirmada sin cobrar teniendo dinero retenido: se suelta, o quedaría
    // bloqueado en su tarjeta por una cita que se le ha dado igualmente.
    if (hayQueSoltar) {
      await soltarRetencionDeCita(ctx, row, "Confirmada sin cobrar online");
    }

    await row.reload();

    // Auditoría DESPUÉS de la mutación y FUERA de la transacción: escribe en
    // master con otra conexión, y dentro dejaría rastro de un cambio que un
    // rollback deshiciera.
    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_confirmed",
      entity: "Booking",
      entityId: row.id,
      before: { status: estadoAnterior },
      after: {
        status: "confirmed",
        // Lo que de verdad importa auditar aquí es si se movió dinero y cuánto.
        cobrado: cobro?.cobrado ? (cobro.importe ?? row.amount ?? null) : null,
        sinCobrar: sinCobrar || undefined,
      },
      ip,
    });

    process.stdout.write(
      `[citas:confirm] booking=${row.id} pending→confirmed${cobro?.cobrado ? ` (cobrado ${cobro.importe})` : sinCobrar ? " (SIN COBRAR)" : ""}\n`
    );

    // Email best-effort: si falla, log + sigue. No rompe el flujo.
    // Y solo si la familia quiere avisos por correo (01/08/2026): quien
    // desmarcó esa casilla no recibe correos de citas, sin excepciones.
    try {
      if (!(await citaPuedeAvisar(tenantModels, row, "citasEmail"))) throw new Error("SIN_CONSENTIMIENTO_EMAIL");
      // null si el centro no deja anular a la familia: la plantilla ya sabe no
      // pintar el enlace (08/08/2026).
      const cancelUrl = enlaceCancelacion(tenant, { slug: tenant.slug, token: row.cancellationToken });
      const { subject, html, text } = bookingConfirmedTemplate({
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        clientName: row.clientName,
        eventTypeName: row.eventType?.name ?? "tu cita",
        scheduledAt: row.scheduledAt,
        duration: row.duration,
        modality: row.modality,
        meetUrl: row.meetUrl,
        cancelUrl,
        location: row.eventType?.location ?? null,
        // Para que el correo no diga lo mismo cobrando que sin cobrar.
        importe: row.amount ?? null,
        cobro: cobro?.cobrado ? "cobrada" : sinCobrar ? "sin_cobrar" : null,
      });
      // BYOK: cada cliente manda desde SU cuenta de Resend y su dominio
      // (mejor entrega, y su consumo no gasta el cupo de los demás).
      const cfgResend = getTenantResendConfig({ tenant });
      await sendEmail({
        to: row.clientEmail,
        subject,
        html,
        text,
        from: cfgResend.fromEmail || undefined,
        replyTo: cfgResend.replyTo || undefined,
        apiKey: cfgResend.apiKey || undefined,
      });
    } catch (mailErr) {
      if (mailErr.message === "SIN_CONSENTIMIENTO_EMAIL") {
        process.stdout.write(`[citas:confirm] ${row.id}: sin correo, la familia no quiere avisos por email\n`);
      } else {
        process.stderr.write(`[citas:confirm] email-confirmed fail: ${mailErr.message}\n`);
      }
    }

    // Y por WhatsApp, si el cliente lo tiene encendido: credenciales propias,
    // interruptor del cliente y consentimiento de la familia (ver
    // lib/citas/avisosWhatsapp.js). Nunca lanza.
    await avisarCitaPorWhatsapp(ctx, {
      booking: row,
      tipo: "confirmada",
      eventTypeName: row.eventType?.name,
    });

    return ok(citaSegunRol(row.toJSON(), request.headers.get("x-user-role")));
  } catch (err) {
    return serverError(err);
  }
});
