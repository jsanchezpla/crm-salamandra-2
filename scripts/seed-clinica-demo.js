/**
 * seed-clinica-demo.js — Datos clínicos realistas (Pacientes + Clínica) para el
 * escaparate. Reemplaza cualquier dato clínico previo del tenant (lo vacía y
 * vuelve a sembrar) con las FORMAS correctas que consume la UI: objectives como
 * array, observations como objeto de 4 campos, contentSections de 7 secciones,
 * coordinaciones con enum válido. Enganchado a los team_members reales del tenant.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-clinica-demo.js [slug]
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-clinica-demo.js aumenta
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = process.argv[2] || "demo";

function log(m) { process.stdout.write(`  ${m}\n`); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dateAgo(days, hour = 17) { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour, 0, 0, 0); return d; }
function ymdAgo(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function ymdIn(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

const CENTROS = ["CEIP Las Acacias", "Colegio Miraflores", "CEIP San Isidro", "Colegio Santa Ana", "CEIP El Pinar", "IES Vega del Turia"];
const NIVELES = ["1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria", "1º ESO"];
const DERIVA = ["Orientador escolar", "Pediatra de referencia", "Familia", "Neuropediatra", "Equipo de orientación (EOEP)"];
const FRECS = ["Semanal", "Quincenal"];
const OBJETIVOS = [
  "Atención sostenida", "Flexibilidad cognitiva", "Regulación emocional", "Memoria de trabajo",
  "Comprensión lectora", "Conciencia fonológica", "Autonomía en tareas", "Habilidades sociales",
  "Planificación y organización", "Control de la impulsividad", "Grafomotricidad", "Cálculo mental",
];
const ACTIVIDADES = [
  "Memory con piezas progresivas y juego simbólico guiado.",
  "Fichas de conciencia fonológica + lectura compartida.",
  "Circuito psicomotor y ejercicios de secuenciación.",
  "Tareas de categorización y resolución de problemas.",
  "Juego de reglas para trabajar la espera y el turno.",
  "Dictado preparado y estrategias de autocorrección.",
];
const DESEMPENOS = [
  "Ha mostrado mayor concentración que en sesiones previas; mantiene la tarea 15-20 min sin ayuda.",
  "Evolución estable. Necesita apoyo verbal para iniciar, pero termina de forma autónoma.",
  "Mejora leve. Se frustra ante el error, aunque acepta mejor la corrección.",
  "Muy participativo. Generaliza las estrategias trabajadas a nuevos ejercicios.",
];
const NOMBRES = ["Diego", "Lucía", "Martín", "Nora", "Hugo", "Vega", "Bruno", "Alba", "Gael", "Carla"];
const APELLIDOS = ["Martín", "Ferrer", "Sáez", "Ibáñez", "Roldán", "Bravo", "Gil", "Sanz", "Molina", "Peña"];

function motivo(nombre) {
  return `${nombre} acude a consulta derivado por dificultades de atención y regulación en el aula. Se observa fatigabilidad en tareas largas y baja tolerancia a la frustración, con impacto en el rendimiento y en las relaciones con iguales.`;
}
function observaciones() {
  return {
    familyComments: pick(["La familia refiere mejora en la rutina de deberes.", "Los padres observan más autonomía en casa.", "La madre comenta episodios de frustración con los deberes."]),
    nextSessionNotes: pick(["Continuar con ejercicios de atención sostenida.", "Introducir tareas de doble demanda.", "Reforzar estrategias de autocontrol."]),
    homeworkTasks: pick(["Practicar 10 min diarios de lectura compartida.", "Juego de reglas en familia 2 veces por semana.", "Fichas de atención (nivel 2)."]),
    incidents: pick(["Ninguna.", "Ninguna.", "Llegó cansado, sesión más corta."]),
  };
}
function fullReportContent(nombre) {
  return {
    motiveOfIntervention: motivo(nombre),
    objectives: ["Mejorar la atención sostenida en tareas académicas.", "Desarrollar estrategias de autorregulación emocional.", "Reforzar la memoria de trabajo.", "Fomentar la autonomía en la resolución de tareas."],
    evolution: [
      "Durante el último trimestre se observa una evolución favorable en los tiempos de atención y en la aceptación de la corrección.",
      "Ha incorporado rutinas de autoinstrucción que aplica de forma cada vez más autónoma.",
    ],
    achievements: ["Completa de manera autónoma tareas de 15-20 minutos.", "Utiliza estrategias de autocontrol ante el error.", "Mejora en la comprensión lectora inferencial.", "Mayor iniciativa en el juego cooperativo.", "Reducción de episodios de frustración."],
    persistentDifficulties: ["Dificultad para mantener el orden del material.", "Fatiga en tareas de más de 25 minutos.", "Necesita apoyo para planificar tareas complejas."],
    recommendations: ["Continuar reforzando rutinas de organización en casa y en el aula.", "Mantener sesiones semanales.", "Coordinar pautas con el centro escolar.", "Fraccionar las tareas largas en el aula."],
    continuityProposal: "Se propone continuar la intervención con frecuencia semanal durante el próximo trimestre, con revisión de objetivos a los tres meses.",
  };
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(`  Seed clínico (Pacientes + Clínica) — tenant ${SLUG}\n`);
  process.stdout.write("══════════════════════════════════════════════\n");

  const { models } = getTenantDb(SLUG);
  const { Patient, ClinicSession, ClinicalReport, Coordination, PerformanceMetric, TeamMember } = models;

  const team = await TeamMember.findAll({ where: { status: "active" } });
  if (team.length === 0) throw new Error(`No hay team_members activos en ${SLUG}; siembra el equipo primero.`);
  log(`✓ ${team.length} terapeutas (team_members)`);

  // ── Vaciar datos clínicos previos (orden FK-safe: hijos → patients) ──
  await Coordination.destroy({ where: {} });
  await ClinicSession.destroy({ where: {} });
  await ClinicalReport.destroy({ where: {} });
  await PerformanceMetric.destroy({ where: {} });
  await Patient.destroy({ where: {} });
  log("✓ datos clínicos previos vaciados");

  // ── Pacientes ──
  const N = 8;
  const patients = [];
  for (let i = 0; i < N; i++) {
    const firstName = NOMBRES[i % NOMBRES.length];
    const lastName = `${pick(APELLIDOS)} ${pick(APELLIDOS)}`;
    const age = rand(6, 13);
    const therapist = team[i % team.length];
    const status = i === N - 1 ? "discharged" : i === N - 2 ? "paused" : "active";
    const p = await Patient.create({
      firstName,
      lastName,
      age,
      birthDate: ymdAgo(age * 365 + rand(0, 300)),
      educationCenter: pick(CENTROS),
      educationLevel: pick(NIVELES),
      referralReason: motivo(firstName),
      referredBy: pick(DERIVA),
      objectives: [...new Set([pick(OBJETIVOS), pick(OBJETIVOS), pick(OBJETIVOS)])],
      mainTherapistId: therapist.id,
      enrollmentDate: ymdAgo(rand(120, 400)),
      attendanceFrequency: pick(FRECS),
      status,
      dischargeDate: status === "discharged" ? ymdAgo(rand(5, 30)) : null,
      dischargeReason: status === "discharged" ? "Objetivos alcanzados. Alta terapéutica." : null,
    });
    patients.push(p);
  }
  log(`✓ ${patients.length} pacientes`);

  // ── Sesiones (2-6 por paciente) ──
  let nSess = 0;
  for (const p of patients) {
    const count = rand(2, 6);
    for (let k = 0; k < count; k++) {
      const withAudio = Math.random() < 0.5;
      const daysBack = 4 + k * rand(7, 14);
      await ClinicSession.create({
        patientId: p.id,
        therapistId: p.mainTherapistId,
        sessionDate: dateAgo(daysBack),
        duration: pick([45, 50, 55, 60]),
        objectives: p.objectives.slice(0, rand(1, p.objectives.length)),
        activities: pick(ACTIVIDADES),
        performance: pick(DESEMPENOS),
        observations: observaciones(),
        audioDurationSec: withAudio ? rand(30, 180) : null,
        aiReviewedAt: withAudio ? dateAgo(daysBack, 18) : null,
        aiTranscription: withAudio ? "Hoy hemos trabajado atención con un memory de piezas… (transcripción de ejemplo)." : null,
        status: k === 0 && Math.random() < 0.3 ? "draft" : "registered",
      });
      nSess++;
    }
  }
  log(`✓ ${nSess} sesiones`);

  // ── Informes (los 2 primeros pacientes con contenido completo) ──
  let nRep = 0;
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i];
    if (i >= 5) continue; // ~5 pacientes con informe
    const full = i < 2;
    const status = pick(["draft", "reviewed", "delivered"]);
    await ClinicalReport.create({
      patientId: p.id,
      therapistId: p.mainTherapistId,
      reportType: pick(["evolution", "evolution", "admission"]),
      reportDate: ymdAgo(rand(3, 40)),
      dueDate: i % 2 === 0 ? ymdAgo(rand(1, 6)) : ymdIn(rand(2, 12)), // algunos vencidos
      deliveredAt: status === "delivered" ? dateAgo(rand(1, 20)) : null,
      contentSections: full ? fullReportContent(p.firstName) : {},
      status,
    });
    nRep++;
  }
  log(`✓ ${nRep} informes`);

  // ── Coordinaciones ──
  const COORDS = [
    { coordinationType: "school", participants: ["Tutora", "Orientador", "Familia", "Terapeuta"], topics: ["Adaptación metodológica en el aula", "Seguimiento de objetivos"], agreements: ["Fraccionar tareas largas", "Reforzar rutinas de organización"], nextActions: ["Revisión en 4 semanas"] },
    { coordinationType: "family", participants: ["Madre", "Padre", "Terapeuta"], topics: ["Pautas para casa", "Gestión de la frustración"], agreements: ["Rutina de deberes con descansos"], nextActions: ["Enviar guía de pautas"] },
    { coordinationType: "neuropediatrician", participants: ["Neuropediatra", "Terapeuta"], topics: ["Revisión de tratamiento", "Coordinación de informe"], agreements: ["Compartir informe evolutivo"], nextActions: ["Próxima cita en 3 meses"] },
    { coordinationType: "orientator", participants: ["Orientadora del centro", "Terapeuta"], topics: ["Medidas de apoyo educativo"], agreements: ["Solicitar adaptación no significativa"], nextActions: ["Reunión de seguimiento"] },
  ];
  let nCoord = 0;
  for (let i = 0; i < COORDS.length; i++) {
    const p = patients[i % patients.length];
    await Coordination.create({
      ...COORDS[i],
      coordinationDate: dateAgo(rand(5, 60), 12),
      relatedPatientId: p.id,
      createdById: p.mainTherapistId,
    });
    nCoord++;
  }
  log(`✓ ${nCoord} coordinaciones`);

  process.stdout.write(`\n✓ Seed clínico completado en ${SLUG}: ${patients.length} pacientes · ${nSess} sesiones · ${nRep} informes · ${nCoord} coordinaciones\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
