/**
 * Datos dummy para la maqueta del módulo Clínica.
 *
 * Todo hardcoded. Cero queries a BD. Pensado para demostrar el aspecto final
 * del módulo en la reunión con el equipo de Aumenta.
 *
 * Nombres totalmente ficticios para evitar choques con personas reales.
 */

export const DIRECTION = [
  { id: "dir-1", name: "Dra. Beatriz Andrade", role: "Dirección clínica" },
  { id: "dir-2", name: "Dra. Mónica Salgado", role: "Coordinación terapéutica" },
];

export const THERAPISTS = [
  { id: "t-1", name: "Lorena Vázquez", initials: "LV", position: "Psicopedagoga", color: "#1B3A2D" },
  { id: "t-2", name: "Patricia Mendoza", initials: "PM", position: "Logopeda", color: "#3F6B53" },
  { id: "t-3", name: "Cristina Olmedo", initials: "CO", position: "Psicóloga infantil", color: "#7C4F8C" },
  { id: "t-4", name: "Inés Carballo", initials: "IC", position: "Neuropsicóloga", color: "#A35E2E" },
  { id: "t-5", name: "Daniela Espinosa", initials: "DE", position: "Pedagoga terapéutica", color: "#2A5F7A" },
  { id: "t-6", name: "Raquel Tudela", initials: "RT", position: "Psicomotricista", color: "#8B6F2E" },
];

// Casting de pacientes infantiles 5-13 años
export const PATIENTS = [
  {
    id: "p-1",
    name: "Diego Martín",
    age: 8,
    focus: "Atención sostenida y flexibilidad cognitiva",
    therapistId: "t-1",
    lastSession: "2026-06-05",
    sessionsCount: 12,
  },
  {
    id: "p-2",
    name: "Lucía Pérez",
    age: 11,
    focus: "Lectoescritura y comprensión lectora",
    therapistId: "t-2",
    lastSession: "2026-06-06",
    sessionsCount: 18,
  },
  {
    id: "p-3",
    name: "Hugo Sanz",
    age: 7,
    focus: "Velocidad de procesamiento y organización ejecutiva",
    therapistId: "t-1",
    lastSession: "2026-06-04",
    sessionsCount: 9,
  },
  {
    id: "p-4",
    name: "Valeria Núñez",
    age: 13,
    focus: "Autorregulación emocional y habilidades sociales",
    therapistId: "t-3",
    lastSession: "2026-06-06",
    sessionsCount: 22,
  },
  {
    id: "p-5",
    name: "Mateo Olivares",
    age: 6,
    focus: "Lenguaje expresivo y memoria de trabajo",
    therapistId: "t-2",
    lastSession: "2026-06-03",
    sessionsCount: 15,
  },
  {
    id: "p-6",
    name: "Carla Estévez",
    age: 10,
    focus: "TDAH y autoestima académica",
    therapistId: "t-4",
    lastSession: "2026-06-05",
    sessionsCount: 7,
  },
];

export const REPORTS = [
  {
    id: "r-1",
    patientId: "p-1",
    therapistId: "t-1",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-06-07",
    dueDate: "2026-06-12",
    status: "draft",
    statusLabel: "Borrador",
  },
  {
    id: "r-2",
    patientId: "p-2",
    therapistId: "t-2",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-06-02",
    dueDate: "2026-06-09",
    status: "reviewed",
    statusLabel: "Revisado",
  },
  {
    id: "r-3",
    patientId: "p-3",
    therapistId: "t-1",
    type: "admission",
    typeLabel: "Admisión",
    reportDate: "2026-05-28",
    dueDate: "2026-06-03",
    status: "delivered",
    statusLabel: "Entregado",
  },
  {
    id: "r-4",
    patientId: "p-4",
    therapistId: "t-3",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-06-06",
    dueDate: "2026-06-11",
    status: "draft",
    statusLabel: "Borrador",
  },
  {
    id: "r-5",
    patientId: "p-5",
    therapistId: "t-2",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-05-25",
    dueDate: "2026-05-30",
    status: "delivered",
    statusLabel: "Entregado",
  },
  {
    id: "r-6",
    patientId: "p-6",
    therapistId: "t-4",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-06-04",
    dueDate: "2026-06-10",
    status: "reviewed",
    statusLabel: "Revisado",
  },
  {
    id: "r-7",
    patientId: "p-1",
    therapistId: "t-1",
    type: "discharge",
    typeLabel: "Alta",
    reportDate: "2026-05-15",
    dueDate: "2026-05-20",
    status: "delivered",
    statusLabel: "Entregado",
  },
  {
    id: "r-8",
    patientId: "p-2",
    therapistId: "t-2",
    type: "evolution",
    typeLabel: "Evolutivo",
    reportDate: "2026-05-20",
    dueDate: "2026-05-25",
    status: "delivered",
    statusLabel: "Entregado",
  },
];

