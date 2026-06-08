/**
 * Datos dummy del módulo Pacientes para la maqueta de Aumenta.
 *
 * Cero queries a BD. Todo hardcoded.
 *
 * Decisión de scope:
 *   - 6 pacientes en el listado (poblado pero acotado).
 *   - Solo Diego Martín (id "p-1") tiene 4 sesiones completas y datos
 *     extensos. Los otros 5 son placeholders: su ficha existe y se navega,
 *     pero los tabs muestran empty states.
 *   - Nombres de terapeutas COHERENTES con el sprint Clínica
 *     (Lorena Vázquez, Patricia Mendoza, etc.).
 */

import { THERAPISTS } from "../../clinica/_components/dummyData.js";

export { THERAPISTS };

export const PATIENTS = [
  {
    id: "p-1",
    firstName: "Diego",
    lastName: "Martín",
    age: 8,
    birthDate: "2017-09-12",
    educationCenter: "CEIP Las Acacias",
    educationLevel: "3º Primaria",
    referralReason:
      "Diego acude derivado por su orientador escolar debido a dificultades en atención sostenida, organización del trabajo escolar y baja velocidad de procesamiento. La familia refiere fatiga durante el estudio y necesidad de supervisión constante para completar tareas.",
    referredBy: "Orientador escolar (CEIP Las Acacias)",
    mainTherapistId: "t-1", // Lorena Vázquez
    enrollmentDate: "2025-10-14",
    attendanceFrequency: "Semanal",
    status: "active",
    statusLabel: "Activo",
    lastSession: "2026-06-05",
    sessionsCount: 12,
    objectives: [
      "Atención sostenida",
      "Flexibilidad cognitiva",
      "Organización ejecutiva",
      "Velocidad de procesamiento",
      "Autorregulación emocional",
      "Habilidades sociales",
    ],
    initials: "DM",
    color: "#1B3A2D",
  },
  {
    id: "p-2",
    firstName: "Lucía",
    lastName: "Pérez",
    age: 11,
    birthDate: "2014-03-22",
    educationCenter: "Colegio Santa María",
    educationLevel: "6º Primaria",
    referralReason: "Lectoescritura y comprensión lectora.",
    referredBy: "Familia",
    mainTherapistId: "t-2", // Patricia Mendoza
    enrollmentDate: "2025-11-03",
    attendanceFrequency: "Semanal",
    status: "active",
    statusLabel: "Activo",
    lastSession: "2026-06-06",
    sessionsCount: 18,
    objectives: ["Lectoescritura", "Comprensión lectora"],
    initials: "LP",
    color: "#3F6B53",
  },
  {
    id: "p-3",
    firstName: "Hugo",
    lastName: "Sanz",
    age: 7,
    birthDate: "2018-12-04",
    educationCenter: "CEIP Miguel Hernández",
    educationLevel: "2º Primaria",
    referralReason: "Velocidad de procesamiento y organización ejecutiva.",
    referredBy: "Pediatra",
    mainTherapistId: "t-5", // Daniela Espinosa
    enrollmentDate: "2026-01-19",
    attendanceFrequency: "Semanal",
    status: "active",
    statusLabel: "Activo",
    lastSession: "2026-06-04",
    sessionsCount: 9,
    objectives: ["Velocidad procesamiento", "Organización ejecutiva"],
    initials: "HS",
    color: "#7C4F8C",
  },
  {
    id: "p-4",
    firstName: "Valeria",
    lastName: "Núñez",
    age: 13,
    birthDate: "2012-07-30",
    educationCenter: "IES Cervantes",
    educationLevel: "1º ESO",
    referralReason: "Autorregulación emocional y habilidades sociales.",
    referredBy: "Tutor IES",
    mainTherapistId: "t-3", // Cristina Olmedo
    enrollmentDate: "2025-09-22",
    attendanceFrequency: "Quincenal",
    status: "active",
    statusLabel: "Activo",
    lastSession: "2026-06-06",
    sessionsCount: 22,
    objectives: ["Autorregulación emocional", "Habilidades sociales"],
    initials: "VN",
    color: "#A35E2E",
  },
  {
    id: "p-5",
    firstName: "Mateo",
    lastName: "Olivares",
    age: 6,
    birthDate: "2019-11-08",
    educationCenter: "CEIP San Pedro",
    educationLevel: "1º Primaria",
    referralReason: "Lenguaje expresivo y memoria de trabajo.",
    referredBy: "Familia",
    mainTherapistId: "t-2", // Patricia Mendoza
    enrollmentDate: "2025-12-10",
    attendanceFrequency: "Semanal",
    status: "paused",
    statusLabel: "En pausa",
    lastSession: "2026-05-15",
    sessionsCount: 15,
    objectives: ["Lenguaje expresivo", "Memoria de trabajo"],
    initials: "MO",
    color: "#2A5F7A",
  },
  {
    id: "p-6",
    firstName: "Carla",
    lastName: "Estévez",
    age: 10,
    birthDate: "2015-05-17",
    educationCenter: "Colegio Trilema",
    educationLevel: "5º Primaria",
    referralReason: "TDAH y autoestima académica.",
    referredBy: "Neuropediatra",
    mainTherapistId: "t-4", // Inés Carballo
    enrollmentDate: "2026-02-02",
    attendanceFrequency: "Semanal",
    status: "active",
    statusLabel: "Activo",
    lastSession: "2026-06-05",
    sessionsCount: 7,
    objectives: ["TDAH", "Autoestima académica"],
    initials: "CE",
    color: "#8B6F2E",
  },
];

