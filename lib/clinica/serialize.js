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

import { PERFORMANCE_AREAS, scoreToSemaforo } from "./performanceAreas.js";
import { LEGACY_ROLE } from "./performanceConfig.js";
import { normalizeSpecialties, specialtyLabels } from "./specialties.js";
import { proposeIncentive } from "./incentives.js";
import { REFERRAL_SPECIALTY_LABEL } from "./derivaciones.js";

// ── Labels (enum → etiqueta ES) ─────────────────────────────────────────────
export const PATIENT_STATUS_LABEL = { active: "Activo", paused: "En pausa", discharged: "Alta" };
export const CARE_TYPE_LABEL = { terapia: "Terapia", nutricion: "Nutrición" };
export const SESSION_STATUS_LABEL = {
  draft: "Borrador",
  ai_pending: "Procesando IA",
  registered: "Registrada",
  published: "Publicada",
};
// "admission" se renombró a "Entrevista inicial" y se añadió "referral"
// (Derivación) en el sprint Aumenta 2026-07-28. Los valores en BD no cambian.
// REPORT_TYPES es la fuente ÚNICA de tipos válidos: los endpoints y la UI
// importan de aquí (antes el array vivía duplicado en 5 ficheros).
export const REPORT_TYPES = ["evolution", "admission", "discharge", "referral"];
export const REPORT_TYPE_LABEL = {
  evolution: "Evolutivo",
  admission: "Entrevista inicial",
  discharge: "Alta",
  referral: "Derivación",
};
export const REPORT_STATUS_LABEL = { draft: "Borrador", reviewed: "Revisado", delivered: "Enviado" };
export const COORDINATION_TYPE_LABEL = {
  family: "Familia",
  school: "Colegio",
  psychiatrist: "Psiquiatría",
  neuropediatrician: "Neuropediatría",
  other_therapist: "Otro terapeuta",
  orientator: "Orientación",
  other: "Otro",
};
export const COORDINATION_SCOPE_LABEL = { internal: "Interna", external: "Externa" };

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

// Vista segura de la metadata del contrato (oculta el nombre en disco).
function contractView(cf) {
  if (!cf || typeof cf !== "object") return null;
  return {
    originalName: cf.originalName ?? null,
    size: cf.size ?? null,
    uploadedAt: cf.uploadedAt ?? null,
  };
}

// Contactos del cliente que paga (email/teléfono etiquetados). El paciente NO
// duplica contactos: se muestran los del pagador (decisión de Aumenta).
function payerContactsOf(client) {
  const cms = client?.contactMethods;
  if (!Array.isArray(cms)) return [];
  return cms.map((cm) => {
    const c = cm.toJSON ? cm.toJSON() : cm;
    return { id: c.id, kind: c.kind, value: c.value, label: c.label ?? null, isPrimary: !!c.isPrimary };
  });
}

// ── Paciente ────────────────────────────────────────────────────────────────
export function serializePatient(p, extra = {}) {
  const j = p.toJSON ? p.toJSON() : p;
  const objectives = toArr(j.objectives);
  const therapist = j.mainTherapist ? serializeTherapist(j.mainTherapist) : null;
  const consents = j.consents && typeof j.consents === "object" && !Array.isArray(j.consents) ? j.consents : {};
  const clientJson = j.client ?? null;
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
    careType: j.careType ?? "terapia",
    careTypeLabel: CARE_TYPE_LABEL[j.careType] ?? CARE_TYPE_LABEL.terapia,
    specialties: normalizeSpecialties(j.specialties),
    specialtyLabels: specialtyLabels(j.specialties),
    dischargeDate: j.dischargeDate ?? null,
    dischargeReason: j.dischargeReason ?? null,
    notes: j.notes ?? null,
    // ── Datos personales / legales (Aumenta) ──────────────────────────────
    dni: j.dni ?? null,
    address: j.address ?? null,
    relationship: j.relationship ?? null,
    consents,
    contractSigned: !!j.contractSigned,
    contractFile: contractView(j.contractFile),
    // ── Cliente pagador + sus contactos (si vienen incluidos) ─────────────
    clientId: j.clientId ?? null,
    client: clientJson
      ? {
          id: clientJson.id,
          name: clientJson.name,
          separated: clientJson.separated ?? null,
          // Padres/tutores estructurados (sprint Aumenta 2026-07-28); llegan
          // solo si el include del endpoint pide el atributo guardians.
          guardians: toArr(clientJson.guardians),
        }
      : null,
    payerContacts: payerContactsOf(clientJson),
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
    // Registro de sesión en 3 partes (sprint Aumenta 2026-07-28).
    prepText: j.prepText ?? "",
    // Sin `storagePath`: la ruta en disco es cosa del servidor, y el navegador
    // solo necesita el id para pedir la descarga.
    prepFiles: toArr(j.prepFiles).map((f) => ({
      id: f?.id ?? null,
      name: f?.name ?? "archivo",
      mimeType: f?.mimeType ?? null,
      size: f?.size ?? null,
      uploadedAt: f?.uploadedAt ?? null,
    })),
    parentFeedback: j.parentFeedback ?? "",
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
  const hasContent =
    REPORT_SECTIONS.some((k) => cs[k] != null && (Array.isArray(cs[k]) ? cs[k].length : String(cs[k]).trim())) ||
    Boolean(cs.referralSpecialty);
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
    deliveredDocumentId: j.deliveredDocumentId ?? null,
    status: j.status,
    statusLabel: REPORT_STATUS_LABEL[j.status] ?? j.status,
    overdue,
    hasContent,
    // `sourceSessionIds` = registros de sesión elegidos como base del informe
    // evolutivo (generación IA, sprint Aumenta 2026-07-28).
    sourceSessionIds: toArr(cs.sourceSessionIds),
    contentSections: {
      motiveOfIntervention: cs.motiveOfIntervention ?? "",
      objectives: toArr(cs.objectives),
      evolution: toArr(cs.evolution),
      achievements: toArr(cs.achievements),
      persistentDifficulties: toArr(cs.persistentDifficulties),
      recommendations: toArr(cs.recommendations),
      continuityProposal: cs.continuityProposal ?? "",
      // Solo informes de tipo Derivación (claves de lib/clinica/derivaciones.js).
      referralSpecialty: cs.referralSpecialty ?? "",
    },
    referralSpecialtyLabel: cs.referralSpecialty ? (REFERRAL_SPECIALTY_LABEL[cs.referralSpecialty] ?? cs.referralSpecialty) : null,
  };
}

