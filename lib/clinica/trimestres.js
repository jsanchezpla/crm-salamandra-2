/**
 * Trimestres ESCOLARES para la secuenciación de informes (sprint Aumenta
 * 2026-07-28): T1 sep–dic · T2 ene–mar · T3 abr–jun.
 *
 * Decisión de Rodrigo (28/07): opción de que el T3 cuente TAMBIÉN julio.
 * Se controla por tenant con `settings.clinica.trimestreConJulio` (boolean).
 * Julio (sin la opción) y agosto quedan fuera de todo trimestre.
 *
 * Todo trabaja con año/mes numéricos (sin Date parsing ambiguo). "Curso"
 * = año en que empieza (curso 2026 = sep 2026 → jun/jul 2027).
 */

export function trimestreConJulio(tenant) {
  return tenant?.settings?.clinica?.trimestreConJulio === true;
}

// Curso escolar al que pertenece una fecha: de septiembre a diciembre es el
// año en curso; de enero a agosto, el anterior.
export function schoolYearOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  const m = d.getMonth() + 1;
  return m >= 9 ? d.getFullYear() : d.getFullYear() - 1;
}

// Trimestres de un curso. `startYear` = año en que empieza el curso.
export function trimestersOf(startYear, { conJulio = false } = {}) {
  return [
    { key: "T1", label: "1er trimestre", start: { year: startYear, month: 9 }, end: { year: startYear, month: 12 } },
    { key: "T2", label: "2º trimestre", start: { year: startYear + 1, month: 1 }, end: { year: startYear + 1, month: 3 } },
    { key: "T3", label: "3er trimestre", start: { year: startYear + 1, month: 4 }, end: { year: startYear + 1, month: conJulio ? 7 : 6 } },
  ];
}

// Trimestre al que pertenece una fecha, o null (verano fuera de curso).
export function trimesterOf(date, { conJulio = false } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const startYear = schoolYearOf(d);
  const ym = d.getFullYear() * 100 + (d.getMonth() + 1);
  for (const t of trimestersOf(startYear, { conJulio })) {
    const from = t.start.year * 100 + t.start.month;
    const to = t.end.year * 100 + t.end.month;
    if (ym >= from && ym <= to) return { ...t, schoolYear: startYear };
  }
  return null;
}

// Rango [inicio, finExclusivo) de un trimestre como Dates locales, para
// queries por columna de fecha (sessionDate, reportDate).
export function trimesterRange(trimester) {
  const start = new Date(trimester.start.year, trimester.start.month - 1, 1);
  const end = new Date(trimester.end.year, trimester.end.month, 1); // 1º del mes siguiente
  return { start, end };
}

export function schoolYearLabel(startYear) {
  return `${startYear}-${startYear + 1}`;
}