// 4 sesiones para Diego Martín (id="p-1"). Ordenadas por fecha desc.
export const DIEGO_SESSIONS = [
  {
    id: "s-1",
    patientId: "p-1",
    therapistId: "t-1",
    sessionDate: "2026-06-05T17:00:00",
    duration: 50,
    status: "registered",
    statusLabel: "Registrada",
    preview:
      "Trabajadas atención sostenida y flexibilidad cognitiva con memory progresivo. Mejora notable.",
    objectives: ["Atención sostenida", "Flexibilidad cognitiva", "Velocidad de procesamiento"],
    activities:
      "Memory con piezas progresivas (15 minutos). Ejercicios de toma de decisiones con escenarios escolares. Laberintos y orientación en mapas para trabajar flexibilidad cognitiva.",
    performance:
      "Diego ha mostrado mayor concentración respecto a sesiones anteriores. Ha completado las actividades de memory con menor número de distracciones. Ha verbalizado estrategias propias para evitar la precipitación.",
    observations: {
      familyComments: "La madre refiere mejora notable en la realización de los deberes.",
      nextSessionNotes:
        "Continuar con ejercicios de flexibilidad cognitiva. Introducir actividades de planificación.",
      homeworkTasks: "Realizar ejercicios de atención durante 5 minutos antes del estudio.",
      incidents: "Ninguna.",
    },
    audioDurationSec: 47,
    aiReviewedAt: "2026-06-05T17:55:00",
  },
  {
    id: "s-2",
    patientId: "p-1",
    therapistId: "t-1",
    sessionDate: "2026-05-29T17:00:00",
    duration: 50,
    status: "registered",
    statusLabel: "Registrada",
    preview:
      "Sesión centrada en organización ejecutiva y autorregulación. Mejora la planificación de tareas escolares.",
    objectives: ["Organización ejecutiva", "Autorregulación emocional"],
    activities:
      "Uso de agenda visual con códigos de color. Ejercicios de respiración guiada. Role-play con escenarios de frustración escolar.",
    performance:
      "Diego ha sido capaz de elaborar un plan semanal de estudio de manera autónoma con apoyos visuales. Ante la frustración, ha aplicado la técnica de respiración aprendida en sesiones previas.",
    observations: {
      familyComments: "El padre refiere que ha empezado a usar la agenda en casa.",
      nextSessionNotes: "Reforzar la generalización de la agenda a actividades extraescolares.",
      homeworkTasks: "Anotar 3 tareas diarias en la agenda durante una semana.",
      incidents: "Ninguna.",
    },
    audioDurationSec: 52,
    aiReviewedAt: "2026-05-29T18:00:00",
  },
  {
    id: "s-3",
    patientId: "p-1",
    therapistId: "t-1",
    sessionDate: "2026-05-22T17:00:00",
    duration: 50,
    status: "draft",
    statusLabel: "Borrador",
    preview:
      "Trabajada memoria de trabajo y velocidad de procesamiento. Pendiente revisión final.",
    objectives: ["Memoria de trabajo", "Velocidad de procesamiento"],
    activities:
      "Series de dígitos directa e inversa. Tareas de cancelación con presión temporal. Lectura cronometrada de párrafos cortos.",
    performance:
      "Diego ha mantenido 6 dígitos en orden inverso, mejorando respecto a la sesión anterior (4). En cancelación ha pasado del p25 al p35 en velocidad sin perder precisión.",
    observations: {
      familyComments: "Sin comentarios destacables esta semana.",
      nextSessionNotes: "Volver a trabajar atención sostenida; introducir flexibilidad cognitiva.",
      homeworkTasks: "Juego online de memoria 10 min al día durante 3 días.",
      incidents: "Ninguna.",
    },
    audioDurationSec: 44,
    aiReviewedAt: null,
  },
  {
    id: "s-4",
    patientId: "p-1",
    therapistId: "t-1",
    sessionDate: "2026-05-15T17:00:00",
    duration: 50,
    status: "registered",
    statusLabel: "Registrada",
    preview:
      "Primera sesión de mayo: revisión de objetivos y trabajo de atención sostenida.",
    objectives: ["Atención sostenida"],
    activities:
      "Revisión conjunta de los objetivos del trimestre. Tareas de atención sostenida con cancelación de símbolos (15 min). Juego cooperativo final.",
    performance:
      "Diego ha verbalizado con claridad sus propios objetivos. En cancelación ha rendido en p30, en línea con sesiones previas, sin signos de fatiga atencional.",
    observations: {
      familyComments:
        "La madre comenta que esta semana ha completado los deberes solo en 3 de los 4 días.",
      nextSessionNotes: "Trabajar memoria de trabajo y velocidad de procesamiento.",
      homeworkTasks: "Continuar con lectura diaria de 10 minutos antes de dormir.",
      incidents: "Ninguna.",
    },
    audioDurationSec: 39,
    aiReviewedAt: "2026-05-15T17:58:00",
  },
];

