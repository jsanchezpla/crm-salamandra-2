/**
 * Modo DEMO de la IA de Proyectos (sin coste, sin clave, sin API real).
 *
 * La demo pública enseña la IA en modo SIMULADO (demoForcesFakeAi, mismo
 * patrón que lib/support/ai.js): respuestas deterministas, plausibles y en
 * español, construidas a partir del prompt/instrucción y de los datos reales
 * del tenant. Las salidas respetan el mismo contrato que la IA real, así que
 * pasan por normalizePlan / normalizeOperations exactamente igual.
 */

function addDays(base, days) {
  const d = new Date(base.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function capitaliza(text) {
  const t = String(text ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Nombre corto derivado del prompt: primera frase, recortada con cabeza. */
function nombreDesdePrompt(prompt) {
  const limpio = String(prompt ?? "").trim().replace(/\s+/g, " ");
  const primeraFrase = limpio.split(/[.\n!?;]/)[0].trim();
  let nombre = primeraFrase || "Proyecto de ejemplo";
  if (nombre.length > 80) nombre = `${nombre.slice(0, 77).trimEnd()}…`;
  return capitaliza(nombre);
}

/**
 * Plan de proyecto simulado: 3 fases con 3-4 tareas cada una, checklist en
 * las primeras, 2 hitos y asignaciones rotando entre los miembros recibidos.
 */
export function fakeProjectPlan(prompt, { teamMembers = [] } = {}) {
  const hoy = new Date();
  const ids = (Array.isArray(teamMembers) ? teamMembers : []).map((m) => m.id);
  const rota = (i) => (ids.length > 0 ? [ids[i % ids.length]] : []);
  let n = 0; // contador global de tareas para rotar asignados

  const tarea = (title, extra = {}) => ({
    title,
    description: extra.description ?? null,
    priority: extra.priority ?? "medium",
    estimatedHours: extra.estimatedHours ?? null,
    dueDate: extra.dueDate ?? null,
    assigneeIds: rota(n++),
    checklist: extra.checklist ?? [],
  });

  return {
    name: nombreDesdePrompt(prompt),
    description:
      "Plan generado en modo demostración a partir de tu descripción. Revisa fases, tareas y fechas antes de crear el proyecto.",
    priority: "medium",
    startDate: addDays(hoy, 0),
    dueDate: addDays(hoy, 60),
    estimatedHours: 120,
    tags: ["demo", "planificado-con-ia"],
    phases: [
      {
        name: "Preparación",
        description: "Definir el alcance, los responsables y el calendario.",
        startDate: addDays(hoy, 0),
        endDate: addDays(hoy, 14),
        tasks: [
          tarea("Reunión de arranque con el equipo", {
            priority: "high",
            estimatedHours: 2,
            dueDate: addDays(hoy, 3),
            checklist: ["Convocar a los implicados", "Repasar la descripción del proyecto", "Cerrar el calendario"],
          }),
          tarea("Definir el alcance y los entregables", {
            estimatedHours: 6,
            dueDate: addDays(hoy, 7),
            checklist: ["Listar los entregables", "Validar con el cliente"],
          }),
          tarea("Preparar el plan de trabajo detallado", {
            estimatedHours: 4,
            dueDate: addDays(hoy, 14),
            checklist: ["Desglosar tareas por fase", "Asignar responsables"],
          }),
        ],
      },
      {
        name: "Ejecución",
        description: "Desarrollo del trabajo principal del proyecto.",
        startDate: addDays(hoy, 14),
        endDate: addDays(hoy, 45),
        tasks: [
          tarea("Ejecutar el primer bloque de trabajo", { priority: "high", estimatedHours: 24, dueDate: addDays(hoy, 25) }),
          tarea("Revisión intermedia de avance", { estimatedHours: 3, dueDate: addDays(hoy, 30) }),
          tarea("Ejecutar el segundo bloque de trabajo", { estimatedHours: 24, dueDate: addDays(hoy, 40) }),
          tarea("Ajustes tras el feedback recibido", { priority: "low", estimatedHours: 8, dueDate: addDays(hoy, 45) }),
        ],
      },
      {
        name: "Cierre y entrega",
        description: "Revisión final, entrega y documentación.",
        startDate: addDays(hoy, 45),
        endDate: addDays(hoy, 60),
        tasks: [
          tarea("Control de calidad final", { priority: "high", estimatedHours: 6, dueDate: addDays(hoy, 52) }),
          tarea("Entrega y presentación de resultados", { estimatedHours: 3, dueDate: addDays(hoy, 57) }),
          tarea("Retrospectiva y documentación del cierre", { priority: "low", estimatedHours: 2, dueDate: addDays(hoy, 60) }),
        ],
      },
    ],
    milestones: [
      { name: "Plan de trabajo aprobado", dueDate: addDays(hoy, 14), phaseIndex: 0 },
      { name: "Entrega final", dueDate: addDays(hoy, 60), phaseIndex: 2 },
    ],
    members: (Array.isArray(teamMembers) ? teamMembers : [])
      .slice(0, 5)
      .map((m) => ({ teamMemberId: m.id, role: "member" })),
  };
}

/**
 * Propuesta de reorganización simulada: 3-4 operaciones seguras construidas
 * sobre el snapshot real. Devuelve { summary, operations } con el mismo
 * contrato que la IA real (se normaliza después con normalizeOperations).
 */
export function fakeEditOps(instruction, snapshot) {
  const operations = [];
  const frases = [];

  // 1. Una tarea de revisión ligada a la instrucción.
  const primeraFase = snapshot?.phases?.[0] ?? null;
  operations.push({
    op: "createTask",
    phaseId: primeraFase ? primeraFase.id : null,
    title: "Revisión general del proyecto",
    description: `Tarea propuesta en modo demostración a partir de la instrucción: «${String(instruction ?? "").trim()}».`,
    priority: "medium",
    checklist: ["Repasar las tareas pendientes", "Confirmar fechas con el equipo"],
  });
  frases.push("crear una tarea de revisión general");

  // 2. Subir la prioridad de la tarea más antigua sin asignar.
  const sinAsignar = (snapshot?.tasks ?? []).find(
    (t) => (!t.assignees || t.assignees.length === 0) && t.priority !== "urgent" && t.priority !== "high"
  );
  if (sinAsignar) {
    operations.push({ op: "updateTask", taskId: sinAsignar.id, changes: { priority: "high" } });
    frases.push(`subir la prioridad de «${sinAsignar.title}» (está sin asignar)`);
  }

  // 3. Añadir al proyecto al primer miembro del equipo que no esté ya.
  const yaMiembros = new Set((snapshot?.members ?? []).map((m) => m.teamMemberId));
  const candidato = (snapshot?.team ?? []).find((m) => !yaMiembros.has(m.id));
  if (candidato) {
    operations.push({ op: "addMember", teamMemberId: candidato.id, role: "member" });
    frases.push(`incorporar a ${candidato.name || "una persona del equipo"} como miembro`);
  }

  const summary = `Propuesta en modo demostración para «${String(instruction ?? "").trim()}»: ${frases.join(", ")}. Con una clave de IA configurada, la propuesta se adaptaría de verdad a tu instrucción.`;

  return { summary, operations };
}
