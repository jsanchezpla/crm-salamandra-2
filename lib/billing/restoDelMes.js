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
