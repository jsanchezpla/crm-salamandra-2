import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { emailDeTokenDeBaja } from "../../../../../../../../lib/mailing/bajaToken.js";
import { suprimirEmail } from "../../../../../../../../lib/mailing/supresion.js";
import { paginaPublica } from "../../../../../../../../lib/mailing/paginaPublica.js";
import { centroDe } from "../../../../../../../../lib/mailing/envio.js";
import { getClientIp } from "../../../../../../../../lib/utils/rateLimit.js";

/**
 * /api/public/c/[tenantSlug]/mailing/baja/[token] — la baja, pública y sin login.
 *
 * El token lo firma `lib/mailing/bajaToken.js` (HMAC del cliente y el correo):
 * no hay tabla, no caduca, y no se puede fabricar para otra dirección.
 *
 *   GET   enseña una página con UN botón «Sí, dadme de baja». No se da de baja
 *         en el GET a propósito: los antivirus de correo y Outlook «Safe Links»
 *         ABREN los enlaces de cada correo antes de que la persona lo lea, y
 *         darían de baja a media lista sin que nadie lo pidiera.
 *   POST  ejecuta la baja. Lo llama ese botón y también el buzón directamente
 *         por la cabecera `List-Unsubscribe-Post` (RFC 8058, el botón «Cancelar
 *         suscripción» de Gmail y Yahoo), que manda un POST sin cuerpo útil.
 *
 * La baja mete la dirección en `mailing_suppressions` y deja coherente el
 * resto (contacto → baja, casilla de la ficha → no): lib/mailing/supresion.js.
 * Es idempotente: pinchar dos veces enseña lo mismo.
 */
function html(cuerpo, status = 200) {
  return new NextResponse(cuerpo, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function tokenValido(rc, ctx) {
  const { token } = await rc.params;
  if (!ctx.hasModule("mailing")) return null;
  return emailDeTokenDeBaja(ctx.slug, token);
}

export const GET = withPublicTenant(
  async (request, rc, ctx) => {
    const email = await tokenValido(rc, ctx);
    const centro = centroDe(ctx);
    if (!email) {
      return html(paginaPublica({ centro, titulo: "Este enlace no es válido", cuerpo: "Puede que esté incompleto. Abre el correo original y vuelve a pinchar en «Darme de baja»." }), 404);
    }
    const ya = await ctx.tenantModels.MailingSuppression.findOne({ where: { email }, attributes: ["id"] });
    if (ya) {
      return html(paginaPublica({ centro, titulo: "Ya estabas de baja", cuerpo: `No te enviaremos más novedades a ${email}.` }));
    }
    return html(
      paginaPublica({
        centro,
        titulo: "¿Quieres dejar de recibir nuestras novedades?",
        cuerpo: `Si confirmas, ${email} no volverá a recibir campañas ni novedades de ${centro.nombre}. Los avisos de tus citas, si los tienes, no cambian.`,
        boton: { texto: "Sí, dadme de baja", action: new URL(request.url).pathname },
      })
    );
  },
  { rateLimit: { limit: 60, windowMs: 60_000, key: "mailing-baja" } }
);

export const POST = withPublicTenant(
  async (request, rc, ctx) => {
    const email = await tokenValido(rc, ctx);
    const centro = centroDe(ctx);
    if (!email) return html(paginaPublica({ centro, titulo: "Este enlace no es válido", cuerpo: "Abre el correo original y vuelve a pinchar en «Darme de baja»." }), 404);
    await suprimirEmail(ctx, {
      email,
      motivo: "baja",
      detalle: "enlace de baja del correo",
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return html(paginaPublica({ centro, titulo: "Listo: te hemos dado de baja", cuerpo: `${email} no recibirá más novedades de ${centro.nombre}. Gracias por avisarnos.` }));
  },
  { rateLimit: { limit: 60, windowMs: 60_000, key: "mailing-baja" } }
);
