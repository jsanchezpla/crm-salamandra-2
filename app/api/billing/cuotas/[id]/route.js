import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { limpiarCuota, cuadrarBajaYActiva, cobroSePuedeRehacer } from "../../../../../lib/billing/cuotas.js";
import { sincronizarCobroDelMes } from "../../../../../lib/billing/cobroDeCuota.js";

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
 *
 * ── Y EDITAR NO ES DAR DE BAJA (04/09/2026) ────────────────────────────────
 * Una edición cualquiera —cambiarle el día de cobro— APAGABA la cuota si tenía
 * fecha de baja, porque el drawer reenvía siempre ese campo. El porqué y la
 * regla, en `cuadrarBajaYActiva`.
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
    // dos cosas a la vez. Quién contradice a quién lo decide `lib/billing/
    // cuotas.js` (`cuadrarBajaYActiva`), con su prueba: aquí solo se aplica.
    const cuadrados = cuadrarBajaYActiva(cuota, valores, { activaEnElCuerpo: "active" in body });

    const antes = resumenCuota(cuota);
    await cuota.update(cuadrados);

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

    /*
     * Y el cobro pendiente del mes en curso se rehace (05/09/2026, AV-0046:
     * «si un paciente tiene dos terapias en cuotas, eliminas una de ella, sigue
     * apareciendo en cobros las dos terapias que tenía anteriormente»). Solo
     * ese cobro y solo si aún no es dinero ni papel; los frenos y el porqué,
     * en `lib/billing/cobroDeCuota.js`.
     */
    const cobro = await sincronizarCobroDelMes({ tenantModels, cuotaId: cuota.id });

    return ok({ ...cuota.toJSON(), cobro });
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
     * `?confirmar=1` borra.
     *
     * ── QUÉ PASA CON LOS COBROS (cambiado el 05/09/2026) ────────────────────
     * Hasta hoy no se tocaba ninguno, y tenía sentido porque el cobro solo
     * nacía si alguien pulsaba «Generar el mes». Desde AV-0048 la cuota genera
     * SOLA su cobro del mes, así que borrar el alta equivocada de hace cinco
     * minutos dejaba un cobro pendiente huérfano que nadie iba a pagar y que
     * ensuciaba la morosidad. Ahora se borran los cobros que todavía NO son
     * dinero ni papel —pendientes, sin factura, sin Stripe y sin banco, el
     * mismo criterio de `cobroSePuedeRehacer`—; el dinero cobrado y lo ya
     * facturado se queda, con su `cuotaId` apuntando a una cuota que ya no
     * existe, que es exactamente lo que pasó.
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

    // Los que no son dinero ni papel se van con la cuota que los creó.
    const sueltos = await Payment.findAll({ where: { cuotaId: cuota.id, status: "pending" } });
    const borrables = sueltos.filter((p) => cobroSePuedeRehacer(p).ok);
    for (const p of borrables) await p.destroy();

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
      before: { ...antes, cobros, cobrosPendientes: pendientes, cobrosBorrados: borrables.length },
      after: null,
    });

    return ok({ borrada: true, cobros, pendientes, cobrosBorrados: borrables.length });
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
