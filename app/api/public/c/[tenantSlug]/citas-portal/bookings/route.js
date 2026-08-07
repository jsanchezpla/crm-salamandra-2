import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import { splitBookings } from "../../../../../../../lib/citas/clientBookingSerializer.js";
import { normalizeEmail } from "../../../../../../../lib/citas/validation.js";
import { noEsCarritoAbandonado } from "../../../../../../../lib/citas/booking.js";
import { CUPO_PORTAL } from "../../../../../../../lib/citas/portalRateLimit.js";
import { estadoPack } from "../../../../../../../lib/citas/packs.js";

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
    const bonos = new Map();
    const { SessionPack } = tenantModels;
    const idsDeBono = [...new Set(rows.map((r) => r.packId).filter(Boolean))];
    if (SessionPack && idsDeBono.length) {
      try {
        const packs = await SessionPack.findAll({
          where: { id: { [Op.in]: idsDeBono } },
          attributes: ["id", "totalSessions"],
        });
        const ahora = new Date();
        for (const pack of packs) {
          const suyas = rows.filter((r) => r.packId === pack.id);
          bonos.set(pack.id, estadoPack(pack, suyas, ahora).restantes);
        }
      } catch {
        // Sin la tabla o con un tropiezo, el aviso sale sin el número: sigue
        // diciendo lo importante, que es que NO se devuelve el dinero.
      }
    }

    return ok(splitBookings(rows, new Date(), bonos));
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });
