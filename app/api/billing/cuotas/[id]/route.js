import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { limpiarCuota } from "../../../../../lib/billing/cuotas.js";

/**
 * PATCH/DELETE /api/billing/cuotas/[id] — modificar, dar de baja o eliminar una
 * cuota (01/09/2026, las tres cosas que pidió Aumenta).
 *
 * ── Baja ≠ borrado, y no es lo mismo ───────────────────────────────────────
 * DAR DE BAJA (`PATCH { endDate, active:false }`) apaga la cuota a partir de
 * una fecha y CONSERVA la fila: los cobros que ya salieron de ella siguen
 * explicando por qué se cobró lo que se cobró, y el mes de la baja se prorratea
 * solo. Es lo que hay que hacer casi siempre.
 * ELIMINAR (`DELETE`) es para el alta equivocada de hace cinco minutos. Con
 * cobros generados detrás, la ruta se niega y manda dar de baja: borrarla
 * dejaría cobros huérfanos sin explicación.
 */
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota } = tenantModels;
    const { id } = await params;

    const cuota = await Cuota.findByPk(id);
    if (!cuota) return notFound("Cuota no encontrada");

    const body = await request.json();
    const { valores, problema } = limpiarCuota(body, { parcial: true });
    if (problema) return error(problema, 422);

    // La baja escrita sin apagar la cuota (o al revés) deja la fila diciendo
    // dos cosas a la vez. Se cierra el círculo aquí, una sola vez:
    //  · poner fecha de baja apaga la cuota
    //  · reactivarla sin quitar la fecha borraría la baja sin querer → se quita
    const bajaNueva = "endDate" in valores ? valores.endDate : cuota.endDate;
    if ("endDate" in valores && valores.endDate && !("active" in body)) valores.active = false;
    if (valores.active === true && bajaNueva && !("endDate" in valores)) valores.endDate = null;

    const antes = resumenCuota(cuota);
    await cuota.update(valores);

    const daDeBaja = antes.activa && !cuota.active;
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: daDeBaja ? "cuota.ended" : "cuota.updated",
      entity: "Cuota",
      entityId: cuota.id,
      before: antes,
      after: resumenCuota(cuota),
    });

    return ok(cuota);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota, Payment } = tenantModels;
    const { id } = await params;

    const cuota = await Cuota.findByPk(id);
    if (!cuota) return notFound("Cuota no encontrada");

    // Con cobros detrás no se borra: se da de baja. Un cobro cuya cuota ya no
    // existe no se puede explicar, y en un mes es exactamente la pregunta que
    // alguien va a hacer.
    const cobros = await Payment.count({ where: { cuotaId: cuota.id } });
    if (cobros > 0) {
      return error(
        `Esta cuota ya ha generado ${cobros} ${cobros === 1 ? "cobro" : "cobros"}: no se puede borrar. Dale de baja con su fecha y dejará de generar, conservando lo cobrado.`,
        409,
        { cobros }
      );
    }

    const antes = resumenCuota(cuota);
    await cuota.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "cuota.deleted",
      entity: "Cuota",
      entityId: id,
      before: antes,
      after: null,
    });

    return ok({ borrada: true });
  } catch (err) {
    return serverError(err);
  }
});

/** Lo que interesa de una cuota en el rastro (nunca la fila entera). */
function resumenCuota(c) {
  if (!c) return null;
  return {
    clienteId: c.clientId ?? null,
    pacienteId: c.patientId ?? null,
    importe: c.amount != null ? String(c.amount) : null,
    conceptos: Array.isArray(c.conceptIds) ? c.conceptIds.length : 0,
    metodo: c.method ?? null,
    desde: c.startDate ?? null,
    hasta: c.endDate ?? null,
    activa: !!c.active,
  };
}
