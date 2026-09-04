// @prueba ligera — funciones puras + el texto de una pantalla; sin base, sin servidor.
/**
 * _smoke-entrevista-en-informes.mjs — la entrevista inicial se escribe como
 * registro de sesión y se GUARDA con los informes (04/09/2026, AV-0042 de
 * Aumenta).
 *
 *   node scripts/_smoke-entrevista-en-informes.mjs
 *
 * ── DE QUÉ QUEJA REAL NACE ─────────────────────────────────────────────────
 * Aumenta, 04/09/2026: «al generar las entrevistas iniciales se guardan en la
 * ficha del paciente como sesiones en lugar de como informe».
 *
 * El 03/09 la entrevista dejó de ser un TIPO DE INFORME para escribirse como
 * registro de sesión (sus 15 apartados, la IA del audio o del bloc de notas).
 * Eso no se toca. Lo que esta prueba defiende es lo otro: que la entrevista
 * salga con los informes y NO entre las sesiones, que es donde se perdía —un
 * paciente de Aumenta llega a tener 241—.
 *
 * Las dos mitades tienen que seguir casando, y por eso se prueban juntas:
 *
 *   1. `esEntrevistaInicial` reconoce el registro por su plantilla, y no por
 *      nada que se pueda escribir a mano.
 *   2. `repartirRegistros` lo saca de «Sesiones» y lo pone en «Informes», sin
 *      duplicarlo cuando llega por las dos peticiones de la ficha.
 *   3. El PDF lo NOMBRA «Entrevista inicial» exactamente para los mismos
 *      registros. Si alguien cambia una de las dos reglas, la ficha diría una
 *      cosa y la portada otra: son la misma pregunta y hay una sola respuesta.
 *   4. La ficha sigue pintando cada pestaña con su lista (se lee el código: es
 *      un componente con hooks y tres fetch, y lo que se rompería aquí es qué
 *      array mapea cada pestaña).
 *   5. Y desde el 04/09/2026 la ficha también la ESTRENA: el botón «Nueva
 *      entrevista inicial» de la cabecera, que abre el registro de siempre con
 *      la plantilla puesta (Rodrigo). Se prueba aquí, con el resto de la
 *      entrevista, porque es la misma clave la que decide las tres cosas: con
 *      qué plantilla se abre, en qué pestaña se archiva y cómo se titula.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAVE_ENTREVISTA, esEntrevistaInicial, repartirRegistros } from "../lib/clinica/entrevistaInicial.js";
import { tituloDeRegistro } from "../lib/clinica/sessionPdf.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// La ficha del paciente, leída una vez: la miran los dos últimos bloques (qué
// pinta cada pestaña y el botón de la cabecera). `codigo` es la misma fuente
// sin comentarios, para no dar por buena una regla que solo esté explicada.
const fuente = fs.readFileSync(path.join(RAIZ, "app", "(dashboard)", "pacientes", "[id]", "page.jsx"), "utf8");
const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const entrevista = (extra = {}) => ({
  id: "e1",
  sessionDate: "2026-09-01T14:00:00.000Z",
  contentSections: { plantilla: CLAVE_ENTREVISTA },
  ...extra,
});
const sesion = (extra = {}) => ({ id: "s1", sessionDate: "2026-09-02T08:00:00.000Z", ...extra });

describe("qué es una entrevista inicial", () => {
  it("lo dice la plantilla con la que se escribió", () => {
    assert.equal(CLAVE_ENTREVISTA, "entrevista_inicial");
    assert.equal(esEntrevistaInicial(entrevista()), true);
  });

  it("un registro normal, uno de taller y uno con otra plantilla no lo son", () => {
    assert.equal(esEntrevistaInicial(sesion()), false);
    assert.equal(esEntrevistaInicial(sesion({ tallerSesionId: "t1", contentSections: { plantilla: "taller" } })), false);
    assert.equal(esEntrevistaInicial(sesion({ contentSections: { apartados: [{ key: "x" }] } })), false);
  });

  it("no se cae con un contentSections que no es un objeto", () => {
    for (const cs of [null, undefined, "entrevista_inicial", [{ plantilla: CLAVE_ENTREVISTA }], 3]) {
      assert.equal(esEntrevistaInicial({ id: "x", contentSections: cs }), false, `contentSections = ${JSON.stringify(cs)}`);
    }
    assert.equal(esEntrevistaInicial(null), false);
    assert.equal(esEntrevistaInicial(undefined), false);
    // Una clave que no es texto (un JSONB puede traer cualquier cosa) no cuela.
    assert.equal(esEntrevistaInicial({ id: "x", contentSections: { plantilla: { key: CLAVE_ENTREVISTA } } }), false);
  });

  it("acepta una fila de Sequelize (toJSON) y los espacios de sobra", () => {
    const fila = { toJSON: () => ({ id: "e1", contentSections: { plantilla: ` ${CLAVE_ENTREVISTA} ` } }) };
    assert.equal(esEntrevistaInicial(fila), true);
  });
});

describe("dónde va cada registro en la ficha", () => {
  it("la entrevista sale de Sesiones y entra en Informes", () => {
    const { sesiones, entrevistas } = repartirRegistros([sesion(), entrevista()]);
    assert.deepEqual(sesiones.map((r) => r.id), ["s1"]);
    assert.deepEqual(entrevistas.map((r) => r.id), ["e1"]);
  });

  it("no se duplica cuando llega por las DOS peticiones", () => {
    // La ficha pide las últimas sesiones y, aparte, las entrevistas: una
    // entrevista reciente viene en las dos listas y es UNA.
    const { sesiones, entrevistas } = repartirRegistros([sesion(), entrevista()], [entrevista()]);
    assert.equal(entrevistas.length, 1);
    assert.equal(sesiones.length, 1);
  });

  it("una entrevista antigua, fuera del listado de sesiones, sigue apareciendo", () => {
    // Es el caso que motiva la segunda petición: 50 de los 587 pacientes con
    // historia en Aumenta pasan de 100 sesiones, y la entrevista es la primera
    // de todas.
    const ultimas = Array.from({ length: 100 }, (_, i) => sesion({ id: `s${i}`, sessionDate: `2026-0${(i % 8) + 1}-10T09:00:00.000Z` }));
    const vieja = entrevista({ id: "e-vieja", sessionDate: "2024-09-10T09:00:00.000Z" });
    const { sesiones, entrevistas } = repartirRegistros(ultimas, [vieja]);
    assert.deepEqual(entrevistas.map((r) => r.id), ["e-vieja"]);
    assert.equal(sesiones.length, 100);
    assert.equal(sesiones.some((r) => r.id === "e-vieja"), false);
  });

  it("cada lista queda de la más reciente a la más antigua", () => {
    const a = sesion({ id: "a", sessionDate: "2026-01-10T09:00:00.000Z" });
    const b = sesion({ id: "b", sessionDate: "2026-03-10T09:00:00.000Z" });
    const e1 = entrevista({ id: "e1", sessionDate: "2025-09-01T09:00:00.000Z" });
    const e2 = entrevista({ id: "e2", sessionDate: "2026-02-01T09:00:00.000Z" });
    const { sesiones, entrevistas } = repartirRegistros([b, a], [e1, e2]);
    assert.deepEqual(sesiones.map((r) => r.id), ["b", "a"]);
    assert.deepEqual(entrevistas.map((r) => r.id), ["e2", "e1"]);
  });

  it("aguanta listas vacías, nulas y filas sin id o sin fecha", () => {
    assert.deepEqual(repartirRegistros(), { sesiones: [], entrevistas: [] });
    assert.deepEqual(repartirRegistros(null, undefined, "no soy una lista"), { sesiones: [], entrevistas: [] });
    const { sesiones, entrevistas } = repartirRegistros([null, { sinId: true }, entrevista({ sessionDate: null })]);
    assert.equal(sesiones.length, 0);
    assert.deepEqual(entrevistas.map((r) => r.id), ["e1"]);
  });
});

describe("la ficha y el PDF contestan lo mismo", () => {
  it("el PDF titula «Entrevista inicial» justo los registros que van a Informes", () => {
    assert.equal(tituloDeRegistro(entrevista()).tipo, "Entrevista inicial");
    assert.equal(tituloDeRegistro(sesion()).tipo, "Registro de sesión");
    assert.equal(tituloDeRegistro(sesion({ tallerSesionId: "t1" })).tipo, "Sesión de taller");
  });
});

describe("las pestañas de la ficha pintan la lista que les toca", () => {
  it("Sesiones mapea `sesiones` (el reparto), no la lista cruda", () => {
    const i = codigo.indexOf('activeTab === "sesiones"');
    assert.ok(i > 0, "ancla: la pestaña Sesiones ha cambiado de nombre; revisa esta prueba");
    const bloque = codigo.slice(i, i + 900);
    assert.match(bloque, /\{sesiones\.map\(/, "la pestaña Sesiones tiene que pintar el reparto, o la entrevista vuelve a colarse");
    assert.equal(/\{sessions\.map\(/.test(bloque), false, "`sessions` es la lista cruda: incluye las entrevistas");
  });

  it("Informes mapea `entrevistas` además de los informes", () => {
    const i = codigo.indexOf('activeTab === "informes"');
    assert.ok(i > 0, "ancla: la pestaña Informes ha cambiado de nombre; revisa esta prueba");
    const bloque = codigo.slice(i, i + 2600);
    assert.match(bloque, /\{entrevistas\.map\(/, "las entrevistas iniciales se archivan aquí (AV-0042)");
    assert.match(bloque, /\{reports\.map\(/, "y los informes de siempre siguen saliendo");
  });

  it("las entrevistas se piden aparte, por su plantilla", () => {
    assert.match(
      codigo,
      /plantilla=\$\{CLAVE_ENTREVISTA\}/,
      "sin la segunda petición, la entrevista de un paciente con más de 100 sesiones desaparecería de la ficha"
    );
  });
});

describe("el botón «Nueva entrevista inicial» de la cabecera", () => {
  // Dónde empieza la columna de botones de la cabecera, para no dar por bueno
  // el enlace que vive dentro del modal de «Nuevo informe» (que es otra cosa:
  // ahí es una nota de «esto no es un informe», y no el botón que se pidió).
  const cabecera = codigo.indexOf("Nuevo registro");
  const bloque = codigo.slice(cabecera, cabecera + 2600);

  it("está en la cabecera, con los de «Nuevo registro» y «Nuevo informe»", () => {
    assert.ok(cabecera > 0, "ancla: «Nuevo registro» ha cambiado de nombre; revisa esta prueba");
    assert.match(bloque, /Nuevo informe/);
    assert.match(bloque, /Nueva entrevista inicial/, "04/09/2026, Rodrigo: la entrevista se estrena desde la ficha");
  });

  it("abre el registro nuevo con la plantilla de la entrevista", () => {
    assert.match(
      bloque,
      /\/pacientes\/\$\{patient\.id\}\/sesiones\/nueva\?plantilla=\$\{CLAVE_ENTREVISTA\}/,
      "el botón es el formulario de siempre; lo único que cambia es la plantilla, y viaja en la URL"
    );
  });

  it("la clave sale de la constante y no escrita a mano en ningún sitio", () => {
    // Si mañana cambia `CLAVE_ENTREVISTA`, una copia literal dejaría el botón
    // abriendo un registro normal sin que nada avisara.
    assert.equal(
      codigo.includes(`plantilla=${CLAVE_ENTREVISTA}`),
      false,
      "la ficha tiene que componer la URL con CLAVE_ENTREVISTA, no con el texto"
    );
  });

  it("solo sale si el centro ofrece la plantilla", () => {
    assert.match(bloque, /ofreceEntrevista &&/, "un centro que la borró de sus plantillas abriría un registro con otra");
    assert.match(codigo, /\/api\/clinica\/plantillas/, "y eso hay que preguntárselo al centro");
    assert.match(
      codigo,
      /\[ofreceEntrevista, setOfreceEntrevista\] = useState\(true\)/,
      "arranca puesta: la de fábrica está en todos los centros y el botón no debe aparecer medio segundo tarde"
    );
  });
});
