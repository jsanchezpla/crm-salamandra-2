/**
 * Estado efectivo de una factura, calculado en lectura (no persistido).
 *
 * Las facturas con dueDate vencido y cobros incompletos pasan a "overdue"
 * dinámicamente al servirlas hacia el cliente, sin tocar la fila en BD.
 * Esto evita inconsistencias entre lo que muestra la UI y lo que hay en BD,
 * y elimina la necesidad de un cron que recorra facturas pendientes.
 *
 * El estado persistido `overdue` (cuando un admin lo setea a mano vía PATCH)
 * prevalece sobre el cálculo: queda explícito que la factura está marcada
 * como vencida (típicamente porque hay reclamación abierta).
 *
 * Reglas:
 *   - status terminal o sin emitir → se devuelve tal cual
 *     (cancelled, rectified, draft, paid, overdue persistido).
 *   - status issued / sent / partially_paid + dueDate < hoy + paidAmount < total
 *     → "overdue" calculado.
 *   - resto → status original.
 *
 * "Hoy" es el día de MADRID, no el de UTC (ver `todayIsoDate`).
 */
import { madridToday } from "../utils/madridDate.js";

const PASS_THROUGH = new Set(["cancelled", "rectified", "draft", "paid", "overdue"]);
const OVERDUE_CANDIDATES = new Set(["issued", "sent", "partially_paid"]);

/**
 * El día de negocio contra el que se compara el vencimiento, "YYYY-MM-DD".
 *
 * ⚠️ UN INSTANTE NO TRAE DÍA: hay que elegir en qué zona se lee, y aquí la zona
 * es Europe/Madrid (arreglo 21/08/2026). Antes esto era
 * `today.toISOString().slice(0, 10)`, o sea el día UTC, así que entre las 00:00
 * y las 02:00 de Madrid en verano (01:00 en invierno) una factura que venció
 * ayer seguía saliendo como no vencida: dos horas cada noche en el listado, en
 * la ficha y en el resumen de facturación, que son los tres sitios que llaman a
 * esto SIN pasar `today` (usan el reloj). Que el contenedor vaya en
 * `TZ=Europe/Madrid` desde el 19/08/2026 no lo tapaba: `toISOString()` es UTC
 * corra el proceso donde corra. Para esto existe `lib/utils/madridDate.js`, que
 * ya usan las citas y la bandeja.
 *
 * Un TEXTO, en cambio, no se reinterpreta: "2026-08-20" no es un instante y no
 * tiene zona que convertir — es un día que ya decidió quien llama, y se toma
 * tal cual por sus diez primeras letras. Hoy ningún endpoint pasa `today`; esa
 * rama es de las pruebas y de los scripts, y por eso se deja como estaba en vez
 * de adivinarle una zona.
 */
function todayIsoDate(today) {
  if (today instanceof Date) return madridToday(today);
  if (typeof today === "string") return today.slice(0, 10);
  return madridToday();
}

export function effectiveStatus(invoice, today = new Date()) {
  if (!invoice) return undefined;
  const status = invoice.status;
  if (PASS_THROUGH.has(status)) return status;
  if (!OVERDUE_CANDIDATES.has(status)) return status;

  const dueDate = invoice.dueDate;
  if (!dueDate) return status;

  const total = Number(invoice.total ?? 0);
  const paidAmount = Number(invoice.paidAmount ?? 0);
  if (paidAmount >= total - 0.0049) return status;

  const dueStr = String(dueDate).slice(0, 10);
  const todayStr = todayIsoDate(today);
  if (dueStr < todayStr) return "overdue";

  return status;
}

/**
 * Devuelve un objeto plano (JSON) de la factura con `status` reescrito al
 * estado efectivo. Acepta tanto instancias de Sequelize como objetos planos
 * (raw). No muta el original.
 */
export function withEffectiveStatus(invoice, today = new Date()) {
  if (!invoice) return invoice;
  const json = typeof invoice.toJSON === "function" ? invoice.toJSON() : { ...invoice };
  json.status = effectiveStatus(json, today);
  return json;
}

/**
 * Equivalente para arrays. Tolerante a null/undefined.
 */
export function withEffectiveStatusList(invoices, today = new Date()) {
  if (!invoices) return invoices;
  return invoices.map((inv) => withEffectiveStatus(inv, today));
}
