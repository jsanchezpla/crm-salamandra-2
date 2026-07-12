/**
 * Serializers del módulo Clínica/Pacientes: convierten filas Sequelize a la forma
 * EXACTA que consume el frontend (labels en español, initials/color derivados,
 * preview, participants/topics como string, etc.). Así el recableo del frontend
 * es mínimo: la API devuelve lo mismo que los antiguos dummies.
 *
 * No accede a BD. Recibe instancias de modelo (o .toJSON()) y, cuando hace falta,
 * asociaciones ya incluidas (row.mainTherapist / row.therapist / row.createdBy /
 * row.patient) o extras precalculados (sessionsCount, lastSession).
 */

// ── Labels (enum → etiqueta ES) ─────────────────────────────────────────────
export const PATIENT_STATUS_LABEL = { active: "Activo", paused: "En pausa", discharged: "Alta" };
export const SESSION_STATUS_LABEL = {
  draft: "Borrador",
  ai_pending: "Procesando IA",
  registered: "Registrada",
  published: "Publicada",
};
export const REPORT_TYPE_LABEL = { evolution: "Evolutivo", admission: "Admisión", discharge: "Alta" };
export const REPORT_STATUS_LABEL = { draft: "Borrador", reviewed: "Revisado", delivered: "Entregado" };
export const COORDINATION_TYPE_LABEL = {
  family: "Familia",
  school: "Colegio",
  psychiatrist: "Psiquiatría",
  neuropediatrician: "Neuropediatría",
  other_therapist: "Otro terapeuta",
  orientator: "Orientación",
  other: "Otro",
};

// ── Derivaciones cosméticas ─────────────────────────────────────────────────
const AVATAR_PALETTE = ["#1B3A2D", "#3E5C57", "#7C5E3B", "#5B4B8A", "#A23E48", "#2E6E8E", "#4F7942", "#8A6D3B"];

