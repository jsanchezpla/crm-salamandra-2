// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-paciente-del-bono.mjs — un bono de una familia con un solo hijo sale a
 * nombre de ese hijo (18/09/2026, AV-0159 de Aumenta).
 *
 *   node scripts/_smoke-paciente-del-bono.mjs
 *   node --test-name-pattern="varios" scripts/_smoke-paciente-del-bono.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rosa vio en Facturación → Bonos tres bonos con el paciente en blanco («de la
 * familia») y la ficha al lado con nombre de niño. Como la lista va por fecha,
 * los tres salían seguidos y los leyó como tres pacientes metidos en una misma
 * familia: «ES QUE NO SON FAMILIA, ESE ES EL PROBLEMA».
 *
 * Los tres eran de familias con UN SOLO paciente, donde «de la familia» no
 * distingue nada. La regla que lo arregla vive en `lib/billing/pacienteDelBono.js`.
 *
 * ── LO QUE ESTA PRUEBA CLAVA ───────────────────────────────────────────────
 *
 * Lo que de verdad hay que impedir no es que deduzca, es que deduzca de MÁS:
 * con dos hermanos no puede salir ningún nombre, porque ahí el bono es de la
 * familia de verdad y elegir uno sería inventarse de quién es el dinero. Por eso
 * la mitad de los casos de abajo son casos en los que la respuesta es `null`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  nombreDePaciente,
  unicoPacienteDe,
  pacienteUnicoPorFamilia,
} from "../lib/billing/pacienteDelBono.js";

const hijo = (id, clientId, firstName, lastName) => ({ id, clientId, firstName, lastName });

test("una familia con un solo paciente: el bono es suyo", () => {
  const uno = unicoPacienteDe([hijo("p1", "f1", "Sahara", "Castaño")]);
  assert.deepEqual(uno, { id: "p1", nombre: "Sahara Castaño" });
});

test("una familia con varios hermanos no deduce nada", () => {
  const varios = [hijo("p1", "f1", "Uno", "Uno"), hijo("p2", "f1", "Dos", "Dos")];
  assert.equal(unicoPacienteDe(varios), null);
});

test("una familia sin pacientes tampoco deduce nada", () => {
  assert.equal(unicoPacienteDe([]), null);
  assert.equal(unicoPacienteDe(), null);
  assert.equal(unicoPacienteDe(null), null);
});

test("las filas sin id no cuentan como paciente", () => {
  // Un `findAll` con `raw` puede traer un hueco; contarlo haría que una familia
  // con un hijo pareciera de dos y se quedara sin nombre.
  assert.deepEqual(unicoPacienteDe([hijo("p1", "f1", "Sola", "Sola"), { id: null }]), {
    id: "p1",
    nombre: "Sola Sola",
  });
});

test("un paciente sin nombre se dice, no se deja en blanco", () => {
  assert.equal(nombreDePaciente({ firstName: "", lastName: "" }), "(sin nombre)");
  assert.equal(nombreDePaciente(null), "(sin nombre)");
  assert.equal(nombreDePaciente({ firstName: "Ana" }), "Ana");
});

test("por familia: solo responden las que tienen un hijo", () => {
  const mapa = pacienteUnicoPorFamilia([
    hijo("p1", "f1", "Sahara", "Castaño"),
    hijo("p2", "f2", "Madeleine", "Fernández"),
    hijo("p3", "f3", "Hermano", "Uno"),
    hijo("p4", "f3", "Hermana", "Dos"),
  ]);
  assert.equal(mapa.size, 2);
  assert.deepEqual(mapa.get("f1"), { id: "p1", nombre: "Sahara Castaño" });
  assert.deepEqual(mapa.get("f2"), { id: "p2", nombre: "Madeleine Fernández" });
  // f3 tiene dos hermanos: su bono sigue siendo de la familia.
  assert.equal(mapa.get("f3"), undefined);
});

test("por familia: un paciente sin familia no arrastra a nadie", () => {
  const mapa = pacienteUnicoPorFamilia([hijo("p1", null, "Suelto", "Suelto")]);
  assert.equal(mapa.size, 0);
});

test("por familia: las claves son texto, vengan como vengan los ids", () => {
  // Los ids son UUID en producción y números en las pruebas de antes: el mapa
  // se consulta con `String(clientId)` y tiene que casar igual.
  const mapa = pacienteUnicoPorFamilia([hijo(7, 42, "Num", "Érico")]);
  assert.deepEqual(mapa.get("42"), { id: 7, nombre: "Num Érico" });
});

test("por familia: sin nada que mirar, mapa vacío y sin reventar", () => {
  assert.equal(pacienteUnicoPorFamilia().size, 0);
  assert.equal(pacienteUnicoPorFamilia(null).size, 0);
  assert.equal(pacienteUnicoPorFamilia([null, undefined]).size, 0);
});
