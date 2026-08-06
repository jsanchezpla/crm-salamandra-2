import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import { normalizeEmail } from "../../../../../../../lib/citas/validation.js";
import { CUPO_PORTAL } from "../../../../../../../lib/citas/portalRateLimit.js";

/**
 * Avisos del centro, en el área privada del cliente.
 *
 * El correo se pierde entre otros cincuenta; el portal sigue ahí en enero. Por
 * eso cada aviso se publica también aquí, y no solo se manda.
 *
 * Se listan por EMAIL de la sesión verificada, igual que las citas: es lo único
 * que compartimos con WordPress, y muchos clientes no tienen ficha creada.
 *
 * ⚠️ Nunca se filtra nada que no sea suyo: el `where` va siempre atado al email
 * del token, jamás a un id que venga del cliente.
 */

const LIMITE = 40;

/** Resuelve el email verificado de la sesión, o null. */
async function emailDeLaSesion(request, slug) {
  try {
    const { email } = await verifyPortalSession(readBearer(request), slug);
    return normalizeEmail(email) || null;
  } catch {
    return null;
  }
}

/**
 * GET — los avisos del cliente, del más nuevo al más viejo.
 *   200: { ok, data: { avisos: [...], sinLeer: n } }
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal de citas no habilitado");

    const email = await emailDeLaSesion(request, slug);
    if (!email) return unauthorized("Sesión no válida o caducada");

    const { ClientNotice } = tenantModels;
    // Tener el módulo no garantiza tener la tabla (schemas anteriores a la
    // migración). Sin avisos que enseñar, el portal se pinta igual: esto es una
    // sección más, no la pantalla.
    if (!ClientNotice) return ok({ avisos: [], sinLeer: 0 });

    let filas;
    try {
      filas = await ClientNotice.findAll({
        where: { clientEmail: { [Op.iLike]: email } },
        order: [["createdAt", "DESC"]],
        limit: LIMITE,
      });
    } catch (err) {
      process.stderr.write(`[portal:avisos] no se pudieron leer: ${err.message}\n`);
      return ok({ avisos: [], sinLeer: 0 });
    }

    return ok({
      avisos: filas.map((a) => ({
        id: a.id,
        titulo: a.title,
        cuerpo: a.body,
        creado: a.createdAt,
        leido: !!a.readAt,
      })),
      sinLeer: filas.filter((a) => !a.readAt).length,
    });
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });

/**
 * POST — marcar avisos como leídos.
 *   Body: { ids: [uuid, …] }
 *
 * Solo marca los que SON SUYOS: el `where` lleva el email de la sesión además
 * de los ids, así que mandar el id de otro no hace nada.
 */
export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal de citas no habilitado");

    const email = await emailDeLaSesion(request, slug);
    if (!email) return unauthorized("Sesión no válida o caducada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string" && x) : [];
    if (!ids.length) return ok({ marcados: 0 });

    const { ClientNotice } = tenantModels;
    if (!ClientNotice) return ok({ marcados: 0 });

    const [marcados] = await ClientNotice.update(
      { readAt: new Date() },
      {
        where: {
          id: { [Op.in]: ids.slice(0, LIMITE) },
          clientEmail: { [Op.iLike]: email },
          readAt: null, // no se re-marca: la primera vez que lo vio es la buena
        },
      }
    );

    return ok({ marcados });
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });
