/**
 * lib/billing/audit.js — rastro de auditoría del dinero.
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón que lib/citas/audit.js y
 * lib/clinica/audit.js — lo comparten todos los endpoints de facturación.)
 *
 * QUÉ RESUELVE: solo se auditaba el ciclo de vida de la factura (emitir,
 * enviar, anular, rectificar). Crear o BORRAR una factura, un cobro, un gasto
 * o una tarifa no dejaba ningún rastro: se podía eliminar un pago y nadie
 * podía saber quién ni cuándo. En un CRM que se vende como serio, y para
 * cualquier revisión contable, eso es un agujero.
 *
 * Best-effort, como el resto de auditorías del CRM: un fallo escribiendo el
 * registro NUNCA rompe la operación. Se llama DESPUÉS de la mutación.
 */

import { getMasterModels } from "../db/masterDb.js";

/** Campos que interesan de una factura (no se vuelca la fila entera). */
export function resumenFactura(inv) {
  if (!inv) return null;
  return {
    numero: inv.number ?? null,
    estado: inv.status ?? null,
    total: inv.total != null ? String(inv.total) : null,
    moneda: inv.currency ?? null,
    clienteId: inv.clientId ?? null,
  };
}

/**
 * Campos que interesan de un cobro / gasto / presupuesto / tarifa.
 *
 * OJO con la cadena de fallbacks: cada modelo llama distinto a lo mismo y
 * Sequelize solo hace SELECT de los atributos DEFINIDOS, así que leer un campo
 * que el modelo no expone devuelve `undefined` en silencio (arreglado
 * 2026-07-28: Cost no tiene `amount` —es legacy en BD, a propósito fuera del
 * modelo— ni `date` ni `method`, así que borrar un gasto de 12.000 € dejaba un
 * rastro sin el importe, y en el PATCH el before y el after salían idénticos).
 *
 *   importe → Payment.amount · Cost/Quote.total · Rate.pricePerSession
 *   fecha   → Payment.paidAt · Cost.incurredAt · Quote.issueDate
 *   concepto→ Cost.description · Rate.serviceType · (name/title genéricos)
 */
export function resumenImporte(fila) {
  if (!fila) return null;
  const importe = fila.amount ?? fila.total ?? fila.pricePerSession ?? null;
  return {
    importe: importe != null ? String(importe) : null,
    fecha: fila.date ?? fila.paidAt ?? fila.incurredAt ?? fila.issueDate ?? null,
    concepto:
      fila.concept ?? fila.description ?? fila.name ?? fila.title ?? fila.serviceType ?? null,
    metodo: fila.method ?? null,
  };
}

/**
 * @param {object} p
 * @param {string} p.action  "invoice.created", "payment.deleted"…
 * @param {string} p.entity  "Invoice" | "Payment" | "Cost" | "Rate" | "Quote"
 */
export async function logBillingAudit({ tenantId, userId, action, entity, entityId, before = null, after = null, ip = null }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity, entityId, before, after, ip });
  } catch {
    /* auditoría best-effort: nunca rompe la operación de dinero */
  }
}

/** Atajo: saca userId e ip del request, que es lo que hacen todos los handlers. */
export function datosPeticion(request) {
  return {
    userId: request.headers.get("x-user-id"),
    ip: request.headers.get("x-forwarded-for") ?? null,
  };
}
