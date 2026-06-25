/**
 * seed-cuestionarios-retorika.js
 *
 * Siembra intentos de cuestionario FICTICIOS en crm_retorika (LOCAL)
 * para poder validar visualmente el dashboard del sprint Bloque 3.
 *
 * NO usar en producción. Los IDs están en un rango alto (50000+) para
 * no colisionar con datos reales de Retorika (que viven solo en prod).
 *
 * Idempotente: re-ejecutar NO duplica filas (findOrCreate por wpAttemptId
 * determinista). Si quieres limpiar, ejecuta antes:
 *   DELETE FROM crm_retorika.quiz_attempts WHERE wp_attempt_id >= 50000;
 *
 * Uso: node --env-file=.env.local scripts/seed-cuestionarios-retorika.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const TENANT_SLUG = "retorika";

// Rango "alto" para no colisionar con datos reales (ni en local ni en prod
// si por accidente se ejecutara — aunque no se debe).
const BASE_ATTEMPT_ID = 50000;
const BASE_QUIZ_ID = 5400;
const BASE_COURSE_ID = 5380;
const BASE_USER_ID = 5500;

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ── Datos de referencia ─────────────────────────────────────────────────────

const COURSES = [
  { wpCourseId: BASE_COURSE_ID + 0, title: "Comunicación y Liderazgo Educativo" },
  { wpCourseId: BASE_COURSE_ID + 1, title: "Metodologías Activas en el Aula" },
  { wpCourseId: BASE_COURSE_ID + 2, title: "Gestión Emocional en el Aula" },
  { wpCourseId: BASE_COURSE_ID + 3, title: "Tecnología Educativa Aplicada" },
];

// 10 quizzes distribuidos: 3 + 3 + 2 + 2
const QUIZZES = [
  { wpQuizId: BASE_QUIZ_ID + 0,  courseIdx: 0, title: "Test Módulo 1 — Fundamentos de comunicación" },
  { wpQuizId: BASE_QUIZ_ID + 1,  courseIdx: 0, title: "Test Módulo 2 — Liderazgo en el aula" },
  { wpQuizId: BASE_QUIZ_ID + 2,  courseIdx: 0, title: "Test Módulo 3 — Escucha activa y feedback" },
  { wpQuizId: BASE_QUIZ_ID + 3,  courseIdx: 1, title: "Test Módulo 1 — ABP y aprendizaje cooperativo" },
  { wpQuizId: BASE_QUIZ_ID + 4,  courseIdx: 1, title: "Test Módulo 2 — Gamificación y flipped" },
  { wpQuizId: BASE_QUIZ_ID + 5,  courseIdx: 1, title: "Test Módulo 3 — Evaluación competencial" },
  { wpQuizId: BASE_QUIZ_ID + 6,  courseIdx: 2, title: "Test Módulo 1 — Emociones en el aula" },
  { wpQuizId: BASE_QUIZ_ID + 7,  courseIdx: 2, title: "Test Módulo 2 — Gestión de conflictos" },
  { wpQuizId: BASE_QUIZ_ID + 8,  courseIdx: 3, title: "Test Módulo 1 — Herramientas digitales" },
  { wpQuizId: BASE_QUIZ_ID + 9,  courseIdx: 3, title: "Test Módulo 2 — IA en el aula" },
];

// 25 alumnos distribuidos en 5 empresas (centros educativos).
const STUDENTS = [
  { name: "Marta García López",      empresa: "Trinity College Boadilla" },
  { name: "Javier Romero Pérez",     empresa: "Trinity College Boadilla" },
  { name: "Lucía Hernández Ruiz",    empresa: "Trinity College Boadilla" },
  { name: "Pablo Fernández Vidal",   empresa: "Trinity College Boadilla" },
  { name: "Elena Martín Jiménez",    empresa: "Trinity College Boadilla" },
  { name: "Daniel Sánchez Morales",  empresa: "Trinity College Boadilla" },
  { name: "Sara López Castro",       empresa: "Colegio Mirabal" },
  { name: "Andrés Torres Vega",      empresa: "Colegio Mirabal" },
  { name: "Carmen Núñez Soto",       empresa: "Colegio Mirabal" },
  { name: "Roberto Iglesias Cano",   empresa: "Colegio Mirabal" },
  { name: "Beatriz Romero Díaz",     empresa: "Colegio Mirabal" },
  { name: "Alejandro Vázquez Lema",  empresa: "IES San Juan Bautista" },
  { name: "Patricia Molina Ortiz",   empresa: "IES San Juan Bautista" },
  { name: "Fernando Castro Ríos",    empresa: "IES San Juan Bautista" },
  { name: "Natalia Ramos Cuesta",    empresa: "IES San Juan Bautista" },
  { name: "Guillermo Pardo Vidal",   empresa: "Colegio Internacional Aravaca" },
  { name: "Clara Aguilar Soriano",   empresa: "Colegio Internacional Aravaca" },
  { name: "Hugo Méndez Bravo",       empresa: "Colegio Internacional Aravaca" },
  { name: "Laura Crespo Marín",      empresa: "Colegio Internacional Aravaca" },
  { name: "Pedro Reyes Calvo",       empresa: "Colegio Internacional Aravaca" },
  { name: "Isabel Domínguez Caro",   empresa: "Centro de Formación AlfaPlus" },
  { name: "Mario Salgado Vela",      empresa: "Centro de Formación AlfaPlus" },
  { name: "Cristina Lara Ferrer",    empresa: "Centro de Formación AlfaPlus" },
  { name: "Adrián Cabrera Pinto",    empresa: "Centro de Formación AlfaPlus" },
  { name: "Eva Bermúdez Lago",       empresa: "Centro de Formación AlfaPlus" },
].map((s, i) => ({
  ...s,
  wpUserId: BASE_USER_ID + i,
  email: s.name.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/).slice(0, 2).join(".") + "@retorika-test.es",
}));

// Banco de preguntas. Cada quiz usa el banco de su curso. Reusamos los 2
// banks del seed-demo (mismo tema: pedagogía) y añadimos 2 más.
const QUESTION_BANKS = {
  "Comunicación y Liderazgo Educativo": [
    { type: "multiple_choice", question: "Los psicólogos Daniel Kahneman y Bárbara Fredrickson demostraron que los alumnos no recuerdan una clase completa como si fuera una grabación, sino que su memoria selecciona momentos clave (Regla del Pico y Final). ¿Qué es lo que los alumnos suelen recordar más de una clase?", correctAnswer: "El momento más intenso y el final de la clase" },
    { type: "multiple_choice", question: "¿Qué ventaja aporta anticipar el próximo tema al finalizar la clase?", correctAnswer: "Aumenta la expectativa y motiva a los alumnos a regresar" },
    { type: "multiple_choice", question: "El autor Simon Sinek, en su libro Start with Why, afirma que las personas no decidimos solo por razones lógicas. ¿Qué factor tiene más peso en las decisiones y en el aprendizaje?", correctAnswer: "Las emociones y el sentido de pertenencia" },
    { type: "multiple_choice", question: "¿Qué transmite un profesor cuando se despide con frases negativas como «no habéis estado atentos, mañana examen»?", correctAnswer: "Ansiedad y asociación negativa con la materia" },
    { type: "true_false", question: "La comunicación no verbal representa más del 55% del impacto total en un mensaje oral según Albert Mehrabian.", correctAnswer: "Verdadero" },
    { type: "multiple_choice", question: "¿Cuál de las siguientes técnicas refuerza mejor la atención sostenida durante una clase de más de 45 minutos?", correctAnswer: "Pausas activas cada 20 minutos con preguntas de reflexión" },
    { type: "multiple_choice", question: "Según el modelo DISC aplicado al aula, ¿qué perfil de alumno necesita más estructura y claridad en las instrucciones?", correctAnswer: "Perfil Concienzudo (C)" },
    { type: "true_false", question: "El contacto visual con el grupo durante la exposición mejora la percepción de autoridad y credibilidad del docente.", correctAnswer: "Verdadero" },
    { type: "multiple_choice", question: "¿Qué elemento del lenguaje no verbal genera mayor confianza en el aula según la investigación de Amy Cuddy?", correctAnswer: "La postura abierta y expansiva" },
    { type: "multiple_choice", question: "¿Cuál es el objetivo principal de la «escucha activa» en la gestión del aula?", correctAnswer: "Validar emocionalmente al alumno para crear un clima seguro de aprendizaje" },
  ],
  "Metodologías Activas en el Aula": [
    { type: "multiple_choice", question: "¿Cuál es la diferencia fundamental entre el aprendizaje cooperativo y el trabajo en grupo tradicional?", correctAnswer: "La interdependencia positiva y la responsabilidad individual" },
    { type: "multiple_choice", question: "En el Aprendizaje Basado en Proyectos (ABP), ¿cuál es el elemento detonador que da inicio al proyecto?", correctAnswer: "Una pregunta guía o situación problema auténtica" },
    { type: "true_false", question: "La gamificación en educación consiste únicamente en añadir puntos y recompensas a las tareas académicas.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Qué método Flipped Classroom propone respecto a la transmisión de contenidos?", correctAnswer: "El alumno accede a los contenidos en casa y el aula se dedica a la práctica" },
    { type: "multiple_choice", question: "Según Bloom, ¿cuál es el nivel cognitivo más alto de su taxonomía revisada?", correctAnswer: "Crear" },
    { type: "true_false", question: "El Design Thinking se puede aplicar en educación secundaria para desarrollar el pensamiento creativo.", correctAnswer: "Verdadero" },
    { type: "multiple_choice", question: "¿Qué rol adopta el docente en una metodología activa?", correctAnswer: "Facilitador y guía del aprendizaje" },
    { type: "multiple_choice", question: "¿Cuál de estos es un indicador clave de evaluación formativa?", correctAnswer: "El portafolio de aprendizaje del alumno" },
    { type: "true_false", question: "El aprendizaje servicio (APS) combina el aprendizaje curricular con el servicio a la comunidad.", correctAnswer: "Verdadero" },
    { type: "multiple_choice", question: "¿Qué es la «zona de desarrollo próximo» de Vygotsky y cómo la aprovechan las metodologías activas?", correctAnswer: "La distancia entre lo que el alumno puede hacer solo y con ayuda, aprovechada mediante andamiaje" },
  ],
  "Gestión Emocional en el Aula": [
    { type: "multiple_choice", question: "¿Qué entiende Daniel Goleman por «inteligencia emocional» en el contexto educativo?", correctAnswer: "La capacidad de reconocer y gestionar emociones propias y ajenas" },
    { type: "multiple_choice", question: "Ante un conflicto entre alumnos, ¿cuál es la primera acción recomendada por el modelo CASEL?", correctAnswer: "Asegurar un espacio seguro y validar las emociones de ambas partes" },
    { type: "true_false", question: "Reprimir las emociones del alumno mejora el rendimiento académico a largo plazo.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Qué función cumple la respiración consciente en la gestión emocional del docente?", correctAnswer: "Activa el sistema parasimpático y reduce la reactividad" },
    { type: "multiple_choice", question: "El término «alfabetización emocional» se refiere a:", correctAnswer: "Enseñar a los alumnos a identificar y nombrar sus emociones" },
    { type: "true_false", question: "La empatía cognitiva es la capacidad de comprender el estado emocional del otro sin necesariamente compartirlo.", correctAnswer: "Verdadero" },
    { type: "multiple_choice", question: "¿Qué herramienta es útil para que los alumnos pequeños identifiquen su estado emocional al inicio de la clase?", correctAnswer: "El semáforo emocional o ruleta de emociones" },
    { type: "multiple_choice", question: "Según Marshall Rosenberg (Comunicación No Violenta), ¿cuáles son los 4 pasos para resolver un conflicto?", correctAnswer: "Observación, sentimiento, necesidad, petición" },
    { type: "true_false", question: "El docente puede gestionar emociones del aula sin haber trabajado las propias.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Qué actitud favorece más la regulación emocional en un alumno en crisis?", correctAnswer: "Presencia tranquila, escucha sin juicio y validación" },
  ],
  "Tecnología Educativa Aplicada": [
    { type: "multiple_choice", question: "El modelo SAMR (Puentedura) propone 4 niveles de integración tecnológica. ¿Cuál es el más transformador?", correctAnswer: "Redefinición — la tecnología permite tareas antes inconcebibles" },
    { type: "multiple_choice", question: "¿Qué riesgo principal plantea el uso indiscriminado de IA generativa por alumnos sin guía docente?", correctAnswer: "Pérdida del proceso de aprendizaje y pensamiento crítico" },
    { type: "true_false", question: "Una herramienta digital es educativa por sí misma, independientemente del diseño didáctico que la acompañe.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Para qué tipo de evaluación es especialmente útil una herramienta como Kahoot o Quizizz?", correctAnswer: "Evaluación formativa y diagnóstica con retroalimentación inmediata" },
    { type: "multiple_choice", question: "¿Qué competencia digital del marco DigCompEdu prioriza la creación de contenido educativo digital propio?", correctAnswer: "Creación de contenidos digitales" },
    { type: "true_false", question: "Las plataformas LMS sustituyen al docente en la mediación pedagógica.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Qué buena práctica recomienda la UNESCO para integrar IA generativa en el aula?", correctAnswer: "Transparencia, validación crítica de outputs y autoría compartida" },
    { type: "multiple_choice", question: "Un asistente IA puede ayudar al docente a:", correctAnswer: "Generar rúbricas, adaptar materiales y proponer actividades diferenciadas" },
    { type: "true_false", question: "La brecha digital se ha cerrado completamente en el sistema educativo español.", correctAnswer: "Falso" },
    { type: "multiple_choice", question: "¿Qué principio ético es central al usar datos de alumnos en plataformas digitales?", correctAnswer: "Minimización de datos y consentimiento informado" },
  ],
};

// ── Generador determinista de respuestas ────────────────────────────────────
// Para que las stats por pregunta del Modo B salgan variadas (no todas al
// 90%), definimos para cada quiz un "perfil de dificultad por pregunta":
// las preguntas 3, 5 y 7 son sistemáticamente más difíciles (40-60% fallo)
// y la 8 es muy difícil (~70% fallo). Eso hace que el dashboard muestre
// barras de % acierto realistas y diversas.

function difficultyFor(questionNo) {
  // Probabilidad de FALLO por pregunta (1..10):
  // 1=10%, 2=15%, 3=45%, 4=20%, 5=50%, 6=15%, 7=40%, 8=70%, 9=20%, 10=10%
  const p = [0.10, 0.15, 0.45, 0.20, 0.50, 0.15, 0.40, 0.70, 0.20, 0.10];
  return p[(questionNo - 1) % 10];
}

// Perfiles de quiz: algunos quizzes son "fáciles" (multiplicador 0.6 al fallo)
// y otros "duros" (multiplicador 1.3). Esto sesga el ranking de Top fallo.
const QUIZ_DIFFICULTY = {
  // courseIdx 0: "Comunicación y Liderazgo Educativo"
  [BASE_QUIZ_ID + 0]: 1.0,  // medio
  [BASE_QUIZ_ID + 1]: 0.8,  // medio-fácil
  [BASE_QUIZ_ID + 2]: 1.2,  // medio-duro
  // courseIdx 1: "Metodologías Activas"
  [BASE_QUIZ_ID + 3]: 1.0,
  [BASE_QUIZ_ID + 4]: 1.4,  // ← el más duro: candidato a Top fallo
  [BASE_QUIZ_ID + 5]: 0.9,
  // courseIdx 2: "Gestión Emocional"
  [BASE_QUIZ_ID + 6]: 0.7,  // ← el más fácil
  [BASE_QUIZ_ID + 7]: 1.1,
  // courseIdx 3: "Tecnología Educativa"
  [BASE_QUIZ_ID + 8]: 1.3,
  [BASE_QUIZ_ID + 9]: 1.5,  // ← también muy duro
};

// rand determinista por intento (no usamos Math.random para que el seed
// sea reproducible — clave estable: (wpUserId, wpQuizId, no, salt))
function det(seed, salt) {
  let x = (seed * 9301 + 49297 + salt * 233280) % 233280;
  x = ((x * 9301 + 49297) % 233280);
  return x / 233280; // 0..1
}

function generateAnswers(courseTitle, wpUserId, wpQuizId) {
  const bank = QUESTION_BANKS[courseTitle];
  if (!bank) throw new Error("Banco no encontrado para curso: " + courseTitle);
  const mult = QUIZ_DIFFICULTY[wpQuizId] ?? 1.0;
  const seed = (wpUserId * 1000) + wpQuizId;

  const answers = bank.map((q, i) => {
    const failProb = Math.min(0.95, difficultyFor(i + 1) * mult);
    const r = det(seed, i + 1);
    const isWrong = r < failProb;
    return {
      no: i + 1,
      questionId: (wpQuizId * 100) + (i + 1),
      type: q.type,
      question: q.question,
      correctAnswer: q.correctAnswer,
      givenAnswer: isWrong ? "Respuesta incorrecta del alumno" : q.correctAnswer,
      isCorrect: !isWrong,
      marks: 1,
    };
  });

  const correct = answers.filter((a) => a.isCorrect).length;
  const wrong = answers.length - correct;
  return { answers, correct, wrong, earned: correct };
}

// ── Función principal ──────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Salamandra CRM — Seed Cuestionarios (retorika local)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  // ── 1. Verificar tenant y módulo ────────────────────────────────────────
  header("Conectando a master...");
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${TENANT_SLUG}" no encontrado.\n`);
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  const trainingMod = await TenantModule.findOne({
    where: { tenantId: tenant.id, moduleKey: "training" },
  });
  if (!trainingMod?.enabled) {
    process.stderr.write(`\n✗ Módulo "training" no activo en ${TENANT_SLUG}. Activa antes de sembrar.\n`);
    process.exit(1);
  }
  log(`✓ Módulo "training" activo`);

  // ── 2. Sync schema (por si falta la tabla) ──────────────────────────────
  header(`Verificando schema crm_${TENANT_SLUG}...`);
  const { sequelize: tenantSeq, models } = getTenantDb(TENANT_SLUG);
  await tenantSeq.sync({ alter: true });
  log("✓ Tabla quiz_attempts lista");

  const { QuizAttempt } = models;

  // ── 3. Sembrar intentos ─────────────────────────────────────────────────
  header("Sembrando intentos de cuestionario (idempotente)...");

  const BASE_DATE = new Date("2026-04-01T08:00:00Z");
  const SPREAD_DAYS = 80; // ~80 días para que el ranking tenga distribución temporal

  let attemptId = BASE_ATTEMPT_ID;
  let seeded = 0;
  let skipped = 0;

  for (const student of STUDENTS) {
    for (const quiz of QUIZZES) {
      const course = COURSES[quiz.courseIdx];

      // ~85% completan cada quiz (skip determinista por seed).
      const skipRand = det((student.wpUserId * 31) + quiz.wpQuizId, 7);
      if (skipRand < 0.15) {
        attemptId++; // mantener IDs deterministas aunque skip
        continue;
      }

      // Fecha determinista dentro del rango
      const dayOffset = (det(student.wpUserId, quiz.wpQuizId) * SPREAD_DAYS) | 0;
      const minuteOffset = (det(quiz.wpQuizId, student.wpUserId) * 1440) | 0;
      const attemptDate = new Date(
        BASE_DATE.getTime() + dayOffset * 24 * 60 * 60 * 1000 + minuteOffset * 60 * 1000
      );

      const totalQ = 10;
      const totalPts = 10;
      const passingPts = 6; // necesita 6/10 para aprobar (más realista)
      const quizTimeSecs = 0;
      const attemptTimeSecs = 60 + ((det(attemptId, 99) * 240) | 0); // 1-5 min

      const { answers, correct, wrong, earned } = generateAnswers(
        course.title,
        student.wpUserId,
        quiz.wpQuizId
      );

      const result = earned >= passingPts ? "pass" : "fail";

      const [, isNew] = await QuizAttempt.findOrCreate({
        where: { wpAttemptId: attemptId },
        defaults: {
          wpAttemptId: attemptId,
          wpQuizId: quiz.wpQuizId,
          wpCourseId: course.wpCourseId,
          wpUserId: student.wpUserId,
          studentName: student.name,
          studentEmail: student.email,
          quizTitle: quiz.title,
          courseTitle: course.title,
          empresa: student.empresa,
          attemptDate,
          totalQuestions: totalQ,
          totalPoints: totalPts,
          earnedPoints: earned,
          passingPoints: passingPts,
          correctAnswers: correct,
          incorrectAnswers: wrong,
          quizTime: quizTimeSecs,
          attemptTime: attemptTimeSecs,
          result,
          answers,
        },
      });

      if (isNew) seeded++;
      else skipped++;
      attemptId++;
    }
  }

  log(`✓ ${seeded} intentos creados, ${skipped} ya existían (idempotencia)`);

  // ── 4. Resumen para validación manual ───────────────────────────────────
  header("Resumen de los datos sembrados:");
  const [byCourseRows] = await tenantSeq.query(`
    SELECT course_title, COUNT(*)::int AS cnt,
           ROUND((COUNT(*) FILTER (WHERE result='pass')::numeric / COUNT(*)) * 100, 1) AS pass_rate
    FROM crm_${TENANT_SLUG}.quiz_attempts
    WHERE wp_attempt_id >= ${BASE_ATTEMPT_ID}
    GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const r of byCourseRows) {
    log(`  · ${r.course_title.padEnd(40)} ${String(r.cnt).padStart(4)} intentos · ${r.pass_rate}% aprobados`);
  }

  const [byQuizRows] = await tenantSeq.query(`
    SELECT quiz_title, COUNT(*)::int AS cnt,
           ROUND((COUNT(*) FILTER (WHERE result='pass')::numeric / COUNT(*)) * 100, 1) AS pass_rate
    FROM crm_${TENANT_SLUG}.quiz_attempts
    WHERE wp_attempt_id >= ${BASE_ATTEMPT_ID}
    GROUP BY 1 ORDER BY pass_rate ASC LIMIT 5
  `);
  log("");
  log("Top 5 quizzes con menor % aprobado (deberían dominar el panel rojo):");
  for (const r of byQuizRows) {
    log(`  · ${r.quiz_title.padEnd(55)} ${String(r.cnt).padStart(3)} intentos · ${r.pass_rate}%`);
  }

  const [byCompanyRows] = await tenantSeq.query(`
    SELECT empresa, COUNT(*)::int AS cnt
    FROM crm_${TENANT_SLUG}.quiz_attempts
    WHERE wp_attempt_id >= ${BASE_ATTEMPT_ID}
    GROUP BY 1 ORDER BY 2 DESC
  `);
  log("");
  log("Empresas con intentos (dropdown empresa):");
  for (const r of byCompanyRows) {
    log(`  · ${r.empresa.padEnd(40)} ${String(r.cnt).padStart(4)} intentos`);
  }

  const totalAll = await QuizAttempt.count();
  const passedAll = await QuizAttempt.count({ where: { result: "pass" } });

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" ¡Seed completado!\n");
  process.stdout.write("════════════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:                ${tenant.name} (${TENANT_SLUG})\n`);
  process.stdout.write(`  Intentos sembrados:    ${seeded}\n`);
  process.stdout.write(`  Ya existían:           ${skipped}\n`);
  process.stdout.write(`  Total quiz_attempts:   ${totalAll}\n`);
  process.stdout.write(`  Aprobados:             ${passedAll} / ${totalAll}\n`);
  process.stdout.write(`  Rango wpAttemptId:     ${BASE_ATTEMPT_ID}..${attemptId - 1}\n`);
  process.stdout.write("\n");
  process.stdout.write(`  Para limpiar:\n`);
  process.stdout.write(`    DELETE FROM crm_${TENANT_SLUG}.quiz_attempts WHERE wp_attempt_id >= ${BASE_ATTEMPT_ID};\n`);
  process.stdout.write("════════════════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
