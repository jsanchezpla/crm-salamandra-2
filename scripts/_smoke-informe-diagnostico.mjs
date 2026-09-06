// @prueba ligera — funciones puras de lib/clinica y un PDF generado en memoria:
// sin base de datos, sin servidor, sin .env.
/**
 * _smoke-informe-diagnostico.mjs — el informe de VALORACIÓN DIAGNÓSTICA
 * (05/09/2026, AV-0045 de Aumenta, Isabel Alberca; Rodrigo: «haz ambos»).
 *
 *   node scripts/_smoke-informe-diagnostico.mjs
 *
 * Lo que se fija, y por qué:
 *
 *   1. El tipo EXISTE y se puede crear (`REPORT_TYPES` y `REPORT_TYPES_NUEVOS`)
 *      y se nombra en los dos registros («Diagnóstico» en el chip, «Informe de
 *      valoración diagnóstica» donde el rótulo va solo).
 *   2. Su PLANTILLA de fábrica se ofrece con las del centro y un informe que
 *      dice usarla se lee con sus 25 apartados, sin que el centro haya
 *      guardado nada. Y no pasa del tope de apartados.
 *   3. El CATÁLOGO: las 13 áreas del listado del centro, las pruebas que están
 *      en dos áreas salen una sola vez, y las que añade el centro no pisan las
 *      de fábrica.
 *   4. Lo ESCRITO se limpia: una prueba sin nombre no entra, las filas vacías
 *      de la tabla no se guardan, y solo se imprimen las columnas con datos.
 *   5. En el PDF, las pruebas salen como el apartado «Resultados de la
 *      evaluación», numerado, DETRÁS de «Pruebas administradas»; en la beca no
 *      salen nunca. Y el documento se genera de verdad con ellas dentro.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REPORT_TYPES, REPORT_TYPES_NUEVOS, REPORT_TYPE_LABEL, nombreDelInforme } from "../lib/clinica/serialize.js";
import { apartadosPara, plantillasDe, limpiarContentSections, MAX_APARTADOS } from "../lib/clinica/plantillas.js";
import { apartadosDelInforme } from "../lib/clinica/apartadosInforme.js";
import { buildReportPdfBuffer } from "../lib/clinica/reportPdf.js";
import {
  TIPO_DIAGNOSTICO,
  CLAVE_PRUEBAS,
  PLANTILLA_DIAGNOSTICO,
  APARTADOS_DIAGNOSTICO_BASE,
  AREAS_PRUEBAS,
  CATALOGO_PRUEBAS,
  COLUMNAS_PUNTUACION,
  TITULO_RESULTADOS,
  clavePrueba,
  pruebasDe,
  normalizarPruebasDelCentro,
  normalizarPruebas,
  columnasConDatos,
  hayPruebas,
} from "../lib/clinica/pruebasDiagnosticas.js";

const comoTexto = (buf) => buf.toString("latin1");
const esPdf = (buf) => Buffer.isBuffer(buf) && comoTexto(buf).startsWith("%PDF-") && comoTexto(buf).includes("%%EOF");
const paginasDe = (buf) => (comoTexto(buf).match(/\/Type\s*\/Page[^s]/g) || []).length;

const PRUEBAS = [
  {
    key: "wisc_v", nombre: "WISC-V", area: "cognitiva", descripcion: "Inteligencia y perfil cognitivo",
    resultados: [
      { escala: "Comprensión verbal", pd: "", pt: "104", pc: "61", clasificacion: "Medio" },
      { escala: "Memoria de trabajo", pd: "", pt: "88", pc: "21", clasificacion: "Medio-bajo" },
    ],
    interpretacion: "Perfil cognitivo dentro de la normalidad con memoria de trabajo por debajo de la media.",
  },
  { key: "d2_r", nombre: "d2-R", area: "atencion", descripcion: "Atención selectiva", resultados: [], interpretacion: "" },
];

const ESCRITO = {
  plantilla: TIPO_DIAGNOSTICO,
  motivo_consulta: "Dificultades de atención en el aula.",
  pruebas_administradas: ["WISC-V", "d2-R"],
  integracion_clinica: "Funcionamiento cognitivo medio con atención sostenida por debajo de lo esperado.",
  diagnostico_principal: "TDAH, presentación combinada.",
  dsm5: "Trastorno por déficit de atención con hiperactividad, presentación combinada — 314.01 (F90.2)",
  [CLAVE_PRUEBAS]: PRUEBAS,
};

const informe = (extra = {}) => ({
  id: "r1", reportType: TIPO_DIAGNOSTICO, reportDate: "2026-09-05", contentSections: ESCRITO, ...extra,
});

describe("1 · el tipo existe y se nombra", () => {
  it("está en las dos listas", () => {
    assert.ok(REPORT_TYPES.includes(TIPO_DIAGNOSTICO));
    assert.ok(REPORT_TYPES_NUEVOS.includes(TIPO_DIAGNOSTICO), "si no está aquí, no hay por dónde crearlo");
  });
  it("chip y nombre del documento", () => {
    assert.equal(REPORT_TYPE_LABEL[TIPO_DIAGNOSTICO], "Diagnóstico");
    assert.equal(nombreDelInforme(TIPO_DIAGNOSTICO), "Informe de valoración diagnóstica");
  });
});

describe("2 · la plantilla de fábrica", () => {
  it("se ofrece con las del centro sin que el centro haya guardado nada", () => {
    const claves = plantillasDe({ settings: {} }, "informe").map((p) => p.key);
    assert.ok(claves.includes(TIPO_DIAGNOSTICO), `falta en ${claves}`);
  });
  it("un informe que dice usarla se lee con sus 25 apartados", () => {
    const aps = apartadosPara({ plantilla: TIPO_DIAGNOSTICO }, { settings: {} }, "informe");
    assert.equal(aps.length, APARTADOS_DIAGNOSTICO_BASE.length);
    assert.equal(aps[0].key, "datos_escolares");
    assert.ok(aps.some((a) => a.key === "dsm5"));
    assert.ok(aps.some((a) => a.key === "cie11"));
  });
  it("no pasa del tope de apartados, ni repite claves", () => {
    assert.ok(PLANTILLA_DIAGNOSTICO.apartados.length <= MAX_APARTADOS);
    const claves = PLANTILLA_DIAGNOSTICO.apartados.map((a) => a.key);
    assert.equal(new Set(claves).size, claves.length);
  });
  it("si el centro guarda la suya con la misma clave, manda la suya", () => {
    const centro = { settings: { clinica: { plantillas: { informe: [{ key: TIPO_DIAGNOSTICO, name: "La nuestra", apartados: [{ key: "solo_uno", label: "Solo uno", tipo: "texto" }] }] } } } };
    const aps = apartadosPara({ plantilla: TIPO_DIAGNOSTICO }, centro, "informe");
    assert.deepEqual(aps.map((a) => a.key), ["solo_uno"]);
  });
});

describe("3 · el catálogo", () => {
  it("13 áreas, en el orden del listado del centro", () => {
    assert.equal(AREAS_PRUEBAS.length, 13);
    assert.equal(AREAS_PRUEBAS[0].key, "cognitiva");
    assert.equal(AREAS_PRUEBAS[12].key, "adaptativa");
  });
  it("una prueba que está en dos áreas sale una sola vez, con las dos", () => {
    const brief = CATALOGO_PRUEBAS.filter((p) => p.key === clavePrueba("BRIEF-2"));
    assert.equal(brief.length, 1);
    assert.deepEqual([...brief[0].areas], ["atencion", "ejecutivas"]);
    const rey = CATALOGO_PRUEBAS.find((p) => p.key === clavePrueba("Figura Compleja de Rey"));
    assert.deepEqual([...rey.areas], ["ejecutivas", "memoria"]);
  });
  it("las claves no chocan", () => {
    const claves = CATALOGO_PRUEBAS.map((p) => p.key);
    assert.equal(new Set(claves).size, claves.length);
    // 75 entradas en el listado del centro, 6 repetidas en dos áreas → 69.
    assert.equal(claves.length, 69, `${claves.length} pruebas: ¿ha cambiado el listado?`);
  });
  it("las del centro se añaden detrás y no pisan las de fábrica", () => {
    const tenant = { settings: { clinica: { pruebasDiagnosticas: [
      { nombre: "WISC-V", uso: "intento de pisar", areas: ["cognitiva"] },
      { nombre: "Prueba propia", uso: "Lo que evalúa", areas: ["lenguaje", "inventada"] },
      { nombre: "", uso: "sin nombre" },
    ] } } };
    const lista = pruebasDe(tenant);
    const propias = lista.filter((p) => !p.deFabrica);
    assert.equal(propias.length, 1);
    assert.equal(propias[0].nombre, "Prueba propia");
    assert.deepEqual(propias[0].areas, ["lenguaje"], "el área inventada se tira");
    assert.equal(lista.filter((p) => p.key === clavePrueba("WISC-V")).length, 1, "la de fábrica no se duplica");
  });
  it("una del centro sin área conocida va a «otras»", () => {
    assert.deepEqual(normalizarPruebasDelCentro([{ nombre: "X", areas: ["nada"] }])[0].areas, ["otras"]);
  });
});

describe("4 · lo escrito se limpia", () => {
  it("una prueba sin nombre no entra y las filas vacías no se guardan", () => {
    const limpias = normalizarPruebas([
      { nombre: "", resultados: [{ escala: "a" }] },
      { nombre: "WISC-V", resultados: [{ escala: "", pd: "", pt: "", pc: "", clasificacion: "" }, { escala: "CV", pt: "104" }] },
    ]);
    assert.equal(limpias.length, 1);
    assert.equal(limpias[0].resultados.length, 1);
    assert.deepEqual(Object.keys(limpias[0].resultados[0]), COLUMNAS_PUNTUACION.map((c) => c.key));
  });
  it("solo se imprimen las columnas con datos", () => {
    assert.deepEqual(columnasConDatos(PRUEBAS[0].resultados).map((c) => c.key), ["escala", "pt", "pc", "clasificacion"]);
    assert.deepEqual(columnasConDatos([]), []);
  });
  it("`limpiarContentSections` pasa las pruebas por el mismo colador", () => {
    const cs = limpiarContentSections({ [CLAVE_PRUEBAS]: [{ nombre: "" }, { nombre: "d2-R" }] });
    assert.equal(cs[CLAVE_PRUEBAS].length, 1);
    assert.equal(hayPruebas(cs), true);
    assert.equal(hayPruebas({}), false);
  });
  it("un apartado que se llame «Pruebas» no puede pisar el bloque", () => {
    const cs = limpiarContentSections({ apartados: [{ key: CLAVE_PRUEBAS, label: "Pruebas", tipo: "texto" }] });
    assert.notEqual(cs.apartados[0].key, CLAVE_PRUEBAS);
  });
});

describe("5 · en el PDF", () => {
  it("las pruebas salen como «Resultados de la evaluación», numeradas, detrás de «Pruebas administradas»", () => {
    const salen = apartadosDelInforme(informe(), { settings: {} });
    const i = salen.findIndex((s) => s.label === TITULO_RESULTADOS);
    assert.ok(i > 0, "no sale el bloque");
    assert.equal(salen[i - 1].key, "pruebas_administradas");
    assert.equal(salen[i].pruebas.length, 2);
    assert.deepEqual(salen.map((s) => s.n), salen.map((_, k) => k + 1), "la numeración tiene que ser seguida");
  });
  it("sin «Pruebas administradas» escrito, salen al final", () => {
    const { pruebas_administradas, ...resto } = ESCRITO;
    const salen = apartadosDelInforme(informe({ contentSections: resto }), { settings: {} });
    assert.equal(salen.at(-1).label, TITULO_RESULTADOS);
  });
  it("en la beca no salen nunca", () => {
    const salen = apartadosDelInforme(informe({ reportType: "beca", contentSections: { ...ESCRITO, motiveOfIntervention: "x" } }), { settings: {} });
    assert.ok(!salen.some((s) => s.label === TITULO_RESULTADOS));
  });
  it("el documento se genera de verdad con la tabla dentro", async () => {
    const args = (cs) => ({
      report: informe({ contentSections: cs }),
      patientName: "Paciente de prueba",
      patientBirthDate: "2016-03-02",
      therapistName: "Isabel Prueba",
      tenantName: "Centro de prueba",
      brand: {},
      tenant: { settings: {} },
    });
    const con = await buildReportPdfBuffer(args(ESCRITO));
    const sin = await buildReportPdfBuffer(args({ ...ESCRITO, [CLAVE_PRUEBAS]: [] }));
    assert.ok(esPdf(con), "tiene que ser un PDF válido");
    assert.ok(esPdf(sin));
    assert.ok(con.length > sin.length, "con las pruebas dentro el documento tiene que pesar más");
    assert.ok(paginasDe(con) >= paginasDe(sin));
  });
});
