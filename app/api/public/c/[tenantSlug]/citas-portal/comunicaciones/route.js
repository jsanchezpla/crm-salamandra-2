import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../lib/utils/auditoria.js";
import { gatePortal, resolvePortalContractSession } from "../../../../../../../lib/citas/portalContract.js";
import {
  CANALES,
  CANAL_LABEL,
  CANAL_AYUDA,
  preferenciasDe,
  yaRespondio,
  normalizarPreferencias,
} from "../../../../../../../lib/clients/comunicaciones.js";

/**
 * /api/public/c/[slug]/citas-portal/comunicaciones — qué le puede escribir el
 * centro a la familia (01/08/2026).
 *
 *   GET  → las tres casillas con su estado y si ya contestaron alguna vez
 *   POST → guarda la respuesta { citasEmail, citasWhatsapp, novedades }
 *
 * Va DESPUÉS de la firma del contrato en el portal, pero **no bloquea**: se
 * puede guardar con todo desmarcado y seguir. Condicionar el acceso al área
 * privada a aceptar publicidad invalidaría ese consentimiento — y aquí el
 * consentimiento es justo lo que se está recogiendo.
 *
 * Se guarda con fecha, IP y navegador: es la prueba de que lo marcó la familia
 * y no alguien del centro por ella.
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return ok({ disponible: false, canales: [] });

    const prefs = preferenciasDe(client);
    return ok({
      disponible: true,
      yaRespondio: yaRespondio(client),
      canales: CANALES.map((canal) => ({
        canal,
        label: CANAL_LABEL[canal],
        ayuda: CANAL_AYUDA[canal],
        aceptado: prefs[canal].granted,
        desde: prefs[canal].at,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return error("Todavía no tenemos tu ficha. Escríbenos y lo revisamos.", 409);

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
    if (Object.keys(entrada).length === 0) return error("No has marcado nada que guardar", 422);

    const { Client } = tenantModels;
    const fila = await Client.findByPk(client.id);
    if (!fila) return error("Cliente no encontrado", 404);

    const communicationPrefs = normalizarPreferencias(entrada, {
      previas: fila.communicationPrefs,
      ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      userAgent: request.headers.get("user-agent"),
      by: "portal",
    });
    await fila.update({ communicationPrefs });

    await auditar({
      tenantId: tenant.id,
      userId: null, // lo marca la familia, no un usuario del CRM
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "client.comunicaciones.updated",
      entity: "Client",
      entityId: fila.id,
      // Solo qué aceptó, sin datos personales: la auditoría vive en master.
      after: Object.fromEntries(CANALES.map((c) => [c, !!communicationPrefs[c]?.granted])),
    });

    const prefs = preferenciasDe(fila);
    return ok({
      guardado: true,
      canales: CANALES.map((canal) => ({
        canal,
        label: CANAL_LABEL[canal],
        ayuda: CANAL_AYUDA[canal],
        aceptado: prefs[canal].granted,
        desde: prefs[canal].at,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});
