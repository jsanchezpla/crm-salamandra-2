import { getMasterModels } from "../db/masterDb.js";

/**
 * Auditoría de acciones del módulo Clínica/Pacientes. Best-effort: nunca rompe la
 * request (los AuditLog viven en el schema master). Llamar DESPUÉS de la mutación.
 */
export async function logClinicaAudit({ tenantId, userId, action, entity, entityId, before = null, after = null, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId: userId || null, action, entity, entityId, before, after, ip: ip || null });
  } catch {
    /* silent */
  }
}

/**
 * Resumen SEGURO de un registro clínico para auditar (2026-07-23).
 *
 * El AuditLog vive en master (schema COMPARTIDO por todos los tenants), así que
 * NUNCA debe llevar contenido clínico: transcripciones, motivos de consulta,
 * observaciones, informes… Antes se auditaba `row.toJSON()` entero, que metía
 * datos de salud (art. 9 RGPD) de pacientes —muchos con TCA— fuera de su
 * aislamiento por schema. Este helper deja solo identificadores y metadatos de
 * estado; todo lo demás se descarta.
 *
 * Lista blanca deliberada: si un campo no está aquí, no se audita. Ante la duda,
 * fuera.
 */
const SAFE_AUDIT_KEYS = new Set([
  "id",
  "patientId",
  "relatedPatientId",
  "clientId",
  "therapistId",
  "createdById",
  "teamMemberId",
  "mainTherapistId",
  "status",
  "reportType",
  "coordinationType",
  "sessionDate",
  "reportDate",
  "coordinationDate",
  "dueDate",
  "createdAt",
  "updatedAt",
]);

export function auditSummary(row) {
  if (!row) return null;
  const obj = typeof row.toJSON === "function" ? row.toJSON() : row;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (SAFE_AUDIT_KEYS.has(k)) out[k] = obj[k];
  }
  return out;
}
