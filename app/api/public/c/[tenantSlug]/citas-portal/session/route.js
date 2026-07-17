import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyWpSsoToken } from "../../../../../../../lib/citas/ssoToken.js";
import { signPortalSession, SESSION_TTL_SECONDS } from "../../../../../../../lib/citas/portalSession.js";
import { normalizeEmail } from "../../../../../../../lib/citas/validation.js";

/**
 * POST /api/public/c/[tenantSlug]/citas-portal/session
 *
 * Canjea el token `wpsso` (firmado por WordPress con el email del usuario
 * logueado, TTL ~5 min) por un `sessionToken` propio del CRM (scope
 * "citas-portal", ~60 min). El frontend guarda el sessionToken en sessionStorage
 * y lo envía en `Authorization: Bearer` en las llamadas de datos.
 *
 * Body: { wpsso: "<jwt de WordPress>" }
 *   200: { ok, data: { sessionToken, expiresInSeconds } }
 *   400: falta wpsso · 401: wpsso inválido/expirado · 403: SSO no habilitado / secreto ausente
 *   404: tenant o módulo citas no disponible · 429: rate limit
 *
 * Rate limit estricto (borde de confianza): 10 req/min por IP.
 */
export const POST = withPublicTenant(
  async (request, _ctx, { slug, tenant, hasModule }) => {
    try {
      if (!hasModule("citas")) return notFound("Módulo no disponible");
      if (tenant.settings?.widget?.sso?.enabled !== true) {
        return forbidden("Portal de citas no habilitado");
      }

      let body = {};
      try { body = (await request.json()) ?? {}; } catch { /* body inválido */ }
      const wpsso = typeof body?.wpsso === "string" ? body.wpsso : null;
      if (!wpsso) return error("Falta el token de acceso", 400);

      let email;
      try {
        ({ email } = await verifyWpSsoToken(wpsso, slug));
      } catch (err) {
        if (err.code === "SSO_SECRET_MISSING") return forbidden("Portal de citas no habilitado");
        return unauthorized("Enlace de acceso inválido o caducado");
      }

      // Normalizar (trim + lowercase) el email antes de firmar la sesión: las
      // reservas guardan clientEmail normalizado, así que el token debe llevar la
      // misma forma para que "Mis citas" y "cancelar" casen. WordPress puede
      // enviarlo con espacios o mayúsculas.
      email = normalizeEmail(email);
      if (!email) return unauthorized("Enlace de acceso inválido o caducado");

      const sessionToken = await signPortalSession({ email, tenant: slug });
      return ok({ sessionToken, expiresInSeconds: SESSION_TTL_SECONDS });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: { limit: 10, windowMs: 60_000, key: "citas-portal-session" } }
);
