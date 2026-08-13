import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { enforceRateLimit } from "../../../../../lib/utils/rateLimit.js";
import { validarMensaje, serializarAviso } from "../../../../../lib/buzon/buzon.js";
import {
  leerDeUsuario,
  anadirMensaje,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../lib/buzon/buzonStore.js";
import { quienEscribe } from "../../../../../lib/buzon/quienEscribe.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/ayuda/[id]/mensajes — el cliente sigue el hilo.
 *
 * El estado NO viene del body: lo decide `estadoTrasMensaje` en el store a
 * partir de quién escribe. Escribir el cliente devuelve el aviso a nuestro
 * tejado, y si estaba resuelto lo REABRE — «sigue pasando» es lo más importante
 * que nos pueden decir y no puede quedarse enterrado en un hilo cerrado.
 *
 * Un mensaje del cliente nunca puede ser `interno`: esa marca es nuestra y se
 * ignora aquí a propósito, no se valida ni se rechaza.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("En la demo no se puede escribir a soporte.");

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const usuarioId = request.headers.get("x-user-id");
    const frenado = enforceRateLimit(request, {
      key: `ayuda-responder:${ctx.slug}:${usuarioId ?? "anon"}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (frenado) return frenado;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const v = validarMensaje(body);
    if (!v.ok) return error(v.error, v.status);

    const aviso = await leerDeUsuario(id, { usuarioId });
    if (!aviso) return notFound("Ese aviso no existe");

    const usuario = await quienEscribe(request, ctx);
    await anadirMensaje(aviso, {
      autorTipo: "cliente",
      autorNombre: usuario.nombre,
      autorEmail: usuario.email,
      cuerpo: v.limpio.cuerpo,
      // Nunca interno, venga lo que venga en el body.
      interno: false,
    });

    const fresco = await leerDeUsuario(id, { usuarioId });
    return created(serializarAviso(fresco, { para: "cliente" }));
  } catch (err) {
    if (esSinTabla(err)) {
      return error(`No se ha podido guardar. Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    }
    return serverError(err);
  }
});
