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

      /*
       * ⚠️ AQUÍ NO SE CREA NINGUNA SOLICITUD (retirado el 05/08/2026, el mismo
       * día que se puso).
       *
       * La idea era buena y la ejecución mala: como el CRM ve aquí el correo
       * real con el que entra la paciente, se dejaba una solicitud en la bandeja
       * cuando no había ficha con ese correo, para cazar los desajustes.
       *
       * El problema es lo que significa una solicitud: «quiero ser paciente».
       * Y entrar en el área privada NO es pedir cita — se entra también para
       * comprar un curso. Así que se llenaba Leads Comerciales de gente que no
       * había pedido nada y, peor, la puerta de admisión les leía esa solicitud
       * como «pendiente» y les decía «tu solicitud está en revisión» sin que
       * hubieran rellenado un formulario en su vida. Un callejón sin salida.
       *
       * LA REGLA, de Rodrigo: **una solicitud la crea SOLO el formulario de
       * /formularios**. Registrarse en la web no es pedir cita.
       *
       * El desajuste de correos se sigue detectando donde no hace daño: en la
       * ficha, con el distintivo de «¿tiene cuenta con este correo?»
       * (`GET /api/clients/[id]/portal-user`).
       */

      return ok({ sessionToken, expiresInSeconds: SESSION_TTL_SECONDS });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: { limit: 10, windowMs: 60_000, key: "citas-portal-session" } }
);
