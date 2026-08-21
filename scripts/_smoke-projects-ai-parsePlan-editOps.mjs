// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-projects-ai-parsePlan-editOps.mjs — «Crear con IA» y «Reorganizar con
 * IA» del Kanban: lo que devuelve el modelo no se cree (19/08/2026).
 *
 *   node scripts/_smoke-projects-ai-parsePlan-editOps.mjs
 *   node --test-name-pattern="normalizeOperations" scripts/_smoke-projects-ai-parsePlan-editOps.mjs
 *
 * Prueba `lib/projects/ai/parsePlan.js` (normalizePlan) y
 * `lib/projects/ai/editOps.js` (buildProjectSnapshot, normalizeOperations).
 * `loadProjectSnapshot` lee de la base y NO se prueba aquí. Como ejemplo de
 * entrada «de verdad» se usa `lib/projects/ai/fake.js`, el modo demo de la IA,
 * que promete respetar el mismo contrato que el modelo real.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * La IA de Proyectos devuelve texto, y ese texto acaba escrito en el schema del
 * tenant: un plan entero (fases, tareas, hitos, miembros) o una tanda de
 * operaciones sobre un tablero que ya existe (mover, crear, renombrar, borrar).
 * Entre el texto y la base hay DOS filtros y nada más: `normalizePlan` y
 * `normalizeOperations`. Los endpoints `/ai/create` y `/ai/apply` los vuelven a
 * pasar sobre lo que llega del navegador, contra un snapshot recién leído, así
 * que son también la frontera de seguridad (ids de OTRO proyecto, uuids que no
 * son del equipo, fechas que no existen, 4.000 tareas de golpe).
 *
 * Lo que se fija aquí es lo que DEVUELVEN: qué lanza (y con qué mensaje para
 * el usuario), qué se descarta en silencio, qué se descarta avisando, los topes
 * (12 fases, 60 tareas, 15 hitos, 15 pasos de checklist, 10 etiquetas, 200
 * tareas en el snapshot), y la etiqueta legible en español que la vista previa
 * enseña antes de aplicar. Si alguien afloja un tope o cambia un motivo, aquí
 * se ve cuál.
 *
 * Lo que hoy devuelve y NO parece lo que debería va marcado con
 * `// SOSPECHOSO`: el `it` fija la salida de hoy para que el día que se arregle
 * la prueba lo diga, en vez de callarse.
 *
 * ── POR QUÉ SE IMPORTA CON UN GANCHO ──────────────────────────────────────
 *
 * Los dos ficheros importan `lib/utils/errors.js`, que arrastra `next/server`,
 * un especificador que Node pelado no resuelve (le falta el `.js`; lo explica
 * `scripts/_abrir-lib.mjs`). Aquí se registra desde dentro ESE MISMO gancho
 * (`_abrir-lib-hooks.mjs`, que solo completa la extensión y no sustituye nada)
 * y se importan los dos módulos después: así `node scripts/…` funciona tal
 * cual y el runner no necesita una bandera especial.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { ValidationError } from "../lib/utils/errorTypes.js";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const { normalizePlan } = await import("../lib/projects/ai/parsePlan.js");
const { buildProjectSnapshot, normalizeOperations } = await import("../lib/projects/ai/editOps.js");
const { fakeProjectPlan, fakeEditOps } = await import("../lib/projects/ai/fake.js");

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const MSG_PLAN_INVALIDO = "La IA no ha devuelto un plan válido, prueba a reformular el prompt";

// Con letras a propósito: la regla de mayúsculas/minúsculas solo se ve así.
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARLOS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NADIE = "99999999-9999-4999-8999-999999999999"; // uuid bien formado, no es del equipo

const EQUIPO = [
  { id: ANA, name: "Ana", position: "Dirección" },
  { id: BEA, name: "Bea" },
  { id: CARLOS, displayName: "Carlos" }, // sin `name`: el snapshot cae a displayName
];

/** Lo que el caller carga de la base: instancias o POJOs del proyecto. */
function datosDeProyecto() {
  return {
    project: { id: "p1", name: "Web nueva", status: "active", priority: "medium" },
    phases: [
      { id: "f1", name: "Diseño", order: 0, startDate: "2026-09-01" },
      { id: "f2", name: "Desarrollo", order: 1 },
    ],
    columns: [
      { id: "c1", name: "Por hacer", order: 0 },
      { id: "c2", name: "Hecho", order: 1, isDoneColumn: 1 },
    ],
    tasks: [
      {
        id: "t1",
        title: "Maquetar portada",
        boardColumnId: "c1",
        phaseId: "f1",
        priority: "high",
        assignees: [{ teamMemberId: ANA, displayName: "Ana" }],
      },
      { id: "t2", title: "Configurar dominio", boardColumnId: "c1", phaseId: null, assignees: [] },
    ],
    members: [
      { teamMemberId: ANA, role: "lead", teamMember: { displayName: "Ana" } },
      { teamMemberId: BEA, role: "member" }, // sin include: name null
    ],
    teamMembers: EQUIPO,
  };
}

/** El snapshot tal como lo espera normalizeOperations (la forma se fija abajo). */
const SNAP = buildProjectSnapshot(datosDeProyecto());

/** Atajo: una sola operación → { op: la primera válida o null, warnings }. */
function una(rawOp, snapshot = SNAP) {
  const { operations, warnings } = normalizeOperations([rawOp], snapshot);
  return { op: operations[0] ?? null, warnings };
}

const lanzaPlanInvalido = (fn) =>
  assert.throws(fn, { name: "ValidationError", statusCode: 422, message: MSG_PLAN_INVALIDO });

/* ── normalizePlan: lo que NO es un plan ─────────────────────────────────── */

describe("normalizePlan: lo que no es un plan lanza ValidationError con el mensaje para el usuario", () => {
  it("texto que no es JSON: 422 y el mensaje de «reformula el prompt»", () => {
    lanzaPlanInvalido(() => normalizePlan("Claro, aquí tienes el plan: nombre Web, tres fases"));
    lanzaPlanInvalido(() => normalizePlan("{name: 'x'}")); // JSON con comillas simples: no vale
  });

  it("es la MISMA clase ValidationError que handleRouteError convierte en 422", () => {
    assert.throws(() => normalizePlan("no json"), ValidationError);
  });

  it("JSON que parsea pero no es un objeto: vacío, null, lista, número, texto, {} sin nombre", () => {
    for (const s of ["", "null", "[]", "42", '"texto"', "{}"])
      lanzaPlanInvalido(() => normalizePlan(s));
  });

  it("un valor que no es texto ni objeto: undefined, null, número, lista, booleano", () => {
    for (const v of [undefined, null, 42, [], true]) lanzaPlanInvalido(() => normalizePlan(v));
  });

  it("un objeto sin nombre utilizable: ausente, vacío, solo espacios o que no es texto", () => {
    lanzaPlanInvalido(() => normalizePlan({ phases: [] }));
    lanzaPlanInvalido(() => normalizePlan({ name: "" }));
    lanzaPlanInvalido(() => normalizePlan({ name: "   " }));
    lanzaPlanInvalido(() => normalizePlan({ name: 42 }));
  });

  it("texto ANTES o DESPUÉS del JSON (aunque lleve vallas) no se rescata: se pide JSON y solo JSON", () => {
    lanzaPlanInvalido(() => normalizePlan('Aquí va: {"name":"X"}'));
    lanzaPlanInvalido(() => normalizePlan('```json\n{"name":"X"}\n```\nEspero que te sirva.'));
  });
});

/* ── normalizePlan: la forma saneada ─────────────────────────────────────── */