// ── Coordinación ────────────────────────────────────────────────────────────
export function serializeCoordination(c) {
  const j = c.toJSON ? c.toJSON() : c;
  return {
    id: j.id,
    type: j.coordinationType,
    typeLabel: COORDINATION_TYPE_LABEL[j.coordinationType] ?? j.coordinationType,
    scope: j.scope ?? null,
    scopeLabel: j.scope ? (COORDINATION_SCOPE_LABEL[j.scope] ?? j.scope) : null,
    externalEntity: j.externalEntity ?? null,
    date: isoDate(j.coordinationDate),
    participants: toStr(j.participants),
    participantsList: toArr(j.participants),
    topics: toStr(j.topics),
    topicsList: toArr(j.topics),
    agreements: toArr(j.agreements),
    nextActions: toArr(j.nextActions),
    relatedPatientId: j.relatedPatientId ?? null,
    // Nombre del paciente para el listado general del módulo (2026-07-31):
    // solo si el endpoint pidió el include; una coordinación puede no tener
    // paciente (reunión de equipo).
    patientName: j.relatedPatient ? `${j.relatedPatient.firstName ?? ""} ${j.relatedPatient.lastName ?? ""}`.trim() : null,
    createdById: j.createdById ?? null,
    createdBy: j.createdBy ? serializeTherapist(j.createdBy) : null,
  };
}

// ── Desempeño (PerformanceMetric) ───────────────────────────────────────────
const MONTH_SHORT = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_FULL = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const num = (v) => (v == null ? null : Number(v));

export const monthShort = (m) => MONTH_SHORT[m] ?? "?";
export const monthLabel = (m, y) => `${MONTH_FULL[m] ?? ""} ${y ?? ""}`.trim();

// Etiqueta de complementos alcanzados (Ocupación ≥90 · Antigüedad ≥3 · Asistencia).
function complementsLabel(m) {
  const met = [];
  if ((m.complementOccupation ?? 0) >= 90) met.push("Ocupación");
  if ((m.complementSeniority ?? 0) >= 3) met.push("Antigüedad");
  if (m.complementAttendance) met.push("Asistencia");
  if (met.length === 3) return "Todos";
  return met.join(", ") || "—";
}

/**
 * Regla de LECTURA de puntuaciones de una fila (desempeño por roles, 2026-07-29
 * — regla #2): manda `area_scores` (JSONB) si tiene contenido; si está vacío o
 * la fila es anterior a la migración, se reconstruye desde las columnas legacy
 * `areaN_score`. Así las filas históricas de aumenta se siguen viendo igual.
 */
export function readAreaScores(row) {
  const j = row?.toJSON ? row.toJSON() : row ?? {};
  const stored = j.areaScores;
  if (stored && typeof stored === "object" && !Array.isArray(stored) && Object.keys(stored).length > 0) {
    return { ...stored };
  }
  const out = {};
  for (const a of PERFORMANCE_AREAS) {
    if (j[`${a.key}Score`] != null) out[a.key] = j[`${a.key}Score`];
  }
  return out;
}

