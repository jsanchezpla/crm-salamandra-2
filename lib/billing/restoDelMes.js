/**
 * lib/billing/restoDelMes.js — lo que queda por cobrar de un mes cuando ya se
 * cobró una parte (04/09/2026, Rodrigo).
 *
 * El encargo: «si alguien hace un pago parcial y se registra el cobro del pago
 * parcial, cuando se vuelva a registrar un cobro suyo en ese mismo mes debe
 * salir el resto del dinero automáticamente que debe».
 *
 * Hasta hoy el drawer de «Nuevo cobro» rellenaba el importe con la cuota
 * ENTERA del mes, mirara o no lo ya cobrado. Con los pagos partidos —que en un
 * centro con 274 cuotas son constantes: la familia deja 50 € y trae el resto la
 * semana siguiente— eso obliga a restar a mano contra la lista de Cobros, y
 * cuando no se resta se cobra el mes dos veces.
 *
 * ── QUÉ COBROS CUENTAN ──────────────────────────────────────────────────────
 * La MISMA regla que decide qué cuotas se rellenan (`cuotaParaRellenar.js`
 * `cuotasQueEntran`), y a propósito: si el importe esperado sale de las cuotas
 * de este paciente más las de la familia entera, lo ya cobrado tiene que salir
 * del mismo sitio o la resta compara dos cosas distintas.
 *
 *   · Con paciente elegido → los cobros de ESE paciente y los que no llevan
 *     paciente (los de la familia entera). Nunca los de un hermano: son de otra
 *     cuota, y restarlos haría cobrar de menos.
 *   · Sin paciente elegido → todos los de la familia, que es lo que se cobra.
 *
 * ── Y DESDE EL 08/09/2026, EL COBRO GENERADO MANDA (AV-0086) ───────────────
 * La regla del 06/09 —«el pendiente manda: ese cobro ya lleva su importe de
 * verdad, prorrateado, pactado o el de la tarifa»— solo se aplicó a los cobros
 * PENDIENTES. Al mes ya cobrado se le seguía midiendo contra la tarifa del
 * catálogo, y eso hacía que el cajón ofreciera cobrar un resto que nadie debe.
 *
 * Medido en producción el 08/09/2026: en septiembre eso pasaba en **112
 * familias**, en 98 de ellas por exactamente 30,00 € —la reserva de plaza que
 * el cobro generado ya llevaba descontada—, y sumaba **4.515,00 €** ofrecidos
 * de más. Rosa lo contó como «hago el cobro por el importe que refleja y luego
 * crea otro por 30 €»: no creaba ninguno (comprobado: cero cobros de 30 € en
 * todo septiembre), lo OFRECÍA, 112 veces.
 *
 * `generadoDelMes` devuelve lo que el CRM generó para ese mes. Quien llama lo
 * usa como `esperado` en vez de la tarifa, pero SOLO si cubre todas las cuotas
 * de la familia: si de dos cuotas el CRM solo generó una, medir contra esa
 * mitad diría «este mes ya está cobrado entero» a quien debe la otra terapia.
 * Por eso viene también el recuento de cuotas distintas.
 *
 * Puras y sin base de datos: quien llama trae los cobros del mes
 * (`GET /api/billing/payments/mes`) y el importe esperado, que ya sabe calcular.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Los cobros de ese mes que cuentan contra este cobro.
 * @param {Array<{patientId: ?string, amount: *}>} cobros
 * @param {?string} patientId
 */
export function cobrosQueCuentan(cobros, patientId = null) {
  const lista = Array.isArray(cobros) ? cobros : [];
  if (!patientId) return lista;
  const mismo = (c) => String(c?.patientId ?? "") === String(patientId);
  const deLaFamilia = (c) => c?.patientId == null || c?.patientId === "";
  return lista.filter((c) => mismo(c) || deLaFamilia(c));
}

/** La suma de esos cobros, redondeada a céntimos. */
export function yaCobradoDelMes(cobros, patientId = null) {
  return round2(
    cobrosQueCuentan(cobros, patientId).reduce((s, c) => s + (Number(c?.amount) || 0), 0)
  );
}

/**
 * Lo que el CRM GENERÓ para ese mes: la suma de los cobros nacidos de una cuota
 * —pendientes y cobrados— y cuántas cuotas distintas cubren.
 *
 * Devuelve `null` cuando no generó ninguno: ahí manda la tarifa, que es lo que
 * se hacía siempre. Un cobro tecleado a mano NO cuenta como generado (nace sin
 * `cuotaId`), y eso es lo que deja intacto el encargo del 04/09: si alguien
 * apunta 50 € a mano, el resto contra la cuota sigue saliendo solo.
 *
 * @param {Array<{patientId: ?string, amount: *, deCuota: ?boolean, cuotaId: ?string}>} pagos
 * @param {?string} patientId
 * @returns {{ importe: number, cuotas: number }|null}
 */