describe("normalizePlan: vallas, forma vacía y campos sueltos", () => {
  it("las vallas ```json, ```JSON o ``` peladas se quitan, con espacios y saltos alrededor", () => {
    assert.equal(normalizePlan('```json\n{"name":"X"}\n```').name, "X");
    assert.equal(normalizePlan('```JSON\n{"name":"X"}\n```').name, "X");
    assert.equal(normalizePlan('```\n{"name":"X"}\n```').name, "X");
    assert.equal(
      normalizePlan('  \n```json  \n {"name": "  Con espacios  "} \n```  \n').name,
      "Con espacios"
    );
  });

  it("un plan con solo el nombre sale con TODOS los campos en su forma vacía", () => {
    assert.deepEqual(normalizePlan({ name: "Solo nombre" }), {
      name: "Solo nombre",
      description: null,
      priority: "medium",
      startDate: null,
      dueDate: null,
      estimatedHours: null,
      tags: [],
      phases: [],
      milestones: [],
      members: [],
    });
  });

  it("el nombre se recorta a 200 caracteres (también el de fase y el de hito); la descripción vacía es null", () => {
    const p = normalizePlan({ name: ` ${"x".repeat(250)} `, description: "   " });
    assert.equal(p.name.length, 200);
    assert.equal(p.description, null);
    assert.equal(normalizePlan({ name: "P", description: " Con texto " }).description, "Con texto");
    const largo = normalizePlan({
      name: "P",
      phases: [{ name: "f".repeat(250) }],
      milestones: [{ name: "h".repeat(250), dueDate: "2026-09-01" }],
    });
    assert.equal(largo.phases[0].name.length, 200);
    assert.equal(largo.milestones[0].name.length, 200);
  });

  it("prioridad fuera del enum (o en mayúsculas) cae a medium; la válida se queda", () => {
    assert.equal(normalizePlan({ name: "P", priority: "URGENT" }).priority, "medium");
    assert.equal(normalizePlan({ name: "P", priority: "alta" }).priority, "medium");
    assert.equal(normalizePlan({ name: "P", priority: "urgent" }).priority, "urgent");
  });

  it("etiquetas: solo textos, recortados, sin vacíos, máximo 10; si no es lista, ninguna", () => {
    const tags = ["a", " b ", "", 3, "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    assert.deepEqual(normalizePlan({ name: "P", tags }).tags, [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
    ]);
    assert.deepEqual(normalizePlan({ name: "P", tags: "demo" }).tags, []);
  });

  it("un objeto ya parseado (el plan que reenvía el navegador) da lo mismo que el texto", () => {
    const texto =
      '{"name":" P ","priority":"high","tags":["x"],"phases":[{"name":"F","tasks":[{"title":"T"}]}]}';
    assert.deepEqual(normalizePlan(JSON.parse(texto)), normalizePlan(texto));
  });

  it("pasar dos veces es pasar una: el plan saneado que vuelve del navegador a /ai/create no cambia al re-normalizarlo", () => {
    // El endpoint RE-normaliza lo que le llega del cliente. Si la segunda pasada
    // cambiara algo (una fecha anulada, un miembro que cae), lo que el usuario
    // vio en la vista previa no sería lo que se crea.
    const sucio = {
      name: " P ",
      description: " d ",
      priority: "URGENT",
      startDate: "2026-09-10",
      dueDate: "2026-09-01",
      estimatedHours: "8",
      tags: ["a", " b ", 3],
      phases: [
        { tasks: [] },
        {
          name: " A ",
          startDate: "2026-03-10",
          endDate: "2026-03-09",
          tasks: [{ title: " T ", assigneeIds: [ANA, NADIE], checklist: ["x", " "] }, null],
        },
      ],
      milestones: [{ name: "H", dueDate: "2026-09-01", phaseIndex: 0 }],
      members: [{ teamMemberId: BEA, role: "viewer" }, { teamMemberId: NADIE }],
    };
    const primera = normalizePlan(sucio, { teamMembers: EQUIPO });
    assert.deepEqual(normalizePlan(primera, { teamMembers: EQUIPO }), primera);
    // Y la primera pasada sí limpió algo (la prueba no es trivial):
    assert.equal(primera.dueDate, null);
    assert.deepEqual(primera.members, [{ teamMemberId: BEA, role: "member" }]);
  });
});

describe("normalizePlan: fechas, en el proyecto y en las fases", () => {
  it("una fecha que no existe en el calendario, con hora o con otro formato se queda en null", () => {
    const p = normalizePlan({
      name: "P",
      phases: [
        { name: "A", startDate: "2026-02-30", endDate: "2026-13-01" },
        { name: "B", startDate: "2026-03-01T00:00:00Z", endDate: "2026-3-1" },
        { name: "C", startDate: 20260301, endDate: "01/03/2026" },
      ],
    });
    assert.deepEqual(
      p.phases.map((f) => [f.startDate, f.endDate]),
      [
        [null, null],
        [null, null],
        [null, null],
      ]
    );
  });

  it("una fecha válida con espacios alrededor vale; el 29 de febrero bisiesto también", () => {
    const p = normalizePlan({
      name: "P",
      startDate: " 2026-03-01 ",
      phases: [{ name: "A", startDate: "2024-02-29" }],
    });
    assert.equal(p.startDate, "2026-03-01");
    assert.equal(p.phases[0].startDate, "2024-02-29");
  });

  it("fin antes que inicio: la fecha de fin se anula y la de inicio se queda (proyecto y fase)", () => {
    const p = normalizePlan({
      name: "P",
      startDate: "2026-09-10",
      dueDate: "2026-09-01",
      phases: [{ name: "C", startDate: "2026-03-10", endDate: "2026-03-09" }],
    });
    assert.equal(p.startDate, "2026-09-10");
    assert.equal(p.dueDate, null);
    assert.equal(p.phases[0].startDate, "2026-03-10");
    assert.equal(p.phases[0].endDate, null);
  });

  it("el mismo día de inicio y fin NO es «fin antes que inicio»", () => {
    const p = normalizePlan({ name: "P", startDate: "2026-09-01", dueDate: "2026-09-01" });
    assert.equal(p.dueDate, "2026-09-01");
  });
});

describe("normalizePlan: horas estimadas", () => {
  it("número o texto numérico ≥ 0, incluido el 0; lo demás es null", () => {
    const horas = (v) => normalizePlan({ name: "P", estimatedHours: v }).estimatedHours;
    assert.equal(horas(8), 8);
    assert.equal(horas("8"), 8);
    assert.equal(horas(" 8 "), 8);
    assert.equal(horas(2.5), 2.5);
    assert.equal(horas(0), 0);
    assert.equal(horas("8h"), null);
    assert.equal(horas(-1), null);
    assert.equal(horas(""), null);
    assert.equal(horas(null), null);
    assert.equal(horas(undefined), null);
    assert.equal(horas(Infinity), null);
    assert.equal(horas({}), null);
  });

  it("SOSPECHOSO: un booleano, una lista o un texto hexadecimal se convierten en horas por la coerción de Number", () => {
    // SOSPECHOSO: `Number(true)` es 1, `Number([])` es 0 y `Number("0x10")` es
    // 16, así que un `true`, un `[]` o un "0x10" del modelo acaban como 1 h,
    // 0 h y 16 h en vez de null. El comentario de toHours promete «número ≥ 0
    // o null; acepta strings numéricas». Se fija lo de hoy.
    const horas = (v) => normalizePlan({ name: "P", estimatedHours: v }).estimatedHours;
    assert.equal(horas(true), 1);
    assert.equal(horas(false), 0);
    assert.equal(horas([]), 0);
    assert.equal(horas([5]), 5);
    assert.equal(horas("0x10"), 16);
    assert.equal(horas("1e2"), 100);
  });
});

