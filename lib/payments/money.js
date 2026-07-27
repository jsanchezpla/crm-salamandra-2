/**
 * Dinero: conversión y formato.
 *
 * REGLA DEL PROYECTO: el dinero se guarda y se transporta SIEMPRE en **céntimos**
 * (entero). Los decimales en coma flotante acumulan error (`0.1 + 0.2 !== 0.3`) y
 * la API de Stripe también trabaja en la unidad mínima. Los euros existen solo en
 * la interfaz, justo al pintar y justo al leer del formulario.
 *
 * Por eso la conversión vive aquí y no repartida por la UI: un `* 100` suelto en
 * varios sitios es como se cuelan los cobros de 0,75 € en vez de 75 €.
 */

/**
 * "75,50" | "75.50" | 75.5  →  7550 céntimos.
 * Devuelve null si no es un importe válido (vacío, texto, negativo).
 */
export function eurosToCents(value) {
  if (value == null || value === "") return null;
  const normalizado = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const num = Number(normalizado);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/** 7550 → "75.50" (para rellenar un input). */
export function centsToEuros(cents) {
  if (!Number.isInteger(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** 7550 → "75,50 €" (para mostrar al usuario). */
export function formatMoney(cents, currency = "EUR") {
  if (!Number.isInteger(cents)) return "";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
}
