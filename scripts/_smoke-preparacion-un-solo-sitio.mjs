// @prueba ligera — lee el CÓDIGO de una pantalla; sin base, sin servidor, sin .env.
/**
 * _smoke-preparacion-un-solo-sitio.mjs — la preparación de la sesión se
 * escribe en UN estado, no en dos (01/09/2026).
 *
 *   node scripts/_smoke-preparacion-un-solo-sitio.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, 01/09/2026: «guardar la preparación de la sesión clínica no
 * funciona, no se guarda nada como borrador». Y no se guardaba.
 *
 * `/pacientes/[id]/sesiones/nueva` tiene DOS pantallas que piden lo mismo: el
 * registro completo (su tarjeta «1 · Preparación») y «Preparar la sesión», a la
 * que se llega con `?preparar=1` o con el enlace «Guárdala solo como
 * preparación». La segunda guardaba su texto en un estado propio (`prepSolo`)
 * que NADIE rellenaba al llegar desde la primera: se escribía la preparación en
 * el registro, se pulsaba el enlace y aparecía el recuadro vacío con el botón
 * apagado —`disabled={... || !prepSolo.trim()}`—, sin error y sin manera de
 * seguir. El día y los adjuntos ya se compartían; el texto era el único que se
 * caía por la rendija, y por eso costaba de ver.
 *
 * Lo que esta prueba defiende no es «que guarde» —eso lo fija
 * `_smoke-clinica-preparar.mjs` sobre `payloadDePreparacion`, que estaba bien—,
 * es que la preparación siga teniendo UNA sola fuente: `form.prepText`. Con dos
 * estados el fallo vuelve, y vuelve mudo.
 *
 * ── POR QUÉ SE LEE EL TEXTO Y NO SE EJECUTA ────────────────────────────────
 * Es una página de React con hooks, `useSearchParams` y tres fetch: montarla
 * pide un DOM y un router de Next. Lo que se rompió es una palabra —qué estado
 * lee cada `value=`—, así que leer el fichero atrapa exactamente esa clase de
 * fallo y cuesta milisegundos. Cada aserción exige además que su ANCLA exista:
 * si alguien reordena la pantalla, la prueba falla pidiendo que se revise en
 * vez de aprobar por no encontrar nada.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTA = path.join(RAIZ, "app", "(dashboard)", "pacientes", "[id]", "sesiones", "nueva", "page.jsx");
const fuente = fs.readFileSync(RUTA, "utf8");
// Sin comentarios: el porqué del arreglo NOMBRA el estado viejo, y buscarlo en
// el fichero entero daría un falso positivo eterno.
const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("la preparación vive en un solo estado", () => {
  it("no hay un segundo useState para la preparación", () => {
    const otros = codigo.match(/useState[^\n]*\n?/g) ?? [];
    assert.ok(otros.length > 0, "ancla: la pantalla ya no declara estado; revisa esta prueba");
    assert.equal(
      /prepSolo/.test(codigo),
      false,
      "`prepSolo` ha vuelto: dos estados para la misma preparación es el fallo del 01/09/2026"
    );
  });

  it("las DOS pantallas escriben en form.prepText", () => {
    const bindings = codigo.match(/value=\{form\.prepText\}/g) ?? [];
    assert.equal(
      bindings.length,
      2,
      `se esperaban 2 recuadros atados a form.prepText (registro y preparación) y hay ${bindings.length}`
    );
  });

  it("guardarPreparacion manda lo que hay en form.prepText", () => {
    const i = codigo.indexOf("function guardarPreparacion");
    assert.ok(i > 0, "ancla: `guardarPreparacion` ya no se llama así; revisa esta prueba");
    const cuerpo = codigo.slice(i, i + 1600);
    assert.match(
      cuerpo,
      /prepText:\s*form\.prepText/,
      "el alta de la preparación tiene que mandar `form.prepText`, no otro estado"
    );
  });

  it("el botón de guardar se apaga por form.prepText y no por otra cosa", () => {
    const i = codigo.indexOf("onClick={guardarPreparacion}");
    assert.ok(i > 0, "ancla: el botón de guardar la preparación ha cambiado; revisa esta prueba");
    const boton = codigo.slice(i, i + 400);
    assert.match(
      boton,
      /disabled=\{saving \|\| !form\.prepText\.trim\(\)\}/,
      "el botón tiene que mirar el MISMO texto que se guarda, o vuelve a quedarse apagado con la preparación escrita"
    );
  });

  it("el registro completo sigue mandando la preparación al guardar la sesión", () => {
    const i = codigo.indexOf("function guardarRegistro");
    assert.ok(i > 0, "ancla: `guardarRegistro` ya no se llama así; revisa esta prueba");
    const cuerpo = codigo.slice(i, i + 2000);
    assert.match(cuerpo, /prepText:\s*form\.prepText/, "el registro completo tiene que guardar su preparación");
  });
});