describe("normalizePlan: fases y tareas", () => {
  it("una fase sin nombre, o que no es un objeto, se descarta en silencio; las demás siguen", () => {
    const p = normalizePlan({ name: "P", phases: [{ tasks: [] }, null, "texto", { name: " B " }] });
    assert.deepEqual(
      p.phases.map((f) => f.name),
      ["B"]
    );
  });

  it("máximo 12 fases: la 13 se pierde, y el corte se hace ANTES de filtrar las sin nombre", () => {
    const trece = Array.from({ length: 13 }, (_, i) => ({ name: `Fase ${i + 1}` }));
    assert.equal(normalizePlan({ name: "P", phases: trece }).phases.length, 12);
    // Si la primera no tiene nombre, solo quedan 11 de las 13 (se cortó a 12 y luego se filtró una).
    const conHueco = [{ tasks: [] }, ...trece];
    assert.equal(normalizePlan({ name: "P", phases: conHueco }).phases.length, 11);
  });

  it("una fase vale aunque no traiga tareas: tasks sale como lista vacía", () => {
    assert.deepEqual(normalizePlan({ name: "P", phases: [{ name: "A" }] }).phases, [
      { name: "A", description: null, startDate: null, endDate: null, tasks: [] },
    ]);
  });

  it("una tarea completa sale saneada: título recortado, asignados filtrados, checklist a 15", () => {
    const p = normalizePlan(
      {
        name: "P",
        phases: [
          {
            name: "A",
            description: "  ",
            tasks: [
              {
                title: "  T  ",
                description: " d ",
                priority: "urgent",
                estimatedHours: "8",
                dueDate: "2026-09-01",
                assigneeIds: [ANA, ANA, NADIE, 5, ` ${BEA} `],
                checklist: Array.from({ length: 17 }, (_, i) => (i === 3 ? "  " : `c${i}`)),
              },
            ],
          },
        ],
      },
      { teamMembers: EQUIPO }
    );
    assert.deepEqual(p.phases[0], {
      name: "A",
      description: null,
      startDate: null,
      endDate: null,
      tasks: [
        {
          title: "T",
          description: "d",
          priority: "urgent",
          estimatedHours: 8,
          dueDate: "2026-09-01",
          assigneeIds: [ANA, BEA],
          checklist: [
            "c0",
            "c1",
            "c2",
            "c4",
            "c5",
            "c6",
            "c7",
            "c8",
            "c9",
            "c10",
            "c11",
            "c12",
            "c13",
            "c14",
            "c15",
          ],
        },
      ],
    });
  });

  it("una tarea con solo título sale con los demás campos en su forma vacía", () => {
    const [f] = normalizePlan({
      name: "P",
      phases: [{ name: "A", tasks: [{ title: "Sola" }] }],
    }).phases;
    assert.deepEqual(f.tasks[0], {
      title: "Sola",
      description: null,
      priority: "medium",
      estimatedHours: null,
      dueDate: null,
      assigneeIds: [],
      checklist: [],
    });
  });

  it("una tarea sin título, o que no es objeto, se descarta en silencio; el título se corta a 255", () => {
    const [f] = normalizePlan({
      name: "P",
      phases: [
        {
          name: "A",
          tasks: [{ title: "" }, { title: "  " }, null, "texto", { title: "x".repeat(300) }],
        },
      ],
    }).phases;
    assert.equal(f.tasks.length, 1);
    assert.equal(f.tasks[0].title.length, 255);
  });

  it("tope GLOBAL de 60 tareas: las que sobran se pierden aunque estén en otra fase, y la fase se queda vacía", () => {
    const cincuentaYNueve = Array.from({ length: 59 }, (_, j) => ({ title: `T${j}` }));
    const p = normalizePlan({
      name: "P",
      phases: [
        // 59 válidas + una en blanco (no cuenta) + 2 más = 61 válidas: entra hasta T59
        {
          name: "A",
          tasks: [...cincuentaYNueve, { title: " " }, { title: "T59" }, { title: "T60" }],
        },
        { name: "B", tasks: [{ title: "X" }] },
      ],
    });
    assert.equal(p.phases[0].tasks.length, 60);
    assert.equal(p.phases[0].tasks.at(-1).title, "T59");
    assert.deepEqual(p.phases[1], {
      name: "B",
      description: null,
      startDate: null,
      endDate: null,
      tasks: [],
    });
  });
});

describe("normalizePlan: asignados y miembros se filtran contra el equipo", () => {
  it("un uuid bien formado que no es del equipo se va en silencio; sin equipo, nadie", () => {
    const plan = {
      name: "P",
      phases: [{ name: "A", tasks: [{ title: "T", assigneeIds: [NADIE, ANA] }] }],
    };
    assert.deepEqual(normalizePlan(plan, { teamMembers: EQUIPO }).phases[0].tasks[0].assigneeIds, [
      ANA,
    ]);
    assert.deepEqual(normalizePlan(plan).phases[0].tasks[0].assigneeIds, []);
    assert.deepEqual(
      normalizePlan(plan, { teamMembers: "no es lista" }).phases[0].tasks[0].assigneeIds,
      []
    );
  });

  it("el mismo uuid en MAYÚSCULAS casa con el equipo, y lo que sale es el id de la base (en minúsculas)", () => {
    // Hasta el 21/08/2026 se perdía: UUID_RE lleva /i, pero la comprobación
    // contra el equipo era exacta, así que un id que el modelo devolviera en
    // mayúsculas —copia los del prompt y no garantiza la caja— se descartaba
    // como si fuera de otro. Y sin un solo warning: el plan salía sin asignar
    // y no había forma de saber por qué. Lo que se devuelve es el id CANÓNICO,
    // no el que escribió el modelo: es lo que acaba en la FK.
    const p = normalizePlan(
      {
        name: "P",
        phases: [{ name: "A", tasks: [{ title: "T", assigneeIds: [ANA.toUpperCase(), BEA] }] }],
        members: [{ teamMemberId: ANA.toUpperCase(), role: "lead" }],
      },
      { teamMembers: EQUIPO }
    );
    assert.deepEqual(p.phases[0].tasks[0].assigneeIds, [ANA, BEA]);
    assert.deepEqual(p.members, [{ teamMemberId: ANA, role: "lead" }]);

    // Y sigue sin colar a quien no es del equipo, esté en la caja que esté.
    const q = normalizePlan(
      {
        name: "P",
        phases: [{ name: "A", tasks: [{ title: "T", assigneeIds: [NADIE.toUpperCase()] }] }],
        members: [{ teamMemberId: NADIE.toUpperCase() }],
      },
      { teamMembers: EQUIPO }
    );
    assert.deepEqual(q.phases[0].tasks[0].assigneeIds, []);
    assert.deepEqual(q.members, []);
  });

  it("el mismo uuid dos veces en distinta caja cuenta como una sola persona", () => {
    const p = normalizePlan(
      {
        name: "P",
        phases: [{ name: "A", tasks: [{ title: "T", assigneeIds: [ANA, ANA.toUpperCase()] }] }],
        members: [
          { teamMemberId: ANA, role: "lead" },
          { teamMemberId: ANA.toUpperCase(), role: "member" },
        ],
      },
      { teamMembers: EQUIPO }
    );
    assert.deepEqual(p.phases[0].tasks[0].assigneeIds, [ANA]);
    assert.deepEqual(p.members, [{ teamMemberId: ANA, role: "lead" }]);
  });

  it("miembros: sin duplicados (gana el primero), role lead o member («viewer» cae a member), con espacios", () => {
    const p = normalizePlan(
      {
        name: "P",
        members: [
          { teamMemberId: ANA, role: "lead" },
          { teamMemberId: ANA, role: "member" },
          { teamMemberId: BEA, role: "viewer" },
          { teamMemberId: NADIE },
          { teamMemberId: "no-es-uuid" },
          { teamMemberId: ` ${CARLOS} ` },
          null,
        ],
      },
      { teamMembers: EQUIPO }
    );
    assert.deepEqual(p.members, [
      { teamMemberId: ANA, role: "lead" },
      { teamMemberId: BEA, role: "member" },
      { teamMemberId: CARLOS, role: "member" },
    ]);
  });
});

