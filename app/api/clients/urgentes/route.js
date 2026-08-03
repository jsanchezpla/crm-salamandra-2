import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { carpetasCon, marcarRevisado, ES_CARPETA } from "../../../../lib/clients/urgentes.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fichas a completar: los huecos de datos, por carpetas.
 *
 * Cuelga de `clients`, no de un módulo nuevo: es la propia ficha de cliente la
 * que está a medias. Quien no tenga `pacientes` verá solo las carpetas de
 * familias, porque las de pacientes salen vacías por sí solas.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!ctx.hasModule("clients")) return forbidden("Módulo Clientes no activo");
  const { tenantSequelize, tenant, tenantModels } = ctx;
  const esquema = `crm_${tenant.slug}`;

  const carpetas = await carpetasCon(tenantSequelize, esquema, tenantModels.DataReview);
  const bloquea = carpetas.filter((c) => c.bloquea);
  const completar = carpetas.filter((c) => !c.bloquea);

  return ok({
    bloquea,
    completar,
    totalBloquea: bloquea.reduce((a, c) => a + c.total, 0),
    totalCompletar: completar.reduce((a, c) => a + c.total, 0),
  });
});

/** Archiva (o desarchiva) una fila: «ya lo he mirado y está bien así». */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!ctx.hasModule("clients")) return forbidden("Módulo Clientes no activo");
  const { DataReview } = ctx.tenantModels;
  if (!DataReview) return error("Falta la migración de data_reviews", 503);

  let body;
  try { body = await request.json(); } catch { return error("Body inválido"); }

  if (!ES_CARPETA(body.checkKey)) return error("Carpeta desconocida");
  if (!UUID_RE.test(String(body.entityId ?? ""))) return error("entityId inválido");
  if (!["client", "patient"].includes(body.entidad)) return error("entidad inválida");

  const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  const r = await marcarRevisado(DataReview, {
    checkKey: body.checkKey,
    entityId: String(body.entityId),
    entidad: body.entidad,
    teamMemberId,
    nota: typeof body.nota === "string" ? body.nota.slice(0, 500) : null,
  });
  return ok(r);
});
