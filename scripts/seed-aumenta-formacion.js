/**
 * seed-aumenta-formacion.js — datos de FORMACIÓN para Aumenta, borrables de un tirón.
 *
 * PARA QUÉ: Rodrigo da una formación al equipo de Aumenta (2026-07-28) y el CRM
 * está vacío por la parte clínica, así que no hay nada que enseñar. Esto lo
 * llena con una historia COHERENTE: al abrir una familia se ven sus citas, sus
 * facturas, sus pacientes y las sesiones de esos pacientes. Un seed por módulo
 * habría creado islas sin relación entre sí, que es justo lo que no sirve para
 * enseñar a alguien a trabajar con la herramienta.
 *
 * ⚠️ AUMENTA ES UN CRM EN USO REAL. Por eso:
 *   · NO se toca `team_members` (las 15 personas del centro son reales).
 *   · NO se tocan `leads` (los 18 se conservaron en el reset del 24-jul).
 *   · NO se tocan `event_types` ni `invoice_series` (configuración real).
 *   · Todo lo que se crea lleva un id que empieza por `f0f0f0f0-`, así que
 *     borrarlo es exacto y no depende de acordarse de nada. Nada de
 *     `destroy({where:{}})`: si el día de mañana ya hay pacientes de verdad,
 *     este script sigue sin poder llevárselos por delante.
 *
 * USO
 *   docker exec crm-salamandra-app-1 node scripts/seed-aumenta-formacion.js aumenta --confirm
 *   docker exec crm-salamandra-app-1 node scripts/seed-aumenta-formacion.js aumenta --borrar
 *
 *   Sin --confirm ni --borrar solo cuenta lo que haría.
 *
 * ANTES DE QUE EMPIECEN A FACTURAR DE VERDAD hay que lanzar el --borrar: las
 * facturas de formación ocupan los números F-2026-00xx y `number` es único.
 * El --borrar deja el contador de la serie otra vez en 1.
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = process.argv[2] || "aumenta";
const CONFIRM = process.argv.includes("--confirm");
const BORRAR = process.argv.includes("--borrar");

// Prefijo de todos los ids que crea este script. Es lo que hace el borrado
// exacto y visible a simple vista en la propia base de datos.
const MARCA = "f0f0f0f0";
const uid = (grupo, n) => `${MARCA}-${String(grupo).padStart(4, "0")}-4000-8000-${String(n).padStart(12, "0")}`;

const G = {
  CLIENTE: 1, PACIENTE: 2, CITA: 3, SESION: 4, INFORME: 5,
  COORD: 6, FACTURA: 7, COBRO: 8, GASTO: 9, PROYECTO: 10, TAREA: 11, TABLERO: 12,
};

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

// Aleatoriedad con semilla fija: dos ejecuciones producen lo MISMO, así que
// repetir el seed no genera un centro distinto cada vez.
let semilla = 20260728;
function rnd() {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rand = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;

const HOY = new Date();
function dia(offset, hora = 10, minuto = 0) {
  const d = new Date(HOY);
  d.setDate(d.getDate() + offset);
  d.setHours(hora, minuto, 0, 0);
  return d;
}
const ymd = (offset) => dia(offset).toISOString().slice(0, 10);

// ── Contenido, con el vocabulario real de un centro de psicología infantil ──

const FAMILIAS = [
  { apellidos: "Ferrer Solís", tutor: "Carmen Solís Rueda", tel: "615 22 41 08" },
  { apellidos: "Martín Ibáñez", tutor: "Javier Martín Cano", tel: "628 71 03 55" },
  { apellidos: "Roldán Bravo", tutor: "Nuria Bravo Alonso", tel: "699 14 60 27" },
  { apellidos: "Sáez Molina", tutor: "Ana Molina Ruiz", tel: "610 45 88 32" },
  { apellidos: "Peña Gil", tutor: "Sergio Peña Ortiz", tel: "637 90 12 74" },
  { apellidos: "Cordero Vidal", tutor: "Marta Vidal Serrano", tel: "622 38 55 91" },
  { apellidos: "Herrera Nieto", tutor: "Alberto Herrera Lima", tel: "645 07 29 63" },
  { apellidos: "Lozano Prieto", tutor: "Beatriz Prieto Cid", tel: "691 63 44 10" },
  { apellidos: "Cabrera Santos", tutor: "Diego Cabrera Rey", tel: "634 18 72 05" },
  { apellidos: "Ortega Marín", tutor: "Lucía Marín Duarte", tel: "618 55 90 37" },
  { apellidos: "Navarro Cuesta", tutor: "Pablo Navarro Rico", tel: "677 21 08 46" },
  { apellidos: "Salas Fuentes", tutor: "Elena Fuentes Paz", tel: "603 84 17 52" },
];

// Dos familias con hermanos: es el caso que más confunde al usar el CRM
// (mismo pagador, dos fichas de paciente) y conviene que salga en la formación.
const NINOS = [
  { nombre: "Diego", familia: 0, edad: 9 },
  { nombre: "Lucía", familia: 1, edad: 7 },
  { nombre: "Martín", familia: 2, edad: 11 },
  { nombre: "Nora", familia: 3, edad: 6 },
  { nombre: "Hugo", familia: 4, edad: 10 },
  { nombre: "Vega", familia: 5, edad: 8 },
  { nombre: "Bruno", familia: 6, edad: 12 },
  { nombre: "Alba", familia: 7, edad: 7 },
  { nombre: "Gael", familia: 8, edad: 9 },
  { nombre: "Carla", familia: 9, edad: 13 },
  { nombre: "Iván", familia: 10, edad: 8 },
  { nombre: "Sofía", familia: 11, edad: 10 },
  { nombre: "Mateo", familia: 0, edad: 6 },  // hermano de Diego
  { nombre: "Jimena", familia: 3, edad: 9 }, // hermana de Nora
];

// Centro y curso van EMPAREJADOS: la formación es para profesionales de la
// educación y un "IES — 2º Primaria" les habría cantado a la primera.
const COLEGIOS = ["CEIP Las Acacias", "Colegio Miraflores", "CEIP San Isidro", "Colegio Santa Ana", "CEIP El Pinar"];
const INSTITUTOS = ["IES Vega del Turia", "IES Ramón y Cajal"];
// El colegio se ata a la FAMILIA, no al niño: dos hermanos en dos centros
// distintos es justo el detalle que delata unos datos inventados ante gente
// que trabaja con colegios todos los días.
function centroYCurso(edad, indiceFamilia) {
  if (edad >= 12) {
    return { centro: INSTITUTOS[indiceFamilia % INSTITUTOS.length], curso: edad === 12 ? "1º ESO" : "2º ESO" };
  }
  return {
    centro: COLEGIOS[indiceFamilia % COLEGIOS.length],
    curso: `${Math.max(1, Math.min(6, edad - 5))}º Primaria`,
  };
}
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

// Un motivo distinto por perfil. Con el texto repetido, la lista de pacientes
// se leía como una plantilla y no como un centro de verdad.
const MOTIVOS = [
  (n) => `${n} acude derivado por dificultades de atención y regulación en el aula. Se observa fatigabilidad en tareas largas y baja tolerancia a la frustración, con impacto en el rendimiento y en las relaciones con iguales.`,
  (n) => `Los padres de ${n} consultan por un retraso en la adquisición del lenguaje expresivo. Se aprecian dificultades articulatorias y un vocabulario por debajo de lo esperado para su edad.`,
  (n) => `${n} presenta dificultades específicas en la lectoescritura: lectura silabeante, errores de sustitución y omisión, y bajo rendimiento en comprensión pese a un nivel cognitivo dentro de la media.`,
  (n) => `Derivación desde el centro escolar por conductas disruptivas y dificultad para el cumplimiento de normas. La familia refiere rabietas frecuentes y problemas de sueño.`,
  (n) => `${n} consulta por dificultades en el cálculo y el razonamiento matemático, con ansiedad anticipatoria ante los exámenes y evitación de las tareas del área.`,
  (n) => `Se solicita valoración neuropsicológica tras un traumatismo craneoencefálico leve. La familia observa mayor lentitud y olvidos frecuentes desde entonces.`,
  (n) => `${n} acude por dificultades en la interacción social: escaso contacto ocular, intereses restringidos y problemas para interpretar claves sociales con iguales.`,
  (n) => `Consulta por sintomatología ansiosa: quejas somáticas antes de ir al colegio, preocupación excesiva por el rendimiento y dificultad para separarse de la figura de apego.`,
  (n) => `${n} presenta dificultades de coordinación motriz y grafomotricidad. La letra es poco legible y se fatiga rápidamente al escribir.`,
  (n) => `Derivación por parte del pediatra ante una posible dislalia. Se observan errores fonológicos persistentes que afectan a la inteligibilidad del habla.`,
];
const motivo = (n, i = 0) => MOTIVOS[i % MOTIVOS.length](n);

const observaciones = () => ({
  familyComments: pick(["La familia refiere mejora en la rutina de deberes.", "Los padres observan más autonomía en casa.", "La madre comenta episodios de frustración con los deberes."]),
  nextSessionNotes: pick(["Continuar con ejercicios de atención sostenida.", "Introducir tareas de doble demanda.", "Reforzar estrategias de autocontrol."]),
  homeworkTasks: pick(["Practicar 10 min diarios de lectura compartida.", "Juego de reglas en familia 2 veces por semana.", "Fichas de atención (nivel 2)."]),
  incidents: pick(["Ninguna.", "Ninguna.", "Llegó cansado, sesión más corta."]),
});

const informeCompleto = (n) => ({
  motiveOfIntervention: motivo(n),
  objectives: ["Mejorar la atención sostenida en tareas académicas.", "Desarrollar estrategias de autorregulación emocional.", "Reforzar la memoria de trabajo.", "Fomentar la autonomía en la resolución de tareas."],
  evolution: [
    "Durante el último trimestre se observa una evolución favorable en los tiempos de atención y en la aceptación de la corrección.",
    "Ha incorporado rutinas de autoinstrucción que aplica de forma cada vez más autónoma.",
  ],
  achievements: ["Completa de manera autónoma tareas de 15-20 minutos.", "Utiliza estrategias de autocontrol ante el error.", "Mejora en la comprensión lectora inferencial.", "Mayor iniciativa en el juego cooperativo."],
  persistentDifficulties: ["Dificultad para mantener el orden del material.", "Fatiga en tareas de más de 25 minutos.", "Necesita apoyo para planificar tareas complejas."],
  recommendations: ["Continuar reforzando rutinas de organización en casa y en el aula.", "Mantener sesiones semanales.", "Coordinar pautas con el centro escolar."],
  continuityProposal: "Se propone continuar la intervención con frecuencia semanal durante el próximo trimestre, con revisión de objetivos a los tres meses.",
});

// ── Borrado ────────────────────────────────────────────────────────────────
// Orden hijo → padre para no pelearse con las FK. Todo por prefijo de id.
const TABLAS_EN_ORDEN_DE_BORRADO = [
  "payments", "invoices", "costs", "tasks", "board_columns", "projects",
  "coordinations", "clinical_reports", "clinic_sessions",
  "bookings", "patients", "clients",
];

async function borrar(sequelize, schema) {
  header(`Borrando los datos de formación de ${SLUG}`);
  let total = 0;
  for (const tabla of TABLAS_EN_ORDEN_DE_BORRADO) {
    try {
      const [filas] = await sequelize.query(
        `DELETE FROM "${schema}"."${tabla}" WHERE id::text LIKE '${MARCA}-%' RETURNING id`
      );
      if (filas.length) log(`${tabla}: ${filas.length} borrada(s)`);
      total += filas.length;
    } catch (err) {
      log(`${tabla}: se salta (${err.message.split("\n")[0]})`);
    }
  }
  // El contador de la serie vuelve a 1: sin facturas, la primera de verdad
  // tiene que ser la número 1.
  try {
    await sequelize.query(`UPDATE "${schema}".invoice_series SET next_number = 1 WHERE code IN ('F','R')`);
    log("series de facturación: contador otra vez en 1");
  } catch { /* el tenant puede no tener billing */ }
  header(`Hecho: ${total} fila(s) eliminadas. Nada más se ha tocado.`);
}

