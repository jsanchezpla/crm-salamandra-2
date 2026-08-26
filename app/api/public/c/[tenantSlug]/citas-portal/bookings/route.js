import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import { splitBookings } from "../../../../../../../lib/citas/clientBookingSerializer.js";
import { normalizeEmail } from "../../../../../../../lib/citas/validation.js";
import { noEsCarritoAbandonado } from "../../../../../../../lib/citas/booking.js";
import { CUPO_PORTAL } from "../../../../../../../lib/citas/portalRateLimit.js";
import { estadoPack, proximoPagoDe, PAGO_FRACCIONADO } from "../../../../../../../lib/citas/packs.js";

/**
 * GET /api/public/c/[tenantSlug]/citas-portal/bookings
 *
 * Lista las citas del cliente autenticado con el sessionToken (por email).
 * Requiere `Authorization: Bearer <sessionToken>`.
 *
 *   200: { ok, data: { upcoming: [...], history: [...] } }
 *   401: sesión ausente/inválida/caducada · 403: SSO no habilitado · 404: tenant/módulo
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal de citas no habilitado");

    let email;
    try {
      ({ email } = await verifyPortalSession(readBearer(request), slug));
    } catch {
      return unauthorized("Sesión no válida o caducada");
    }

    // El email de la sesión viene del token SSO de WordPress SIN normalizar,
    // pero las reservas guardan clientEmail normalizado (trim + lowercase). Sin
    // normalizar aquí, un email de sesión con espacios (u otras diferencias que
    // ILIKE no cubre) no casaba y las citas confirmadas NO aparecían en "Mis
    // citas". Normalizamos igual que al reservar antes de comparar.
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return unauthorized("Sesión no válida o caducada");

    const { Booking, EventType } = tenantModels;
    const rows = await Booking.findAll({
      where: {
        clientEmail: { [Op.iLike]: normalizedEmail }, // usa bookings_client_email_idx
        // Fuera los carritos abandonados: si empezó a reservar y no llegó a
        // pagar, no es una cita suya y su hueco puede estar ya vendido a otra
        // persona. Enseñársela como "próxima" sería mentirle.
        ...noEsCarritoAbandonado(),
      },
      // `isInitialAssessment` viaja para que el portal sepa si esta persona YA
      // tiene su valoración inicial cogida: en ese caso no se le vuelve a
      // preguntar y entra directo a su perfil (04/08/2026).
      include: [
        {
          model: EventType,
          as: "eventType",
          attributes: ["id", "name", "color", "isInitialAssessment"],
        },
      ],
      order: [["scheduledAt", "ASC"]],
    });

    /*
     * Cuántas sesiones le quedan de cada bono (07/08/2026, Rodrigo): al cancelar
     * hay que decirle «la sesión vuelve a tu bono, te quedan N», no prometerle
     * una devolución que nunca llega.
     *
     * Se cuenta desde las citas que YA se han leído arriba —las sesiones
     * gastadas no son un contador, salen de las propias citas— así que lo único
     * que falta de la BD es el total de cada bono.
     */
    const ahora = new Date();
    const bonos = new Map();
    const { SessionPack } = tenantModels;
    const idsDeBono = [...new Set(rows.map((r) => r.packId).filter(Boolean))];
    if (SessionPack && idsDeBono.length) {
      try {
        const packs = await SessionPack.findAll({
          where: { id: { [Op.in]: idsDeBono } },
          attributes: ["id", "totalSessions"],
        });
        for (const pack of packs) {
          const suyas = rows.filter((r) => r.packId === pack.id);
          bonos.set(pack.id, estadoPack(pack, suyas, ahora).restantes);
        }
      } catch {
        // Sin la tabla o con un tropiezo, el aviso sale sin el número: sigue
        // diciendo lo importante, que es que NO se devuelve el dinero.
      }
    }

    /*
     * El próximo pago de cada fraccionado (26/08/2026, Rodrigo): quien paga su
     * programa por meses ve en su área privada qué día le toca la siguiente
     * cuota. Se buscan los bonos por CORREO y no por las citas de arriba: el
     * plan sigue cobrándose aunque hoy no tenga ninguna cita puesta.
     *
     * Best-effort como los bonos: si la tabla no está o algo tropieza, el
     * portal enseña las citas igual y esta sección simplemente no sale.
     */
    const pagos = [];
    if (SessionPack) {
      try {
        const fraccionados = await SessionPack.findAll({
          where: {
            clientEmail: { [Op.iLike]: normalizedEmail },
            pricingMode: PAGO_FRACCIONADO,
            status: { [Op.ne]: "anulado" },
          },
          include: [{ model: tenantModels.EventType, as: "eventType", attributes: ["name"] }],
          order: [["purchasedAt", "ASC"]],
        });
        for (const pack of fraccionados) {
          const pago = proximoPagoDe(pack, ahora);
          if (!pago) continue; // pago único imposible aquí, pero sí un plan ya completado
          pagos.push({
            id: pack.id,
            nombre: pack.eventType?.name ?? "Tu programa",
            cuota: pago.cuota,
            totalCuotas: pago.totalCuotas,
            importe: pago.importe,
            fecha: pago.fecha.toISOString(),
          });
        }
      } catch {
        // Sin sección de pagos; las citas se enseñan igual.
      }
    }

    // El tenant va porque de él depende que la cita salga como anulable: un
    // centro que gestiona sus citas por teléfono no enseña el botón.
    const data = splitBookings(rows, ahora, bonos, tenant);
    data.pagos = pagos;
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });
