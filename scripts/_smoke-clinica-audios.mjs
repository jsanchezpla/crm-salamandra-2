// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clinica-audios.mjs — varios audios en un registro (04/09/2026).
 *
 *   node scripts/_smoke-clinica-audios.mjs
 *   node --test-name-pattern="tandas" scripts/_smoke-clinica-audios.mjs
 *
 * ── QUÉ SE FIJA AQUÍ ───────────────────────────────────────────────────────
 *
 * `lib/clinica/audios.js` decide dos cosas de las que depende que una sesión se
 * transcriba entera y en orden:
 *
 *  1. **Cómo se reparten los audios en peticiones.** El nginx del CRM corta los
 *     cuerpos a 30 MB: una tanda que se pase muere ANTES de llegar al código,
 *     con un HTML de nginx por respuesta. Que el reparto respete el tope no se
 *     puede comprobar leyendo la pantalla, así que se fija aquí.
 *  2. **En qué orden se junta el texto.** Es una nota clínica: si los trozos se
 *     juntan al revés, la sesión se cuenta al revés. El orden ES el de subida.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_AUDIOS,
  MAX_BYTES_POR_TANDA,
  duracionTotal,
  juntarTranscripciones,
  repartirEnTandas,
} from "../lib/clinica/audios.js";

const MB = 1024 * 1024;
const audio = (nombre, mb) => ({ name: nombre, size: Math.round(mb * MB) });

test("tandas: los audios de una sesión normal caben todos en una", () => {
  const tandas = repartirEnTandas([audio("a.m4a", 1.2), audio("b.m4a", 0.9), audio("c.m4a", 2)]);
  assert.equal(tandas.length, 1);
  assert.deepEqual(tandas[0].map((f) => f.name), ["a.m4a", "b.m4a", "c.m4a"]);
});

test("tandas: ninguna pasa del tope que aguanta el proxy", () => {
  const tandas = repartirEnTandas([audio("a", 12), audio("b", 12), audio("c", 12)]);
  for (const t of tandas) {
    const bytes = t.reduce((n, f) => n + f.size, 0);
    assert.ok(bytes <= MAX_BYTES_POR_TANDA, `una tanda pesa ${bytes} y el tope es ${MAX_BYTES_POR_TANDA}`);
  }
  assert.equal(tandas.flat().length, 3, "no se puede perder ningún audio por el camino");
});

test("tandas: un audio que él solo pasa del tope va en su propia tanda, no se tira", () => {
  const tandas = repartirEnTandas([audio("pequeño", 1), audio("enorme", 24)]);
  assert.equal(tandas.flat().length, 2);
  assert.ok(tandas.some((t) => t.length === 1 && t[0].name === "enorme"));
});

test("tandas: nunca más de MAX_AUDIOS por petición", () => {
  const muchos = Array.from({ length: MAX_AUDIOS + 3 }, (_, i) => audio(`a${i}`, 0.1));
  for (const t of repartirEnTandas(muchos)) assert.ok(t.length <= MAX_AUDIOS);
});

test("tandas: sin audios no hay tandas", () => {
  assert.deepEqual(repartirEnTandas([]), []);
  assert.deepEqual(repartirEnTandas(undefined), []);
});

test("juntar: el orden es el de subida y los vacíos no dejan huecos", () => {
  assert.equal(juntarTranscripciones(["Primero.", "", "  ", "Segundo."]), "Primero.\n\nSegundo.");
  assert.equal(juntarTranscripciones(["Uno", "Dos", "Tres"]), "Uno\n\nDos\n\nTres");
  assert.equal(juntarTranscripciones([]), "");
  assert.equal(juntarTranscripciones([null, undefined]), "");
});

test("duración: suma la de los audios que la traen", () => {
  assert.equal(duracionTotal([60, 120, 30]), 210);
  assert.equal(duracionTotal([60, null, 30]), 90);
});

test("duración: sin ninguna es null, no cero — cero significaría «no hubo audio»", () => {
  assert.equal(duracionTotal([null, undefined]), null);
  assert.equal(duracionTotal([]), null);
});
