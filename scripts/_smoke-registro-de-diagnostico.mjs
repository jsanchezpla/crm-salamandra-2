// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-registro-de-diagnostico.mjs — los registros de un expediente de
 * diagnóstico: título, orden, URLs y el material que va a la IA para unirse
 * en el informe (12/09/2026, segunda entrega).
 *
 *   node --test scripts/_smoke-registro-de-diagnostico.mjs
 *
 * Fija `lib/clinica/registroDeDiagnostico.js`:
 *   · el título: el propio si lo hay; «Entrevista inicial» por su plantilla;
 *     «Sesión de diagnóstico N» numerada entre las de horas;
 *   · la cola `&diagnostico=&titulo=` y su lectura estricta (uuid) en el editor;
 *   · las URLs de estrenar y de seguir un registro, montadas sobre
 *     `colaDePreparacion` (fecha, cita, firma, plantilla);
 *   · el material: por fecha, `### dd/mm/yyyy · título`, cada apartado con su
 *     rótulo y las listas como viñetas; NUNCA notas internas, preparación ni
 *     transcripción; un registro vacío no aparece.
 *
 * Y la plantilla de fábrica `sesion_diagnostico` (`lib/clinica/plantillas.js`):
 * los CINCO apartados que Aumenta aceptó, en su orden, ofrecida a todos los
 * centros con clínica detrás de la entrevista y el taller.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TITULO,
  ESTADOS_TERMINADOS,
  tituloPorDefecto,
  tituloDe,
  limpiarTitulo,
  leerDiagnosticoDeLaUrl,
  colaDeRegistroDeDiagnostico,
  urlDeNuevoRegistro,
  urlDeRegistro,
  registrosPorFecha,
  siguienteTitulo,
  materialDeLosRegistros,
} from "../lib/clinica/registroDeDiagnostico.js";
import {
  PLANTILLA_SESION_DIAGNOSTICO,
  APARTADOS_SESION_DIAGNOSTICO_BASE,
  PLANTILLAS_EXTRA,
  plantillasDe,
  CLAVES_RESERVADAS,
  CAMPOS_SESION,
} from "../lib/clinica/plantillas.js";

const ID = "3f2b9c1e-9d4a-4b1e-8c7d-1a2b3c4d5e6f";
const PACIENTE = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const ISA = "6c1f3a12-9d84-4b77-8e21-0a5f2c7d4b90";

const entrevista = (extra = {}) => ({ id: "s-e", sessionDate: "2026-09-01T12:00:00Z", status: "registered", contentSections: { plantilla: "entrevista_inicial" }, ...extra });
const sesion = (extra = {}) => ({ sessionDate: "2026-09-05T12:00:00Z", status: "registered", contentSections: { plantilla: "sesion_diagnostico" }, ...extra });

describe("la plantilla de fábrica «Sesión de diagnóstico»", () => {
  it("tiene exactamente los cinco apartados que aceptó Aumenta, en su orden, y ninguno de notas internas", () => {
    assert.equal(PLANTILLA_SESION_DIAGNOSTICO.key, "sesion_diagnostico");
    assert.equal(PLANTILLA_SESION_DIAGNOSTICO.name, "Sesión de diagnóstico");
    assert.deepEqual(
      APARTADOS_SESION_DIAGNOSTICO_BASE.map((a) => [a.key, a.label, a.tipo]),
      [
        ["pruebaAdministrada", "Prueba administrada", "texto"],
        ["queEvalua", "Qué evalúa", "texto"],
        ["observacionesDurantePrueba", "Observaciones durante la prueba", "texto"],
        ["puntuaciones", "Puntuaciones", "texto"],
        ["interpretacion", "Interpretación", "texto"],
      ]
    );
    for (const a of APARTADOS_SESION_DIAGNOSTICO_BASE) {
      assert.equal(typeof a.pista, "string", `${a.key} lleva pista`);
      assert.equal(CLAVES_RESERVADAS.has(a.key), false, `${a.key} no es reservada`);
      assert.equal(a.key in CAMPOS_SESION, false, `${a.key} no es de fábrica: cae en contentSections`);
      assert.doesNotMatch(a.key, /intern/i);
    }
  });

  it("se ofrece a todos los centros con clínica, detrás de la entrevista y el taller", () => {
    assert.deepEqual(PLANTILLAS_EXTRA.registro.map((p) => p.key), ["entrevista_inicial", "taller", "sesion_diagnostico"]);
    const claves = plantillasDe({ settings: {} }, "registro").map((p) => p.key);
    assert.deepEqual(claves, ["base", "entrevista_inicial", "taller", "sesion_diagnostico"]);
    // El centro puede sustituirla guardando la suya con esa clave.
    const tenant = { settings: { clinica: { plantillas: { registro: [{ key: "sesion_diagnostico", name: "La nuestra", apartados: [{ key: "x", label: "X" }] }] } } } };
    const propia = plantillasDe(tenant, "registro").find((p) => p.key === "sesion_diagnostico");
    assert.equal(propia.name, "La nuestra");
  });
});