// Contenido textual largo de UN informe para el drawer de detalle
export const REPORT_CONTENT = {
  "r-1": {
    motiveOfIntervention:
      "Diego acude a consulta derivado por su orientador escolar debido a dificultades en atención sostenida, organización del trabajo escolar y baja velocidad de procesamiento. La familia refiere fatiga durante el estudio y necesidad de supervisión constante para completar tareas. Tras la valoración inicial se observa un perfil cognitivo dentro de la media con desfase específico en funciones ejecutivas, especialmente en planificación, memoria de trabajo y control inhibitorio.",
    objectives: [
      "Mejorar la atención sostenida en tareas de 15-20 minutos.",
      "Desarrollar flexibilidad cognitiva ante cambios de criterio.",
      "Reforzar la organización ejecutiva del material escolar.",
      "Aumentar la velocidad de procesamiento en lectura y cálculo.",
      "Trabajar la autorregulación emocional ante la frustración.",
      "Generalizar estrategias aprendidas al entorno escolar y familiar.",
    ],
    evolution: [
      "Durante el último trimestre Diego ha mostrado una mejora progresiva en su capacidad para mantener el foco atencional en actividades estructuradas. Inicialmente requería pausas cada 5 minutos; actualmente sostiene tareas de hasta 18 minutos sin necesidad de redireccionamiento por parte del terapeuta. En las pruebas de cancelación su rendimiento ha pasado del percentil 25 al percentil 50.",
      "La flexibilidad cognitiva ha sido una de las áreas con mayor avance: ante cambios de criterio en tareas tipo Wisconsin, Diego logra ajustar la respuesta en un promedio de 2 intentos, frente a los 5-6 que requería en marzo. La familia confirma esta mejora en la vida cotidiana, especialmente al gestionar imprevistos en la rutina diaria.",
    ],
    achievements: [
      "Completa de manera autónoma su agenda escolar tres días por semana.",
      "Lectura silenciosa sostenida durante 12 minutos en aula.",
      "Reducción del 40% en errores por impulsividad en tareas de cálculo.",
      "Verbaliza estrategias propias para autorregularse ante la frustración.",
      "Inicia y termina los deberes con un único recordatorio familiar.",
    ],
    persistentDifficulties: [
      "Dificultad para mantener orden en su mochila y material de trabajo.",
      "Resistencia inicial ante tareas que percibe como difíciles.",
      "Tendencia a precipitarse en exámenes con presión temporal.",
    ],
    recommendations: [
      "Continuar reforzando rutinas de organización en casa con apoyo visual (checklist).",
      "Coordinación con el centro escolar para aplicar adaptaciones metodológicas (tiempo extra en pruebas, fragmentación de tareas).",
      "Limitar pantallas en horario de estudio para favorecer la consolidación atencional.",
      "Mantener actividad física diaria (mín. 45 min) como apoyo al rendimiento ejecutivo.",
    ],
    continuityProposal:
      "Se propone continuar la intervención con frecuencia semanal hasta la evaluación de junio. Tras dicha evaluación se valorará reducir la frecuencia a quincenal si los avances se mantienen y consolidan en el entorno natural.",
  },
};

// 7 áreas del sistema de desempeño (la 5 se salta intencionadamente)
export const PERFORMANCE_AREAS = [
  {
    key: "area1",
    n: 1,
    name: "Avances terapéuticos",
    weight: 25,
    icon: "trending-up",
    indicators: [
      { label: "Objetivos alcanzados por paciente", status: "green", value: "94%" },
      { label: "Reducción de síntomas medibles", status: "green", value: "82%" },
      { label: "Satisfacción de la familia", status: "green", value: "4.7/5" },
    ],
  },
  {
    key: "area2",
    n: 2,
    name: "Puntualidad y organización",
    weight: 10,
    icon: "clock",
    indicators: [
      { label: "Registros funcionales realizados", status: "green", value: "100%" },
    ],
  },
  {
    key: "area3",
    n: 3,
    name: "Manejo de casos complejos",
    weight: 15,
    icon: "stack",
    indicators: [
      { label: "Casos complejos asumidos", status: "green", value: "3" },
      { label: "Continuidad en seguimiento", status: "green", value: "100%" },
      { label: "Coordinación interdisciplinar", status: "amber", value: "Mejorable" },
    ],
  },
  {
    key: "area4",
    n: 4,
    name: "Participación en equipo",
    weight: 10,
    icon: "users",
    indicators: [
      { label: "Asistencia a reuniones clínicas", status: "green", value: "12/12" },
      { label: "Aporte de casos a sesión", status: "green", value: "4 casos" },
      { label: "Compartir buenas prácticas", status: "green", value: "Activa" },
    ],
  },
  {
    key: "area6",
    n: 6,
    name: "Comunicación y trabajo en equipo",
    weight: 15,
    icon: "chat",
    indicators: [
      { label: "Calidad de las coordinaciones", status: "green", value: "Alta" },
      { label: "Comunicación con familias", status: "amber", value: "7/10" },
    ],
  },
  {
    key: "area7",
    n: 7,
    name: "Fidelización de pacientes",
    weight: 15,
    icon: "heart",
    indicators: [
      { label: "Continuidad de tratamientos (>3 meses)", status: "green", value: "88%" },
      { label: "Tasa de abandono", status: "green", value: "6%" },
    ],
  },
  {
    key: "area8",
    n: 8,
    name: "Derivaciones y recomendaciones",
    weight: 10,
    icon: "share",
    indicators: [
      { label: "Pacientes captados por recomendación", status: "green", value: "4" },
    ],
  },
];