describe("normalizePlan: hitos", () => {
  it("sin nombre o sin fecha válida se descarta (la fecha es obligatoria); lo que no es objeto, también", () => {
    const p = normalizePlan({
      name: "P",
      milestones: [
        { name: "sin fecha" },
        { name: "fecha mala", dueDate: "2026-02-30" },
        { name: "", dueDate: "2026-09-01" },
        null,
        "texto",
        { name: " Vale ", dueDate: "2026-09-01" },
      ],
    });
    assert.deepEqual(p.milestones, [{ name: "Vale", dueDate: "2026-09-01", phaseIndex: null }]);
  });

  it("phaseIndex solo vale si es un entero dentro de las fases que quedaron; si no, null", () => {
    const p = normalizePlan({
      name: "P",
      phases: [{ name: "A" }, { name: "B" }],
      milestones: [
        { name: "idx -1", dueDate: "2026-09-01", phaseIndex: -1 },
        { name: "idx 2", dueDate: "2026-09-01", phaseIndex: 2 },
        { name: "idx 1.5", dueDate: "2026-09-01", phaseIndex: 1.5 },
        { name: "idx '1'", dueDate: "2026-09-01", phaseIndex: "1" },
        { name: "idx 0", dueDate: "2026-09-01", phaseIndex: 0 },
        { name: "idx 1", dueDate: "2026-09-01", phaseIndex: 1 },
      ],
    });
    assert.deepEqual(
      p.milestones.map((m) => [m.name, m.phaseIndex]),
      [
        ["idx -1", null],
        ["idx 2", null],
        ["idx 1.5", null],
        ["idx '1'", null],
        ["idx 0", 0],
        ["idx 1", 1],
      ]
    );
  });

  it("máximo 15 hitos: el 16 se pierde", () => {
    const dieciseis = Array.from({ length: 16 }, (_, i) => ({
      name: `H${i}`,
      dueDate: "2026-09-01",
    }));
    assert.equal(normalizePlan({ name: "P", milestones: dieciseis }).milestones.length, 15);
  });

  it("si una fase anterior se descartó por no tener nombre, el phaseIndex de los hitos se traduce y cada uno sigue en la suya", () => {
    // Hasta el 21/08/2026 el índice se comparaba contra la lista YA filtrada:
    // con phases [sin nombre, B, C] el hito de B (índice 1) acababa colgado de
    // C y el de C (índice 2) se perdía. No era un descarte visible: era un hito
    // bien formado, en la fase equivocada, guardado en la base. Ahora el índice
    // que escribió el modelo se traduce al de la lista resultante.
    const p = normalizePlan({
      name: "P",
      phases: [{ tasks: [] }, { name: "B" }, { name: "C" }],
      milestones: [
        { name: "de B", dueDate: "2026-09-01", phaseIndex: 1 },
        { name: "de C", dueDate: "2026-09-01", phaseIndex: 2 },
      ],
    });
    assert.deepEqual(
      p.phases.map((f) => f.name),
      ["B", "C"]
    );
    assert.deepEqual(
      p.milestones.map((m) => [m.name, m.phaseIndex]),
      [
        ["de B", 0], // «B» quedó la primera
        ["de C", 1],
      ]
    );
  });

  it("un hito que apuntaba a la fase descartada se queda sin fase, no se cuelga de la de al lado", () => {
    const p = normalizePlan({
      name: "P",
      phases: [{ name: "A" }, { tasks: [] }, { name: "C" }],
      milestones: [
        { name: "de la que no está", dueDate: "2026-09-01", phaseIndex: 1 },
        { name: "de C", dueDate: "2026-09-01", phaseIndex: 2 },
        { name: "de A", dueDate: "2026-09-01", phaseIndex: 0 },
      ],
    });
    assert.deepEqual(
      p.phases.map((f) => f.name),
      ["A", "C"]
    );
    assert.deepEqual(
      p.milestones.map((m) => [m.name, m.phaseIndex]),
      [
        ["de la que no está", null],
        ["de C", 1],
        ["de A", 0],
      ]
    );
  });
});

describe("normalizePlan: el plan del modo demo (fake.js) pasa sin perder nada", () => {
  it("el plan simulado sale IDÉNTICO tras normalizar: 3 fases, 10 tareas, 2 hitos, un miembro por persona", () => {
    const plan = fakeProjectPlan("Lanzar la web nueva. Con tienda.", { teamMembers: EQUIPO });
    const saneado = normalizePlan(plan, { teamMembers: EQUIPO });
    assert.deepEqual(saneado, plan);
    assert.equal(saneado.name, "Lanzar la web nueva");
    assert.equal(saneado.phases.length, 3);
    assert.equal(
      saneado.phases.reduce((s, f) => s + f.tasks.length, 0),
      10
    );
    assert.equal(saneado.milestones.length, 2);
    assert.deepEqual(
      saneado.members.map((m) => m.teamMemberId),
      [ANA, BEA, CARLOS]
    );
    assert.ok(saneado.startDate <= saneado.dueDate);
  });

  it("sin equipo, el plan simulado no asigna a nadie y sigue pasando", () => {
    const saneado = normalizePlan(fakeProjectPlan("", {}));
    assert.equal(saneado.name, "Proyecto de ejemplo");
    assert.deepEqual(saneado.members, []);
    for (const f of saneado.phases) for (const t of f.tasks) assert.deepEqual(t.assigneeIds, []);
  });
});

/* ── buildProjectSnapshot ────────────────────────────────────────────────── */

describe("buildProjectSnapshot: lo justo para el prompt, con esta forma exacta", () => {
  it("ids, nombres y poco más; nombres de columna y fase resueltos en cada tarea", () => {
    assert.deepEqual(SNAP, {
      project: {
        id: "p1",
        name: "Web nueva",
        description: null,
        status: "active",
        priority: "medium",
        startDate: null,
        dueDate: null,
      },
      phases: [
        { id: "f1", name: "Diseño", order: 0, startDate: "2026-09-01", endDate: null },
        { id: "f2", name: "Desarrollo", order: 1, startDate: null, endDate: null },
      ],
      columns: [
        { id: "c1", name: "Por hacer", order: 0, isDoneColumn: false },
        { id: "c2", name: "Hecho", order: 1, isDoneColumn: true }, // el 1 se fuerza a booleano
      ],
      tasks: [
        {
          id: "t1",
          title: "Maquetar portada",
          columnId: "c1",
          column: "Por hacer",
          phaseId: "f1",
          phase: "Diseño",
          priority: "high",
          dueDate: null,
          assignees: ["Ana"],
          assigneeIds: [ANA],
        },
        {
          id: "t2",
          title: "Configurar dominio",
          columnId: "c1",
          column: "Por hacer",
          phaseId: null,
          phase: null,
          priority: "medium", // sin prioridad → medium
          dueDate: null,
          assignees: [],
          assigneeIds: [],
        },
      ],
      members: [
        { teamMemberId: ANA, name: "Ana", role: "lead" },
        { teamMemberId: BEA, name: null, role: "member" },
      ],
      team: [
        { id: ANA, name: "Ana", position: "Dirección" },
        { id: BEA, name: "Bea", position: null },
        { id: CARLOS, name: "Carlos", position: null },
      ],
    });
  });

  it("si el proyecto trae toJSON (una instancia), se usa lo que devuelve", () => {
    const project = {
      id: "ignorado",
      toJSON: () => ({
        id: "p2",
        name: "Desde toJSON",
        status: "draft",
        priority: "low",
        startDate: "2026-01-01",
      }),
    };
    assert.deepEqual(buildProjectSnapshot({ project }).project, {
      id: "p2",
      name: "Desde toJSON",
      description: null,
      status: "draft",
      priority: "low",
      startDate: "2026-01-01",
      dueDate: null,
    });
  });

  it("solo con el proyecto, las listas salen vacías y no revienta", () => {
    const s = buildProjectSnapshot({ project: { id: "p" } });
    assert.deepEqual([s.phases, s.columns, s.tasks, s.members, s.team], [[], [], [], [], []]);
  });

  it("una tarea cuya columna o fase ya no existe conserva el id pero el nombre sale null", () => {
    const s = buildProjectSnapshot({
      project: { id: "p" },
      tasks: [{ id: "t", title: "Huérfana", boardColumnId: "c-borrada", phaseId: "f-borrada" }],
    });
    assert.equal(s.tasks[0].columnId, "c-borrada");
    assert.equal(s.tasks[0].column, null);
    assert.equal(s.tasks[0].phaseId, "f-borrada");
    assert.equal(s.tasks[0].phase, null);
  });

  it("asignados: el nombre sale de displayName y el id de teamMemberId (o id si no hay)", () => {
    const s = buildProjectSnapshot({
      project: { id: "p" },
      tasks: [
        {
          id: "t",
          title: "T",
          assignees: [{ id: BEA, displayName: "Bea" }, { teamMemberId: ANA }],
        },
      ],
    });
    assert.deepEqual(s.tasks[0].assignees, ["Bea"]);
    assert.deepEqual(s.tasks[0].assigneeIds, [BEA, ANA]);
  });

  it("200 tareas pasan; 201 lanzan ValidationError diciendo cuántas hay y el máximo", () => {
    const tareas = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `T${i}` }));
    assert.equal(
      buildProjectSnapshot({ project: { id: "p" }, tasks: tareas(200) }).tasks.length,
      200
    );
    assert.throws(() => buildProjectSnapshot({ project: { id: "p" }, tasks: tareas(201) }), {
      name: "ValidationError",
      statusCode: 422,
      message: /201 tareas.*máximo de 200/,
    });
  });
});

