// @prueba ligera
/**
 * _smoke-actas-reunion.mjs — el ACTA de una reunión de equipo (01/09/2026,
 * Aumenta por Rodrigo).
 *
 * Lo que se fija aquí, en orden de lo que más dolería si se rompiera:
 *
 *   1. **Las notas internas no se cuelan en el acta.** Es la única regla que,
 *      si se rompe, se rompe hacia fuera: lo que el equipo dice de una familia
 *      o de un compañero acabaría en el acta que se reparte. Un apartado de
 *      plantilla que pida esa clave se descarta, y `limpiarActa` guarda la foto
 *      de apartados SIN el bloque interno.
 *   2. **Solo las Reuniones de equipo tienen acta.** Unas vacaciones o un
 *      descanso, no.
 *   3. **El acta se compone con los apartados del centro**, y sin ellos con los
 *      cinco de fábrica — nunca con una lista vacía, que dejaría un acta con
 *      solo notas internas.
 *   4. **Guardar en blanco es borrar** (`actaVacia`), y la foto de apartados no
 *      cuenta como contenido: un acta con apartados y sin una palabra escrita
 *      sigue estando vacía.
 *   5. `limpiarActa` solo deja pasar las claves de los bloques: lo que mande de
 *      más el navegador no acaba en el JSONB.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOQUE_NOTAS_INTERNAS,
  CATEGORIA_ACTA,
  actaVacia,
  bloquesDelActa,
  limpiarActa,
  mensajeDelActa,
  promptDelActa,
  puedeTenerActa,
} from "../lib/reuniones/acta.js";
import { APARTADOS_ACTA_BASE, CLAVE_APARTADOS, PLANTILLA_BASE } from "../lib/clinica/plantillas.js";

test("solo los bloqueos de Reunión de equipo llevan acta", () => {
  assert.equal(puedeTenerActa({ categoryKey: CATEGORIA_ACTA }), true);
  assert.equal(puedeTenerActa({ categoryKey: "descanso" }), false);
  assert.equal(puedeTenerActa({ categoryKey: null }), false);
  assert.equal(puedeTenerActa({}), false);
  assert.equal(puedeTenerActa(null), false);
});

test("el acta la componen los apartados del centro, y las notas internas van al final", () => {
  const bloques = bloquesDelActa([
    { key: "asistentes", label: "Quién vino", tipo: "lista" },
    { key: "acuerdos", label: "Acuerdos", tipo: "lista" },
  ]);
  assert.deepEqual(
    bloques.map((b) => b.key),
    ["asistentes", "acuerdos", BLOQUE_NOTAS_INTERNAS.key]
  );
  // El título que puso el centro manda sobre el de fábrica.
  assert.equal(bloques[0].label, "Quién vino");
  // Y el bloque interno viene marcado, que es lo que mira quien reparte el acta.
  assert.equal(bloques.at(-1).interno, true);
});

test("sin apartados usables se cae a los cinco de fábrica, nunca a una lista vacía", () => {
  for (const entrada of [null, undefined, [], "no soy una lista", [{ sinTitulo: true }]]) {
    const bloques = bloquesDelActa(entrada);
    assert.equal(bloques.length, APARTADOS_ACTA_BASE.length + 1, JSON.stringify(entrada));
    assert.deepEqual(
      bloques.slice(0, -1).map((b) => b.key),
      APARTADOS_ACTA_BASE.map((a) => a.key)
    );
  }
  // Y esos cinco son los de la plantilla de fábrica: una sola verdad.
  assert.deepEqual(PLANTILLA_BASE.acta.apartados, APARTADOS_ACTA_BASE);
});

test("un apartado que pida la clave de las notas internas se descarta", () => {
  // Si se colara, escribiría en el mismo sitio que el bloque interno y el
  // material del equipo saldría impreso en el acta repartible.
  const bloques = bloquesDelActa([
    { key: "internalNotes", label: "Resumen para todos", tipo: "texto" },
    { key: "temas", label: "Temas tratados", tipo: "texto" },
  ]);
  const internos = bloques.filter((b) => b.key === BLOQUE_NOTAS_INTERNAS.key);
  assert.equal(internos.length, 1);
  assert.equal(internos[0].label, BLOQUE_NOTAS_INTERNAS.label);
  assert.equal(internos[0].interno, true);
});

test("limpiarActa guarda los bloques y NADA más, y la foto va sin lo interno", () => {
  const bloques = bloquesDelActa(null);
  const guardada = limpiarActa(
    {
      asistentes: ["Rosa", "Olga"],
      temas: "Se repasó la lista de espera.",
      acuerdos: [],
      internalNotes: "Hablar con Marta a solas.",
      plantilla: "base",
      // Lo que mande de más el navegador no puede acabar en el JSONB.
      colada: "no debería guardarse",
      id: "tampoco",
    },
    bloques
  );

  assert.equal(guardada.asistentes, "Rosa\nOlga"); // las listas se guardan por líneas
  assert.equal(guardada.acuerdos, "");
  assert.equal(guardada.internalNotes, "Hablar con Marta a solas.");
  assert.equal("colada" in guardada, false);
  assert.equal("id" in guardada, false);

  // La FOTO de apartados es la que se imprime, y el bloque interno no es un
  // apartado de plantilla: no puede aparecer ahí.
  const foto = guardada[CLAVE_APARTADOS];
  assert.ok(Array.isArray(foto));
  assert.equal(foto.some((a) => a.key === BLOQUE_NOTAS_INTERNAS.key), false);
  assert.deepEqual(foto.map((a) => a.key), APARTADOS_ACTA_BASE.map((a) => a.key));
});

test("un acta en blanco es un acta vacía, aunque traiga la foto de apartados", () => {
  const bloques = bloquesDelActa(null);
  assert.equal(actaVacia(limpiarActa({}, bloques)), true);
  assert.equal(actaVacia(limpiarActa({ asistentes: "   ", temas: "" }, bloques)), true);
  assert.equal(actaVacia(null), true);
  // Con una sola palabra escrita, ya no.
  assert.equal(actaVacia(limpiarActa({ temas: "Lista de espera" }, bloques)), false);
  // Y las notas internas SOLAS también cuentan como acta: se guardan.
  assert.equal(actaVacia(limpiarActa({ internalNotes: "Ojo con el horario" }, bloques)), false);
});

test("el prompt lleva las claves exactas y prohíbe inventarse acuerdos", () => {
  const bloques = bloquesDelActa(null);
  const system = promptDelActa(bloques);
  for (const b of bloques) assert.ok(system.includes(`"${b.key}"`), `falta la clave ${b.key}`);
  assert.ok(/SOLO un objeto JSON/i.test(system));
  assert.ok(/NO inventes/i.test(system));
  // Sin historia clínica en el cuerpo del acta: en una reunión de equipo se
  // habla de casos, y el acta se reparte.
  assert.ok(/historia clínica/i.test(system));
});

test("el mensaje lleva fecha y nombres, y no confunde la plantilla con la asistencia", () => {
  const bloques = bloquesDelActa(null);
  const msg = mensajeDelActa({
    material: "Estuvimos Rosa y Olga…",
    bloques,
    cuando: "miércoles, 2 de septiembre de 2026, 12:00",
    equipo: ["Rosa", "Olga", "  ", null],
    escrito: { temas: "Ya escrito a mano" },
  });
  assert.ok(msg.includes("miércoles, 2 de septiembre de 2026, 12:00"));
  assert.ok(msg.includes("Rosa, Olga")); // los vacíos se caen
  assert.ok(/NO son la lista de asistentes/i.test(msg));
  assert.ok(msg.includes("Ya escrito a mano"));
  assert.ok(/NO lo copies/i.test(msg));

  // Sin contexto, el mensaje sigue siendo válido y no inventa cabeceras.
  const pelado = mensajeDelActa({ material: "…", bloques });
  assert.ok(pelado.includes("MATERIAL DE LA REUNIÓN"));
  assert.equal(/lista de asistentes/i.test(pelado), false);
});
