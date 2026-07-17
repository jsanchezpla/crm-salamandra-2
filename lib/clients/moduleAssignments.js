/**
 * lib/clients/moduleAssignments.js — lógica compartida del sprint
 * "Clientes ↔ módulos".
 *
 * (Motivo del fichero nuevo en /lib, regla #2: encapsula la materialización
 * del Patient clínico y la lista de módulos asignables, reutilizada por los
 * endpoints GET/PATCH de asignaciones.)
 *
 * Módulos que un Client puede tener asignados desde su ficha. La mitad de
 * Nutrición es "pertenencia/intención" (la vista /nutricion/asignados sigue
 * siendo plan-céntrica hasta el refactor del siguiente sprint). La de Clínica
 * materializa un Patient enlazado por client_id para que aparezca en Clínica.
 */
export const ASSIGNABLE_MODULE_KEYS = ["nutricion", "clinica"];

function isMissingTable(err) {
  return err?.parent?.code === "42P01" || err?.original?.code === "42P01";
}

// Divide el nombre del cliente en firstName / lastName para el Patient
// (ambos NOT NULL, VARCHAR(120)). Heurística: primer token = nombre, resto =
// apellidos. Se trunca a 120 para no reventar la columna (un Client.name puede
// llegar a 255) — el terapeuta puede afinarlo luego en la ficha del paciente.
function splitName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  let firstName, lastName;
  if (parts.length === 0) [firstName, lastName] = ["Cliente", "—"];
  else if (parts.length === 1) [firstName, lastName] = [parts[0], "—"];
  else [firstName, lastName] = [parts[0], parts.slice(1).join(" ")];
  return { firstName: firstName.slice(0, 120), lastName: lastName.slice(0, 120) };
}

// Cuenta datos clínicos que impiden borrar el Patient (FK ON DELETE RESTRICT:
// clinic_sessions y clinical_reports). Coordinations es SET NULL → no bloquea.
async function countClinicDeps(tenantModels, patientId, transaction) {
  const { ClinicSession, ClinicalReport } = tenantModels;
  let n = 0;
  if (ClinicSession) n += await ClinicSession.count({ where: { patientId }, transaction });
  if (ClinicalReport) n += await ClinicalReport.count({ where: { patientId }, transaction });
  return n;
}

/**
 * Sincroniza el Patient enlazado a un Client al activar/desactivar 'clinica'.
 *
 * CAMBIO (Sprint Pacientes & Clientes, Fase 1): asignar el módulo YA NO crea ni
 * borra pacientes automáticamente. Aumenta pidió que el paciente sea SIEMPRE
 * explícito (botón "Crear paciente" en la ficha del cliente), porque casi
 * siempre el que paga (cliente) NO es el que asiste (paciente puede ser un hijo,
 * etc.) y un cliente puede tener VARIOS pacientes. El auto-alta creaba un
 * paciente con el nombre del cliente → paciente equivocado o duplicado.
 *
 * Se mantiene la firma/retorno { action } por compatibilidad con el endpoint de
 * asignaciones, pero no toca la tabla `patients`.
 */
export async function syncClinicPatient({ tenantModels, client, enabled, transaction }) {
  // Referencias intencionadamente sin usar: la asignación del módulo ya no
  // materializa pacientes (ver comentario). Los helpers splitName/countClinicDeps
  // se conservan por si un flujo futuro (p. ej. migración) los necesita.
  void tenantModels;
  void client;
  void enabled;
  void transaction;
  return { action: "skip", reason: "explicit_patient_creation" };
}

/**
 * Lee las asignaciones de un cliente de forma tolerante a schema parcial: si la
 * tabla no existe todavía en el tenant (42P01) devuelve [].
 */
export async function listAssignments(ClientModuleAssignment, clientId) {
  try {
    return await ClientModuleAssignment.findAll({
      where: { clientId },
      order: [["moduleKey", "ASC"]],
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export { isMissingTable };
