// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-fecha-y-edad.mjs — «12/03/2015 · 8 años» (18/09/2026, AV-0210).
 *
 *   node scripts/_smoke-clients-fecha-y-edad.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Olga, de Aumenta: «necesitamos que en la ficha del cliente aparezca la fecha
 * de nacimiento + edad tanto de ellos si nos lo han dado como de los pacientes.
 * Al lado del nombre es un dato importante para manejar las terapeutas».
 *
 * `lib/clients/fechaYEdad.js` es la línea que se pinta al lado de cada nombre,
 * y lo que esta prueba sujeta es lo que puede pasar con un dato que MUCHAS
 * fichas no tienen (medido el 18/09/2026 en producción: 1.000 de 1.202
 * pacientes con fecha, 3 de 1.110 familias):
 *
 *   · sin fecha y sin edad no se pinta NADA —ni un guion ni un « · » suelto—,
 *     porque una cabecera llena de huecos es peor que una sin el dato;
 *   · la edad que llega del servidor MANDA sobre la que saldría de la fecha
 *     (el serializador de pacientes ya decide entre la fecha y la casilla
 *     «Edad» escrita a mano, `lib/clinica/edad.js`), y `edad: null` es una
 *     respuesta —«no lo sé»—, no un «calcúlala tú»;
 *   · un año se escribe «1 año», no «1 años»;
 *   · una fecha futura o ilegible no puede acabar en «-3 años» en la ficha.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { fechaCorta, fechaYEdad, textoEdad } from "../lib/clients/fechaYEdad.js";

/** Una fecha de nacimiento de hace `anos` años y un día, para no depender del día del cumpleaños. */
function naceHace(anos) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - anos);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

test("la fecha se lee como la escribe el centro: 12/03/2015", () => {
  assert.equal(fechaCorta("2015-03-12"), "12/03/2015");
  // DATEONLY de Sequelize y el ISO completo que devuelve un JSON dan lo mismo.
  assert.equal(fechaCorta("2015-03-12T00:00:00.000Z"), "12/03/2015");
  assert.equal(fechaCorta(null), "");
  assert.equal(fechaCorta(""), "");
  assert.equal(fechaCorta("no soy una fecha"), "");
});

test("un año es «1 año»; sin edad, nada", () => {
  assert.equal(textoEdad(1), "1 año");
  assert.equal(textoEdad(8), "8 años");
  assert.equal(textoEdad(0), "0 años"); // un bebé de meses tiene cero años
  assert.equal(textoEdad(null), "");
  assert.equal(textoEdad(undefined), "");
  assert.equal(textoEdad(-3), "");
  assert.equal(textoEdad(130), "");
});

test("con fecha se pinta la fecha y la edad calculada", () => {
  const { fecha, edad, texto } = fechaYEdad(naceHace(8));
  assert.equal(edad, 8);
  assert.equal(texto, `${fecha} · 8 años`);
});

test("sin fecha y sin edad no se pinta nada (es lo que tienen 1.107 familias de Aumenta)", () => {
  assert.deepEqual(fechaYEdad(null), { fecha: "", edad: null, texto: "" });
  assert.deepEqual(fechaYEdad(undefined), { fecha: "", edad: null, texto: "" });
  assert.deepEqual(fechaYEdad(""), { fecha: "", edad: null, texto: "" });
});

test("la edad que manda el servidor manda, y `null` significa «no lo sé»", () => {
  // Paciente sin fecha pero con la casilla «Edad» escrita a mano: el
  // serializador la resuelve y aquí solo se pinta.
  assert.equal(fechaYEdad(null, { edad: 12 }).texto, "12 años");
  // Y si el servidor dice que no la sabe, no se calcula por detrás.
  assert.equal(fechaYEdad("2015-03-12", { edad: null }).texto, "12/03/2015");
});

test("una fecha futura no pinta años en negativo", () => {
  /*
   * Mañana en hora LOCAL, no en UTC (19/09/2026). Con `toISOString` esta
   * prueba fallaba entre medianoche y las dos de la madrugada de Madrid:
   * allí el UTC va un día por detrás, así que «mañana» salía siendo HOY y
   * la edad era 0 en vez de null. `edadDesde` calcula en hora local y
   * estaba bien; lo frágil era el reloj de la prueba.
   */
  const m = new Date();
  m.setDate(m.getDate() + 1);
  const manana = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
  const { edad, texto } = fechaYEdad(manana);
  assert.equal(edad, null);
  assert.equal(texto, fechaCorta(manana)); // la fecha sí, la edad no
});
