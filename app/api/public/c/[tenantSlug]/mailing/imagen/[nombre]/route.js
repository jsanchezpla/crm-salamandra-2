import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { localizarImagen, streamDeImagen } from "../../../../../../../../lib/mailing/imagenStorage.js";

/**
 * GET /api/public/c/[tenantSlug]/mailing/imagen/[nombre] — sirve una imagen de
 * un correo de mailing. Pública porque la pide el buzón del destinatario, sin
 * sesión. El nombre es un UUID con extensión: no se lista ni se adivina, y
 * `localizarImagen` no acepta otra forma (nada de `..`).
 *
 * Caché larga: el fichero no cambia nunca (si se sube otra imagen, tiene otro
 * nombre).
 */
export const GET = withPublicTenant(
  async (_request, rc, ctx) => {
    const { nombre } = await rc.params;
    if (!ctx.hasModule("mailing")) return new NextResponse("Not found", { status: 404 });
    const img = await localizarImagen(ctx.slug, nombre);
    if (!img) return new NextResponse("Not found", { status: 404 });
    const cuerpo = Readable.toWeb(streamDeImagen(img.ruta));
    return new NextResponse(cuerpo, {
      headers: {
        "Content-Type": img.mime,
        "Content-Length": String(img.bytes),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  { rateLimit: { limit: 1200, windowMs: 60_000, key: "mailing-imagen" } }
);