/* ── normalizeOperations: la forma de la propuesta ───────────────────────── */

describe("normalizeOperations: la forma de la propuesta", () => {
  it("acepta una lista o un objeto { operations }; cualquier otra cosa da un aviso y ninguna operación", () => {
    const ok1 = normalizeOperations([{ op: "createPhase", name: "X" }], SNAP);
    const ok2 = normalizeOperations(
      { summary: "…", operations: [{ op: "createPhase", name: "X" }] },
      SNAP
    );
    assert.deepEqual(ok1, ok2);
    assert.equal(ok1.operations.length, 1);
    for (const raro of [
      null,
      undefined,
      {},
      "texto",
      42,
      { operations: "x" },
      { operations: null },
    ]) {
      assert.deepEqual(normalizeOperations(raro, SNAP), {
        operations: [],
        warnings: ["La propuesta no contiene una lista de operaciones."],
      });
    }
  });

  it("una lista vacía no es un error: cero operaciones y cero avisos", () => {
    assert.deepEqual(normalizeOperations([], SNAP), { operations: [], warnings: [] });
  });

  it("una entrada que no es objeto o sin `op` de texto se descarta como «desconocida»", () => {
    const { operations, warnings } = normalizeOperations([null, "texto", {}, { op: 5 }], SNAP);
    assert.deepEqual(operations, []);
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «desconocida»: no tiene una forma reconocible",
      "Se ha descartado una operación «desconocida»: no tiene una forma reconocible",
      "Se ha descartado una operación «desconocida»: no tiene una forma reconocible",
      "Se ha descartado una operación «5»: no tiene una forma reconocible", // un op numérico pinta su valor
    ]);
  });

  it("un tipo de operación que no existe (p. ej. «moveTask») se descarta avisando", () => {
    assert.deepEqual(una({ op: "moveTask", taskId: "t1" }).warnings, [
      "Se ha descartado una operación «moveTask»: tipo de operación no soportado",
    ]);
  });

  it("con un snapshot sin listas ({}) no revienta: crear una fase sigue valiendo", () => {
    assert.deepEqual(normalizeOperations([{ op: "createPhase", name: "X" }], {}), {
      operations: [
        {
          op: "createPhase",
          name: "X",
          phaseDescription: null,
          startDate: null,
          endDate: null,
          description: "Crear la fase «X»",
        },
      ],
      warnings: [],
    });
  });

  it("válidas e inválidas mezcladas: las válidas salen en su orden, los avisos en el suyo", () => {
    const { operations, warnings } = normalizeOperations(
      [
        { op: "deleteTask", taskId: "t2" },
        { op: "deleteTask", taskId: "no-existe" },
        { op: "createPhase", name: "Cierre" },
        { op: "updatePhase", phaseId: "f9", changes: { name: "X" } },
      ],
      SNAP
    );
    assert.deepEqual(
      operations.map((o) => o.op),
      ["deleteTask", "createPhase"]
    );
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «deleteTask»: la tarea indicada no existe en el proyecto",
      "Se ha descartado una operación «updatePhase»: la fase indicada no existe en el proyecto",
    ]);
  });

  it("la salida es la forma canónica: los campos extra del raw no se cuelan", () => {
    const { op } = una({ op: "deleteTask", taskId: "t1", motivo: "porque sí", force: true });
    assert.deepEqual(op, {
      op: "deleteTask",
      taskId: "t1",
      description: "Eliminar la tarea «Maquetar portada»",
    });
  });

  it("pasar dos veces es pasar una: las operaciones válidas, re-validadas en /ai/apply contra el mismo snapshot, salen idénticas y sin avisos", () => {
    // Una de cada tipo, con lo que el modelo suele ensuciar (espacios, enums
    // malos, un uuid que no es del equipo, una descripción en blanco). La
    // primera pasada limpia; la segunda —lo que el navegador devuelve— no
    // puede cambiar nada, o lo aplicado no sería lo que enseñó la vista previa.
    const raw = [
      {
        op: "updateProject",
        changes: { name: " N ", priority: "high", status: "paused", description: " " },
      },
      { op: "createPhase", name: " Cierre ", description: "Lo que hace", startDate: "2026-10-01" },
      { op: "updatePhase", phaseId: "f1", changes: { name: " Diseño UX ", description: "" } },
      { op: "deletePhase", phaseId: "f2" },
      {
        op: "createTask",
        phaseId: "f2",
        title: " Probar ",
        description: " Qué ",
        priority: "alta",
        estimatedHours: "3",
        assigneeIds: [ANA, CARLOS, NADIE],
        checklist: ["a", " ", "b"],
      },
      {
        op: "updateTask",
        taskId: "t2",
        changes: { priority: "high", boardColumnId: "c2", phaseId: "f1", assigneeIds: [ANA, BEA] },
      },
      { op: "updateTask", taskId: "t1", changes: { phaseId: null, assigneeIds: [] } },
      { op: "deleteTask", taskId: "t1" },
      { op: "addMember", teamMemberId: CARLOS, role: "viewer" },
      { op: "removeMember", teamMemberId: BEA },
    ];
    const primera = normalizeOperations(raw, SNAP);
    assert.deepEqual(primera.warnings, []);
    assert.equal(primera.operations.length, raw.length);
    assert.deepEqual(normalizeOperations(primera.operations, SNAP), primera);
  });
});

/* ── updateProject ───────────────────────────────────────────────────────── */

describe("normalizeOperations · updateProject", () => {
  it("nombre (recortado a 200), prioridad y estado del enum, fechas: salen en changes con su etiqueta", () => {
    const { op, warnings } = una({
      op: "updateProject",
      changes: {
        name: ` ${"N".repeat(210)} `,
        priority: "high",
        status: "paused",
        startDate: "2026-09-01",
        dueDate: "2026-12-31",
      },
    });
    assert.deepEqual(warnings, []);
    assert.equal(op.changes.name.length, 200);
    assert.deepEqual(
      { ...op.changes, name: undefined },
      {
        name: undefined,
        priority: "high",
        status: "paused",
        startDate: "2026-09-01",
        dueDate: "2026-12-31",
      }
    );
    assert.match(
      op.description,
      /^Actualizar el proyecto: nombre → «N+», prioridad → Alta, estado → paused, fecha de inicio → 2026-09-01, fecha límite → 2026-12-31$/
    );
  });

  it("campos fuera del enum o vacíos se ignoran uno a uno; si no queda nada, la operación se descarta", () => {
    const { op, warnings } = una({
      op: "updateProject",
      changes: { name: "  ", priority: "alta", status: "done", estimatedHours: 10 },
    });
    assert.equal(op, null);
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «updateProject»: no incluye ningún cambio válido",
    ]);
    assert.equal(una({ op: "updateProject" }).op, null); // sin changes
    assert.equal(una({ op: "updateProject", changes: "texto" }).op, null);
  });

  it("description vacía cuenta como cambio: la deja en null («nueva descripción»)", () => {
    const { op } = una({ op: "updateProject", changes: { description: "  " } });
    assert.deepEqual(op.changes, { description: null });
    assert.equal(op.description, "Actualizar el proyecto: nueva descripción");
  });

  it("una fecha inválida o una descripción que no es texto se IGNORAN avisando (no borran lo que había); solo null explícito quita", () => {
    // Arreglado el 19/08/2026: `startDate: "el lunes que viene"` entraba en
    // changes como null y la vista previa decía «sin fecha». El modelo quería
    // PONER, no quitar: ahora se ignora el campo avisando, como priority/status.
    const { op, warnings } = una({
      op: "updateProject",
      changes: { startDate: "el lunes que viene", description: 42 },
    });
    assert.equal(op, null);
    assert.deepEqual(warnings, [
      "Al actualizar el proyecto se ha ignorado el campo «descripción»: no es texto",
      "Al actualizar el proyecto se ha ignorado el campo «fecha de inicio»: no es una fecha válida (AAAA-MM-DD)",
      "Se ha descartado una operación «updateProject»: no incluye ningún cambio válido",
    ]);
    // Un campo inválido junto a uno válido: el válido entra, el otro se avisa.
    const mixto = una({
      op: "updateProject",
      changes: { dueDate: "2026-12-31", startDate: "" },
    });
    assert.deepEqual(mixto.op.changes, { dueDate: "2026-12-31" });
    assert.deepEqual(mixto.warnings, [
      "Al actualizar el proyecto se ha ignorado el campo «fecha de inicio»: no es una fecha válida (AAAA-MM-DD)",
    ]);
    // null EXPLÍCITO sí quita, sin aviso: la vista previa dice «sin fecha».
    const quita = una({
      op: "updateProject",
      changes: { startDate: null, dueDate: "2026-09-01", description: null },
    });
    assert.deepEqual(quita.warnings, []);
    assert.deepEqual(quita.op.changes, {
      description: null,
      startDate: null,
      dueDate: "2026-09-01",
    });
    assert.equal(
      quita.op.description,
      "Actualizar el proyecto: nueva descripción, fecha de inicio → sin fecha, fecha límite → 2026-09-01"
    );
  });
});

