import { Readable } from "node:stream";

import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, notFound, unauthorized, serverError } from "../../../../../lib/utils/apiResponse.js";
import { contentDisposition } from "../../../../../lib/documents/helpers.js";
import { adjuntoConSuAviso } from "../../../../../lib/buzon/buzonStore.js";
import { abrirFichero } from "../../../../../lib/buzon/buzonStorage.js";
import { tipoParaVerEnPantalla } from "../../../../../lib/buzon/buzon.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/ayuda/adjuntos/[adjuntoId] — la captura que él mismo nos mandó.
 *
 * ⚠️ AQUÍ EL AISLAMIENTO HAY QUE PONERLO A MANO, y es la diferencia importante
 * con `/api/tickets/attachments/[attachmentId]`. Allí basta con buscar el
 * adjunto: la tabla vive en el schema del tenant, así que un id de otro cliente
 * sencillamente no aparece. Estas tres tablas viven en MASTER y las ve todo el
 * mundo, o sea que un `findByPk` a secas serviría la captura de cualquiera a
 * cualquiera. De ahí las dos comprobaciones de abajo.
 *
 * Se exige que el aviso sea SUYO (no solo de su empresa), igual que en el resto
 * de la pantalla: un aviso puede ser una queja sobre su propio centro y la
 * captura, la prueba.
 *
 * Y una tercera cosa: la URL lleva UUID y NUNCA el nombre del fichero. El
 * matcher del middleware excluye las rutas que acaban en `.png`/`.jpg`/`.svg`,
 * así que `…/captura.png` no pasaría por él — ni reparto por host, ni sello de
 * sesión, ni cabecera de usuario. El nombre viaja en `Content-Disposition`.
 */
export const GET = withTenant(async (request, { params }) => {
  try {
    const usuarioId = request.headers.get("x-user-id");
    if (!usuarioId) return unauthorized();

    const { adjuntoId } = await params;
    if (!UUID_RE.test(String(adjuntoId ?? ""))) return error("id inválido", 422);

    const adj = await adjuntoConSuAviso(adjuntoId);
    // Un 404 en los tres casos, sin distinguirlos: decir «existe pero no es
    // tuyo» ya es contar algo.
    if (!adj || !adj.aviso) return notFound("Adjunto no encontrado");
    if (adj.aviso.usuarioId !== usuarioId) return notFound("Adjunto no encontrado");
    // Un adjunto que cuelga de una nota nuestra no existe para él.
    if (adj.subidoPor === "salamandra" && adj.mensajeId) return notFound("Adjunto no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await abrirFichero(adj.ruta));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Ese fichero ya no está");
      throw e;
    }

    // `?ver=1` = enseñarlo en pantalla en vez de descargarlo. Solo se concede
    // para lo que `tipoParaVerEnPantalla` acepta (imágenes normales y PDF, NUNCA
    // SVG), y con el tipo que decide ELLA a partir de la extensión que
    // guardamos, no con el `mime` que declaró quien lo subió.
    const url = new URL(request.url);
    const tipoEnLinea = url.searchParams.get("ver") === "1" ? tipoParaVerEnPantalla(adj.ruta) : null;

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": tipoEnLinea || adj.mime || "application/octet-stream",
        "Content-Disposition": contentDisposition(tipoEnLinea ? "inline" : "attachment", adj.nombre),
        "Content-Length": String(size),
        // Siempre, en los dos casos: es lo que impide que el navegador adivine
        // un tipo distinto del que le decimos.
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
