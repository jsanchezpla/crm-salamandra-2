// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clinica-notas-internas.mjs — las notas internas del registro de sesión
 * (29/08/2026, Aumenta por Rodrigo).
 *
 *   node scripts/_smoke-clinica-notas-internas.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Lo que pidió el centro, con sus palabras: «no siempre pueden ver todo porque
 * en ocasiones ponemos comentarios que son solo de nuestro interés (falta de
 * implicación familiar, estados de los padres, actitudes…)».
 *
 * O sea, la promesa tiene dos mitades y las dos se pueden romper solas:
 *
 *   · **Que se puedan poner.** `serializeSession` es lo único que el navegador
 *     del CRM ve de una sesión: si el campo no sale ahí, la terapeuta escribe
 *     la nota, se guarda en la base y al recargar la pantalla ha desaparecido.
 *   · **Que no se suban.** El único camino por el que un texto de una sesión
 *     llega a la familia es el informe, y empieza en `redactarDesdeSesiones`:
 *     el volcado que compone el borrador. Lo que entre ahí acaba en el PDF que
 *     el centro entrega. El otro camino —el anexo literal— lo cubre
 *     `_smoke-informe-beca.mjs`, donde ya está el lector de PDF.
 *
 * Al portal de la familia no llega ninguna sesión por ningún endpoint (en
 * `app/api/public/c/[slug]/citas-portal/` no hay ruta de sesiones), así que
 * ahí no hay nada que probar todavía: lo que la familia lee son documentos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { serializeSession } from "../lib/clinica/serialize.js";
import { redactarDesdeSesiones } from "../lib/clinica/redactarInforme.js";

const SECRETO = "LA MADRE NO TRAE LAS TAREAS Y VIENE MUY QUEMADA";

const SESION = {
  id: "11111111-1111-1111-1111-111111111111",
  patientId: "22222222-2222-2222-2222-222222222222",
  therapistId: null,
  sessionDate: "2026-03-03T10:00:00.000Z",
  duration: 45,
  status: "registered",
  objectives: ["Atención sostenida"],
  activities: "Tareas con apoyo visual.",
  performance: "Responde con interés.",
  observations: { familyComments: "En casa aguanta más rato.", nextSessionNotes: "", homeworkTasks: "", incidents: "" },
  prepText: "Llevar el material de atención.",
  prepFiles: [],
  parentFeedback: "La familia dice que va mejor.",
  internalNotes: SECRETO,
};

describe("la nota interna se puede poner: el CRM la devuelve", () => {
  it("serializeSession la expone tal cual", () => {
    assert.equal(serializeSession(SESION).internalNotes, SECRETO);
  });

  it("una sesión que no tiene notas devuelve cadena vacía, no undefined", () => {
    const { internalNotes, ...sinNotas } = SESION;
    assert.equal(internalNotes, SECRETO); // (que el fixture sí las traía)
    assert.equal(serializeSession(sinNotas).internalNotes, "");
    assert.equal(serializeSession({ ...sinNotas, internalNotes: null }).internalNotes, "");
  });

  it("no se cuela en la vista previa de la lista de sesiones", () => {
    // El preview cae en cascada hasta las tareas para casa. Una sesión SOLO con
    // nota interna tiene que salir sin previsualización, no con el secreto.
    const soloNota = { ...SESION, activities: "", performance: "", objectives: [], observations: {} };
    assert.equal(serializeSession(soloNota).preview, "");
  });
});

describe("la nota interna NO se sube: el volcado del informe no la toca", () => {
  const secciones = (cs) =>
    Object.values(cs ?? {})
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v) => typeof v === "string")
      .join("\n");

  it("nada de lo que compone el borrador contiene la nota", () => {
    const cs = redactarDesdeSesiones({}, [SESION]);
    assert.ok(!secciones(cs).includes(SECRETO), "la nota interna se ha colado en el borrador del informe");
  });

  it("y lo que sí es del informe sigue llegando (o la prueba no probaría nada)", () => {
    const cs = redactarDesdeSesiones({}, [SESION]);
    const texto = secciones(cs);
    assert.ok(texto.includes("Atención sostenida"), "el volcado debería traer los objetivos");
    assert.ok(texto.includes("Tareas con apoyo visual"), "el volcado debería traer las actividades");
  });

  it("tampoco cuando la nota interna es lo ÚNICO escrito en la sesión", () => {
    const soloNota = {
      sessionDate: "2026-03-03T10:00:00.000Z",
      objectives: [],
      activities: "",
      performance: "",
      observations: {},
      parentFeedback: "",
      internalNotes: SECRETO,
    };
    const cs = redactarDesdeSesiones({}, [soloNota]);
    assert.ok(!secciones(cs).includes(SECRETO));
  });
});
