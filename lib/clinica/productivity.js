/**
 * Productividad clínica — % de horas de intervención DIRECTA sobre las
 * DISPONIBLES de cada profesional en un mes.
 *
 *   - Horas directas: suma de la duración de las CITAS atendidas del profesional
 *     en el mes (bookings con status confirmed/completed). Se calcula en el
 *     endpoint; aquí solo se recibe el total en minutos.
 *   - Horas disponibles: objetivo semanal (team_members.weekly_direct_hours)
 *     prorrateado a los días laborables (lun-vie) del mes.
 *   - Productividad %: directas / disponibles. Puede pasar de 100 (hizo más de
 *     lo previsto); el valor real se muestra tal cual, pero para el complemento
 *     de "ocupación" del incentivo se recorta a 0-100.
 *
 * Sin festivos por ahora (v1): se cuentan todos los lun-vie. Afinable después.
 */

/** Días laborables (lunes a viernes) de un mes. `month` es 1-12. */
export function workingDaysInMonth(year, month) {
  const days = new Date(year, month, 0).getDate(); // último día del mes
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=dom .. 6=sáb
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

/**
 * Productividad de un profesional en un mes.
 * @returns { directHours, availableHours, pct }  pct es null si no hay objetivo.
 */
export function computeProductivity({ directMinutes = 0, weeklyDirectHours = null, year, month }) {
  const directHours = Math.round((Number(directMinutes) / 60) * 10) / 10;
  if (weeklyDirectHours == null || !Number.isFinite(Number(weeklyDirectHours)) || Number(weeklyDirectHours) <= 0) {
    return { directHours, availableHours: null, pct: null };
  }
  const workDays = workingDaysInMonth(year, month);
  const dailyHours = Number(weeklyDirectHours) / 5;
  const availableHours = Math.round(dailyHours * workDays * 10) / 10;
  const pct = availableHours > 0 ? Math.round((directHours / availableHours) * 100) : null;
  return { directHours, availableHours, pct };
}

/** % de productividad → valor 0-100 para el complemento de ocupación (null si N/D). */
export function occupationFromPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(pct))));
}
