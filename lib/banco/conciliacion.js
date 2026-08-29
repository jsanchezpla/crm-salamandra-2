/**
 * lib/banco/conciliacion.js — las reglas PURAS de la conciliación bancaria.
 *
 * (Fichero en /lib, regla #2: estas dos decisiones —cómo se lee una transacción
 * de GoCardless y qué cobros/gastos casan con un movimiento— las comparten la
 * sincronización y la pantalla de sugerencias, y son las que fija la prueba
 * `scripts/_smoke-banco-conciliacion.mjs`. Nada de aquí toca red ni base de
 * datos: entra un objeto, sale un objeto.)
 */

/** ¿Este movimiento se casa con un cobro (entra dinero) o con un gasto (sale)? */
export function ladoDe(mov) {
  return Number(mov?.amount) >= 0 ? "cobro" : "gasto";
}

/**
 * Una transacción de GoCardless → nuestra fila, o `null` si no da para fila.
 *
 * `uid`: el banco manda `internalTransactionId` (estable) y a veces también
 * `transactionId`; se prefiere el primero. SIN uid no se guarda: sin idempotencia
 * cada sincronización duplicaría el extracto entero.
 *
 * `counterparty`: si entra dinero interesa QUIÉN LO MANDA (debtor); si sale,
 * a quién se le paga (creditor). Es la pista principal para sugerir.
 */
export function normalizarTransaccion(tx) {
  if (!tx || typeof tx !== "object") return null;

  const uid = tx.internalTransactionId ?? tx.transactionId ?? null;
  const bookingDate = tx.bookingDate ?? tx.valueDate ?? null;
  const amount = Number(tx.transactionAmount?.amount);
  if (!uid || !bookingDate || !Number.isFinite(amount)) return null;

  const trozosConcepto = [
    tx.remittanceInformationUnstructured,
    Array.isArray(tx.remittanceInformationUnstructuredArray)
      ? tx.remittanceInformationUnstructuredArray.join(" ")
      : null,
    tx.additionalInformation,
  ].filter((x) => typeof x === "string" && x.trim());

  return {
    uid: String(uid),
    bookingDate,
    valueDate: tx.valueDate ?? null,
    amount,
    currency: (tx.transactionAmount?.currency || "EUR").toUpperCase(),
    concept: trozosConcepto.length ? [...new Set(trozosConcepto)].join(" · ").slice(0, 2000) : null,
    counterparty:
      (amount >= 0 ? (tx.debtorName ?? tx.creditorName) : (tx.creditorName ?? tx.debtorName)) ?? null,
  };
}

/** Días entre dos fechas 'YYYY-MM-DD' (valor absoluto; Infinity si falta una). */
function diasEntre(a, b) {
  const ta = Date.parse(String(a ?? "").slice(0, 10));
  const tb = Date.parse(String(b ?? "").slice(0, 10));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / (24 * 60 * 60 * 1000);
}

/** minúsculas y sin tildes, para comparar nombres como los escribe un banco. */
function llano(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** ¿Comparten el nombre del banco y el del CRM alguna palabra con sustancia? */
function nombresSeParecen(a, b) {
  if (!a || !b) return false;
  const palabras = (s) => new Set(llano(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const pa = palabras(a);
  for (const w of palabras(b)) if (pa.has(w)) return true;
  return false;
}

/**
 * Ordena los candidatos a casar con un movimiento, de más a menos probable.
 *
 * `mov`: { amount (firmado), bookingDate, counterparty }.
 * `candidatos`: [{ id, importe, fecha, nombre }] — YA del lado correcto (cobros
 * para importes positivos, gastos para negativos) y sin casar; eso lo filtra la
 * consulta, no esto.
 *
 * La regla, en orden de peso:
 *   1. El importe tiene que CLAVAR al céntimo (con 0,005 € de margen por
 *      redondeo decimal). Un importe distinto no es «menos probable»: no es él.
 *   2. Cuanto más cerca la fecha, mejor (tope `maxDias`; el banco liquida con
 *      días de retraso, sobre todo tarjeta y remesas).
 *   3. Si el nombre del banco se parece al del CRM, sube.
 */
export function sugerenciasPara(mov, candidatos, { maxDias = 10, max = 5 } = {}) {
  const objetivo = Math.abs(Number(mov?.amount));
  if (!Number.isFinite(objetivo)) return [];

  const puntuados = [];
  for (const c of Array.isArray(candidatos) ? candidatos : []) {
    const importe = Math.abs(Number(c?.importe));
    if (!Number.isFinite(importe) || Math.abs(importe - objetivo) > 0.005) continue;

    const dias = diasEntre(mov.bookingDate, c.fecha);
    if (dias > maxDias) continue;

    const parecido = nombresSeParecen(mov.counterparty, c.nombre);
    puntuados.push({ ...c, puntos: 100 - dias * 5 + (parecido ? 20 : 0), dias, nombreCoincide: parecido });
  }

  puntuados.sort((a, b) => b.puntos - a.puntos || a.dias - b.dias);
  return puntuados.slice(0, Math.max(1, max));
}
