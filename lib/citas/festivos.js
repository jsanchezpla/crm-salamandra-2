/**
 * lib/citas/festivos.js — días bloqueados del centro (sprint Aumenta 2026-07-29).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la reserva pública, el
 * calendario del panel, el sugeridor de huecos y el alta manual de citas.)
 *
 * QUÉ RESUELVE: el CRM solo sabía de disponibilidad SEMANAL (los martes de 9 a
 * 14). No había forma de decir "el 6 de diciembre está cerrado", así que el
 * widget seguía ofreciendo huecos en Navidad, en el puente y el día que el
 * centro cierra por formación — y alguien reservaba.
 *
 * ALCANCE: es del TENANT entero, no por profesional. Un cierre del centro
 * afecta a todos; una ausencia individual se resuelve con la disponibilidad de
 * esa persona, que es otra cosa.
 *
 * LO QUE NO HACE, A PROPÓSITO: no toca las citas YA existentes de ese día.
 * Cancelarlas automáticamente sería tomar por el cliente una decisión que
 * tiene que tomar él (avisar, reubicar, cobrar o no). El panel las sigue
 * enseñando y el admin decide.
 */

/** "YYYY-MM-DD" a partir de { year, month, day } (mes 1-12). */
export function claveDia({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Festivos del tenant en un rango, como Set de "YYYY-MM-DD".
 *
 * Devuelve un Set VACÍO si el tenant no tiene la tabla (schema sin migrar):
 * un centro sin festivos configurados tiene que seguir dando cita, no quedarse
 * sin agenda por una migración pendiente.
 */
export async function cargarFestivos(tenantModels, { desde = null, hasta = null } = {}) {
  const { BlockedDay } = tenantModels ?? {};
  if (!BlockedDay) return new Set();
  try {
    const where = {};
    if (desde && hasta) {
      const { Op } = await import("sequelize");
      where.date = { [Op.between]: [desde, hasta] };
    }
    const filas = await BlockedDay.findAll({ where, attributes: ["date"] });
    return new Set(filas.map((f) => String(f.date).slice(0, 10)));
  } catch {
    return new Set();
  }
}

/** ¿Está bloqueado este día? Acepta {year,month,day} o "YYYY-MM-DD". */
export function esFestivo(festivos, fecha) {
  if (!festivos || festivos.size === 0) return false;
  const clave = typeof fecha === "string" ? fecha.slice(0, 10) : claveDia(fecha);
  return festivos.has(clave);
}
