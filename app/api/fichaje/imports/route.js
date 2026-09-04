import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";


/**
 * GET /api/fichaje/imports — histórico de volcados.
 *
 * Es la pantalla que contesta «¿de dónde salieron estas horas?». Cada fila dice
 * qué mes, qué fichero, cuántas jornadas entraron, quién lo subió y en qué
 * estado quedó (`applied` el vigente, `superseded` el que sustituyó otro más
 * nuevo, `reverted` el que se deshizo).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    // Sin puerta de rol: la llave es tener el módulo CONCEDIDO, y eso ya lo
    // cruza `hasModule` (`lib/fichaje/acceso.js`, 04/09/2026).

    const { FichajeImport, TeamMember } = tenantModels;
    const url = new URL(request.url);
    const periodo = url.searchParams.get("mes");

    const lotes = await FichajeImport.findAll({
      where: periodo ? { periodo } : undefined,
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    // El nombre de quien lo subió, para no enseñar un UUID.
    const ids = [...new Set(lotes.map((l) => l.importedByTeamId).filter(Boolean))];
    const nombres = new Map();
    if (ids.length) {
      const personas = await TeamMember.findAll({ where: { id: ids }, attributes: ["id", "displayName"] });
      for (const p of personas) nombres.set(p.id, p.displayName);
    }

    return ok({
      items: lotes.map((l) => {
        const j = l.toJSON();
        return {
          ...j,
          importadoPor: j.importedByTeamId ? nombres.get(j.importedByTeamId) || null : null,
          // El resumen puede ser grande (anotaciones incluidas): en el listado
          // solo se manda el recuento, y el detalle se pide abriendo el lote.
          resumen: undefined,
          anotaciones: Array.isArray(j.resumen?.anotaciones) ? j.resumen.anotaciones.length : 0,
        };
      }),
    });
  } catch (err) {
    return serverError(err);
  }
});
