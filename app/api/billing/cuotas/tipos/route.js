import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { cuotasConPacientes } from "../../../../../lib/billing/cuotasConPacientes.js";
import { resumenPorTipo } from "../../../../../lib/billing/tiposDeCuota.js";
import { hoyVigente } from "../../../../../lib/billing/cuotas.js";

/**
 * GET /api/billing/cuotas/tipos — el catálogo visto DESDE LOS PACIENTES
 * (09/09/2026, petición de Aumenta: «diferentes tipos de cuotas… dentro de
 * cada cuota, los pacientes asignados»).
 *
 * Una fila por tipo de cuota (concepto del catálogo, que también son la
 * entrevista inicial, los bonos y los informes) con cuántas cuotas vivas lleva,
 * cuántas de baja, a cuántos pacientes cubre y cuánto suma al mes. Las cuentas
 * viven en `lib/billing/tiposDeCuota.js`, con su prueba.
 *
 * ── UNA CONSULTA, NO UNA POR TIPO ──────────────────────────────────────────
 * Se traen las cuotas UNA vez y se reparten en memoria. Aumenta tiene 46
 * conceptos y 278 cuotas: preguntar por cada tipo serían 46 consultas para
 * pintar una tabla que se mira de un vistazo.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept } = tenantModels;

    // Los apagados también: un tipo que ya no se ofrece puede seguir teniendo
    // gente pagándolo, y esconderlo es esconder dinero que entra todos los meses.
    const conceptos = await BillingConcept.findAll({ order: [["sortOrder", "ASC"], ["name", "ASC"]] });

    // Todas las cuotas, vivas y de baja: el recuento de bajas es media pantalla
    // («12 pagando, 4 que se fueron este curso»).
    const cuotas = await cuotasConPacientes({ tenantModels, hasModule, where: {} });

    const { tipos, sinTipo } = resumenPorTipo({
      conceptos: conceptos.map((c) => c.toJSON()),
      cuotas,
      hoy: hoyVigente(),
    });

    return ok({ tipos, sinTipo, total: tipos.length });
  } catch (err) {
    return serverError(err);
  }
});
