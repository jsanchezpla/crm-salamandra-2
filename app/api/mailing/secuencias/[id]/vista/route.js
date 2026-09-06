import { NextResponse } from "next/server";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { buscarOFallar, exigirMailing, idDeRuta } from "../../../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../../../lib/mailing/bloques.js";
import { renderCorreo } from "../../../../../../lib/mailing/render.js";
import { centroDe } from "../../../../../../lib/mailing/envio.js";
import { enlacesDePrueba, urlBase } from "../../../../../../lib/mailing/enlaces.js";

/** GET /api/mailing/secuencias/[id]/vista — la secuencia pintada como saldrá (mismo render que el envío). */
export const GET = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const seq = await buscarOFallar(ctx.tenantModels.MailingSequence, id, "Esa secuencia");
  const correo = renderCorreo({
    asunto: seq.asunto || "(sin asunto)",
    preheader: seq.preheader,
    bloques: normalizarBloques(seq.bloques),
    centro: centroDe(ctx),
    destinatario: { nombre: "Nombre de ejemplo", email: "ejemplo@correo.invalid" },
    enlaces: enlacesDePrueba({ base: urlBase(request), slug: ctx.slug, email: "ejemplo@correo.invalid" }),
  });
  return new NextResponse(correo.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
});
