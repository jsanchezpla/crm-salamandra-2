/**
 * lib/utils/auditoria.js — rastro de auditoría genérico.
 *
 * (Fichero nuevo en /lib, regla #2: había un helper por módulo —citas, clínica,
 * documentos, facturación— y los módulos que faltaban por auditar no tenían
 * ninguno. En vez de crear cinco más iguales, este sirve para todos.)
 *
 * QUÉ RESUELVE: crear, editar o BORRAR un cliente, un lead, un ticket o un
 * pedido no dejaba ningún rastro. Se podía eliminar la ficha de un cliente —con
 * sus adjuntos y su historial— y nadie podía saber quién ni cuándo.
 *
 * Best-effort, como el resto: se llama DESPUÉS de la mutación y un fallo aquí
 * jamás rompe la operación.
 */

import { getMasterModels } from "../db/masterDb.js";

/**
 * Guarda una fila de auditoría.
 * `action` sigue la convención "modulo.entidad.verbo" (o "modulo.verbo").
 */
export async function auditar({ tenantId, userId, action, entity, entityId, before = null, after = null, ip = null }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity, entityId, before, after, ip });
  } catch {
    /* auditoría best-effort */
  }
}

/** userId e ip del request, que es lo que hacen todos los handlers. */
export function datosPeticion(request) {
  return {
    userId: request.headers.get("x-user-id"),
    ip: request.headers.get("x-forwarded-for") ?? null,
  };
}

/**
 * Resumen corto de una fila para el before/after.
 *
 * NUNCA se vuelca la fila entera: en clientes y tickets hay datos personales
 * (y en un CRM con pacientes, datos de salud) que no deben acabar duplicados en
 * la tabla de auditoría del schema master, que además comparten todos los
 * clientes. Solo lo justo para saber DE QUÉ se está hablando.
 */
export function resumen(fila, campos) {
  if (!fila) return null;
  const out = {};
  for (const c of campos) {
    const v = fila[c];
    if (v != null && v !== "") out[c] = typeof v === "object" ? String(v) : v;
  }
  return Object.keys(out).length ? out : null;
}