export function initialsOf(a, b) {
  const s = `${a ?? ""} ${b ?? ""}`.trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Color determinista a partir del id (mismo id → mismo color, sin columna en BD).
export function colorFor(id) {
  const str = String(id ?? "");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  return [v]; // tolera datos antiguos guardados como string suelto
}
function toStr(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return v ?? "";
}
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

// ── Terapeuta (TeamMember → forma de la UI) ─────────────────────────────────
export function serializeTherapist(tm) {
  if (!tm) return null;
  const j = tm.toJSON ? tm.toJSON() : tm;
  return {
    id: j.id,
    name: j.displayName,
    initials: initialsOf(...String(j.displayName ?? "").split(/\s+/)),
    position: j.position ?? "—",
    color: j.avatarColor || colorFor(j.id),
  };
}

// ── Paciente ────────────────────────────────────────────────────────────────
export function serializePatient(p, extra = {}) {
  const j = p.toJSON ? p.toJSON() : p;
  const objectives = toArr(j.objectives);
  const therapist = j.mainTherapist ? serializeTherapist(j.mainTherapist) : null;
  return {
    id: j.id,
    firstName: j.firstName,
    lastName: j.lastName,
    name: `${j.firstName ?? ""} ${j.lastName ?? ""}`.trim(),
    initials: initialsOf(j.firstName, j.lastName),
    color: colorFor(j.id),
    age: j.age ?? null,
    birthDate: j.birthDate ?? null,
    educationCenter: j.educationCenter ?? null,
    educationLevel: j.educationLevel ?? null,
    referralReason: j.referralReason ?? null,
    referredBy: j.referredBy ?? null,
    objectives,
    focus: objectives.join(" · ") || (j.referralReason ? String(j.referralReason).slice(0, 80) : ""),
    mainTherapistId: j.mainTherapistId ?? null,
    therapistId: j.mainTherapistId ?? null, // alias que usa la vista de Clínica
    therapist,
    enrollmentDate: j.enrollmentDate ?? null,
    attendanceFrequency: j.attendanceFrequency ?? null,
    status: j.status,
    statusLabel: PATIENT_STATUS_LABEL[j.status] ?? j.status,
    dischargeDate: j.dischargeDate ?? null,
    dischargeReason: j.dischargeReason ?? null,
    notes: j.notes ?? null,
    lastSession: extra.lastSession ? isoDate(extra.lastSession) : null,
    sessionsCount: extra.sessionsCount ?? 0,
  };
}

// ── Sesión ──────────────────────────────────────────────────────────────────
export function serializeSession(s) {
  const j = s.toJSON ? s.toJSON() : s;
  const obs = j.observations && typeof j.observations === "object" && !Array.isArray(j.observations) ? j.observations : {};
  const preview =
    (j.performance && String(j.performance)) ||
    (j.activities && String(j.activities)) ||
    toArr(j.objectives).join(", ") ||
    "";
  return {
    id: j.id,
    patientId: j.patientId,
    therapistId: j.therapistId,
    therapist: j.therapist ? serializeTherapist(j.therapist) : null,
    sessionDate: isoDate(j.sessionDate),
    duration: j.duration ?? null,
    status: j.status,
    statusLabel: SESSION_STATUS_LABEL[j.status] ?? j.status,
    preview: preview.length > 140 ? preview.slice(0, 140) + "…" : preview,
    objectives: toArr(j.objectives),
    activities: j.activities ?? "",
    performance: j.performance ?? "",
    observations: {
      familyComments: obs.familyComments ?? "",
      nextSessionNotes: obs.nextSessionNotes ?? "",
      homeworkTasks: obs.homeworkTasks ?? "",
      incidents: obs.incidents ?? "",
    },
    audioDurationSec: j.audioDurationSec ?? null,
    aiReviewedAt: isoDate(j.aiReviewedAt),
    aiTranscription: j.aiTranscription ?? null,
  };
}

// ── Informe ─────────────────────────────────────────────────────────────────
const REPORT_SECTIONS = [
  "motiveOfIntervention",
  "objectives",
  "evolution",
  "achievements",
  "persistentDifficulties",
  "recommendations",
  "continuityProposal",
];
export function serializeReport(r) {
  const j = r.toJSON ? r.toJSON() : r;
  const cs = j.contentSections && typeof j.contentSections === "object" ? j.contentSections : {};
  const hasContent = REPORT_SECTIONS.some((k) => cs[k] != null && (Array.isArray(cs[k]) ? cs[k].length : String(cs[k]).trim()));
  const dueDate = j.dueDate ?? null;
  const overdue = j.status !== "delivered" && dueDate ? new Date(dueDate) < new Date() : false;
  return {
    id: j.id,
    patientId: j.patientId,
    therapistId: j.therapistId,
    patient: j.patient ? serializePatient(j.patient) : null,
    therapist: j.therapist ? serializeTherapist(j.therapist) : null,
    type: j.reportType,
    typeLabel: REPORT_TYPE_LABEL[j.reportType] ?? j.reportType,
    reportDate: j.reportDate ?? null,
    dueDate,
    deliveredAt: isoDate(j.deliveredAt),
    status: j.status,
    statusLabel: REPORT_STATUS_LABEL[j.status] ?? j.status,
    overdue,
    hasContent,
    contentSections: {
      motiveOfIntervention: cs.motiveOfIntervention ?? "",
      objectives: toArr(cs.objectives),
      evolution: toArr(cs.evolution),
      achievements: toArr(cs.achievements),
      persistentDifficulties: toArr(cs.persistentDifficulties),
      recommendations: toArr(cs.recommendations),
      continuityProposal: cs.continuityProposal ?? "",
    },
  };
}

// ── Coordinación ────────────────────────────────────────────────────────────
export function serializeCoordination(c) {
  const j = c.toJSON ? c.toJSON() : c;
  return {
    id: j.id,
    type: j.coordinationType,
    typeLabel: COORDINATION_TYPE_LABEL[j.coordinationType] ?? j.coordinationType,
    date: isoDate(j.coordinationDate),
    participants: toStr(j.participants),
    participantsList: toArr(j.participants),
    topics: toStr(j.topics),
    topicsList: toArr(j.topics),
    agreements: toArr(j.agreements),
    nextActions: toArr(j.nextActions),
    relatedPatientId: j.relatedPatientId ?? null,
    createdById: j.createdById ?? null,
    createdBy: j.createdBy ? serializeTherapist(j.createdBy) : null,
  };
}
