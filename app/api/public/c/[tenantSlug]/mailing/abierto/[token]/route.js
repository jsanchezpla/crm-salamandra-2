import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { sendIdDeToken } from "../../../../../../../../lib/mailing/bajaToken.js";
import { GIF_1X1, registrarApertura } from "../../../../../../../../lib/mailing/eventos.js";

/**
 * GET /api/public/c/[tenantSlug]/mailing/abierto/[token].gif — el píxel de
 * apertura. Siempre devuelve el GIF, pase lo que pase: un correo con una
 * imagen rota queda peor que una apertura sin contar. La apertura es un dato
 * ORIENTATIVO (Apple Mail y los filtros la disparan sin que nadie lea).
 */
function gif() {
  return new NextResponse(GIF_1X1, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache", "Content-Length": String(GIF_1X1.length) },
  });
}

export const GET = withPublicTenant(
  async (request, rc, ctx) => {
    try {
      const { token } = await rc.params;
      const limpio = String(token ?? "").replace(/\.gif$/i, "");
      const sendId = ctx.hasModule("mailing") ? sendIdDeToken(ctx.slug, limpio) : null;
      if (sendId) {
        const { MailingSend, MailingCampaign } = ctx.tenantModels;
        const send = await MailingSend.findByPk(sendId);
        const campana = send ? await MailingCampaign.findByPk(send.campaignId) : null;
        if (send && campana) await registrarApertura(ctx, { send, campana, userAgent: request.headers.get("user-agent") });
      }
    } catch {
      /* el píxel sale igual */
    }
    return gif();
  },
  { rateLimit: { limit: 600, windowMs: 60_000, key: "mailing-abierto" } }
);
