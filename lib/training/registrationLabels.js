/**
 * Diccionarios de labels para los slugs del formulario de Registro previo
 * del curso "Liderazgo Educativo" (Retorika).
 *
 * Reutilizado en:
 *   - UI: renderizado legible del drawer detalle.
 *   - Export CSV: cabeceras y valores.
 *   - Tooltips / filtros futuros.
 *
 * Si el form de WP añade un nuevo slug, basta con añadirlo aquí; el
 * sistema cae a "slug crudo" mientras tanto (`labelOr(dict, slug)`).
 */

export const CENTER_TYPE = {
  privado: "Colegio privado",
  concertado: "Colegio concertado",
  publico: "Colegio público",
  instituto: "Instituto",
  universidad: "Universidad",
  formacion_profesional: "Formación profesional / FP",
  academia: "Academia / centro privado de refuerzo",
  ninguno: "Actualmente en ninguno",
  otro: "Otro",
};

export const POSITIONS = {
  docente_infantil: "Docente Infantil",
  docente_primaria: "Docente Primaria",
  docente_infantil_primaria: "Docente Infantil/Primaria",
  docente_secundaria: "Docente Secundaria",
  docente_bachillerato: "Docente Bachillerato",
  docente_fp: "Docente FP",
  orientador: "Orientador/a",
  pt: "PT (Pedagogía Terapéutica)",
  al: "AL (Audición y Lenguaje)",
  coordinador_etapa: "Coordinador/a de etapa",
  coordinador_tic: "Coordinador/a TIC",
  jefe_estudios: "Jefe/a de estudios",
  jefe_departamento: "Jefe/a de departamento",
  director: "Director/a",
  vicedirector: "Vicedirector/a",
  secretario: "Secretario/a",
  inspector: "Inspector/a",
  formador_externo: "Formador/a externo",
  otro: "Otro",
};

export const COURSES_TEACHING = {
  infantil_3_5: "Infantil (3-5 años)",
  primaria_1_3: "Primaria 1º-3º (6-8 años)",
  primaria_4_6: "Primaria 4º-6º (9-11 años)",
  eso_1_2: "ESO 1º-2º (12-13 años)",
  eso_3_4: "ESO 3º-4º (14-15 años)",
  bachillerato: "Bachillerato (16-17 años)",
  fp_basico: "FP Básico",
  fp_grado_medio: "FP Grado Medio",
  fp_grado_superior: "FP Grado Superior",
  universidad: "Universidad",
  adultos: "Adultos",
  ninguno: "Actualmente no doy clases",
  otro: "Otro",
};

export const SUBJECTS = {
  lengua: "Lengua y Literatura",
  matematicas: "Matemáticas",
  ciencias_naturales: "Ciencias Naturales / Biología y Geología",
  fisica_quimica: "Física y Química",
  ciencias_sociales: "Ciencias Sociales / Historia y Geografía",
  ingles: "Inglés",
  frances: "Francés",
  otra_lengua_extranjera: "Otra lengua extranjera",
  educacion_fisica: "Educación Física",
  musica: "Música",
  plastica: "Plástica / Educación Artística",
  tecnologia: "Tecnología",
  informatica: "Informática",
  religion: "Religión",
  valores: "Valores / Educación en valores",
  economia: "Economía",
  filosofia: "Filosofía",
  latin_griego: "Latín / Griego",
  educacion_emocional: "Educación emocional",
  tutoria: "Tutoría",
  generalista_infantil_primaria: "Generalista Infantil/Primaria",
  otra: "Otra",
};

export const TOPICS_OF_INTEREST = {
  liderazgo: "Liderazgo educativo",
  gestion_aula: "Gestión del aula",
  convivencia: "Convivencia escolar",
  acoso_escolar: "Acoso escolar / bullying",
  educacion_emocional: "Educación emocional",
  inteligencias_multiples: "Inteligencias múltiples",
  metodologias_activas: "Metodologías activas (ABP, gamificación)",
  tic_aula: "TIC en el aula",
  inteligencia_artificial: "Inteligencia artificial aplicada al aula",
  evaluacion: "Evaluación competencial",
  atencion_diversidad: "Atención a la diversidad / inclusión",
  altas_capacidades: "Altas capacidades",
  necesidades_educativas: "Necesidades educativas específicas",
  relacion_familias: "Relación con familias",
  burnout_docente: "Prevención del burnout docente",
  comunicacion: "Comunicación y oratoria",
  coaching_educativo: "Coaching educativo",
  innovacion: "Innovación educativa",
  neuroeducacion: "Neuroeducación",
  bilinguismo: "Bilingüismo / educación bilingüe",
  otro: "Otro",
};

// Diagnóstico (preguntas con respuesta libre o escala 1-5)
export const DIAGNOSIS_QUESTION_LABELS = {
  motivationCurrent: "Motivación actual con tu trabajo (1-5)",
  motivationVsStart: "Motivación actual vs. cuando empezaste (1-5)",
  centerEnvironment: "Cómo describirías el ambiente en tu centro (1-5)",
  stressLevel: "Nivel de estrés habitual (1-5)",
  hasResources: "¿Tienes los recursos necesarios para hacer bien tu trabajo? (sí/no/parcial)",
  socialRecognition: "Reconocimiento social que percibes hacia tu labor (1-5)",
  workloadFrequency: "Frecuencia con la que sientes sobrecarga (nunca/ocasional/frecuente/constante)",
  weeklyExtraHours: "Horas extra semanales fuera de horario (número)",
  mainDifficulties: "Principales dificultades que encuentras hoy (texto libre)",
  courseGoals: "Qué esperas conseguir con este curso (texto libre)",
};

// Centro y dirección — labels para CSV/UI
export const CENTER_FIELD_LABELS = {
  type: "Tipo de centro",
  name: "Nombre del centro",
  otherName: "Nombre (si 'Otro')",
  nif: "NIF",
  "address.street": "Dirección · Calle",
  "address.apartment": "Dirección · Piso / Puerta",
  "address.city": "Ciudad",
  "address.state": "Provincia",
  "address.postalCode": "Código postal",
  "address.country": "País",
};

export const TEACHER_FIELD_LABELS = {
  yearsOfExperience: "Años de experiencia docente",
  positions: "Cargos / roles",
  coursesTeaching: "Cursos en los que enseña",
  subjects: "Materias",
  topicsOfInterest: "Temas de interés",
};

/**
 * Devuelve el label legible para un slug. Si el slug no existe en el
 * diccionario, devuelve el propio slug (no aborta nada — el form de WP
 * puede añadir slugs nuevos antes de que actualicemos este fichero).
 */
export function labelOr(dict, slug) {
  if (slug == null) return "";
  return dict[slug] ?? String(slug);
}

/**
 * Renderiza un array de slugs como `"Label A, Label B"` para CSV/UI.
 * Resuelve cada slug contra el diccionario. Si el dict no lo conoce,
 * deja el slug crudo.
 */
export function joinSlugs(dict, slugs, sep = ", ") {
  if (!Array.isArray(slugs)) return "";
  return slugs.map((s) => labelOr(dict, s)).join(sep);
}

/**
 * Resuelve un slug nested tipo "address.city" desde un objeto JSONB.
 */
export function getNested(obj, path) {
  if (!obj || !path) return "";
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj) ?? "";
}
