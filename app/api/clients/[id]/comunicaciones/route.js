import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  CANALES,
  CANAL_LABEL,
  CANAL_AYUDA,
  preferenciasDe,
  yaRespondio,
  normalizarPreferencias,
} from "../../../../../lib/clients/comunicaciones.js";

/**
 * /api/clients/[id]/comunicaciones — por dónde se le puede escribir a esta
 * familia, desde el CRM (01/08/2026).
 *
 *   GET → las tres casillas, con quién las marcó y cuándo
 *   PUT → las cambia (queda registrado como hecho por el EQUIPO, no por la
 *         familia: es la diferencia entre «lo marcó ella» y «nos lo dijo por
 *         teléfono y lo apuntamos»)
 *
 * Existe porque retirar un consentimiento tiene que ser tan fácil como darlo:
 * si una familia llama y dice «dejadme de mandar WhatsApps», tiene que poder
 * quedar reflejado en ese momento, sin esperar a que entre en el portal.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clients") ? null : forbidden("Módulo clients no activo");
}

function vista(cliente) {
  const prefs = preferenciasDe(cliente);
  return {
    clientId: cliente.id,
    yaRespondio: yaRespondio(cliente),
    canales: CANALES.map((canal) => ({
      canal,
      label: CANAL_LABEL[canal],
      ayuda: CANAL_AYUDA[canal],
      aceptado: prefs[canal].granted,
      desde: prefs[canal].at,
      // "portal" = lo marcó la familia · "equipo" = lo registró el centro
      quien: prefs[canal].by,
    })),
  };
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client } = ctx.tenantModels;
    const cliente = await Client.findByPk(id, { attributes: ["id", "communicationPrefs"] });
    if (!cliente) return notFound("Cliente no encontrado");
    return ok(vista(cliente));
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client } = ctx.tenantModels;
    const cliente = await Client.findByPk(id);
    if (!cliente) return notFound("Cliente no encontrado");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const entrada = {};
    for (const canal of CANALES) {
      if (canal in (body ?? {})) entrada[canal] = !!body[canal];
    }
    if (Object.keys(entrada).length === 0) return error("No hay nada que cambiar", 422);

    const communicationPrefs = normalizarPreferencias(entrada, {
      previas: cliente.communicationPrefs,
      ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      userAgent: request.headers.get("user-agent"),
      by: "equipo",
    });
    await cliente.update({ communicationPrefs });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.comunicaciones.updated",
      entity: "Client",
      entityId: id,
      after: Object.fromEntries(CANALES.map((c) => [c, !!communicationPrefs[c]?.granted])),
    });

    return ok(vista(cliente));
  } catch (err) {
    return serverError(err);
  }
});