describe("títulos", () => {
  it("por defecto: la entrevista, o «Sesión de diagnóstico N» (sin número, a secas)", () => {
    assert.equal(tituloPorDefecto({ tramo: "entrevista" }), "Entrevista inicial");
    assert.equal(tituloPorDefecto({ tramo: "entrevista", numero: 3 }), "Entrevista inicial");
    assert.equal(tituloPorDefecto({ tramo: "horas", numero: 3 }), "Sesión de diagnóstico 3");
    assert.equal(tituloPorDefecto({ numero: "2" }), "Sesión de diagnóstico 2");
    assert.equal(tituloPorDefecto({ tramo: "horas" }), "Sesión de diagnóstico");
    assert.equal(tituloPorDefecto({ numero: 0 }), "Sesión de diagnóstico");
    assert.equal(tituloPorDefecto(), "Sesión de diagnóstico");
  });

  it("tituloDe: el propio manda; la entrevista se reconoce por su plantilla; el resto, por defecto con su número", () => {
    assert.equal(tituloDe({ titulo: "  Pruebas WISC-V  " }), "Pruebas WISC-V");
    assert.equal(tituloDe({ titulo: "Mío", contentSections: { plantilla: "entrevista_inicial" } }), "Mío");
    assert.equal(tituloDe(entrevista()), "Entrevista inicial");
    assert.equal(tituloDe(entrevista({ titulo: "   " }), { numero: 4 }), "Entrevista inicial");
    assert.equal(tituloDe(sesion(), { numero: 2 }), "Sesión de diagnóstico 2");
    assert.equal(tituloDe(sesion()), "Sesión de diagnóstico");
    assert.equal(tituloDe({ toJSON: () => ({ titulo: "Con toJSON" }) }), "Con toJSON");
    assert.equal(tituloDe(null), "Sesión de diagnóstico");
  });

  it("limpiarTitulo recorta a MAX_TITULO y devuelve null sin nada", () => {
    assert.equal(MAX_TITULO, 160);
    assert.equal(limpiarTitulo(" a  b ").length, 3);
    assert.equal(limpiarTitulo("x".repeat(500)).length, 160);
    assert.equal(limpiarTitulo(""), null);
    assert.equal(limpiarTitulo(null), null);
  });
});