/* ── createPhase / updatePhase / deletePhase ─────────────────────────────── */

describe("normalizeOperations · createPhase", () => {
  it("sin nombre se descarta con su motivo", () => {
    assert.deepEqual(una({ op: "createPhase", name: "  " }).warnings, [
      "Se ha descartado una operación «createPhase»: la fase no tiene nombre",
    ]);
  });

  it("en la primera pasada (lo que escribe el modelo) `description` es la descripción DE LA FASE", () => {
    const { op } = una({
      op: "createPhase",
      name: " Cierre ",
      description: "Lo que hace la fase",
      startDate: "2026-10-01",
      endDate: "2026-10-15",
    });
    assert.deepEqual(op, {
      op: "createPhase",
      name: "Cierre",
      phaseDescription: "Lo que hace la fase",
      startDate: "2026-10-01",
      endDate: "2026-10-15",
      description: "Crear la fase «Cierre»",
    });
  });

  it("en la re-validación de /ai/apply manda `phaseDescription` aunque sea null: la etiqueta no se cuela como descripción", () => {
    const { op } = una({
      op: "createPhase",
      name: "Cierre",
      phaseDescription: null,
      description: "Crear la fase «Cierre»",
    });
    assert.equal(op.phaseDescription, null);
    const otra = una({
      op: "createPhase",
      name: "Cierre",
      phaseDescription: " De verdad ",
      description: "Crear la fase «Cierre»",
    });
    assert.equal(otra.op.phaseDescription, "De verdad");
  });

  it("fin antes que inicio anula el fin; fechas que no existen, null", () => {
    assert.deepEqual(
      [
        una({ op: "createPhase", name: "X", startDate: "2026-10-10", endDate: "2026-10-01" }).op,
        una({ op: "createPhase", name: "X", startDate: "2026-02-30", endDate: "mañana" }).op,
      ].map((o) => [o.startDate, o.endDate]),
      [
        ["2026-10-10", null],
        [null, null],
      ]
    );
  });
});

describe("normalizeOperations · updatePhase / deletePhase", () => {
  it("una fase que no está en el snapshot se descarta (es la frontera: ids de otro proyecto no pasan)", () => {
    assert.deepEqual(
      una({ op: "updatePhase", phaseId: "f-de-otro", changes: { name: "X" } }).warnings,
      ["Se ha descartado una operación «updatePhase»: la fase indicada no existe en el proyecto"]
    );
    assert.deepEqual(una({ op: "deletePhase", phaseId: "f-de-otro" }).warnings, [
      "Se ha descartado una operación «deletePhase»: la fase indicada no existe en el proyecto",
    ]);
    assert.equal(una({ op: "updatePhase", changes: { name: "X" } }).op, null); // sin phaseId
  });

  it("renombrar y fechar una fase: la etiqueta lleva el nombre ACTUAL de la fase y los cambios", () => {
    const { op } = una({
      op: "updatePhase",
      phaseId: "f1",
      changes: { name: " Diseño UX ", description: "", endDate: "2026-09-30" },
    });
    assert.deepEqual(op, {
      op: "updatePhase",
      phaseId: "f1",
      changes: { name: "Diseño UX", description: null, endDate: "2026-09-30" },
      description:
        "Actualizar la fase «Diseño»: nombre → «Diseño UX», nueva descripción, fecha de fin → 2026-09-30",
    });
  });

  it("sin ningún cambio válido (nombre vacío, campo desconocido) se descarta", () => {
    const { op, warnings } = una({
      op: "updatePhase",
      phaseId: "f1",
      changes: { name: "", color: "rojo" },
    });
    assert.equal(op, null);
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «updatePhase»: no incluye ningún cambio válido",
    ]);
  });

  it("borrar una fase avisa en la etiqueta de que sus tareas quedan sin fase", () => {
    assert.deepEqual(una({ op: "deletePhase", phaseId: "f2" }).op, {
      op: "deletePhase",
      phaseId: "f2",
      description: "Eliminar la fase «Desarrollo» (sus tareas quedan sin fase)",
    });
  });
});

/* ── createTask ──────────────────────────────────────────────────────────── */

describe("normalizeOperations · createTask", () => {
  it("sin título se descarta; con phaseId null vale «sin fase»; con una fase que no existe se descarta ENTERA", () => {
    assert.deepEqual(una({ op: "createTask", phaseId: null }).warnings, [
      "Se ha descartado una operación «createTask»: la tarea no tiene título",
    ]);
    const sinFase = una({ op: "createTask", phaseId: null, title: "Suelta" }).op;
    assert.equal(sinFase.phaseId, null);
    assert.equal(sinFase.description, "Crear la tarea «Suelta»");
    assert.deepEqual(una({ op: "createTask", phaseId: "f-de-otro", title: "T" }).warnings, [
      "Se ha descartado una operación «createTask»: la fase indicada no existe en el proyecto",
    ]);
  });

  it("completa: asignados filtrados contra el EQUIPO (no solo miembros), sin duplicados; prioridad del enum; checklist limpia", () => {
    const { op, warnings } = una({
      op: "createTask",
      phaseId: "f2",
      title: " Probar el pago ",
      priority: "alta",
      dueDate: "2026-11-05",
      estimatedHours: "3",
      assigneeIds: [ANA, CARLOS, ANA, NADIE, 5, ` ${BEA} `],
      checklist: ["a", " ", 3, " b "],
    });
    assert.deepEqual(warnings, []);
    assert.deepEqual(op, {
      op: "createTask",
      phaseId: "f2",
      title: "Probar el pago",
      taskDescription: null,
      priority: "medium",
      dueDate: "2026-11-05",
      estimatedHours: 3,
      assigneeIds: [ANA, CARLOS, BEA], // Carlos no es miembro del proyecto pero sí del equipo: vale
      checklist: ["a", "b"],
      description:
        "Crear la tarea «Probar el pago» en la fase «Desarrollo», asignada a Ana, Carlos, Bea",
    });
  });

  it("los asignados en MAYÚSCULAS casan con el equipo y se guardan con el id de la base", () => {
    // El mismo fallo de caja que en addMember/removeMember, pero por la puerta
    // MUDA: aquí no hay warning que lo cuente. Antes del 21/08/2026 la tarea se
    // creaba sin nadie asignado y en la vista previa no salía el «asignada a».
    //
    // Y esto fija además que las DOS mitades del filtro sigan de acuerdo: si
    // `filtraAsignados` volviera a buscar exacto mientras el recuento de
    // «desconocidos» busca en minúsculas, un `updateTask` con el id en
    // mayúsculas dejaría `assigneeIds: []` —o sea, BORRARÍA los asignados que
    // tenía la tarea— sin un solo aviso. Peor que el fallo original.
    const creada = una({ op: "createTask", title: "T", assigneeIds: [ANA.toUpperCase()] });
    assert.deepEqual(creada.warnings, []);
    assert.deepEqual(creada.op.assigneeIds, [ANA]);
    assert.equal(creada.op.description, "Crear la tarea «T», asignada a Ana");

    const editada = una({
      op: "updateTask",
      taskId: "t1",
      changes: { assigneeIds: [ANA.toUpperCase(), ` ${BEA.toUpperCase()} `] },
    });
    assert.deepEqual(editada.warnings, []);
    assert.deepEqual(editada.op.changes.assigneeIds, [ANA, BEA]);
    assert.equal(
      editada.op.description,
      "Actualizar la tarea «Maquetar portada»: asignados → Ana, Bea"
    );

    // El mismo uuid en dos cajas es una sola persona, no dos filas de FK.
    assert.deepEqual(
      una({ op: "createTask", title: "T", assigneeIds: [ANA, ANA.toUpperCase()] }).op.assigneeIds,
      [ANA]
    );

    // Y quien no es del equipo sigue sin colar, venga en la caja que venga.
    assert.deepEqual(
      una({ op: "createTask", title: "T", assigneeIds: [NADIE.toUpperCase()] }).op.assigneeIds,
      []
    );
  });

  it("la checklist se corta a 15 pasos", () => {
    const { op } = una({
      op: "createTask",
      title: "T",
      checklist: Array.from({ length: 20 }, (_, i) => `p${i}`),
    });
    assert.equal(op.checklist.length, 15);
  });

  it("`description` del modelo es la descripción DE LA TAREA; en la re-validación manda `taskDescription`", () => {
    const primera = una({ op: "createTask", title: "T", description: " Qué hay que hacer " }).op;
    assert.equal(primera.taskDescription, "Qué hay que hacer");
    const segunda = una({
      op: "createTask",
      title: "T",
      taskDescription: null,
      description: "Crear la tarea «T»",
    }).op;
    assert.equal(segunda.taskDescription, null);
  });

  it("SOSPECHOSO: phaseId «» (cadena vacía) no cuenta como «sin fase» y tira la tarea entera", () => {
    // SOSPECHOSO: solo null/undefined significan «sin fase»; un "" del modelo
    // (plausible en un JSON generado) se busca como id, no existe, y la tarea
    // se descarta con «la fase indicada no existe». Se fija lo de hoy.
    const { op, warnings } = una({ op: "createTask", phaseId: "", title: "T" });
    assert.equal(op, null);
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «createTask»: la fase indicada no existe en el proyecto",
    ]);
  });
});

