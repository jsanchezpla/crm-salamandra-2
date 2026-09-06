import { NextResponse } from "next/server";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { buscarOFallar, exigirMailing, idDeRuta } from "../../../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../../../lib/mailing/bloques.js";
import { renderCorreo } from "../../../../../../lib/mailing/render.js";
import { centroDe } from "../../../../../../lib/mailing/envio.js";
import { enlacesDePrueba, urlBase } from "../../../../../../lib/mailing/enlaces.js";

/**
 * GET /api/mailing/campanas/[id]/vista[?formato=texto] — la campaña pintada
 * EXACTAMENTE como saldrá (mismo render que el envío), para el `<iframe>` de
 * la vista previa del editor. El destinatario es de ejemplo y los enlaces no
 * se miden.
 *
 * Se sirve como documento aparte y no se inyecta en la página del CRM: es el
 * único sitio donde HTML escrito por el usuario llega a un navegador, y en un
 * iframe con `sandbox` no puede tocar la sesión.
 */
export const GET = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  const formato = new URL(request.url).searchParams.get("formato");
  const correo = renderCorreo({
    asunto: campana.asunto || "(sin asunto)",
    preheader: campana.preheader,
    bloques: normalizarBloques(campana.bloques),
    centro: centroDe(ctx),
    destinatario: { nombre: "Nombre de ejemplo", email: "ejemplo@correo.invalid" },
    enlaces: enlacesDePrueba({ base: urlBase(request), slug: ctx.slug, email: "ejemplo@correo.invalid" }),
  });
  if (formato === "texto") {
    return new NextResponse(correo.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new NextResponse(correo.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // `frame-ancestors 'self'` y NO `X-Frame-Options: SAMEORIGIN`: el iframe
      // del editor va con `sandbox` (origen opaco) y a SAMEORIGIN le parece
      // ajeno, así que dejaba la vista previa en gris. frame-ancestors compara
      // con el documento que lo incrusta, que sí es el CRM.
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
});
