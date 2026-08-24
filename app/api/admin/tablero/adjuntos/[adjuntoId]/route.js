import { Readable } from "node:stream";

import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { contentDisposition } from "../../../../../../lib/documents/helpers.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { candadoTablero } from "../../../../../../lib/tablero/candado.js";
import { tipoParaVerEnPantalla } from "../../../../../../lib/buzon/buzon.js";
import { abrirFichero, borrarFichero } from "../../../../../../lib/tablero/tableroStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/tablero/adjuntos/[adjuntoId] — servir una captura.
 *
 * ⚠️ ESTAS CAPTURAS PUEDEN LLEVAR DATOS DE UN PACIENTE DENTRO, y no se recortan
 * (Jorge, 24/08/2026): una captura recortada de la pantalla que falla deja de
 * ser la prueba de lo que falla. La contrapartida es que aquí no puede faltar
 * ninguno de los tres candados de `lib/tablero/candado.js` — y en especial el de
 * la demo, que da sesión de admin a cualquier visitante.
 *
 * A diferencia del Buzón, aquí no hay un segundo control de pertenencia: el
 * Registro es NUESTRO, no de un cliente, así que quien pasa los tres candados
 * puede ver cualquier captura del Registro. Lo que no hay es forma de llegar
 * desde fuera del back-office.
 *
 * `?ver=1` la enseña en pantalla en vez de descargarla, y solo para lo que
 * `tipoParaVerEnPantalla` acepta — imágenes normales y PDF, NUNCA SVG (un SVG
 * lleva scripts dentro y servirlo en línea es servir HTML). El tipo lo decide
 * ELLA a partir de la extensión que guardamos nosotros, jamás el `mime` que
 * declaró el navegador de quien la subió.
 *
 * Esa función se importa del Buzón en vez de copiarse: es una lista blanca de
 * seguridad, y dos copias de una lista blanca acaban siendo dos listas
 * distintas — con la copia vieja aceptando lo que la nueva ya rechaza.
 *
 * La URL lleva UUID y NUNCA el nombre del fichero: el matcher del middleware
 * excluye las rutas acabadas en `.png`/`.jpg`/`.svg`, así que `…/captura.png` no
 * pasaría por él, y con él se iría el reparto por host y el sello de sesión. El
 * nombre viaja en `Content-Disposition`.
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoTablero(ctx);
    if (veto) return veto;

    const { adjuntoId } = await params;
    if (!UUID_RE.test(String(adjuntoId ?? ""))) return error("id inválido", 422);

    const { TableroAdjunto } = getMasterModels();
    const adj = await TableroAdjunto.findByPk(adjuntoId);
    if (!adj) return notFound("Esa captura no está");

    let stream;
    let size;
    try {
      ({ stream, size } = await abrirFichero(adj.ruta));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Ese fichero ya no está en disco");
      throw e;
    }

    const url = new URL(request.url);
    const tipoEnLinea = url.searchParams.get("ver") === "1" ? tipoParaVerEnPantalla(adj.ruta) : null;

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": tipoEnLinea || "application/octet-stream",
        "Content-Disposition": contentDisposition(tipoEnLinea ? "inline" : "attachment", adj.nombre),
        "Content-Length": String(size),
        // Siempre, en los dos casos: es lo que impide que el navegador adivine
        // un tipo distinto del que le decimos.
        "X-Content-Type-Options": "nosniff",
        // `private` y `no-store`: esto puede llevar datos de salud dentro y no
        // tiene por qué quedarse en el disco de nadie más de lo imprescindible.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * DELETE — quitar una captura.
 *
 * Primero el disco y después la fila. Al revés, un fallo al borrar el fichero
 * dejaría exactamente lo que esta tabla existe para que no pase: un binario que
 * ya no apunta ninguna fila y que nadie va a encontrar. `borrarFichero` es
 * best-effort —si ya no estaba, no pasa nada—, así que este orden no puede
 * dejar una fila sin poder borrarse.
 */
export const DELETE = withTenant(async (_request, { params }, ctx) => {
  try {
    const veto = candadoTablero(ctx);
    if (veto) return veto;

    const { adjuntoId } = await params;
    if (!UUID_RE.test(String(adjuntoId ?? ""))) return error("id inválido", 422);

    const { TableroAdjunto } = getMasterModels();
    const adj = await TableroAdjunto.findByPk(adjuntoId);
    if (!adj) return notFound("Esa captura no está");

    await borrarFichero(adj.ruta);
    await adj.destroy();

    return ok({ id: adjuntoId, ficha: adj.ficha });
  } catch (err) {
    return serverError(err);
  }
});