describe("la cola de la URL: la escribe la fila, la lee el editor", () => {
  it("colaDeRegistroDeDiagnostico: expediente y título codificado; vacía sin expediente", () => {
    assert.equal(colaDeRegistroDeDiagnostico({ diagnosticoId: ID, titulo: "Sesión de diagnóstico 2" }), `&diagnostico=${ID}&titulo=Sesi%C3%B3n+de+diagn%C3%B3stico+2`);
    assert.equal(colaDeRegistroDeDiagnostico({ diagnosticoId: ID }), `&diagnostico=${ID}`);
    assert.equal(colaDeRegistroDeDiagnostico({ diagnosticoId: ID, titulo: "  " }), `&diagnostico=${ID}`);
    assert.equal(colaDeRegistroDeDiagnostico({ diagnosticoId: null, titulo: "x" }), "");
    assert.equal(colaDeRegistroDeDiagnostico({}), "");
  });

  it("leerDiagnosticoDeLaUrl: solo un uuid es un expediente; el título llega limpio", () => {
    const q = new URLSearchParams(`preparar=1${colaDeRegistroDeDiagnostico({ diagnosticoId: ID, titulo: " Pruebas  WISC-V " })}`);
    assert.deepEqual(leerDiagnosticoDeLaUrl(q), { diagnosticoId: ID, titulo: "Pruebas WISC-V" });
    assert.deepEqual(leerDiagnosticoDeLaUrl(new URLSearchParams("diagnostico=123&titulo=x")), { diagnosticoId: "", titulo: "x" });
    assert.deepEqual(leerDiagnosticoDeLaUrl(new URLSearchParams("")), { diagnosticoId: "", titulo: "" });
    assert.deepEqual(leerDiagnosticoDeLaUrl(null), { diagnosticoId: "", titulo: "" });
    assert.equal(leerDiagnosticoDeLaUrl(new URLSearchParams(`titulo=${"x".repeat(300)}`)).titulo.length, 160);
  });
});

describe("las URLs de los registros", () => {
  it("urlDeNuevoRegistro sin cita: preparar=1, la plantilla de la sesión de diagnóstico, la firma, el expediente y el título", () => {
    const url = urlDeNuevoRegistro({ patientId: PACIENTE, diagnosticoId: ID, therapistId: ISA, titulo: "Sesión de diagnóstico 3" });
    const u = new URL(url, "http://x");
    assert.equal(u.pathname, `/pacientes/${PACIENTE}/sesiones/nueva`);
    assert.equal(u.searchParams.get("preparar"), "1");
    assert.equal(u.searchParams.get("plantilla"), "sesion_diagnostico");
    assert.equal(u.searchParams.get("prof"), ISA);
    assert.equal(u.searchParams.get("diagnostico"), ID);
    assert.equal(u.searchParams.get("titulo"), "Sesión de diagnóstico 3");
    assert.equal(u.searchParams.has("cita"), false);
    assert.equal(u.searchParams.has("fecha"), false);
  });

  it("con cita, lleva la cita y su fecha; el tramo entrevista abre entrevista_inicial; la plantilla pedida manda", () => {
    const ahora = new Date("2026-09-12T10:00:00Z");
    const u = new URL(
      urlDeNuevoRegistro({ patientId: PACIENTE, diagnosticoId: ID, tramo: "entrevista", bookingId: "b-1", scheduledAt: "2026-09-15T17:00:00.000Z", ahora }),
      "http://x"
    );
    assert.equal(u.searchParams.get("cita"), "b-1");
    assert.equal(u.searchParams.get("fecha"), "2026-09-15T17:00:00.000Z");
    assert.equal(u.searchParams.get("plantilla"), "entrevista_inicial");
    assert.equal(u.searchParams.has("prof"), false, "sin firma no cuelga prof");
    const propia = new URL(urlDeNuevoRegistro({ patientId: PACIENTE, diagnosticoId: ID, plantilla: "la_del_centro" }), "http://x");
    assert.equal(propia.searchParams.get("plantilla"), "la_del_centro");
  });

  it("un id de profesional que no es uuid no viaja (lo acota colaDePreparacion)", () => {
    const u = new URL(urlDeNuevoRegistro({ patientId: PACIENTE, diagnosticoId: ID, therapistId: "tm-1" }), "http://x");
    assert.equal(u.searchParams.has("prof"), false);
  });

  it("sin paciente o sin expediente se niega: un enlace a medias abriría un registro suelto", () => {
    assert.throws(() => urlDeNuevoRegistro({ diagnosticoId: ID }), /patientId/);
    assert.throws(() => urlDeNuevoRegistro({ patientId: PACIENTE }), /diagnosticoId/);
    assert.throws(() => urlDeRegistro({ patientId: PACIENTE }), /sessionId/);
  });

  it("urlDeRegistro: seguir el que hay", () => {
    assert.equal(urlDeRegistro({ patientId: PACIENTE, sessionId: "s-1" }), `/pacientes/${PACIENTE}/sesiones/s-1`);
  });
});