/* ── updateTask ──────────────────────────────────────────────────────────── */

describe("normalizeOperations · updateTask (mover, renombrar, reasignar)", () => {
  it("una tarea que no está en el snapshot se descarta", () => {
    assert.deepEqual(
      una({ op: "updateTask", taskId: "t-de-otro", changes: { priority: "high" } }).warnings,
      ["Se ha descartado una operación «updateTask»: la tarea indicada no existe en el proyecto"]
    );
  });

  it("mover de columna y de fase, subir prioridad y reasignar: changes canónicos y etiqueta con los NOMBRES", () => {
    const { op, warnings } = una({
      op: "updateTask",
      taskId: "t2",
      changes: { priority: "high", boardColumnId: "c2", phaseId: "f1", assigneeIds: [ANA, BEA] },
    });
    assert.deepEqual(warnings, []);
    assert.deepEqual(op, {
      op: "updateTask",
      taskId: "t2",
      changes: { priority: "high", phaseId: "f1", boardColumnId: "c2", assigneeIds: [ANA, BEA] },
      description:
        "Actualizar la tarea «Configurar dominio»: prioridad → Alta, fase → «Diseño», columna → «Hecho», asignados → Ana, Bea",
    });
  });

  it("renombrar: título recortado a 255; título vacío se ignora", () => {
    const { op } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { title: ` ${"T".repeat(300)} ` },
    });
    assert.equal(op.changes.title.length, 255);
    assert.equal(una({ op: "updateTask", taskId: "t1", changes: { title: "   " } }).op, null);
  });

  it("phaseId null quita la fase («sin fase») y assigneeIds [] deja la tarea sin nadie («sin asignados»)", () => {
    const { op } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { phaseId: null, assigneeIds: [] },
    });
    assert.deepEqual(op.changes, { phaseId: null, assigneeIds: [] });
    assert.equal(op.description, "Actualizar la tarea «Maquetar portada»: sin fase, sin asignados");
  });

  it("una fase o una columna que no existen se IGNORAN (no se descarta la op); si no queda nada, se descarta", () => {
    const { op } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { phaseId: "f9", boardColumnId: "c9", priority: "low" },
    });
    assert.deepEqual(op.changes, { priority: "low" });
    const { op: nada, warnings } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { phaseId: "f9", boardColumnId: "c9" },
    });
    assert.equal(nada, null);
    assert.deepEqual(warnings, [
      "Se ha descartado una operación «updateTask»: no incluye ningún cambio válido",
    ]);
  });

  it("description, dueDate y estimatedHours válidos entran con su etiqueta", () => {
    const { op } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { description: " Más detalle ", dueDate: "2026-09-15", estimatedHours: "4" },
    });
    assert.deepEqual(op.changes, {
      description: "Más detalle",
      dueDate: "2026-09-15",
      estimatedHours: 4,
    });
    assert.equal(
      op.description,
      "Actualizar la tarea «Maquetar portada»: nueva descripción, fecha límite → 2026-09-15, horas estimadas → 4"
    );
  });

  it("fecha, horas o descripción inválidas, y asignados todos desconocidos, se IGNORAN avisando: no borran lo que había; solo null explícito quita", () => {
    // Arreglado el 19/08/2026: con `dueDate: "mañana"`, `estimatedHours:
    // "muchas"`, `description: 5` y `assigneeIds: [un uuid que no es del
    // equipo]` la op salía VÁLIDA, sin aviso, con todo a null/[]: al aplicarla
    // se borraban la fecha, las horas, la descripción y los asignados. El
    // modelo quería poner, no quitar: ahora cada campo inválido se ignora con
    // su aviso y, si no queda nada, la op se descarta.
    const { op, warnings } = una({
      op: "updateTask",
      taskId: "t1",
      changes: {
        dueDate: "mañana",
        estimatedHours: "muchas",
        assigneeIds: [NADIE],
        description: 5,
      },
    });
    assert.equal(op, null);
    assert.deepEqual(warnings, [
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «descripción»: no es texto",
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «fecha límite»: no es una fecha válida (AAAA-MM-DD)",
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «horas estimadas»: no es un número de horas válido",
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «asignados»: ninguno de los ids es del equipo",
      "Se ha descartado una operación «updateTask»: no incluye ningún cambio válido",
    ]);
    // Si assigneeIds ni siquiera es una lista, también se ignora avisando.
    const texto = una({ op: "updateTask", taskId: "t1", changes: { assigneeIds: "ana" } });
    assert.equal(texto.op, null);
    assert.deepEqual(texto.warnings, [
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «asignados»: no es una lista de ids",
      "Se ha descartado una operación «updateTask»: no incluye ningún cambio válido",
    ]);
    // Un id desconocido entre válidos se quita avisando y el campo sigue (la
    // etiqueta solo nombra a quien queda); lo inválido no arrastra a lo válido.
    const parcial = una({
      op: "updateTask",
      taskId: "t1",
      changes: { assigneeIds: [NADIE, BEA], dueDate: "31/12/2026", priority: "low" },
    });
    assert.deepEqual(parcial.op.changes, { priority: "low", assigneeIds: [BEA] });
    assert.deepEqual(parcial.warnings, [
      "Al actualizar la tarea «Maquetar portada» se ha ignorado el campo «fecha límite»: no es una fecha válida (AAAA-MM-DD)",
      "Al actualizar la tarea «Maquetar portada» se han quitado del campo «asignados» 1 id que no es del equipo",
    ]);
    assert.equal(
      parcial.op.description,
      "Actualizar la tarea «Maquetar portada»: prioridad → Baja, asignados → Bea"
    );
    // null EXPLÍCITO sí quita, sin aviso: «sin fecha», «sin estimar», «nueva descripción».
    const quita = una({
      op: "updateTask",
      taskId: "t1",
      changes: { dueDate: null, estimatedHours: null, description: null },
    });
    assert.deepEqual(quita.warnings, []);
    assert.deepEqual(quita.op.changes, { description: null, dueDate: null, estimatedHours: null });
    assert.equal(
      quita.op.description,
      "Actualizar la tarea «Maquetar portada»: nueva descripción, fecha límite → sin fecha, horas estimadas → sin estimar"
    );
  });

  it("la etiqueta de asignados cae a «N personas» si el equipo no tiene nombre (hoy dice «1 personas»)", () => {
    // Lo del equipo sin nombre no pasa con loadProjectSnapshot (displayName es
    // obligatorio), pero la rama existe; se fija tal cual, singular incluido.
    const sinNombre = { ...SNAP, team: [{ id: BEA, name: "", position: null }] };
    assert.equal(
      una({ op: "updateTask", taskId: "t1", changes: { assigneeIds: [BEA] } }, sinNombre).op
        .description,
      "Actualizar la tarea «Maquetar portada»: asignados → 1 personas"
    );
  });

  it("SOSPECHOSO: si el título nuevo contiene «cambio de columna», la etiqueta se pinta mal", () => {
    // SOSPECHOSO: la etiqueta se monta con describirCambios y luego un
    // `replace("cambio de columna", …)` sobre el texto entero; el primer sitio
    // donde aparece es DENTRO del título nuevo, así que se sustituye ahí y el
    // «cambio de columna» de verdad se queda sin el nombre. Rebuscado pero
    // real. Se fija lo de hoy.
    const { op } = una({
      op: "updateTask",
      taskId: "t1",
      changes: { title: "Pendiente de cambio de columna", boardColumnId: "c2" },
    });
    assert.equal(
      op.description,
      "Actualizar la tarea «Maquetar portada»: título → «Pendiente de columna → «Hecho»», cambio de columna"
    );
  });
});

