/**
 * lib/billing/patientLink.js — enlace factura↔paciente (Fase 2a).
 *
 * (Motivo del fichero nuevo en /lib, regla #2: la validación del patientId y el
 * include del paciente se comparten entre los endpoints POST/PATCH/GET de
 * facturas; centralizarlo evita divergencias y mantiene el gateo por módulo en
 * un solo sitio. El pagador de la factura sigue siendo Invoice.clientId; esto es
 * solo la trazabilidad "de qué paciente es la factura".)
 *
 * Un tenant con billing NO tiene por qué tener el módulo/tabla de pacientes
 * (solo aumenta lo tiene). Por eso el patientId se ignora si el tenant no tiene
 * Clínica/Pacientes, y el include se gatea con la misma condición.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function billingHasPatients(hasModule) {
  return hasModule("clinica") || hasModule("pacientes");
}

/**
 * Resuelve el patientId de una factura. Devuelve { patientId } (posible null) o
 * { err } con un mensaje. Si el tenant no tiene módulo de pacientes, se ignora
 * (patientId=null) en vez de fallar. Si viene un id, debe ser un Patient real.
 */
export async function resolveInvoicePatientId(rawPatientId, tenantModels, hasModule) {
  if (rawPatientId == null || rawPatientId === "") return { patientId: null };
  if (!billingHasPatients(hasModule)) return { patientId: null };
  if (!UUID_RE.test(String(rawPatientId))) return { err: "patientId inválido" };
  const { Patient } = tenantModels;
  if (!Patient) return { patientId: null };
  const p = await Patient.findByPk(rawPatientId, { attributes: ["id"] });
  if (!p) return { err: "patientId no existe" };
  return { patientId: p.id };
}

/** Include del paciente para las queries de factura (guardado por módulo). */
export function invoicePatientInclude(tenantModels, hasModule) {
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return [];
  return [{ model: tenantModels.Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }];
}