// Scorecard completo (página "Mi desempeño"). `history` = filas de meses previos
// del mismo terapeuta (para el gráfico). `teamAverage` = media del equipo.
// (Cambio 2026-07-29, desempeño por roles — regla #2: `role` opcional con el
// rol del evaluado; su default LEGACY_ROLE reproduce la salida histórica —
// mismas áreas, indicadores y umbrales 85/70 — y además se emiten `roleKey`,
// `roleName` y `areaScores` con la regla de lectura de arriba.)
export function serializePerformance(m, { therapist, history = [], teamAverage = null, tiers = null, extras = 0, role = null } = {}) {
  const j = m.toJSON ? m.toJSON() : m;
  const roleDef = role ?? LEGACY_ROLE;
  const scores = readAreaScores(j);
  const areas = roleDef.areas.map((a) => {
    const score = scores[a.key] ?? null;
    const level = scoreToSemaforo(score, roleDef.thresholds);
    return {
      key: a.key, n: a.n ?? null, name: a.name, weight: a.weight, icon: a.icon,
      goal: a.goal ?? "", score, level,
      indicators: (a.indicators ?? []).map((ind) => ({ ...ind, status: level })),
    };
  });
  // Si nos pasan los tramos, la propuesta se deriva EN VIVO de la puntuación
  // total (siempre coherente con la tabla actual); si no, se usa lo almacenado.
  // `extras` = Σ incentivos ESCRITOS del periodo: el total propuesto es la misma
  // cifra que en el ranking/approve (tramos + escritos).
  const proposed = tiers ? proposeIncentive(j.totalScore, tiers) : num(j.proposedIncentive);
  const extrasIncentive = Math.round((Number(extras) || 0) * 100) / 100;
  return {
    id: j.id,
    therapistId: j.therapistId,
    therapist: therapist ? serializeTherapist(therapist) : null,
    period: { month: j.periodMonth, year: j.periodYear, label: `${MONTH_FULL[j.periodMonth] ?? ""} ${j.periodYear}`.trim(), value: `${j.periodYear}-${String(j.periodMonth).padStart(2, "0")}` },
    roleKey: j.roleKey ?? roleDef.key,
    roleName: roleDef.name,
    areaScores: scores,
    totalScore: j.totalScore,
    totalLevel: scoreToSemaforo(j.totalScore, roleDef.thresholds),
    complements: { occupation: j.complementOccupation, seniority: j.complementSeniority, attendance: j.complementAttendance },
    complementsLabel: complementsLabel(j),
    areas,
    proposedIncentive: proposed,
    extrasIncentive,
    totalProposed: Math.round(((proposed ?? 0) + extrasIncentive) * 100) / 100,
    approvedIncentive: num(j.approvedIncentive),
    approved: j.approvedIncentive != null,
    notes: j.notes ?? null,
    history: history.map((h) => ({ month: MONTH_SHORT[(h.periodMonth ?? h.period_month)] ?? "?", value: h.totalScore ?? h.total_score })),
    teamAverage,
  };
}

// Fila de ranking (panel de Dirección). Incluye los datos crudos (áreas,
// complementos, notas) para poder PRECARGAR el editor de evaluación sin otra
// llamada. La propuesta se deriva en vivo si nos pasan los tramos. `extras` =
// Σ de los incentivos ESCRITOS del periodo (IncentiveItem); el total propuesto
// es tramos + extras.
// (Cambio 2026-07-29, desempeño por roles — regla #2: `role` opcional; con el
// default LEGACY_ROLE el mapa `areas` sale con las mismas claves area1..area8
// de siempre y el semáforo con 85/70. Se añaden roleKey/roleName/areaScores.)
export function serializeRankingRow(m, { therapist, tiers = null, extras = 0, role = null } = {}) {
  const j = m.toJSON ? m.toJSON() : m;
  const roleDef = role ?? LEGACY_ROLE;
  const scores = readAreaScores(j);
  const areas = {};
  for (const a of roleDef.areas) areas[a.key] = scores[a.key] ?? null;
  const proposed = tiers ? proposeIncentive(j.totalScore, tiers) : (num(j.proposedIncentive) ?? 0);
  const extrasIncentive = Math.round((Number(extras) || 0) * 100) / 100;
  return {
    id: j.id,
    therapistId: j.therapistId,
    therapist: therapist ? serializeTherapist(therapist) : null,
    roleKey: j.roleKey ?? roleDef.key,
    roleName: roleDef.name,
    areaScores: scores,
    totalScore: j.totalScore,
    totalLevel: scoreToSemaforo(j.totalScore, roleDef.thresholds),
    areas,
    complements: { occupation: j.complementOccupation, seniority: j.complementSeniority, attendance: j.complementAttendance },
    complementsLabel: complementsLabel(j),
    notes: j.notes ?? null,
    proposedIncentive: proposed ?? 0,
    extrasIncentive,
    totalProposed: Math.round(((proposed ?? 0) + extrasIncentive) * 100) / 100,
    approvedIncentive: num(j.approvedIncentive),
    approved: j.approvedIncentive != null,
    period: { month: j.periodMonth, year: j.periodYear },
  };
}
