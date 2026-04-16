/**
 * seed-cuestionarios-demo.js
 *
 * 1. Activa el módulo "cuestionarios" para el tenant demo
 * 2. Sincroniza el schema (crea la tabla quiz_attempts)
 * 3. Siembra intentos de cuestionario realistas (TutorLMS style)
 *
 * Uso: node --env-file=.env.local scripts/seed-cuestionarios-demo.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const DEMO_SLUG = "demo";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ── Datos de referencia ────────────────────────────────────────────────────────

const COURSES = [
  { wpCourseId: 101, title: "Comunicación y Liderazgo Educativo" },
  { wpCourseId: 102, title: "Metodologías Activas en el Aula" },
];

const QUIZZES = [
  { wpQuizId: 201, courseIdx: 0, title: "Test Módulo 1" },
  { wpQuizId: 202, courseIdx: 0, title: "Test Módulo 2" },
  { wpQuizId: 203, courseIdx: 0, title: "Test Módulo 3" },
  { wpQuizId: 204, courseIdx: 0, title: "Test Módulo 4" },
  { wpQuizId: 205, courseIdx: 0, title: "Test Módulo 5" },
  { wpQuizId: 206, courseIdx: 0, title: "Test Módulo 6" },
  { wpQuizId: 207, courseIdx: 0, title: "Test Módulo 7" },
  { wpQuizId: 208, courseIdx: 0, title: "Test Módulo 8" },
  { wpQuizId: 211, courseIdx: 1, title: "Test Módulo 1" },
  { wpQuizId: 212, courseIdx: 1, title: "Test Módulo 2" },
  { wpQuizId: 213, courseIdx: 1, title: "Test Módulo 3" },
  { wpQuizId: 214, courseIdx: 1, title: "Test Módulo 4" },
];

const STUDENTS = [
  { wpUserId: 10, name: "Carolina Marca", email: "cmarca@colegioparticipes.es", empresa: "Colegio Partícipes" },
  { wpUserId: 11, name: "Daniel González", email: "dgonzalez@colegioparticipes.es", empresa: "Colegio Partícipes" },
  { wpUserId: 12, name: "Laura Serrano", email: "lserrano@escuelanova.es", empresa: "Escuela Nueva" },
  { wpUserId: 13, name: "Marcos Díez", email: "mdiez@escuelanova.es", empresa: "Escuela Nueva" },
  { wpUserId: 14, name: "Sara Ruiz", email: "sruiz@cpalmeria.es", empresa: "CP Almería" },
];

// Preguntas reutilizables por módulo
const QUESTION_BANKS = {
  "Comunicación y Liderazgo Educativo": [
    {
      type: "multiple_choice",
      question: "Los psicólogos Daniel Kahneman y Bárbara Fredrickson demostraron que los alumnos no recuerdan una clase completa como si fuera una grabación, sino que su memoria selecciona momentos clave (Regla del Pico y Final). ¿Qué es lo que los alumnos suelen recordar más de una clase?",
      correctAnswer: "El momento más intenso y el final de la clase",
    },
    {
      type: "multiple_choice",
      question: "¿Qué ventaja aporta anticipar el próximo tema al finalizar la clase?",
      correctAnswer: "Aumenta la expectativa y motiva a los alumnos a regresar",
    },
    {
      type: "multiple_choice",
      question: "El autor Simon Sinek, en su libro Start with Why, afirma que las personas no decidimos solo por razones lógicas. ¿Qué factor tiene más peso en las decisiones y en el aprendizaje?",
      correctAnswer: "Las emociones y el sentido de pertenencia",
    },
    {
      type: "multiple_choice",
      question: "¿Qué transmite un profesor cuando se despide con frases negativas como «no habéis estado atentos, mañana examen»?",
      correctAnswer: "Ansiedad y asociación negativa con la materia",
    },
    {
      type: "true_false",
      question: "La comunicación no verbal representa más del 55% del impacto total en un mensaje oral según Albert Mehrabian.",
      correctAnswer: "Verdadero",
    },
    {
      type: "multiple_choice",
      question: "¿Cuál de las siguientes técnicas refuerza mejor la atención sostenida durante una clase de más de 45 minutos?",
      correctAnswer: "Pausas activas cada 20 minutos con preguntas de reflexión",
    },
    {
      type: "multiple_choice",
      question: "Según el modelo DISC aplicado al aula, ¿qué perfil de alumno necesita más estructura y claridad en las instrucciones?",
      correctAnswer: "Perfil Concienzudo (C)",
    },
    {
      type: "true_false",
      question: "El contacto visual con el grupo durante la exposición mejora la percepción de autoridad y credibilidad del docente.",
      correctAnswer: "Verdadero",
    },
    {
      type: "multiple_choice",
      question: "¿Qué elemento del lenguaje no verbal genera mayor confianza en el aula según la investigación de Amy Cuddy?",
      correctAnswer: "La postura abierta y expansiva",
    },
    {
      type: "multiple_choice",
      question: "¿Cuál es el objetivo principal de la «escucha activa» en la gestión del aula?",
      correctAnswer: "Validar emocionalmente al alumno para crear un clima seguro de aprendizaje",
    },
  ],
  "Metodologías Activas en el Aula": [
    {
      type: "multiple_choice",
      question: "¿Cuál es la diferencia fundamental entre el aprendizaje cooperativo y el trabajo en grupo tradicional?",
      correctAnswer: "La interdependencia positiva y la responsabilidad individual",
    },
    {
      type: "multiple_choice",
      question: "En el Aprendizaje Basado en Proyectos (ABP), ¿cuál es el elemento detonador que da inicio al proyecto?",
      correctAnswer: "Una pregunta guía o situación problema auténtica",
    },
    {
      type: "true_false",
      question: "La gamificación en educación consiste únicamente en añadir puntos y recompensas a las tareas académicas.",
      correctAnswer: "Falso",
    },
    {
      type: "multiple_choice",
      question: "¿Qué método Flipped Classroom propone respecto a la transmisión de contenidos?",
      correctAnswer: "El alumno accede a los contenidos en casa y el aula se dedica a la práctica",
    },
    {
      type: "multiple_choice",
      question: "Según Bloom, ¿cuál es el nivel cognitivo más alto de su taxonomía revisada?",
      correctAnswer: "Crear",
    },
    {
      type: "true_false",
      question: "El Design Thinking se puede aplicar en educación secundaria para desarrollar el pensamiento creativo.",
      correctAnswer: "Verdadero",
    },
    {
      type: "multiple_choice",
      question: "¿Qué rol adopta el docente en una metodología activa?",
      correctAnswer: "Facilitador y guía del aprendizaje",
    },
    {
      type: "multiple_choice",
      question: "¿Cuál de estos es un indicador clave de evaluación formativa?",
      correctAnswer: "El portafolio de aprendizaje del alumno",
    },
    {
      type: "true_false",
      question: "El aprendizaje servicio (APS) combina el aprendizaje curricular con el servicio a la comunidad.",
      correctAnswer: "Verdadero",
    },
    {
      type: "multiple_choice",
      question: "¿Qué es la «zona de desarrollo próximo» de Vygotsky y cómo la aprovechan las metodologías activas?",
      correctAnswer: "La distancia entre lo que el alumno puede hacer solo y con ayuda, aprovechada mediante andamiaje",
    },
  ],
};

// ── Función para generar respuestas simuladas ─────────────────────────────────

function generateAnswers(courseTitle, quizIndex, passMark) {
  const bank = QUESTION_BANKS[courseTitle] ?? QUESTION_BANKS["Comunicación y Liderazgo Educativo"];
  // Cada módulo usa las 10 preguntas del banco (en rotación si hay más módulos)
  const questions = bank;
  const totalQ = questions.length;
  const totalPts = totalQ;

  // Simular resultado: algunos aprueban todos, otros fallan 1-3
  const wrongCount = passMark >= 7 ? 0 : Math.floor(Math.random() * 3);
  const wrongIndexes = new Set();
  while (wrongIndexes.size < wrongCount) {
    wrongIndexes.add(Math.floor(Math.random() * totalQ));
  }

  const answers = questions.map((q, i) => {
    const isCorrect = !wrongIndexes.has(i);
    return {
      no: i + 1,
      questionId: (quizIndex + 1) * 100 + i + 1,
      type: q.type,
      question: q.question,
      correctAnswer: q.correctAnswer,
      givenAnswer: isCorrect ? q.correctAnswer : "Respuesta incorrecta del alumno",
      isCorrect,
      marks: 1,
    };
  });

  const correct = answers.filter((a) => a.isCorrect).length;
  return { answers, correct, wrong: wrongCount, earned: correct };
}

// ── Función principal ─────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Salamandra CRM — Seed Cuestionarios (demo)    \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  // ── 1. Conectar y resolver tenant ─────────────────────────────────────────
  header("Conectando a master...");
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${DEMO_SLUG}" no encontrado.\n`);
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Activar módulo cuestionarios ───────────────────────────────────────
  header('Activando módulo "cuestionarios"...');
  const [mod, created] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "cuestionarios" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "cuestionarios",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  if (created) {
    log('✓ Módulo "cuestionarios" creado y activado');
  } else {
    if (!mod.enabled) {
      await mod.update({ enabled: true });
      log('· Ya existía — reactivado');
    } else {
      log('· Ya existía y estaba activo — sin cambios');
    }
  }

  // ── 3. Sync schema (crea quiz_attempts si no existe) ──────────────────────
  header("Sincronizando schema crm_demo...");
  const { sequelize: tenantSeq, models } = getTenantDb(DEMO_SLUG);
  await tenantSeq.sync({ alter: true });
  log("✓ Tabla quiz_attempts lista");

  const { QuizAttempt } = models;

  // ── 4. Sembrar intentos ───────────────────────────────────────────────────
  header("Sembrando intentos de cuestionario...");

  let attemptId = 1000;
  let seeded = 0;

  // Fecha base: octubre 2025 (como en las imágenes)
  const BASE_DATE = new Date("2025-10-01T08:00:00");

  for (const student of STUDENTS) {
    let minuteOffset = Math.floor(Math.random() * 60 * 24 * 30); // variación en los primeros 30 días

    for (const quiz of QUIZZES) {
      const course = COURSES[quiz.courseIdx];

      // Simular si el alumno ha completado este quiz (no todos completan todos)
      const skipChance = Math.random();
      if (skipChance < 0.15) continue; // 15% de intentos "no realizados"

      const attemptDate = new Date(BASE_DATE.getTime() + minuteOffset * 60 * 1000);
      minuteOffset += Math.floor(Math.random() * 120) + 30; // 30-150 min entre intentos

      const totalQ = 10;
      const totalPts = 10;
      const passingPts = 5;
      const quizTimeSecs = 0; // sin límite de tiempo (como en la imagen)
      const attemptTimeSecs = Math.floor(Math.random() * 180) + 60; // 1-4 min

      const { answers, correct, wrong, earned } = generateAnswers(
        course.title,
        quiz.wpQuizId,
        passingPts
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
      attemptId++;
    }
  }

  log(`✓ ${seeded} intentos creados`);

  // ── 5. Resumen ─────────────────────────────────────────────────────────────
  const total = await QuizAttempt.count();
  const passed = await QuizAttempt.count({ where: { result: "pass" } });

  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" ¡Seed completado!\n");
  process.stdout.write("════════════════════════════════════════════════\n");
  process.stdout.write(`  Módulo:   cuestionarios (enabled: true)\n`);
  process.stdout.write(`  Intentos sembrados:  ${seeded}\n`);
  process.stdout.write(`  Total en BD:         ${total}\n`);
  process.stdout.write(`  Aprobados:           ${passed} / ${total}\n`);
  process.stdout.write("════════════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
