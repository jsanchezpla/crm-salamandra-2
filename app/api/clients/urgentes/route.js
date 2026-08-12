import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { carpetasCon, cuentasDe, marcarRevisado, ES_CARPETA } from "../../../../lib/clients/urgentes.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fichas a completar: los huecos de datos, por carpetas.
 *
 * Gatea por `clients_avanzado`, no por `clients` (Rodrigo, 04/08/2026). Nació
 * con `clients` a secas —cualquiera puede tener la ficha a medias— y por eso le
 * apareció a TODOS los clientes con fichas, incluido nutri_laura. Pero esta
 * pantalla resuelve el problema de un centro que importó 1.083 familias y
 * arrastra miles de huecos, no el de una consulta de una persona que conoce a
 * sus pacientes por el nombre.
 *
 * El gate va en el endpoint y no solo en el menú: esconder la entrada del
 * sidebar no impide que alguien con la URL —o con la pestaña guardada— siga
 * sacando el listado completo de fichas incompletas.
 */
function gate(ctx) {
  return ctx.hasModule(MODULE_KEYS.CLIENTS_AVANZADO)
    ? null
    : forbidden("Módulo clients_avanzado no activo");
}

export const GET = withTenant(async (request, _rc, ctx) => {
  const cerrado = gate(ctx);
  if (cerrado) return cerrado;
  const { tenantSequelize, tenant, tenantModels } = ctx;
  const esquema = `crm_${tenant.slug}`;

  /*
   * `?soloTotales=1` — dos números y nada más (12/08/2026).
   *
   * Lo pide el MENÚ, para poder esconder «Fichas a completar» cuando no queda
   * nada que completar. Traerse las filas cuesta 3.997 ms en Aumenta, así que
   * ponerlo tal cual en el sidebar le habría añadido cuatro segundos a cada
   * carga de página. Contando en la base de datos son milisegundos.
   *
   * Las condiciones son EXACTAMENTE las del listado —salen del mismo sitio, ver
   * `cuerpoDe()`— así que el número del menú y lo que se ve al abrir no pueden
   * discrepar.
   */
  if (new URL(request.url).searchParams.get("soloTotales") === "1") {
    const { bloquea, completar } = await cuentasDe(tenantSequelize, esquema);
    return ok({ totalBloquea: bloquea, totalCompletar: completar });
  }

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
  const cerrado = gate(ctx);
  if (cerrado) return cerrado;
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