// 3 informes evolutivos dummy de Diego
export const DIEGO_REPORTS = [
  {
    id: "r-diego-1",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-06-07",
    dueDate: "2026-06-12",
    status: "draft",
    statusLabel: "Borrador",
  },
  {
    id: "r-diego-2",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-04-30",
    dueDate: "2026-05-05",
    status: "delivered",
    statusLabel: "Entregado",
  },
  {
    id: "r-diego-3",
    type: "admission",
    typeLabel: "Admisión",
    reportDate: "2025-10-20",
    dueDate: "2025-10-25",
    status: "delivered",
    statusLabel: "Entregado",
  },
];

// 2 coordinaciones dummy de Diego
export const DIEGO_COORDINATIONS = [
  {
    id: "c-diego-1",
    type: "school",
    typeLabel: "Colegio",
    date: "2026-05-12",
    participants: "Tutora 3º Primaria, orientador, madre, Lorena Vázquez",
    topics: "Adaptación metodológica en aula, deberes graduados, refuerzo positivo.",
    createdById: "t-1",
  },
  {
    id: "c-diego-2",
    type: "family",
    typeLabel: "Familia",
    date: "2026-03-15",
    participants: "Ambos padres, Lorena Vázquez",
    topics:
      "Pautas de organización en casa. Rutinas de estudio. Manejo de la frustración con la lectura.",
    createdById: "t-1",
  },
];

// Próximas citas dummy (para el tab Resumen)
export const DIEGO_UPCOMING = [
  { date: "2026-06-12", time: "17:00", therapistId: "t-1", type: "Sesión semanal" },
  { date: "2026-06-19", time: "17:00", therapistId: "t-1", type: "Sesión semanal" },
  { date: "2026-06-26", time: "17:00", therapistId: "t-1", type: "Revisión trimestral" },
];

// Documentos adjuntos dummy
export const DIEGO_DOCS = [
  { name: "Informe neuropsicológico_oct2025.pdf", date: "2025-10-08", size: "1.4 MB" },
  { name: "Autorización_familia.pdf", date: "2025-10-14", size: "210 KB" },
  { name: "Boletín escolar_2T.pdf", date: "2026-03-28", size: "680 KB" },
];

export function findPatient(id) {
  return PATIENTS.find((p) => p.id === id) ?? null;
}

export function findTherapist(id) {
  return THERAPISTS.find((t) => t.id === id) ?? { name: "—", initials: "?", position: "—", color: "#666" };
}

export function statusStyles(status) {
  switch (status) {
    case "active":
      return { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" };
    case "paused":
      return { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" };
    case "discharged":
      return { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" };
    default:
      return { bg: "bg-neutral-50", text: "text-neutral-500", dot: "bg-neutral-300" };
  }
}

export function sessionStatusStyles(status) {
  switch (status) {
    case "registered":
      return { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" };
    case "draft":
      return { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" };
    case "ai_pending":
      return { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" };
    default:
      return { bg: "bg-neutral-50", text: "text-neutral-500", dot: "bg-neutral-300" };
  }
}
