/**
 * lib/clinica/performancePresets.js — presets de roles de desempeño.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint de configuración
 * — GET config los devuelve para las tarjetas de "Añadir rol" — y el modo
 * simulado del endpoint de IA de la demo.)
 *
 * Puntos de partida listos para usar: cada preset trae áreas con peso (SIEMPRE
 * sumando 100), meta redactada e icono de ALLOWED_ICONS. El preset `terapeuta`
 * reutiliza LEGACY_ROLE para que coincida exactamente con las áreas históricas.
 */

import { LEGACY_ROLE, DEFAULT_THRESHOLDS } from "./performanceConfig.js";

export const PERFORMANCE_PRESETS = [
  {
    key: "terapeuta",
    name: "Equipo terapéutico",
    suggestedPositions: ["Terapeuta", "Psicóloga", "Psicólogo"],
    thresholds: { ...LEGACY_ROLE.thresholds },
    areas: LEGACY_ROLE.areas.map((a) => ({
      key: a.key,
      name: a.name,
      weight: a.weight,
      icon: a.icon,
      goal: a.goal,
      description: a.description ?? "",
    })),
  },
  {
    key: "administracion",
    name: "Administración",
    suggestedPositions: ["Administración", "Administrativa", "Administrativo"],
    thresholds: { ...DEFAULT_THRESHOLDS },
    areas: [
      { key: "gestion_documental", name: "Gestión documental y de procesos", weight: 20, icon: "book", goal: "Documentación al día y sin errores en expedientes y archivos", description: "" },
      { key: "atencion_interna", name: "Atención interna", weight: 15, icon: "users", goal: "Respuesta ágil y resolutiva a las peticiones del equipo", description: "" },
      { key: "puntualidad_fiabilidad", name: "Puntualidad y fiabilidad", weight: 15, icon: "clock", goal: "Plazos y compromisos cumplidos sin necesidad de recordatorios", description: "" },
      { key: "cobros_facturacion", name: "Cobros y facturación", weight: 20, icon: "euro", goal: "Facturación emitida a tiempo y cobros pendientes bajo control", description: "" },
      { key: "mejora_procedimientos", name: "Mejora de procedimientos", weight: 15, icon: "target", goal: "Al menos una propuesta de mejora aplicada por trimestre", description: "" },
      { key: "comunicacion_interna", name: "Comunicación interna", weight: 15, icon: "chat", goal: "Información transmitida a tiempo y a las personas adecuadas", description: "" },
    ],
  },
  {
    key: "comercial",
    name: "Comercial / Ventas",
    suggestedPositions: ["Comercial", "Ventas"],
    thresholds: { ...DEFAULT_THRESHOLDS },
    areas: [
      { key: "objetivos_venta", name: "Consecución de objetivos de venta", weight: 25, icon: "target", goal: "≥100% del objetivo de ventas del mes", description: "" },
      { key: "generacion_oportunidades", name: "Generación de oportunidades", weight: 15, icon: "trending-up", goal: "Nuevas oportunidades cualificadas cada semana", description: "" },
      { key: "conversion_leads", name: "Conversión de leads", weight: 20, icon: "chart", goal: "Tasa de conversión por encima de la media del equipo", description: "" },
      { key: "fidelizacion_clientes", name: "Fidelización de clientes", weight: 15, icon: "heart", goal: "Cartera activa con seguimiento y renovaciones al día", description: "" },
      { key: "registro_crm", name: "Calidad del registro en CRM", weight: 10, icon: "book", goal: "Todos los contactos y avances registrados el mismo día", description: "" },
      { key: "colaboracion_equipo", name: "Colaboración con el equipo", weight: 15, icon: "users", goal: "Traspasos de información completos y apoyo activo a compañeros", description: "" },
    ],
  },
  {
    key: "recepcion",
    name: "Recepción",
    suggestedPositions: ["Recepción", "Recepcionista"],
    thresholds: { ...DEFAULT_THRESHOLDS },
    areas: [
      { key: "atencion_trato", name: "Atención y trato", weight: 25, icon: "heart", goal: "Trato excelente presencial y telefónico, sin quejas de atención", description: "" },
      { key: "gestion_agenda", name: "Gestión de agenda y citas", weight: 20, icon: "calendar", goal: "Agenda sin solapes y citas confirmadas con antelación", description: "" },
      { key: "resolucion_incidencias", name: "Resolución de incidencias", weight: 15, icon: "shield", goal: "Incidencias resueltas o derivadas en el día", description: "" },
      { key: "cobros_caja", name: "Cobros y caja", weight: 15, icon: "euro", goal: "Caja cuadrada a diario y cobros registrados sin errores", description: "" },
      { key: "orden", name: "Orden", weight: 10, icon: "stack", goal: "Recepción y zonas comunes ordenadas y presentables", description: "" },
      { key: "comunicacion_equipo", name: "Comunicación con el equipo", weight: 15, icon: "chat", goal: "Avisos y mensajes trasladados a tiempo a cada profesional", description: "" },
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    suggestedPositions: ["Marketing"],
    thresholds: { ...DEFAULT_THRESHOLDS },
    areas: [
      { key: "plan_contenidos", name: "Plan de contenidos", weight: 20, icon: "book", goal: "Calendario de contenidos planificado y publicado sin huecos", description: "" },
      { key: "captacion", name: "Captación", weight: 25, icon: "trending-up", goal: "Crecimiento sostenido de contactos y solicitudes entrantes", description: "" },
      { key: "rendimiento_campanas", name: "Rendimiento de campañas", weight: 20, icon: "chart", goal: "Campañas dentro del coste por captación objetivo", description: "" },
      { key: "creatividad_calidad", name: "Creatividad y calidad", weight: 15, icon: "star", goal: "Piezas alineadas con la marca y sin errores publicados", description: "" },
      { key: "analisis_reporting", name: "Análisis y reporting", weight: 20, icon: "target", goal: "Informe mensual de resultados con conclusiones accionables", description: "" },
    ],
  },
  {
    key: "gerencia",
    name: "Gerencia",
    suggestedPositions: ["Gerencia", "Gerente", "Coordinación"],
    thresholds: { ...DEFAULT_THRESHOLDS },
    areas: [
      { key: "objetivos_area", name: "Cumplimiento de objetivos del área", weight: 25, icon: "target", goal: "Objetivos trimestrales del área cumplidos", description: "" },
      { key: "liderazgo_equipo", name: "Liderazgo y gestión del equipo", weight: 25, icon: "users", goal: "Equipo estable, evaluado y con seguimiento individual mensual", description: "" },
      { key: "mejora_continua", name: "Mejora continua", weight: 15, icon: "trending-up", goal: "Mejoras de proceso implantadas y medidas cada trimestre", description: "" },
      { key: "control_presupuestario", name: "Control presupuestario", weight: 20, icon: "euro", goal: "Desviación presupuestaria dentro del margen acordado", description: "" },
      { key: "comunicacion_transversal", name: "Comunicación transversal", weight: 15, icon: "chat", goal: "Coordinación fluida entre áreas y con dirección", description: "" },
    ],
  },
];
