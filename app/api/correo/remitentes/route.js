import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { getTenantResendConfig } from "../../../../lib/outreach/resendConfig.js";
import { listarRemitentes } from "../../../../lib/email/remitentes.js";

/**
 * GET /api/correo/remitentes — con qué direcciones puede escribir esta persona.
 *
 * Existe aparte de `/api/tenant/settings` por una razón concreta: aquella es de
 * ADMIN, y quien manda los correos no tiene por qué serlo. La representante de
 * un artista escribe todo el día y no administra nada; si el selector de
 * remitentes colgara del endpoint de configuración, se quedaría sin poder
 * elegir —o habría que hacerla admin, que es peor.
 *
 * Solo devuelve direcciones. Ninguna clave sale por aquí.
 */
export const GET = withTenant(async (_request, _ctxRuta, ctx) => {
  if (!ctx.hasModule("clients") && !ctx.hasModule("outreach")) throw new ForbiddenError();

  const remitentes = listarRemitentes(ctx);
  const { apiKey } = getTenantResendConfig(ctx);

  return ok({
    remitentes,
    // `listo` es la pregunta que de verdad importa antes de escribir un mensaje
    // largo: ¿esto va a salir? Sin clave o sin remitente, la pantalla lo dice
    // ARRIBA y no al pulsar Enviar, después de haberlo escrito todo.
    listo: remitentes.length > 0 && !!apiKey,
    motivo: !apiKey
      ? "Falta la clave de Resend en Configuración."
      : !remitentes.length
        ? "No hay ningún remitente configurado."
        : null,
  });
});
