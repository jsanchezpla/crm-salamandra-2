import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { sendIdDeToken } from "../../../../../../../../lib/mailing/bajaToken.js";
import { normalizarBloques } from "../../../../../../../../lib/mailing/bloques.js";
import { renderCorreo } from "../../../../../../../../lib/mailing/render.js";
import { centroDe } from "../../../../../../../../lib/mailing/envio.js";
import { enlacesDeEnvio, urlBase } from "../../../../../../../../lib/mailing/enlaces.js";
import { paginaPublica } from "../../../../../../../../lib/mailing/paginaPublica.js";

/**
 * GET /api/public/c/[tenantSlug]/mailing/ver/[token] — «ver en el navegador».
 * Vuelve a pintar el correo de ESE envío con el mismo render (los enlaces
 * siguen midiéndose, el píxel no se incluye). Como el HTML no se guarda, un
 * arreglo del render llega también a los correos viejos.
 */
export const GET = withPublicTenant(
  async (request, rc, ctx) => {
    const { token } = await rc.params;
    const sendId = ctx.hasModule("mailing") ? sendIdDeToken(ctx.slug, token) : null;
    const { MailingSend, MailingCampaign } = ctx.tenantModels;
    const send = sendId ? await MailingSend.findByPk(sendId) : null;
    const campana = send ? await MailingCampaign.findByPk(send.campaignId) : null;
    const cabeceras = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
    if (!send || !campana) {
      return new NextResponse(paginaPublica({ centro: centroDe(ctx), titulo: "Este correo ya no está disponible", cuerpo: "El enlace es antiguo o incompleto." }), { status: 404, headers: cabeceras });
    }
    const enlaces = enlacesDeEnvio({ base: urlBase(request), slug: ctx.slug, sendId: send.id, email: send.email });
    const correo = renderCorreo({
      asunto: campana.asunto || "",
      preheader: campana.preheader,
      bloques: normalizarBloques(campana.bloques),
      centro: centroDe(ctx),
      destinatario: { nombre: send.nombre, email: send.email },
      enlaces: { ...enlaces, ver: null, pixel: null },
    });
    return new NextResponse(correo.html, { headers: cabeceras });
  },
  { rateLimit: { limit: 120, windowMs: 60_000, key: "mailing-ver" } }
);
