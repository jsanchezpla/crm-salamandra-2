/**
 * Prompts de la IA del módulo Proyectos (crear y reorganizar).
 *
 * Mismo patrón que el resto del CRM (outreach/soporte/clínica): pedir SOLO un
 * JSON sin markdown, en español, y normalizar la respuesta de forma defensiva
 * en el caller (parsePlan.js / editOps.js). Aquí solo se construye el texto.
 *
 * Contexto que se inyecta SIEMPRE:
 *   - La fecha de hoy (ISO, calculada en servidor) para que "en dos semanas"
 *     tenga sentido.
 *   - La lista de miembros del equipo [{ id, name, position }] para que las
 *     asignaciones usen ids reales.
 *   - El nombre del cliente si viene informado.
 */

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

function equipoComoTexto(teamMembers) {
  const list = (Array.isArray(teamMembers) ? teamMembers : []).map((m) => ({
    id: m.id,
    name: m.name ?? m.displayName ?? "",
    position: m.position ?? null,
  }));
  if (list.length === 0) return "(no hay miembros de equipo dados de alta)";
  return JSON.stringify(list);
}

/**
 * Prompts para GENERAR un proyecto completo desde un texto libre.
 * Devuelve { system, user }.
 */
export function buildGeneratePrompts({ prompt, teamMembers = [], clientName = null, today = hoyIso() }) {
  const system = `Eres un jefe de proyectos experto. A partir de la descripción del usuario, planificas un proyecto completo: fases, tareas, hitos y equipo.

Devuelve SOLO un JSON válido, sin texto alrededor, sin markdown, sin vallas de código. Todo el contenido (nombres, descripciones, checklists) en ESPAÑOL. Forma exacta:

{
  "name": "nombre del proyecto (obligatorio, máx 200 caracteres)",
  "description": "descripción breve" | null,
  "priority": "low" | "medium" | "high" | "urgent",
  "startDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "estimatedHours": número | null,
  "tags": ["etiqueta", ...],
  "phases": [
    {
      "name": "nombre de la fase",
      "description": "..." | null,
      "startDate": "YYYY-MM-DD" | null,
      "endDate": "YYYY-MM-DD" | null,
      "tasks": [
        {
          "title": "título de la tarea (máx 255)",
          "description": "..." | null,
          "priority": "low" | "medium" | "high" | "urgent",
          "estimatedHours": número | null,
          "dueDate": "YYYY-MM-DD" | null,
          "assigneeIds": ["<id de la lista de equipo>", ...],
          "checklist": ["paso 1", "paso 2", ...]
        }
      ]
    }
  ],
  "milestones": [
    { "name": "nombre del hito", "dueDate": "YYYY-MM-DD", "phaseIndex": 0 | null }
  ],
  "members": [
    { "teamMemberId": "<id de la lista de equipo>", "role": "lead" | "member" }
  ]
}

Reglas:
- Máximo 12 fases, 60 tareas en total, 15 hitos, 15 items de checklist por tarea y 10 tags.
- "dueDate" del proyecto debe ser >= "startDate" (o null).
- Los hitos SIEMPRE llevan "dueDate" (un hito sin fecha se descarta). "phaseIndex" es el índice (base 0) de la fase a la que pertenece, o null si es global.
- "assigneeIds" y "members.teamMemberId" solo pueden usar ids EXACTOS de la lista de equipo dada. Si no hay equipo, deja esos arrays vacíos.
- Reparte las tareas entre los miembros según su puesto cuando tenga sentido.
- Usa fechas coherentes con la fecha de hoy que se te da (expresiones como "en dos semanas" se calculan desde hoy).
- No inventes datos que contradigan la descripción del usuario.`;

  const partes = [
    `Fecha de hoy: ${today}`,
    `Miembros del equipo disponibles (id, name, position): ${equipoComoTexto(teamMembers)}`,
  ];
  if (clientName) partes.push(`Cliente del proyecto: ${clientName}`);
  partes.push("", "Descripción del proyecto a planificar:", String(prompt ?? "").trim());

  return { system, user: partes.join("\n") };
}

/**
 * Prompts para PROPONER operaciones de edición sobre un proyecto existente.
 * Devuelve { system, user }.
 */
export function buildEditPrompts({ instruction, snapshot, today = hoyIso() }) {
  const system = `Eres un jefe de proyectos experto. Recibes el estado actual de un proyecto y una instrucción del usuario, y propones una lista de operaciones concretas para aplicarla.

Devuelve SOLO un JSON válido, sin texto alrededor, sin markdown, sin vallas de código. Todo en ESPAÑOL. Forma exacta:

{
  "summary": "resumen en 1-3 frases de lo que propones",
  "operations": [ ...operaciones... ]
}

Operaciones soportadas (usa SOLO estas formas; los ids deben existir en el estado dado):

{ "op": "updateProject", "changes": { "name"?, "description"?, "priority"?, "startDate"?, "dueDate"?, "status"? } }
{ "op": "createPhase", "name": "...", "description"?: "...", "startDate"?: "YYYY-MM-DD", "endDate"?: "YYYY-MM-DD" }
{ "op": "updatePhase", "phaseId": "<id>", "changes": { "name"?, "description"?, "startDate"?, "endDate"? } }
{ "op": "deletePhase", "phaseId": "<id>" }
{ "op": "createTask", "phaseId": "<id>" | null, "title": "...", "description"?, "priority"?, "dueDate"?, "estimatedHours"?, "assigneeIds"?: ["<teamMemberId>"], "checklist"?: ["paso"] }
{ "op": "updateTask", "taskId": "<id>", "changes": { "title"?, "description"?, "priority"?, "dueDate"?, "estimatedHours"?, "phaseId"?, "boardColumnId"?, "assigneeIds"? } }
{ "op": "deleteTask", "taskId": "<id>" }
{ "op": "addMember", "teamMemberId": "<id>", "role": "lead" | "member" | "viewer" }
{ "op": "removeMember", "teamMemberId": "<id>" }

Reglas:
- "priority": low|medium|high|urgent. "status": draft|active|paused|completed|cancelled. Fechas "YYYY-MM-DD".
- "updateTask.changes.assigneeIds" REEMPLAZA la lista completa de asignados de la tarea.
- "assigneeIds", "addMember.teamMemberId" y "removeMember.teamMemberId" usan ids de la lista "team" del estado.
- Propón el MÍNIMO de operaciones necesario para cumplir la instrucción. No borres nada que el usuario no haya pedido borrar.
- Si la instrucción no se puede cumplir con estas operaciones, devuelve "operations": [] y explica el porqué en "summary".`;

  const user = [
    `Fecha de hoy: ${today}`,
    "",
    "Estado actual del proyecto (JSON):",
    JSON.stringify(snapshot),
    "",
    "Instrucción del usuario:",
    String(instruction ?? "").trim(),
  ].join("\n");

  return { system, user };
}
