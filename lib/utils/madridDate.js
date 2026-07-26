/**
 * lib/utils/madridDate.js — fecha "de hoy" en hora ESPAÑOLA, en el servidor.
 *
 * El contenedor de producción corre en UTC (verificado 2026-07-24). Todo código
 * de servidor que calcule "hoy" o "el día de hoy va de X a Y" con new Date()
 * local se equivoca entre las 00:00 y las 02:00 españolas (en verano): cree que
 * aún es el día anterior. Los usuarios del CRM son todos de España, así que el
 * concepto de "hoy" del negocio es Europe/Madrid, no UTC.
 *
 * Se usa en: bandeja (citas de hoy, informes vencidos), alertas automáticas,
 * fecha por defecto de incidencias y periodo por defecto de productividad/
 * dashboard/incentivos. NO cambia la TZ global del proceso (eso afectaría a
 * todo el CRM y es una decisión de infra aparte).
 */

const TZ = "Europe/Madrid";

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" de HOY en Madrid (o de la fecha indicada). */
export function madridToday(now = new Date()) {
  return DATE_FMT.format(now); // en-CA → YYYY-MM-DD
}

/** { year, month } (mes 1-12) de hoy en Madrid. */
export function madridYearMonth(now = new Date()) {
  const [y, m] = madridToday(now).split("-").map(Number);
  return { year: y, month: m };
}

// Instante (Date) de la MEDIANOCHE de Madrid de un "YYYY-MM-DD". España va
// siempre en +01:00 (invierno) o +02:00 (verano): se prueba cuál de los dos
// offsets produce las 00:00 de ese día al formatearlo en Madrid.
function madridMidnight(dateStr) {
  const checkFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  for (const off of ["+02:00", "+01:00"]) {
    const candidate = new Date(`${dateStr}T00:00:00${off}`);
    const parts = Object.fromEntries(checkFmt.formatToParts(candidate).map((p) => [p.type, p.value]));
    const hour = parts.hour === "24" ? "00" : parts.hour;
    if (`${parts.year}-${parts.month}-${parts.day}` === dateStr && hour === "00") return candidate;
  }
  // Salvaguarda (no debería darse en Europe/Madrid): medianoche UTC.
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Rango [start, end) del día de HOY en Madrid, como instantes reales.
 * `end` es la medianoche de Madrid del día siguiente (exacto incluso en los
 * cambios de hora de 23/25 horas).
 */
export function madridDayRange(now = new Date()) {
  const startStr = madridToday(now);
  const start = madridMidnight(startStr);
  const nextStr = madridToday(new Date(start.getTime() + 36 * 3600 * 1000));
  const end = madridMidnight(nextStr);
  return { start, end };
}
