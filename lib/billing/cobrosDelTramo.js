/**
 * lib/billing/cobrosDelTramo.js — los cobros de TODOS los meses firmados, no
 * solo el del mes en curso (10/09/2026, Rodrigo).
 *
 * El encargo, con su ejemplo: «en cobros automáticamente deberían salir tantos
 * cobros como cuotas haya firmado un paciente. Aumentín hemos puesto que tenga
 * 6 meses de cuota en Pedagogía 60x1: deberían salir 6 cobros pendientes, cada
 * uno relativo a un mes, y que cuando busque Aumentín me salgan los 6 para
 * poder hacerlos».
 *
 * ── QUÉ HABÍA ──────────────────────────────────────────────────────────────
 * Dar de alta una cuota creaba UN cobro: el del mes en curso
 * (`sincronizarCobroDelMes`, 05/09/2026, AV-0048). Los otros cinco meses no
 * existían hasta que alguien pulsaba «Generar el mes» en septiembre, en
 * octubre, en noviembre… Firmar seis meses y ver un solo cobro obliga a
 * fiarse de que alguien se acuerde cinco veces.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * Una cuota con fecha de baja tiene un número de meses FIRMADO, y de cada uno
 * sale su cobro pendiente. Con tres frenos, y los tres importan:
 *
 *  1. **Del mes en curso hacia adelante.** Una cuota que empezó en marzo y se
 *     edita hoy no estrena de golpe seis cobros pendientes de meses que ya
 *     pasaron: eso sería inventarle deuda a una familia. Lo pasado se quedó
 *     como se quedó.
 *  2. **Sin fecha de baja no hay número firmado**, así que la cuota indefinida
 *     sigue como hasta hoy: su cobro del mes en curso y el lote mensual. No se
 *     pueden generar infinitos meses.
 *  3. **Tope de 24 meses.** Una cuota firmada hasta 2031 son 60 cobros
 *     pendientes que nadie va a mirar; el lote mensual sigue estando para eso.
 *
 * Cada mes lo resuelve `sincronizarCobroDelMes`, que ya sabe lo difícil: el
 * prorrateo del mes de alta, la reserva de plaza que se gasta una sola vez, el
 * pago parcial que parte la fila y el mes ya cobrado que NO se reabre. Aquí
 * solo se decide QUÉ MESES hay que poner al día.
 *
 * Los dos primeros son puros y se prueban sin base de datos
 * (`scripts/_smoke-cobros-del-tramo.mjs`); el tercero es el que habla con los
 * modelos.
 */

import { mesValido, mesVigente } from "./cuotas.js";
import { sincronizarCobroDelMes } from "./cobroDeCuota.js";

/** Más allá de esto, el lote mensual. Ver el freno 3 de la cabecera. */
export const TOPE_MESES = 24;

/** 'AAAA-MM' → el mes siguiente. */
export function mesSiguiente(mes) {
  const [a, m] = String(mes).split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Los meses que cubre una cuota FIRMADA, del mes en curso hacia adelante.
 *
 *   mesesDelTramo({ startDate: "2026-09-01", endDate: "2027-02-28" })
 *     → ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]
 *
 * Vacío cuando no hay fecha de baja (indefinida), cuando el tramo entero quedó
 * atrás, o cuando las fechas no valen.
 */
export function mesesDelTramo({ startDate, endDate } = {}, { hoy = null, tope = TOPE_MESES } = {}) {
  const alta = String(startDate ?? "").slice(0, 7);
  const baja = String(endDate ?? "").slice(0, 7);
  if (!mesValido(alta) || !mesValido(baja)) return [];

  const ahora = mesValido(hoy) ? hoy : mesVigente();
  // Lo pasado no se rehace (freno 1): se arranca en el mes en curso salvo que
  // la cuota empiece más adelante.
  const desde = alta > ahora ? alta : ahora;
  if (baja < desde) return [];

  const meses = [];
  for (let m = desde; m <= baja && meses.length < tope; m = mesSiguiente(m)) meses.push(m);
  return meses;
}

/**
 * Y los meses que hay que REPASAR de una cuota: los que cubre más aquellos en
 * los que quedó un cobro pendiente.
 *
 * Los pendientes entran para que acortar la cuota limpie lo que sobra: pasar
 * de seis meses a tres tiene que retirar los cobros de los tres que ya no se
 * han firmado, y esos meses no salen del tramo nuevo precisamente porque ya no
 * están en él. Solo del mes en curso en adelante: un pendiente de marzo es
 * deuda vieja y no se toca.
 *
 * Sin tramo firmado queda el mes en curso, que es lo que se hacía hasta hoy.
 */
export function mesesAPonerAlDia({ startDate, endDate, pendientes = [] } = {}, { hoy = null, tope = TOPE_MESES } = {}) {
  const ahora = mesValido(hoy) ? hoy : mesVigente();
  const meses = new Set(mesesDelTramo({ startDate, endDate }, { hoy: ahora, tope }));
  for (const p of pendientes) {
    const mes = String(p ?? "").slice(0, 7);
    if (mesValido(mes) && mes >= ahora) meses.add(mes);
  }
  if (meses.size === 0) return [ahora];
  return [...meses].sort();
}

/**
 * Pone al día los cobros de las cuotas que se acaban de crear o cambiar.
 *
 * Devuelve el mismo recuento que `sincronizarCobrosDelMes` —del que es el
 * relevo— para que la pantalla pueda decirlo en una frase, más los meses
 * recorridos.
 */
export async function sincronizarCobrosDelTramo({ tenantModels, cuotaIds = [], hoy = null }) {
  const { Cuota, Payment } = tenantModels || {};
  const ahora = mesValido(hoy) ? hoy : mesVigente();
  const resultados = [];

  for (const id of cuotaIds) {
    let meses = [ahora];
    try {
      const cuota = Cuota ? await Cuota.findByPk(id, { attributes: ["id", "startDate", "endDate"] }) : null;
      const pendientes = Payment
        ? (await Payment.findAll({
            where: { cuotaId: id, status: "pending" },
            attributes: ["periodMonth"],
          })).map((p) => String(p.periodMonth ?? "").slice(0, 7))
        : [];
      meses = mesesAPonerAlDia(
        { startDate: cuota?.startDate, endDate: cuota?.endDate, pendientes },
        { hoy: ahora }
      );
    } catch {
      // Que no se pueda mirar el tramo no puede dejar la cuota sin su cobro del
      // mes: se sigue con el de siempre.
      meses = [ahora];
    }

    // En orden: la reserva de plaza se descuenta del PRIMER mes que la gasta, y
    // la cuota se queda con ese mes apuntado para los siguientes.
    for (const mes of meses) {
      resultados.push({
        cuotaId: String(id),
        mes,
        ...(await sincronizarCobroDelMes({ tenantModels, cuotaId: id, mes })),
      });
    }
  }

  return {
    resultados,
    meses: [...new Set(resultados.map((r) => r.mes))].sort(),
    creados: resultados.filter((r) => r.estado === "creado").length,
    actualizados: resultados.filter((r) => r.estado === "actualizado").length,
    retirados: resultados.filter((r) => r.estado === "retirado").length,
    sinImporte: resultados.filter((r) => r.estado === "sin-importe").length,
    intocables: resultados.filter((r) => r.estado === "intocable").length,
  };
}