/* ── deleteTask ──────────────────────────────────────────────────────────── */

describe("normalizeOperations · deleteTask", () => {
  it("una tarea del snapshot se borra con su título en la etiqueta; una que no, se descarta", () => {
    assert.deepEqual(una({ op: "deleteTask", taskId: "t2" }).op, {
      op: "deleteTask",
      taskId: "t2",
      description: "Eliminar la tarea «Configurar dominio»",
    });
    assert.deepEqual(una({ op: "deleteTask", taskId: "t9" }).warnings, [
      "Se ha descartado una operación «deleteTask»: la tarea indicada no existe en el proyecto",
    ]);
  });
});

/* ── addMember / removeMember ────────────────────────────────────────────── */

describe("normalizeOperations · addMember / removeMember", () => {
  it("addMember: alguien del equipo que no es miembro entra; el rol vale lead/member/viewer y si no, member", () => {
    assert.deepEqual(una({ op: "addMember", teamMemberId: CARLOS, role: "viewer" }).op, {
      op: "addMember",
      teamMemberId: CARLOS,
      role: "viewer",
      description: "Añadir a Carlos al proyecto como observador",
    });
    assert.equal(
      una({ op: "addMember", teamMemberId: CARLOS, role: "lead" }).op.description,
      "Añadir a Carlos al proyecto como responsable (lead)"
    );
    assert.equal(una({ op: "addMember", teamMemberId: CARLOS, role: "jefe" }).op.role, "member");
    assert.equal(
      una({ op: "addMember", teamMemberId: CARLOS }).op.description,
      "Añadir a Carlos al proyecto como miembro"
    );
  });

  it("addMember: quien no está en el equipo, o ya es miembro, se descarta con su motivo (y su nombre)", () => {
    assert.deepEqual(una({ op: "addMember", teamMemberId: NADIE }).warnings, [
      "Se ha descartado una operación «addMember»: la persona indicada no existe en el equipo",
    ]);
    assert.deepEqual(una({ op: "addMember", teamMemberId: ANA }).warnings, [
      "Se ha descartado una operación «addMember»: Ana ya es miembro del proyecto",
    ]);
  });

  it("removeMember: un miembro sale con su nombre; alguien del equipo que no es miembro, o un desconocido, se descarta", () => {
    assert.deepEqual(una({ op: "removeMember", teamMemberId: BEA }).op, {
      op: "removeMember",
      teamMemberId: BEA,
      description: "Quitar a Bea del proyecto",
    });
    assert.deepEqual(una({ op: "removeMember", teamMemberId: CARLOS }).warnings, [
      "Se ha descartado una operación «removeMember»: la persona indicada no es miembro del proyecto",
    ]);
    assert.deepEqual(una({ op: "removeMember", teamMemberId: NADIE }).warnings, [
      "Se ha descartado una operación «removeMember»: la persona indicada no es miembro del proyecto",
    ]);
  });

  it("a un miembro del proyecto que ya no está en `team` (causó baja) SÍ se le puede quitar", () => {
    // Hasta el 21/08/2026 no se podía, y el motivo era falso: loadProjectSnapshot
    // carga en `team` solo a la plantilla ACTIVA, pero `members` trae a todos
    // los miembros del proyecto, así que quien causaba baja seguía siendo
    // miembro y se le descartaba diciendo «no es miembro del proyecto». Es el
    // caso corriente —alguien se va y hay que sacarlo de los proyectos—, o sea
    // el único que no funcionaba. Ahora manda `members`, que es la lista que
    // responde a la pregunta.
    const snap = {
      ...SNAP,
      members: [...SNAP.members, { teamMemberId: NADIE, name: "Dani (baja)", role: "member" }],
    };
    const { op, warnings } = una({ op: "removeMember", teamMemberId: NADIE }, snap);
    assert.deepEqual(op, {
      op: "removeMember",
      teamMemberId: NADIE,
      description: "Quitar a Dani (baja) del proyecto",
    });
    assert.deepEqual(warnings, []);
  });

  it("addMember y removeMember aceptan el uuid en MAYÚSCULAS y guardan el id de la base", () => {
    // Mismo fallo de caja que en normalizePlan: UUID_RE lleva /i y las
    // búsquedas contra el equipo eran exactas (21/08/2026).
    assert.deepEqual(una({ op: "removeMember", teamMemberId: BEA.toUpperCase() }).op, {
      op: "removeMember",
      teamMemberId: BEA,
      description: "Quitar a Bea del proyecto",
    });
    assert.deepEqual(una({ op: "addMember", teamMemberId: CARLOS.toUpperCase() }).op, {
      op: "addMember",
      teamMemberId: CARLOS,
      role: "member",
      description: "Añadir a Carlos al proyecto como miembro",
    });
    // Y quien YA es miembro se sigue rechazando aunque llegue en otra caja.
    assert.deepEqual(una({ op: "addMember", teamMemberId: ANA.toUpperCase() }).warnings, [
      "Se ha descartado una operación «addMember»: Ana ya es miembro del proyecto",
    ]);
  });
});

/* ── La propuesta del modo demo pasa limpia ──────────────────────────────── */

describe("normalizeOperations: la propuesta del modo demo (fake.js) pasa sin un solo aviso", () => {
  it("con un proyecto con fase, una tarea sin asignar y alguien del equipo fuera: 3 operaciones, 0 avisos", () => {
    const propuesta = fakeEditOps("reparte el trabajo", SNAP);
    const { operations, warnings } = normalizeOperations(propuesta, SNAP);
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      operations.map((o) => [o.op, o.description]),
      [
        ["createTask", "Crear la tarea «Revisión general del proyecto» en la fase «Diseño»"],
        ["updateTask", "Actualizar la tarea «Configurar dominio»: prioridad → Alta"],
        ["addMember", "Añadir a Carlos al proyecto como miembro"],
      ]
    );
    // La descripción que escribe la demo viaja a `taskDescription`, no a la etiqueta.
    assert.match(operations[0].taskDescription, /«reparte el trabajo»/);
  });

  it("con un proyecto vacío solo propone la tarea de revisión, sin fase, y también pasa", () => {
    const vacio = buildProjectSnapshot({ project: { id: "p" } });
    const { operations, warnings } = normalizeOperations(fakeEditOps("x", vacio), vacio);
    assert.deepEqual(warnings, []);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].phaseId, null);
    assert.equal(operations[0].description, "Crear la tarea «Revisión general del proyecto»");
  });
});
