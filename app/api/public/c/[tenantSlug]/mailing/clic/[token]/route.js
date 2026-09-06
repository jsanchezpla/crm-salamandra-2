import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { datosDeTokenDeClic } from "../../../../../../../../lib/mailing/bajaToken.js";
import { registrarClic } from "../../../../../../../../lib/mailing/eventos.js";
import { paginaPublica } from "../../../../../../../../lib/mailing/paginaPublica.js";
import { centroDe } from "../../../../../../../../lib/mailing/envio.js";

/**
 * GET /api/public/c/[tenantSlug]/mailing/clic/[token] — la redirección medida.
 * Apunta el clic (evento + contador del envío) y manda a la URL real, que se
 * resuelve volviendo a recorrer el correo con el índice del token
 * (lib/mailing/eventos.js). Si algo falla, la persona llega igual a su
 * destino: medir nunca rompe un enlace.
 */
export const GET = withPublicTenant(
  async (request, rc, ctx) => {
    const { token } = await rc.params;
    const datos = ctx.hasModule("mailing") ? datosDeTokenDeClic(ctx.slug, token) : null;
    const { MailingSend, MailingCampaign } = ctx.tenantModels;
    let destino = null;
    if (datos) {
      const send = await MailingSend.findByPk(datos.sendId);
      const campana = send ? await MailingCampaign.findByPk(send.campaignId) : null;
      if (send && campana) {
        destino = await registrarClic(ctx, { send, campana, indice: datos.indice, userAgent: request.headers.get("user-agent") });
      }
    }
    if (!destino || !/^https?:\/\//i.test(destino)) {
      const html = paginaPublica({ centro: centroDe(ctx), titulo: "Este enlace ya no está disponible", cuerpo: "El correo del que viene es antiguo o el enlace se cambió." });
      return new NextResponse(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return NextResponse.redirect(destino, { status: 302, headers: { "Cache-Control": "no-store" } });
  },
  { rateLimit: { limit: 300, windowMs: 60_000, key: "mailing-clic" } }
);
