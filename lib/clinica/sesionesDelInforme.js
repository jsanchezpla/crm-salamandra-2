/**
 * lib/clinica/sesionesDelInforme.js — las sesiones en las que se basa un
 * informe, cargadas para su PDF (26/08/2026, Rodrigo: el informe es la
 * redacción de la profesional; de las sesiones, la portada solo dice las
 * FECHAS, y lo literal va en un anexo opcional).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten las dos rutas que generan el
 * PDF — «Ver PDF» y «Enviar al paciente» — y con dos copias del query, la
 * primera que alguien tocara dejaría a la otra enseñando otra cosa.)
 *
 * ⚠️ EL CANDADO DE PACIENTE NO ES OPCIONAL: los ids vienen de
 * `contentSections.sourceSessionIds`, que escribió un navegador. Sin el
 * `patientId` en el where, un id de sesión de OTRO paciente colaría su
 * registro clínico en el PDF de este — un incidente de datos de salud. La
 * misma regla que el volcado («solo sesiones del mismo paciente»).
 */
export async function sesionesDelInforme(tenantModels, report) {
  try {
    const cs = report?.contentSections;
    const ids = Array.isArray(cs?.sourceSessionIds) ? cs.sourceSessionIds.filter(Boolean) : [];
    if (!ids.length) return [];
    const { ClinicSession } = tenantModels;
    if (!ClinicSession) return [];
    const filas = await ClinicSession.findAll({
      where: { id: ids, patientId: report.patientId },
      attributes: ["id", "sessionDate", "objectives", "activities", "performance", "observations", "parentFeedback"],
      order: [["sessionDate", "ASC"]],
    });
    return filas.map((f) => (f.toJSON ? f.toJSON() : f));
  } catch {
    // Un PDF sin la línea de fechas es mejor que un PDF que no sale.
    return [];
  }
}