describe("registrosPorFecha y siguienteTitulo", () => {
  const lista = [
    sesion({ id: "s3", sessionDate: "2026-09-10T12:00:00Z", titulo: "Pruebas WISC-V", therapistId: ISA, status: "draft", bookingId: "b-3", diagnosticoId: ID, updatedAt: "2026-09-10T13:00:00Z" }),
    sesion({ id: "s2", sessionDate: "2026-09-05T12:00:00Z", therapistId: null }),
    entrevista({ id: "s1", sessionDate: "2026-09-01T12:00:00Z" }),
    sesion({ id: "s4", sessionDate: "2026-09-12T12:00:00Z" }),
  ];

  it("ordena ASC por fecha y numera solo las de horas; un título propio conserva su número de sitio", () => {
    const filas = registrosPorFecha(lista);
    assert.deepEqual(
      filas.map((r) => [r.id, r.titulo, r.esEntrevista]),
      [
        ["s1", "Entrevista inicial", true],
        ["s2", "Sesión de diagnóstico 1", false],
        ["s3", "Pruebas WISC-V", false],
        ["s4", "Sesión de diagnóstico 3", false],
      ]
    );
    assert.deepEqual(Object.keys(filas[2]), ["id", "sessionDate", "titulo", "therapistId", "status", "bookingId", "esEntrevista", "diagnosticoId", "updatedAt"]);
    assert.equal(filas[2].therapistId, ISA);
    assert.equal(filas[2].status, "draft");
    assert.equal(filas[2].bookingId, "b-3");
    assert.equal(filas[2].diagnosticoId, ID);
    assert.equal(filas[2].updatedAt, "2026-09-10T13:00:00Z");
    assert.equal(filas[1].therapistId, null);
  });

  it("si la fila trae `terapeuta` resuelto, viaja; si no, no se inventa", () => {
    const [con] = registrosPorFecha([sesion({ id: "x", terapeuta: { id: ISA, nombre: "Isa" } })]);
    assert.deepEqual(con.terapeuta, { id: ISA, nombre: "Isa" });
    assert.equal("terapeuta" in registrosPorFecha([sesion({ id: "y" })])[0], false);
  });

  it("acepta instancias con toJSON, lo que no es lista, y fechas ilegibles (van primero, no revientan)", () => {
    assert.equal(registrosPorFecha([{ toJSON: () => sesion({ id: "z" }) }])[0].id, "z");
    assert.deepEqual(registrosPorFecha(null), []);
    assert.deepEqual(registrosPorFecha("no"), []);
    assert.equal(registrosPorFecha([sesion({ id: "a" }), sesion({ id: "b", sessionDate: "el jueves" })])[0].id, "b");
  });

  it("siguienteTitulo: el número de las de horas + 1; sin nada, la 1", () => {
    assert.equal(siguienteTitulo(lista), "Sesión de diagnóstico 4");
    assert.equal(siguienteTitulo([entrevista()]), "Sesión de diagnóstico 1");
    assert.equal(siguienteTitulo([]), "Sesión de diagnóstico 1");
    assert.equal(siguienteTitulo(undefined), "Sesión de diagnóstico 1");
  });

  it("los estados terminados son registrado y cerrado: un borrador no es material", () => {
    assert.deepEqual([...ESTADOS_TERMINADOS], ["registered", "published"]);
    assert.ok(Object.isFrozen(ESTADOS_TERMINADOS));
  });
});

