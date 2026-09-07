/**
 * lib/billing/pagoACuenta.js — la familia que paga varios meses de golpe
 * (07/09/2026, tarea del Registro del 06/09).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos de
 * un pago a cuenta —cuántos meses cubre el dinero que traen y cuánto va a cada
 * uno—, y la comparten la vista previa del cajón y el POST que lo registra. Se
 * fija en `scripts/_smoke-pago-a-cuenta.mjs` sin levantar nada.)
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * «+ Registrar cobro» pide UN mes. La familia que en septiembre paga septiembre
 * y octubre juntos obligaba a apuntar dos cobros a mano con dos meses, y el de
 * octubre quedaba en Cobros como cobrado de un mes que aún no se ha generado:
 * no se duplica (al generar el mes, esa cuota ya tiene cobro), pero nadie lo ve
 * venir. Aquí ese reparto lo hace el CRM, y lo ENSEÑA antes de guardar.
 *
 * ── EL CONTRATO: MESES COMPLETOS ───────────────────────────────────────────
 * Un pago a cuenta paga meses ENTEROS por adelantado (y, si el mes en curso
 * está a medias, primero lo termina). Lo que no completa un mes NO se reparte:
 * se dice cuánto falta o cuánto sobra y se sale, en vez de dejar meses futuros
 * pagados a medias que nadie sabría leer.
 *
 * No es una limitación caprichosa. Un mes pagado a medias ya tiene su camino
 * —registrar el cobro de ESE mes, que rellena el resto solo
 * (`lib/billing/restoDelMes.js`)— y ahí se ve. Un mes futuro medio pagado, en
 * cambio, se queda con un cobro cobrado por menos de lo que vale, y cuando
 * llegue su día la generación lo ve «ya cobrado» y no crea el pendiente que
 * lo delataría: la familia debería 110 € que no saldrían en ninguna pantalla.
 *
 * Todo en céntimos redondeados, y con UNA cuenta que se comprueba siempre:
 * lo repartido más lo que sobra es exactamente lo que trajeron.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Cuántos meses mira como mucho un reparto. Un año por delante es de sobra. */
export const HORIZONTE_MESES = 12;

/** El mes siguiente a 'AAAA-MM'. */
export function mesSiguiente(mes) {
  if (!MES_RE.test(String(mes ?? ""))) return null;
  const [a, m] = String(mes).split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/** Los `n` meses que empiezan en `mes` (incluido). */
export function mesesDesde(mes, n = HORIZONTE_MESES) {
  const salida = [];
  let actual = MES_RE.test(String(mes ?? "")) ? String(mes) : null;
  for (let i = 0; i < Math.max(0, n) && actual; i++) {
    salida.push(actual);
    actual = mesSiguiente(actual);
  }
  return salida;
}

/** Lo que falta por cobrar de un mes: nunca negativo (pagar de más no da saldo). */
export function faltaDelMes({ coste, yaCobrado = 0 } = {}) {
  const total = Number(coste);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return round2(Math.max(0, round2(total) - round2(Number(yaCobrado) || 0)));
}

/**
 * Cómo se reparte el dinero que traen entre los meses que vienen.
 *
 * @param {object} p
 * @param {number|string} p.importe  lo que la familia entrega.
 * @param {Array<{mes: string, coste: *, yaCobrado: *}>} p.meses
 *        en orden, del más cercano al más lejano. `coste` es lo que vale ese
 *        mes según su cuota; `yaCobrado`, lo que ya entró de ese mes.
 *
 * @returns {{aplicaciones: Array, repartido: number, sobra: number, cubiertos: number, saltados: Array<string>, escalones: Array<number>}}
 *   · `aplicaciones` un apunte por mes cubierto, con lo que se le lleva.
 *   · `repartido` + `sobra` === `importe`, SIEMPRE (es la prueba que manda).
 *   · `saltados`   meses que ya estaban pagados y no consumen nada.
 *   · `escalones`  los importes que SÍ cuadran (120, 240, 360…), para poder
 *                  decirle a quien cobra cuál es el de al lado cuando no cuadra.
 */
export function repartirACuenta({ importe, meses = [] } = {}) {
  const total = round2(importe);
  const aplicaciones = [];
  const saltados = [];
  const escalones = [];
  let disponible = total;
  let acumulado = 0;

  if (!Number.isFinite(total) || total <= 0) {
    return { aplicaciones: [], repartido: 0, sobra: 0, cubiertos: 0, saltados: [], escalones: [] };
  }

  for (const m of Array.isArray(meses) ? meses : []) {
    const falta = faltaDelMes(m);
    // Un mes ya pagado no para el reparto ni se lleva nada: se sigue al
    // siguiente. Pagar por adelantado teniendo el mes en curso cubierto es lo
    // normal, no un caso raro.
    if (falta === 0) {
      saltados.push(m?.mes ?? null);
      continue;
    }
    acumulado = round2(acumulado + falta);
    escalones.push(acumulado);
    if (disponible + 0.0049 < falta) break; // no completa este mes: se para aquí
    disponible = round2(disponible - falta);
    aplicaciones.push({
      mes: m.mes,
      coste: round2(m.coste),
      yaCobrado: round2(Number(m.yaCobrado) || 0),
      importe: falta,
    });
    if (disponible <= 0) break;
  }

  return {
    aplicaciones,
    repartido: round2(total - disponible),
    sobra: disponible,
    cubiertos: aplicaciones.length,
    saltados: saltados.filter(Boolean),
    escalones,
  };
}

/**
 * La frase que explica por qué un importe no cuadra, con los dos de al lado.
 * Se enseña ANTES de guardar (vista previa) y es también lo que contesta el
 * POST si alguien lo intenta igual.
 *
 * @param {{sobra: number, repartido: number, escalones: Array<number>}} reparto
 * @returns {string|null} null si cuadra
 */
export function porQueNoCuadra({ sobra = 0, repartido = 0, escalones = [] } = {}) {
  if (round2(sobra) <= 0) return null;
  const euros = (n) => `${round2(n).toFixed(2).replace(".", ",")} €`;
  const total = round2(repartido + sobra);
  if (!repartido) {
    const primero = escalones[0];
    return primero
      ? `${euros(total)} no llegan a cubrir el primer mes, que son ${euros(primero)}.`
      : `Esta familia no tiene ningún mes que cobrar por adelantado.`;
  }
  const siguiente = escalones.find((e) => e > repartido + 0.0049);
  return (
    `${euros(total)} cubren meses enteros hasta ${euros(repartido)} y sobran ${euros(sobra)}.` +
    (siguiente ? ` Con ${euros(siguiente)} entra un mes más.` : ``)
  );
}
