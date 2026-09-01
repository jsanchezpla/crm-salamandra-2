import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
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
 * cobros generados detrás **se avisa y se pregunta** (409 con el desglose:
 * cuántos hay, cuántos siguen pendientes), y se borra con `?confirmar=1`
 * (01/09/2026, Rodrigo: «que me pida confirmación en lugar de no dejarme»).
 * Los cobros nunca se borran aquí: el dinero no se toca por detrás de nadie.
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

    /*
     * ── CON COBROS DETRÁS SE PREGUNTA, NO SE PROHÍBE (01/09/2026, Rodrigo) ───
     *
     * Hasta hoy esto era un portazo: «ya ha generado N cobros, no se puede
     * borrar, dale de baja». La recomendación sigue siendo buena —dar de baja
     * conserva lo cobrado y deja de generar— pero no es asunto del programa
     * decidirlo: la cuota mal creada de hace diez minutos ya tiene su cobro
     * pendiente generado, y ahí la baja deja una fila muerta y un cobro que
     * nadie va a pagar.
     *
     * Así que la ruta cuenta qué hay detrás y lo devuelve (409 + el desglose)
     * para que la pantalla lo pregunte con esos números en la mano; con
     * `?confirmar=1` borra. Los cobros NO se tocan: el dinero cobrado no se
     * borra por detrás de nadie. Se quedan con su `cuotaId` apuntando a una
     * cuota que ya no existe, que es exactamente lo que pasó.
     */
    const cobros = await Payment.count({ where: { cuotaId: cuota.id } });
    const pendientes = cobros
      ? await Payment.count({ where: { cuotaId: cuota.id, status: "pending" } })
      : 0;
    const confirmado = new URL(request.url).searchParams.get("confirmar") === "1";
    if (cobros > 0 && !confirmado) {
      // `errorConDatos` y no `error`: el tercer argumento de `error()` es
      // `details` y en PRODUCCION no viaja, asi que la pantalla se habria
      // quedado sin el desglose justo donde hace falta (lib/utils/apiResponse.js).
      return errorConDatos(
        `Esta cuota ya ha generado ${cobros} ${cobros === 1 ? "cobro" : "cobros"}.`,
        409,
        { code: "TIENE_COBROS", cobros, pendientes, cobrados: cobros - pendientes }
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
      // Cuántos cobros se quedan sin cuota que los explique: es LO que hay que
      // poder mirar dentro de un mes, cuando alguien pregunte de dónde salió un
      // cobro cuya cuota no aparece.
      before: { ...antes, cobros, cobrosPendientes: pendientes },
      after: null,
    });

    return ok({ borrada: true, cobros, pendientes });
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
