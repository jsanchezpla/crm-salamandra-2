/**
 * lib/clinica/patientClient.js — a qué cliente/pagador pertenece un paciente.
 *
 * (Regla #2) creado para el sprint "conectar todo con cliente y equipo"
 * (2026-07-23): las sesiones, informes y coordinaciones guardan ahora un
 * client_id directo (foto tomada al crearlos) para no depender del salto
 * paciente→cliente al consultarlos. Este helper es la única fuente de ese
 * client_id en el momento de la creación.
 *
 * Devuelve el clientId del paciente o null (paciente sin ficha de cliente
 * asociada, que es válido en el histórico de Aumenta). Nunca lanza.
 */
export async function clientIdOfPatient(tenantModels, patientId) {
  if (!patientId) return null;
  try {
    const { Patient } = tenantModels;
    if (!Patient) return null;
    const p = await Patient.findByPk(patientId, { attributes: ["clientId"] });
    return p ? p.clientId ?? null : null;
  } catch {
    return null;
  }
}