export function generadoDelMes(pagos, patientId = null) {
  const suyos = cobrosQueCuentan(pagos, patientId).filter((p) => p?.deCuota);
  if (!suyos.length) return null;
  const cuotas = new Set(suyos.map((p) => String(p?.cuotaId ?? "")).filter(Boolean));
  return {
    importe: round2(suyos.reduce((s, p) => s + (Number(p?.amount) || 0), 0)),
    // Sin `cuotaId` en la respuesta no se puede contar la cobertura; se dice 0
    // y quien llama se queda con la tarifa, que es lo prudente.
    cuotas: cuotas.size,
  };
}

/**
 * Qué poner en el importe, y qué contarle a quien cobra.
 *
 * @param {object} args
 * @param {number|string|null} args.esperado  la cuota del mes (pactada o del catálogo).
 * @param {Array} args.cobros                 los cobros COMPLETADOS de ese mes.
 * @param {?string} args.patientId            el paciente elegido, si lo hay.
 *
 * @returns {{yaCobrado: number, resto: number, hayParcial: boolean, completo: boolean}}
 *   · `yaCobrado`  lo que ya entró este mes y cuenta para esta cuota.
 *   · `resto`      lo que falta. **Nunca negativo**: si pagaron de más, el
 *                  resto es 0 y no un importe en negativo que el formulario
 *                  aceptaría como cobro (y que restaría de la caja del día).
 *   · `hayParcial` hay algo cobrado y algo pendiente: es EL caso del encargo.
 *   · `completo`   ya está cubierto. Quien cobra tiene que verlo antes de
 *                  apuntar otro: no se rellena el importe, se avisa.
 */
export function restoDelMes({ esperado, cobros, patientId = null } = {}) {
  const yaCobrado = yaCobradoDelMes(cobros, patientId);
  const total = Number(esperado);
  // Sin importe esperado (una familia sin cuota conocida) no hay resta que
  // hacer: se dice lo cobrado y el importe se deja como esté.
  if (!Number.isFinite(total) || total <= 0) {
    return { yaCobrado, resto: 0, hayParcial: false, completo: false };
  }
  const resto = round2(Math.max(0, round2(total) - yaCobrado));
  return {
    yaCobrado,
    resto,
    hayParcial: yaCobrado > 0 && resto > 0,
    completo: yaCobrado > 0 && resto === 0,
  };
}

/**
 * ── LO QUE SE QUEDA A DEBER CUANDO TRAEN MENOS (10/09/2026, Rodrigo) ────────
 *
 * «Si me pagan la mitad, debería quedar pendiente de pago lo restante.»
 *
 * Con una fila PENDIENTE detrás esto ya estaba resuelto desde el 07/09: el
 * servidor la parte y el resto sigue pendiente del mismo mes y de la misma
 * cuota (`lib/billing/cobroParcial.js`). Lo que faltaba es el otro camino, que
 * es el de todo lo que no viene de una cuota generada —un diagnóstico de 650 €
 * del que traen 325, el primer mes de una familia recién dada de alta—: ahí el
 * cobro se guardaba por lo que traían y lo que faltaba no quedaba escrito en
 * ninguna parte, ni en Cobros ni en Morosidad.
 *
 * Esta función dice CUÁNTO falta; quien llama decide si lo reclama (en el
 * cajón es una casilla, puesta de serie) y el POST de cobros crea la fila.
 *
 * @param {object} p
 * @param {number|string} p.esperado     lo que se le pide en este cobro (el resto
 *        del mes si ya había algo cobrado, o la suma de sus conceptos).
 * @param {number|string} p.importe      lo que traen.
 * @param {boolean} p.hayPendiente       si hay una fila pendiente detrás. Entonces
 *        devuelve 0: partirla es cosa del servidor y proponer aquí otro resto
 *        dejaría la deuda escrita DOS veces.
 * @returns {number} lo que falta, redondeado a céntimos. 0 si no falta nada.
 */
export function restoQueSeQuedaPendiente({ esperado, importe, hayPendiente = false } = {}) {
  if (hayPendiente) return 0;
  const debe = round2(esperado);
  const trae = round2(importe);
  if (!Number.isFinite(debe) || debe <= 0) return 0;
  if (!Number.isFinite(trae) || trae <= 0) return 0;
  const falta = round2(debe - trae);
  // Medio céntimo de margen, el mismo que usa el resto de la facturación: un
  // 0,004 de redondeo no es una deuda.
  return falta > 0.005 ? falta : 0;
}
