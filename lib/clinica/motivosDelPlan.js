/**
 * Motivo de consulta POR TERAPIA en el plan de intervención (15/09/2026,
 * AV-0143 de Aumenta, Blanca: «no es lo mismo el motivo recogido para trabajar
 * en el área de pedagogía que en el de psicología»).
 *
 * Igual que los objetivos por terapeuta (AV-0061), pero UN texto por persona:
 * `[{ terapeutaId, texto }]` en `intervention_plans.consultation_reasons_by_therapist`.
 * El motivo de siempre (`consultationReasons`) no se toca ni se reparte: se
 * queda como el «general» del paciente. Los 109 planes de Aumenta que ya lo
 * tenían siguen igual.
 */

export const MAX_TEXTO_MOTIVO = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uno por terapeuta, con texto, recortado. El último escrito gana si viene repetido. */
export function normalizarMotivos(lista) {
  const porId = new Map();
  for (const m of Array.isArray(lista) ? lista : []) {
    const id = typeof m?.terapeutaId === "string" ? m.terapeutaId : null;
    const texto = typeof m?.texto === "string" ? m.texto.trim().slice(0, MAX_TEXTO_MOTIVO) : "";
    if (!id || !UUID_RE.test(id)) continue;
    if (texto) porId.set(id, { terapeutaId: id, texto });
    else porId.delete(id);
  }
  return [...porId.values()];
}

/** El motivo de UNA terapeuta, o "" si no lo tiene. */
export function motivoDe(lista, terapeutaId) {
  if (!terapeutaId) return "";
  return normalizarMotivos(lista).find((m) => m.terapeutaId === terapeutaId)?.texto ?? "";
}

/** Pone (o quita, con texto vacío) el motivo de una terapeuta. Sin recortar mientras se escribe. */
export function ponerMotivo(lista, terapeutaId, texto) {
  const resto = (Array.isArray(lista) ? lista : []).filter((m) => m?.terapeutaId !== terapeutaId);
  return [...resto, { terapeutaId, texto: String(texto ?? "") }];
}

/** ¿Hay algún motivo escrito, general o de alguna terapia? */
export function tieneMotivo(plan) {
  if (typeof plan?.consultationReasons === "string" && plan.consultationReasons.trim()) return true;
  return normalizarMotivos(plan?.consultationReasonsByTherapist).length > 0;
}
