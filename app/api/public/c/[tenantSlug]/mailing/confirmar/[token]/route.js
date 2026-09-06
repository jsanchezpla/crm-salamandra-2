import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { emailDeTokenDeConfirmacion } from "../../../../../../../../lib/mailing/bajaToken.js";
import { paginaPublica } from "../../../../../../../../lib/mailing/paginaPublica.js";
import { centroDe } from "../../../../../../../../lib/mailing/envio.js";
import { getClientIp } from "../../../../../../../../lib/utils/rateLimit.js";

/**
 * GET /api/public/c/[tenantSlug]/mailing/confirmar/[token] — el doble opt-in
 * de un correo suelto: la persona pincha el botón del correo de confirmación
 * y el contacto pasa de `pendiente` a `activo` con la prueba (fecha, IP,
 * navegador, `by: "confirmacion"`).
 *
 * Aquí SÍ se actúa en el GET: confirmar es lo que la persona quiere hacer y
 * un escáner que lo abra por ella solo le da lo que pidió (a diferencia de la
 * baja, donde el escáner le quitaría algo). Si ya estaba en supresión, no se
 * reactiva desde aquí: gana la baja.
 */
function html(cuerpo, status = 200) {
  return new NextResponse(cuerpo, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const GET = withPublicTenant(
  async (request, rc, ctx) => {
    const { token } = await rc.params;
    const centro = centroDe(ctx);
    const email = ctx.hasModule("mailing") ? emailDeTokenDeConfirmacion(ctx.slug, token) : null;
    if (!email) return html(paginaPublica({ centro, titulo: "Este enlace no es válido", cuerpo: "Puede que esté incompleto. Vuelve a abrirlo desde el correo." }), 404);

    const { MailingContact, MailingSuppression } = ctx.tenantModels;
    if (await MailingSuppression.findOne({ where: { email }, attributes: ["id"] })) {
      return html(paginaPublica({ centro, titulo: "Esta dirección está dada de baja", cuerpo: `${email} pidió no recibir novedades. Si quieres volver a recibirlas, escríbenos.` }));
    }
    const contacto = await MailingContact.findOne({ where: { email } });
    if (!contacto) return html(paginaPublica({ centro, titulo: "No encontramos esta dirección", cuerpo: "Puede que se haya quitado de la lista. Si quieres recibir novedades, escríbenos." }), 404);

    if (contacto.estado !== "activo") {
      await contacto.update({
        estado: "activo",
        confirmadoAt: new Date(),
        consentimiento: {
          granted: true,
          at: new Date().toISOString(),
          ip: String(getClientIp(request)).slice(0, 64),
          userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 255) || null,
          by: "confirmacion",
          origen: `${contacto.consentimiento?.origen ?? "alta"} · confirmado por correo`,
        },
      });
    }
    return html(paginaPublica({ centro, titulo: "¡Gracias! Suscripción confirmada", cuerpo: `${email} recibirá las novedades de ${centro.nombre}. Podrás darte de baja desde cualquier correo.` }));
  },
  { rateLimit: { limit: 60, windowMs: 60_000, key: "mailing-confirmar" } }
);