describe("materialDeLosRegistros: lo que viaja a la IA", () => {
  const registros = [
    sesion({
      id: "s2",
      sessionDate: "2026-09-05T12:00:00Z",
      contentSections: {
        plantilla: "sesion_diagnostico",
        pruebaAdministrada: "WISC-V",
        queEvalua: "",
        observacionesDurantePrueba: "Atenta, se cansa al final",
        puntuaciones: "CI 98 · percentil 45",
        interpretacion: "",
      },
      parentFeedback: "La madre dice que en casa se frustra con los deberes.",
      prepText: "SECRETO-PREP",
      internalNotes: "SECRETO-INTERNO",
      aiTranscription: "SECRETO-TRANSCRIPCION",
      prepFiles: [{ name: "SECRETO-FICHERO" }],
    }),
    entrevista({
      id: "s1",
      sessionDate: "2026-09-01T12:00:00Z",
      contentSections: { plantilla: "entrevista_inicial", motivoConsulta: "Dificultades de atención en clase", acuerdosIntervencion: ["Valoración completa", "Informe al colegio"] },
    }),
  ];

  it("por fecha, con cabecera `### dd/mm/yyyy · título`, cada apartado con su rótulo, las listas como viñetas y la devolución de la familia", () => {
    const m = materialDeLosRegistros(registros);
    const esperado = [
      "### 01/09/2026 · Entrevista inicial",
      "",
      "**2. Motivo de consulta**",
      "Dificultades de atención en clase",
      "",
      "**14. Acuerdos de intervención**",
      "- Valoración completa",
      "- Informe al colegio",
      "",
      "### 05/09/2026 · Sesión de diagnóstico 1",
      "",
      "**Prueba administrada**",
      "WISC-V",
      "",
      "**Observaciones durante la prueba**",
      "Atenta, se cansa al final",
      "",
      "**Puntuaciones**",
      "CI 98 · percentil 45",
      "",
      "**Devolución de la familia**",
      "La madre dice que en casa se frustra con los deberes.",
    ].join("\n");
    assert.equal(m, esperado);
  });

  it("NUNCA lleva preparación, notas internas, transcripción ni ficheros", () => {
    const m = materialDeLosRegistros(registros);
    assert.doesNotMatch(m, /SECRETO/);
  });

  it("un registro con título propio lo usa; uno sin nada escrito no aparece; sin registros, cadena vacía", () => {
    const m = materialDeLosRegistros([
      sesion({ id: "a", titulo: "Pruebas WISC-V", contentSections: { plantilla: "sesion_diagnostico", puntuaciones: "PT 110" } }),
      sesion({ id: "b", sessionDate: "2026-09-06T12:00:00Z", contentSections: { plantilla: "sesion_diagnostico" } }),
    ]);
    assert.equal(m, "### 05/09/2026 · Pruebas WISC-V\n\n**Puntuaciones**\nPT 110");
    assert.equal(materialDeLosRegistros([]), "");
    assert.equal(materialDeLosRegistros(null), "");
  });

  it("los apartados de fábrica del registro (columnas) también salen, y la foto de apartados manda sobre la plantilla", () => {
    const m = materialDeLosRegistros([
      { id: "c", sessionDate: "2026-09-07T12:00:00Z", objectives: ["Atención sostenida"], activities: "Tarea de cancelación", observations: { incidents: "Ninguna" }, contentSections: {} },
      { id: "d", sessionDate: "2026-09-08T12:00:00Z", contentSections: { apartados: [{ key: "libre", label: "Apartado suelto", tipo: "texto" }], libre: "Lo que sea" } },
    ]);
    assert.match(m, /\*\*Objetivos trabajados\*\*\n- Atención sostenida/);
    assert.match(m, /\*\*Actividades realizadas\*\*\nTarea de cancelación/);
    assert.match(m, /\*\*Incidencias\*\*\nNinguna/);
    assert.match(m, /### 08\/09\/2026 · Sesión de diagnóstico 2\n\n\*\*Apartado suelto\*\*\nLo que sea/);
  });

  it("las plantillas del centro mandan sobre las de fábrica con la misma clave", () => {
    const propia = { key: "sesion_diagnostico", name: "La nuestra", apartados: [{ key: "puntuaciones", label: "Resultados", tipo: "texto" }] };
    const m = materialDeLosRegistros([sesion({ id: "e", contentSections: { plantilla: "sesion_diagnostico", puntuaciones: "PT 110", pruebaAdministrada: "no sale: no está en la del centro" } })], {
      plantillasDelCentro: [propia],
    });
    assert.equal(m, "### 05/09/2026 · Sesión de diagnóstico 1\n\n**Resultados**\nPT 110");
  });
});