// Puntuaciones del terapeuta logueado (Lorena Vázquez) para "Mi desempeño"
export const MY_PERFORMANCE = {
  therapistId: "t-1",
  periodMonth: 5,
  periodYear: 2026,
  totalScore: 87,
  areas: {
    area1: 92,
    area2: 100,
    area3: 78,
    area4: 95,
    area6: 72,
    area7: 88,
    area8: 80,
  },
  complements: {
    occupation: 96,
    seniority: 3,
    attendance: true,
  },
  // Histórico últimos 6 meses
  history: [
    { month: "Dic", value: 79 },
    { month: "Ene", value: 81 },
    { month: "Feb", value: 83 },
    { month: "Mar", value: 84 },
    { month: "Abr", value: 86 },
    { month: "May", value: 87 },
  ],
};

// Ranking equipo para el panel de Dirección
export const TEAM_RANKING = [
  {
    therapistId: "t-1",
    totalScore: 92,
    areas: { area1: 95, area2: 100, area3: 88, area4: 95, area6: 90, area7: 92, area8: 85 },
    complements: "Todos",
    proposedIncentive: 480,
  },
  {
    therapistId: "t-2",
    totalScore: 89,
    areas: { area1: 92, area2: 100, area3: 90, area4: 75, area6: 88, area7: 92, area8: 85 },
    complements: "Ocupación, Antigüedad",
    proposedIncentive: 420,
  },
  {
    therapistId: "t-3",
    totalScore: 86,
    areas: { area1: 90, area2: 72, area3: 88, area4: 90, area6: 86, area7: 90, area8: 84 },
    complements: "Todos",
    proposedIncentive: 380,
  },
  {
    therapistId: "t-4",
    totalScore: 82,
    areas: { area1: 75, area2: 95, area3: 88, area4: 90, area6: 70, area7: 85, area8: 80 },
    complements: "Antigüedad, Asistencia",
    proposedIncentive: 320,
  },
  {
    therapistId: "t-5",
    totalScore: 78,
    areas: { area1: 85, area2: 70, area3: 72, area4: 85, area6: 82, area7: 80, area8: 70 },
    complements: "Asistencia",
    proposedIncentive: 280,
  },
  {
    therapistId: "t-6",
    totalScore: 74,
    areas: { area1: 78, area2: 85, area3: 70, area4: 82, area6: 68, area7: 78, area8: 65 },
    complements: "Asistencia",
    proposedIncentive: 240,
  },
];

export const TEAM_ALERTS = [
  {
    id: "a-1",
    severity: "high",
    therapistId: "t-4",
    text: "2 informes con entrega vencida hace más de 7 días.",
  },
  {
    id: "a-2",
    severity: "medium",
    therapistId: "t-5",
    text: "Descenso de puntuación de 12 puntos respecto a abril.",
  },
  {
    id: "a-3",
    severity: "medium",
    therapistId: "t-6",
    text: "Ausencia de registros funcionales en 3 sesiones del 15-22 de mayo.",
  },
  {
    id: "a-4",
    severity: "low",
    therapistId: "t-3",
    text: "Comunicación con familias por debajo del estándar del equipo.",
  },
];

export const TEAM_HISTORY = [
  { month: "Dic", value: 78 },
  { month: "Ene", value: 80 },
  { month: "Feb", value: 81 },
  { month: "Mar", value: 82 },
  { month: "Abr", value: 83 },
  { month: "May", value: 84 },
];

export function scoreToSemaforo(score) {
  if (score == null) return "gray";
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "red";
}

export function semaforoClasses(level) {
  switch (level) {
    case "green":
      return { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-200" };
    case "amber":
      return { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-200" };
    case "red":
      return { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", ring: "ring-red-200" };
    default:
      return { bg: "bg-neutral-50", text: "text-neutral-500", dot: "bg-neutral-300", ring: "ring-neutral-200" };
  }
}

export function findTherapist(id) {
  return THERAPISTS.find((t) => t.id === id) ?? { name: "—", initials: "?", position: "—" };
}

export function findPatient(id) {
  return PATIENTS.find((p) => p.id === id) ?? { name: "—", age: 0, focus: "—" };
}
