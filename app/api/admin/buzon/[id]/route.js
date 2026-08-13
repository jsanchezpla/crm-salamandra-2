import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { validarCambio, serializarAviso, referencia } from "../../../../../lib/buzon/buzon.js";
import {
  leerParaSalamandra,
  cambiar,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../lib/buzon/buzonStore.js";
import { candadoBuzon } from "../../../../../lib/buzon/candadoBackoffice.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/admin/buzon/[id] — un aviso por dentro.
 *
 *   GET   → el aviso entero, con las notas internas. Abrirlo lo marca leído.
 *   PATCH → estado, prioridad y reparto. NADA MÁS.
 *
 * Contestar NO va aquí: eso es crear un mensaje, y tiene su propio
 * `POST .../mensajes`. Meter las dos cosas en el PATCH acabaría con un endpoint
 * que hace dos trabajos y con un estado que se cambia por descuido al responder.
 */

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const aviso = await leerParaSalamandra(id);
    if (!aviso) return notFound("Ese aviso no existe");

    return ok(serializarAviso(aviso, { para: "salamandra" }));
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const v = validarCambio(body);
    if (!v.ok) return error(v.error, v.status);

    const aviso = await leerParaSalamandra(id, { marcarLeido: false });
    if (!aviso) return notFound("Ese aviso no existe");

    const antes = { estado: aviso.estado, prioridad: aviso.prioridad, asignadoA: aviso.asignadoA };
    await cambiar(aviso, v.limpio);

    // Igual que en el alta: el rastro lleva la referencia y el cliente, nunca el
    // texto. Lo que interesa saber es quién movió qué, no qué decía.
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "buzon.aviso_actualizado",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: antes,
      after: { ...antes, ...v.limpio, ref: referencia(aviso.numero), tenantSlug: aviso.tenantSlug },
      ip,
    });

    return ok(serializarAviso(aviso, { para: "salamandra" }));
  } catch (err) {
    if (esSinTabla(err)) return error(`Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    return serverError(err);
  }
});