// ── Siembra ────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(`  Datos de formación — tenant ${SLUG}\n`);
  process.stdout.write("══════════════════════════════════════════════\n");

  const { sequelize, models } = getTenantDb(SLUG);
  const schema = `crm_${SLUG}`;
  const {
    Client, Patient, Booking, EventType, TeamMember,
    ClinicSession, ClinicalReport, Coordination,
    Invoice, Payment, Cost, Project, Task,
  } = models;

  if (BORRAR) {
    await borrar(sequelize, schema);
    return;
  }

  // ── Lo que NO se toca: se lee, no se escribe ──
  const equipo = await TeamMember.findAll({ where: { status: "active" }, order: [["displayName", "ASC"]] });
  if (equipo.length === 0) throw new Error(`No hay equipo en ${SLUG}: este script se engancha al equipo real, no lo crea.`);
  const tipos = await EventType.findAll({ where: { active: true } });
  if (tipos.length === 0) throw new Error(`No hay tipos de cita en ${SLUG}.`);
  log(`✓ ${equipo.length} profesionales reales y ${tipos.length} tipos de cita (solo lectura)`);

  // Los terapeutas que ven pacientes; dirección, administración y contabilidad
  // no llevan agenda clínica.
  const clinicos = equipo.filter((t) => Array.isArray(t.specialties) && t.specialties.length > 0);
  const terapeutas = clinicos.length ? clinicos : equipo;
  log(`✓ ${terapeutas.length} con agenda clínica`);

  if (!CONFIRM) {
    header("Simulación (falta --confirm)");
    log(`Crearía ~${FAMILIAS.length} familias, ${NINOS.length} pacientes, ~90 citas, ~50 sesiones,`);
    log("8 informes, 6 coordinaciones, 16 facturas, 10 cobros, 8 gastos y 2 proyectos.");
    log(`Todos con id ${MARCA}-…, borrables con --borrar.`);
    return;
  }

  // Idempotente: si ya se sembró, se limpia antes para no duplicar.
  await borrar(sequelize, schema);

  // ── 1. Clientes (las familias que pagan) ──
  header("Sembrando");
  const clientes = [];
  for (let i = 0; i < FAMILIAS.length; i++) {
    const f = FAMILIAS[i];
    const c = await Client.create({
      id: uid(G.CLIENTE, i + 1),
      name: f.tutor,
      type: "individual",
      email: `${f.tutor.split(" ")[0].toLowerCase()}.${f.apellidos.split(" ")[0].toLowerCase()}@example.com`,
      phone: f.tel,
      status: "active",
      taxId: `${rand(10, 99)}${rand(100000, 999999)}${"TRWAGMYFPDXBNJZSQVHLCKE"[rand(0, 22)]}`,
      fiscalName: f.tutor,
      fiscalAddress: `Calle ${pick(["Alcalá", "Serrano", "Bravo Murillo", "Goya", "Príncipe de Vergara"])} ${rand(1, 180)}`,
      fiscalCity: "Madrid",
      fiscalZip: `280${String(rand(1, 55)).padStart(2, "0")}`,
      notes: `Tutor/a legal de ${NINOS.filter((n) => n.familia === i).map((n) => n.nombre).join(" y ")}.`,
      customFields: { formacion: true },
    });
    clientes.push(c);
  }
  log(`✓ ${clientes.length} familias`);

  // ── 2. Pacientes (los niños), enlazados a su pagador ──
  const pacientes = [];
  for (let i = 0; i < NINOS.length; i++) {
    const n = NINOS[i];
    const fam = FAMILIAS[n.familia];
    const tera = terapeutas[i % terapeutas.length];
    const escolar = centroYCurso(n.edad, n.familia);
    // Uno de alta y uno en pausa, para que se vean los tres estados.
    const status = i === NINOS.length - 1 ? "discharged" : i === NINOS.length - 2 ? "paused" : "active";
    const p = await Patient.create({
      id: uid(G.PACIENTE, i + 1),
      clientId: clientes[n.familia].id,
      firstName: n.nombre,
      lastName: fam.apellidos,
      age: n.edad,
      birthDate: ymd(-(n.edad * 365 + rand(0, 300))),
      educationCenter: escolar.centro,
      educationLevel: escolar.curso,
      referralReason: motivo(n.nombre, i),
      referredBy: pick(DERIVA),
      objectives: [...new Set([pick(OBJETIVOS), pick(OBJETIVOS), pick(OBJETIVOS)])],
      mainTherapistId: tera.id,
      enrollmentDate: ymd(-rand(120, 400)),
      attendanceFrequency: pick(FRECS),
      status,
      dischargeDate: status === "discharged" ? ymd(-rand(5, 30)) : null,
      dischargeReason: status === "discharged" ? "Objetivos alcanzados. Alta terapéutica." : null,
      relationship: "Hijo/a",
    });
    pacientes.push(p);
  }
  log(`✓ ${pacientes.length} pacientes (2 con hermano en el centro)`);

  // ── 3. Citas: pasadas, esta semana y futuras ──
  let nCitas = 0;
  const activos = pacientes.filter((p) => p.status !== "discharged");
  for (let i = 0; i < activos.length; i++) {
    const p = activos[i];
    const fam = FAMILIAS[NINOS[pacientes.indexOf(p)].familia];
    const cliente = clientes.find((c) => c.id === p.clientId);
    const tera = equipo.find((t) => t.id === p.mainTherapistId) || terapeutas[0];
    const tipo = i === 0 ? tipos[0] : pick(tipos);
    const hora = 9 + (i % 9);

    // 4 pasadas + 1 esta semana + 2 futuras por paciente
    const offsets = [-28, -21, -14, -7, rand(0, 4), 7, 14];
    for (let k = 0; k < offsets.length; k++) {
      const off = offsets[k];
      let estado;
      if (off < 0) estado = k === 1 && i % 5 === 0 ? "no_show" : k === 2 && i % 7 === 0 ? "cancelled" : "completed";
      else estado = off === 0 || off <= 4 ? "confirmed" : i % 4 === 0 ? "pending" : "confirmed";

      await Booking.create({
        id: uid(G.CITA, ++nCitas),
        eventTypeId: tipo.id,
        clientName: fam.tutor,
        clientEmail: cliente.email,
        clientPhone: fam.tel,
        scheduledAt: dia(off, hora, (i % 2) * 30),
        duration: tipo.duration || 45,
        modality: pick(["presencial", "presencial", "presencial", "online"]),
        status: estado,
        cancellationToken: uid(G.CITA, 900000 + nCitas),
        teamMemberId: tera.id,
        patientId: p.id,
        clientId: cliente.id,
        cancelledAt: estado === "cancelled" ? dia(off - 1, 12) : null,
        cancellationReason: estado === "cancelled" ? "La familia avisó el día anterior." : null,
        // El nombre que se ve en la agenda es el de quien reserva (el padre o la
        // madre). En un centro infantil eso no basta: la nota dice de QUÉ niño
        // es la sesión, que es lo que necesita la terapeuta al abrir el día.
        notes: `${p.firstName} ${p.lastName} · ${tipo.name}`,
      });
    }
  }
  log(`✓ ${nCitas} citas (pasadas, esta semana y próximas)`);

  // ── 4. Sesiones clínicas ──
  let nSes = 0;
  for (const p of pacientes) {
    if (p.status === "discharged") continue;
    const count = rand(3, 5);
    for (let k = 0; k < count; k++) {
      const conAudio = rnd() < 0.4;
      const atras = 4 + k * rand(7, 14);
      await ClinicSession.create({
        id: uid(G.SESION, ++nSes),
        patientId: p.id,
        clientId: p.clientId,
        therapistId: p.mainTherapistId,
        sessionDate: dia(-atras, 17),
        duration: pick([45, 50, 55, 60]),
        objectives: p.objectives.slice(0, rand(1, p.objectives.length)),
        activities: pick(ACTIVIDADES),
        performance: pick(DESEMPENOS),
        observations: observaciones(),
        audioDurationSec: conAudio ? rand(30, 180) : null,
        aiReviewedAt: conAudio ? dia(-atras, 18) : null,
        aiTranscription: conAudio ? "Hoy hemos trabajado atención con un memory de piezas… (transcripción de ejemplo)." : null,
        status: k === 0 && rnd() < 0.3 ? "draft" : "registered",
      });
    }
  }
  log(`✓ ${nSes} sesiones clínicas`);

  // ── 5. Informes: alguno vencido, que es lo que enciende las alertas ──
  let nInf = 0;
  for (let i = 0; i < 8 && i < pacientes.length; i++) {
    const p = pacientes[i];
    const completo = i < 3;
    const vencido = i < 2;
    const estado = vencido ? "reviewed" : pick(["draft", "reviewed", "delivered"]);
    await ClinicalReport.create({
      id: uid(G.INFORME, ++nInf),
      patientId: p.id,
      clientId: p.clientId,
      therapistId: p.mainTherapistId,
      reportType: i === 0 ? "admission" : "evolution",
      reportDate: ymd(-rand(3, 40)),
      dueDate: vencido ? ymd(-rand(3, 12)) : i % 2 === 0 ? ymd(-rand(1, 6)) : ymd(rand(2, 12)),
      deliveredAt: estado === "delivered" ? dia(-rand(1, 20), 12) : null,
      contentSections: completo ? informeCompleto(p.firstName) : {},
      status: estado,
    });
  }
  log(`✓ ${nInf} informes (2 vencidos, para ver las alertas de dirección)`);

  // ── 6. Coordinaciones con colegio y familia ──
  const TIPOS_COORD = ["school", "family", "orientator", "neuropediatrician", "other_therapist", "school"];
  let nCoord = 0;
  for (let i = 0; i < 6; i++) {
    const p = pacientes[i];
    const tera = equipo.find((t) => t.id === p.mainTherapistId) || terapeutas[0];
    await Coordination.create({
      id: uid(G.COORD, ++nCoord),
      coordinationType: TIPOS_COORD[i],
      coordinationDate: dia(-rand(5, 45), 16),
      relatedPatientId: p.id,
      clientId: p.clientId,
      createdById: tera.id,
      participants: pick([["Tutora del aula", "Orientadora"], ["Madre", "Padre"], ["Neuropediatra"], ["Logopeda externa"]]),
      topics: `Seguimiento de ${p.firstName}: evolución en el aula y ajuste de las pautas trabajadas en sesión.`,
      agreements: "Se acuerda mantener las adaptaciones metodológicas y revisar en un mes.",
      nextActions: "Enviar pautas por escrito al centro y revisar en la próxima reunión.",
    });
  }
  log(`✓ ${nCoord} coordinaciones`);

  // ── 7. Facturación: todos los estados que verán en pantalla ──
  const ESTADOS = [
    "paid", "paid", "paid", "paid",
    "issued", "issued", "issued",
    "sent", "sent",
    "overdue", "overdue",
    "partially_paid",
    "draft", "draft", "draft", "draft",
  ];
  let nFac = 0, nCob = 0, nSerie = 0;
  const facturas = [];
  for (let i = 0; i < ESTADOS.length; i++) {
    const estado = ESTADOS[i];
    const cliente = clientes[i % clientes.length];
    const paciente = pacientes.find((p) => p.clientId === cliente.id);
    const sesiones = rand(2, 4);
    const precio = pick([45, 50, 55, 60]);
    const base = sesiones * precio;
    // Sanidad: las sesiones de terapia van exentas de IVA.
    const lineas = [{
      description: `${sesiones} sesiones de ${pick(["logopedia", "neuropsicología", "psicología", "terapia ocupacional"])} — ${paciente ? paciente.firstName : "seguimiento"}`,
      quantity: sesiones,
      unitPrice: precio,
      discountPct: 0,
      vatRate: 0,
      total: base,
    }];
    const esBorrador = estado === "draft";
    const numero = esBorrador
      ? `BORRADOR-${String(i + 1).padStart(3, "0")}`
      : `F-2026-${String(++nSerie).padStart(4, "0")}`;
    // Una factura VENCIDA tiene que tener el vencimiento ya pasado (emisión +30
    // días). Con fechas recientes salía "Vencida" con vencimiento en agosto, y
    // eso a quien lleva la contabilidad le chirría a la primera.
    const emitida = estado === "overdue" ? -rand(40, 75) : -rand(5, 28);

    const f = await Invoice.create({
      id: uid(G.FACTURA, ++nFac),
      clientId: cliente.id,
      patientId: paciente ? paciente.id : null,
      employeeId: paciente ? paciente.mainTherapistId : null,
      series: esBorrador ? "F" : "F",
      number: numero,
      status: estado,
      issueDate: ymd(emitida),
      dueDate: ymd(emitida + 30),
      paidAt: estado === "paid" ? ymd(emitida + rand(2, 20)) : null,
      lines: lineas,
      taxBase: base,
      vatAmount: 0,
      total: base,
      paidAmount: estado === "paid" ? base : estado === "partially_paid" ? Math.round(base / 2) : 0,
      subtotal: base,
      vatRate: 0,
      notes: "Servicio sanitario exento de IVA (art. 20.1.3º LIVA).",
      customFields: { formacion: true },
    });
    facturas.push(f);

    if (estado === "paid" || estado === "partially_paid") {
      await Payment.create({
        id: uid(G.COBRO, ++nCob),
        invoiceId: f.id,
        amount: estado === "paid" ? base : Math.round(base / 2),
        paidAt: dia(emitida + rand(2, 20), 12),
        method: pick(["transfer", "card", "direct_debit"]),
        status: "completed",
      });
    }
  }
  // Que la numeración real no choque con la de formación mientras convivan.
  await sequelize.query(`UPDATE "${schema}".invoice_series SET next_number = ${nSerie + 1} WHERE code = 'F'`);
  log(`✓ ${nFac} facturas (${nSerie} emitidas + borradores) y ${nCob} cobros`);

  // ── 8. Gastos del centro ──
  const GASTOS = [
    { type: "rent", category: "fixed", description: "Alquiler del local — julio", base: 1450, iva: 21 },
    { type: "salary", category: "fixed", description: "Nóminas del equipo — julio", base: 18400, iva: 0 },
    { type: "software", category: "fixed", description: "Licencias y CRM — julio", base: 89, iva: 21 },
    { type: "material", category: "variable", description: "Material de evaluación (WISC-V protocolos)", base: 320, iva: 21 },
    { type: "material", category: "variable", description: "Juegos y fichas de intervención", base: 145, iva: 21 },
    { type: "other", category: "fixed", description: "Seguro de responsabilidad civil", base: 420, iva: 0 },
    { type: "other", category: "variable", description: "Formación continua del equipo", base: 650, iva: 21 },
    { type: "software", category: "opex", description: "Teléfono e internet — julio", base: 78, iva: 21 },
  ];
  let nGas = 0;
  for (const g of GASTOS) {
    const impuesto = Math.round(g.base * g.iva) / 100;
    await Cost.create({
      id: uid(G.GASTO, ++nGas),
      type: g.type,
      category: g.category,
      description: g.description,
      taxBase: g.base,
      vatRate: g.iva,
      taxAmount: impuesto,
      total: g.base + impuesto,
      vatDeductible: g.iva > 0,
      incurredAt: ymd(-rand(3, 28)),
    });
  }
  log(`✓ ${nGas} gastos`);

  // ── 9. Proyectos internos ──
  let nProy = 0, nTar = 0;
  try {
    const PROYECTOS = [
      { name: "Apertura del grupo de habilidades sociales", tareas: ["Definir criterios de agrupación", "Preparar material de las 8 sesiones", "Informar a las familias", "Reservar sala los martes"] },
      { name: "Campaña de captación curso 2026-27", tareas: ["Actualizar la web con los servicios", "Preparar folleto para los colegios", "Reunión con orientadores de zona"] },
    ];
    // Las tareas NO tienen estado: viven en columnas de Kanban, así que hay
    // que crear el tablero o el proyecto se abre vacío.
    const { BoardColumn } = models;
    const COLUMNAS = [
      { name: "Por hacer", color: "#94a3b8", done: false },
      { name: "En curso", color: "#3b82f6", done: false },
      { name: "Hecho", color: "#22c55e", done: true },
    ];
    let nCol = 0;
    for (const pr of PROYECTOS) {
      const proyecto = await Project.create({
        id: uid(G.PROYECTO, ++nProy),
        name: pr.name,
        status: "active",
        description: "Proyecto interno del centro.",
      });
      const columnas = [];
      for (let ci = 0; ci < COLUMNAS.length; ci++) {
        columnas.push(await BoardColumn.create({
          id: uid(G.TABLERO, ++nCol),
          projectId: proyecto.id,
          name: COLUMNAS[ci].name,
          order: ci,
          color: COLUMNAS[ci].color,
          isDoneColumn: COLUMNAS[ci].done,
        }));
      }
      for (let ti = 0; ti < pr.tareas.length; ti++) {
        await Task.create({
          id: uid(G.TAREA, ++nTar),
          projectId: proyecto.id,
          boardColumnId: columnas[ti % columnas.length].id,
          title: pr.tareas[ti],
          order: ti,
          assigneeId: null,
        });
      }
    }
    log(`✓ ${nProy} proyectos con ${nTar} tareas en ${nCol} columnas`);
  } catch (err) {
    log(`· proyectos: se saltan (${err.message.split("\n")[0]})`);
  }

  header("Listo. Todo lleva id f0f0f0f0-… y se quita con --borrar.");
  log("NO se han tocado: equipo, leads, tipos de cita ni la configuración.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
