import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { findBookingOverlap, lockBookingSlot } from "../../../../../../lib/citas/booking.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { bookingConfirmedTemplate } from "../../../../../../lib/email/templates/citas/bookingConfirmed.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * PATCH /api/citas/bookings/[id]/confirm
 *
 * Transición pending → confirmed. Idempotente:
 *   - Si ya está confirmed, devuelve 200 con el booking sin cambios.
 *   - Si está cancelled/completed/no_show, devuelve 403 (no permitido).
 *   - Si está pending, valida hueco y confirma.
 *
 * ── POR QUÉ ESTO VA DENTRO DE UNA TRANSACCIÓN CON LOCK (2026-07-29) ───────────
 * Hasta ahora la comprobación de solape se hacía SUELTA: leer, comprobar,
 * escribir, sin transacción ni lock. Entre la lectura y la escritura cabe otra
 * petición que lee lo mismo y concluye lo mismo, así que dos confirmaciones
 * simultáneas de la misma hora pasaban las dos.
 *
 * Con citas gratuitas eso era una molestia de agenda. En cuanto confirmar pase a
 * CAPTURAR el dinero de la retención, son dos pacientes cobrados por la misma
 * hora. La reserva pública ya se protegía así desde el sprint de pagos
 * (`/book` usa `lockBookingSlot` + `findBookingOverlap` con transacción); este
 * camino se había quedado fuera, que es justo el que va a mover dinero.
 *
 * La clave del lock se pide SIN `teamMemberId` a propósito, igual que en `/book`:
 * el lock solo sirve si todos los caminos que tocan la agenda usan LA MISMA
 * clave. Pasar aquí el profesional de la cita crearía una clave distinta y las
 * dos rutas dejarían de serializarse entre sí — que es exactamente el fallo que
 * esto viene a cerrar. El solape sí se sigue calculando por profesional: son dos
 * cosas distintas (a quién bloqueo vs. con quién choco).
 *
 * La fila se vuelve a leer DENTRO de la transacción. La leída antes del lock es
 * una foto vieja: pudo cancelarse o confirmarse mientras esperábamos.
 */
export const PATCH = withTenant(
  async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
    try {
      if (!hasModule("citas")) return forbidden("Módulo citas no activo");
      const userRole = request.headers.get("x-user-role") ?? "user";
      const userId = request.headers.get("x-user-id");
      const ip = request.headers.get("x-forwarded-for") ?? null;
      if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede confirmar citas");

      const { id } = await params;
      const { Booking, EventType } = tenantModels;

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

          // Confirmar una cita que ya pasó no tiene sentido y, en cuanto
          // confirmar cobre, sería cobrarle a alguien por una hora que nunca
          // llegó a ocurrir. Nadie lo comprobaba.
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
          await row.update({ status: "confirmed" }, { transaction: t });
          return { row, estadoAnterior };
        });
      } catch (err) {
        if (err?.code === "NO_EXISTE") return notFound("Cita no encontrada");
        if (err?.code === "ESTADO") {
          return forbidden(`No se puede confirmar una cita en estado '${err.estado}'`);
        }
        if (err?.code === "PASADA") {
          return error("No se puede confirmar una cita cuya hora ya ha pasado", 409);
        }
        if (err?.code === "SOLAPA") {
          const cuando = err.cuando?.toISOString?.() ?? err.cuando;
          return forbidden(`La cita solapa con otra activa el ${cuando}`);
        }
        throw err;
      }

      const { row, yaEstaba, estadoAnterior } = resultado;
      if (yaEstaba) {
        process.stdout.write(`[citas:confirm] booking=${row.id} noop (ya confirmed)\n`);
        return ok(row.toJSON());
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
        after: { status: "confirmed" },
        ip,
      });

      process.stdout.write(`[citas:confirm] booking=${row.id} pending→confirmed\n`);

      // Email best-effort: si falla, log + sigue. No rompe el flujo.
      try {
        const cancelUrl = row.cancellationToken
          ? `/widget/c/${tenant.slug}/cancel/${row.cancellationToken}`
          : null;
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
        process.stderr.write(`[citas:confirm] email-confirmed fail: ${mailErr.message}\n`);
      }

      return ok(row.toJSON());
    } catch (err) {
      return serverError(err);
    }
  }
);
