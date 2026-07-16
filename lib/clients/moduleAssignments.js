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
 *   enabled=true  → crea un Patient (clientId, nombre) si no existe uno enlazado.
 *   enabled=false → borra el Patient enlazado SOLO si no tiene datos clínicos
 *                   (sesiones/informes); si los tiene, lo conserva.
 * No-op seguro si el tenant no tiene tabla `patients` (schema parcial): 42P01.
 *
 * Devuelve { action } describiendo lo ocurrido (para el log/respuesta).
 */
export async function syncClinicPatient({ tenantModels, client, enabled, transaction }) {
  const { Patient } = tenantModels;
  if (!Patient) return { action: "skip" };
  try {
    const existing = await Patient.findOne({ where: { clientId: client.id }, transaction });
    if (enabled) {
      if (existing) return { action: "kept", patientId: existing.id };
      const { firstName, lastName } = splitName(client.name);
      const p = await Patient.create(
        { clientId: client.id, firstName, lastName, status: "active" },
        { transaction }
      );
      return { action: "created", patientId: p.id };
    }
    // enabled=false
    if (!existing) return { action: "noop" };
    const deps = await countClinicDeps(tenantModels, existing.id, transaction);
    if (deps > 0) return { action: "kept_has_data", patientId: existing.id, deps };
    await existing.destroy({ transaction });
    return { action: "deleted", patientId: existing.id };
  } catch (err) {
    if (isMissingTable(err)) return { action: "skip" };
    throw err;
  }
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
