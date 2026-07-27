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

/** Campos que interesan de un cobro / gasto / tarifa. */
export function resumenImporte(fila) {
  if (!fila) return null;
  return {
    importe: fila.amount != null ? String(fila.amount) : null,
    fecha: fila.date ?? fila.paidAt ?? null,
    concepto: fila.concept ?? fila.description ?? fila.name ?? null,
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
