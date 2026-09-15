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

/**
 * El PLAN tal como lo lee la IA del informe (15/09/2026, segundo paso de
 * AV-0143, Blanca: «al hacer el informe final, la IA tiene que tener en cuenta
 * el motivo de cada terapia»). Un bloque de texto con el motivo general y, por
 * cada terapia, su motivo y sus objetivos; la terapia de quien firma el
 * informe va marcada y primero. Las terapias se nombran por su ESPECIALIDAD,
 * nunca por el nombre de la persona. Sin nada escrito devuelve "".
 *
 * @param {object} p
 * @param {object} p.plan        `{ consultationReasons, consultationReasonsByTherapist, objectives }`
 * @param {Array}  p.terapeutas  `[{ teamMemberId, specialty }]` del paciente
 * @param {string} [p.autorId]   la ficha de equipo de quien firma el informe
 * @param {object} [p.rotulos]   clave de especialidad → rótulo
 */
export function planParaElInforme({ plan, terapeutas = [], autorId = null, rotulos = {} }) {
  if (!plan) return "";
  const corto = (v, max) => String(v ?? "").trim().slice(0, max);
  const especialidadDe = new Map((terapeutas ?? []).map((t) => [t.teamMemberId, t.specialty ?? null]));
  const nombreDeTerapia = (id) => {
    const k = especialidadDe.get(id);
    return k ? (rotulos[k] ?? k) : "otra terapia del paciente";
  };

  const motivos = normalizarMotivos(plan.consultationReasonsByTherapist);
  const objetivosPorId = new Map();
  for (const o of Array.isArray(plan.objectives) ? plan.objectives : []) {
    const textoO = corto(typeof o === "string" ? o : o?.texto, 300);
    if (!textoO) continue;
    const id = typeof o === "object" && o?.terapeutaId ? o.terapeutaId : "";
    if (!objetivosPorId.has(id)) objetivosPorId.set(id, []);
    objetivosPorId.get(id).push(textoO);
  }

  const ids = [...new Set([...motivos.map((m) => m.terapeutaId), ...objetivosPorId.keys()])].filter(Boolean);
  ids.sort((a, b) => (a === autorId ? -1 : b === autorId ? 1 : 0));

  const partes = [];
  const general = corto(plan.consultationReasons, 1500);
  if (general) partes.push(`Motivo de consulta general: ${general}`);
  for (const id of ids) {
    const lineas = [`Terapia: ${nombreDeTerapia(id)}${id === autorId ? " (la de quien firma este informe)" : ""}`];
    const m = motivos.find((x) => x.terapeutaId === id);
    if (m) lineas.push(`  Motivo de consulta en esta terapia: ${corto(m.texto, 1500)}`);
    for (const o of (objetivosPorId.get(id) ?? []).slice(0, 20)) lineas.push(`  - Objetivo: ${o}`);
    partes.push(lineas.join("\n"));
  }
  const sinTerapia = (objetivosPorId.get("") ?? []).slice(0, 20);
  if (sinTerapia.length) partes.push(`Objetivos sin terapia asignada:\n${sinTerapia.map((o) => `  - ${o}`).join("\n")}`);
  if (!partes.length) return "";

  return [
    "DEL PLAN DE INTERVENCIÓN DEL PACIENTE (contexto: úsalo para enfocar cada apartado según el motivo y los objetivos de su terapia; no lo copies literal ni inventes resultados que no estén en el material):",
    ...partes,
  ].join("\n\n");
}

/** ¿Hay algún motivo escrito, general o de alguna terapia? */
export function tieneMotivo(plan) {
  if (typeof plan?.consultationReasons === "string" && plan.consultationReasons.trim()) return true;
  return normalizarMotivos(plan?.consultationReasonsByTherapist).length > 0;
}
