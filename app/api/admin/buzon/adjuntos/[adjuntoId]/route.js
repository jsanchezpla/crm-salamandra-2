import { Readable } from "node:stream";

import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { contentDisposition } from "../../../../../../lib/documents/helpers.js";
import { adjuntoConSuAviso } from "../../../../../../lib/buzon/buzonStore.js";
import { abrirFichero } from "../../../../../../lib/buzon/buzonStorage.js";
import { candadoBuzon } from "../../../../../../lib/buzon/candadoBackoffice.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/buzon/adjuntos/[adjuntoId] — la captura, desde nuestro lado.
 *
 * Existe SEPARADO del de `/api/ayuda/adjuntos/…` y no por gusto: el middleware
 * sirve `/api/ayuda` solo en el host de los clientes y `/api/admin` solo en el
 * del panel. Con un único endpoint, el lado que no fuera el suyo recibiría un
 * 404 del middleware — indistinguible de «el fichero no está», que es de los
 * fallos más caros de diagnosticar. La lógica común está en `buzonStorage.js`;
 * esto son dos puertas finas.
 *
 * Nosotros sí vemos los adjuntos de las notas internas: son nuestros.
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { adjuntoId } = await params;
    if (!UUID_RE.test(String(adjuntoId ?? ""))) return error("id inválido", 422);

    const adj = await adjuntoConSuAviso(adjuntoId);
    if (!adj) return notFound("Adjunto no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await abrirFichero(adj.ruta));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Ese fichero ya no está");
      throw e;
    }

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": adj.mime || "application/octet-stream",
        // Nunca en línea: un SVG que nos manden abierto en el navegador sería un
        // XSS en `admin.salamandrasolutions.com`, que es el peor sitio posible.
        "Content-Disposition": contentDisposition("attachment", adj.nombre),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
