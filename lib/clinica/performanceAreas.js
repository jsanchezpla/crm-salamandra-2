/**
 * Definición de las 7 áreas de desempeño clínico (config, no datos por-terapeuta).
 * El nº 5 se omite a propósito (el documento original de Aumenta saltó la
 * numeración). Los `indicators` son sub-métricas ilustrativas por área; su color
 * (status) lo calcula el serializer a partir de la puntuación real del área.
 *
 * La puntuación por-terapeuta vive en performance_metrics (area1_score…area8_score,
 * complementos, total_score, incentivo). Esta config solo aporta nombre/peso/icono
 * y las etiquetas de los indicadores.
 */
export const PERFORMANCE_AREAS = [
  {
    key: "area1", n: 1, name: "Avances terapéuticos", weight: 25, icon: "trending-up",
    indicators: [
      { label: "Objetivos alcanzados por paciente", value: "94%" },
      { label: "Reducción de síntomas medibles", value: "82%" },
      { label: "Satisfacción de la familia", value: "4.7/5" },
    ],
  },
  {
    key: "area2", n: 2, name: "Puntualidad y organización", weight: 10, icon: "clock",
    indicators: [{ label: "Registros funcionales realizados", value: "100%" }],
  },
  {
    key: "area3", n: 3, name: "Manejo de casos complejos", weight: 15, icon: "stack",
    indicators: [
      { label: "Casos complejos asumidos", value: "3" },
      { label: "Continuidad en seguimiento", value: "100%" },
      { label: "Coordinación interdisciplinar", value: "Adecuada" },
    ],
  },
  {
    key: "area4", n: 4, name: "Participación en equipo", weight: 10, icon: "users",
    indicators: [
      { label: "Asistencia a reuniones clínicas", value: "12/12" },
      { label: "Aporte de casos a sesión", value: "4 casos" },
      { label: "Compartir buenas prácticas", value: "Activa" },
    ],
  },
  {
    key: "area6", n: 6, name: "Comunicación y trabajo en equipo", weight: 15, icon: "chat",
    indicators: [
      { label: "Calidad de las coordinaciones", value: "Alta" },
      { label: "Comunicación con familias", value: "7/10" },
    ],
  },
  {
    key: "area7", n: 7, name: "Fidelización de pacientes", weight: 15, icon: "heart",
    indicators: [
      { label: "Continuidad de tratamientos (>3 meses)", value: "88%" },
      { label: "Tasa de abandono", value: "6%" },
    ],
  },
  {
    key: "area8", n: 8, name: "Derivaciones y recomendaciones", weight: 10, icon: "share",
    indicators: [{ label: "Pacientes captados por recomendación", value: "4" }],
  },
];

// Claves de área en orden (area1..area8 sin area5). El atributo del modelo es
// `${key}Score` (p.ej. area1 → area1Score → columna area1_score).
export const AREA_KEYS = PERFORMANCE_AREAS.map((a) => a.key);

// Umbrales del semáforo (compartidos backend + frontend).
// (Cambio 2026-07-29, desempeño por roles — regla #2: ahora cada rol puede
// definir sus propios umbrales en settings.clinica.performanceRoles. El
// parámetro es OPCIONAL y su default reproduce los 85/70 históricos, así que
// todos los call-sites existentes se comportan exactamente igual.)
export function scoreToSemaforo(score, thresholds) {
  const green = Number.isFinite(Number(thresholds?.green)) ? Number(thresholds.green) : 85;
  const amber = Number.isFinite(Number(thresholds?.amber)) ? Number(thresholds.amber) : 70;
  if (score == null) return "gray";
  if (score >= green) return "green";
  if (score >= amber) return "amber";
  return "red";
}
