import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { listarRemitentes, resolverRemitente } from "../../../../lib/email/remitentes.js";

/**
 * GET /api/correo/remitentes — con qué direcciones puede escribir ESTA persona.
 *
 * Existe aparte de `/api/tenant/settings` por una razón concreta: aquella es de
 * ADMIN, y quien manda los correos no tiene por qué serlo. La representante de
 * un artista escribe todo el día y no administra nada; si el selector colgara
 * del endpoint de configuración, se quedaría sin poder elegir —o habría que
 * hacerla admin, que es peor.
 *
 * Desde el 24/08/2026 la lista depende de quién pregunta: un remitente asignado
 * a una persona no lo ven las demás. Aquí solo salen direcciones; ninguna clave
 * sale nunca por este endpoint.
 */
export const GET = withTenant(async (_request, _ctxRuta, ctx) => {
  if (!ctx.hasModule("clients")) throw new ForbiddenError();

  const remitentes = listarRemitentes(ctx);

  // ¿Va a salir el correo de verdad? La clave es AHORA POR REMITENTE, así que
  // la pregunta no es «¿tiene el tenant clave?» sino «¿la tiene el que voy a
  // usar?». Se comprueba con el de por defecto, que es el que se va a elegir.
  const porDefecto = remitentes.length ? resolverRemitente(ctx, null) : null;
  const listo = !!porDefecto?.apiKey;

  return ok({
    remitentes,
    listo,
    motivo: !remitentes.length
      ? "No tienes ninguna dirección de envío asignada. Pídele a administración que te asigne una."
      : !listo
        ? `El remitente ${porDefecto?.email ?? ""} todavía no tiene clave de Resend.`
        : null,
    // Para que la pantalla pueda decir «pídeselo a administración» o «ve a
    // Configuración» según quién esté mirando.
    puedeConfigurar: ["admin", "owner", "superadmin"].includes(String(ctx.user?.role ?? "")),
  });
});
