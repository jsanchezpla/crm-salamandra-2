// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-incidencia-identificador.mjs — con qué se llama a un caso (18/09/2026).
 *
 *   node scripts/_smoke-incidencia-identificador.mjs
 *
 * ── QUÉ PROTEGE ────────────────────────────────────────────────────────────
 *
 * `interpretar()` es la primera línea de la skill `/incidencia`: decide si lo
 * que te han escrito es un aviso del Buzón o una tarea del Registro. Si se
 * equivoca, el caso sale «no existe» teniendo el aviso delante — y quien lo
 * lanza se cree que no hay nada apuntado.
 *
 * El caso que de verdad hay que sujetar es `av0169`: casa con las DOS formas
 * (referencia sin guion y ficha del tablero, que es `[a-z0-9]{4,32}`). La
 * lógica que vivía suelta en `scripts/buzon-triaje.mjs` no tenía prueba
 * ninguna, así que este orden se podía invertir en una refactorización sin que
 * nada se pusiera rojo.
 *
 * Se prueba lo que DEVUELVE, no cómo está escrito.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { comoBuscarElAviso, interpretar } from "../lib/incidencias/identificador.js";

test("la referencia del Buzón, se escriba como se escriba", () => {
  for (const escrito of ["AV-0169", "av-0169", "AV0169", "av0169", "AV 0169", "  AV-0169  "]) {
    assert.deepEqual(interpretar(escrito), { tipo: "aviso", numero: 169 }, escrito);
  }
});

test("los ceros de delante no hacen dos avisos distintos", () => {
  assert.deepEqual(interpretar("AV-0007"), { tipo: "aviso", numero: 7 });
  assert.deepEqual(interpretar("AV-7"), { tipo: "aviso", numero: 7 });
});

test("«av0169» es el aviso 169 y NO una ficha del tablero", () => {
  // La trampa: «av0169» son 6 caracteres [a-z0-9], o sea una ficha válida.
  // Si algún día esto devuelve {tipo:"ficha"}, la skill dejará de encontrar
  // los avisos dictados por teléfono, que es como llegan casi todos.
  assert.equal(interpretar("av0169").tipo, "aviso");
});

test("la ficha del Registro", () => {
  assert.deepEqual(interpretar("s55hv5"), { tipo: "ficha", ficha: "s55hv5" });
  assert.deepEqual(interpretar("cnuyfb"), { tipo: "ficha", ficha: "cnuyfb" });
  // Dictada a gritos: se guarda y se escribe en minúsculas.
  assert.deepEqual(interpretar("S55HV5"), { tipo: "ficha", ficha: "s55hv5" });
});

test("el UUID del aviso", () => {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  assert.deepEqual(interpretar(id), { tipo: "avisoId", id });
  // 32 hex sin guiones son una «ficha» por longitud: solo el UUID con guiones
  // cuenta como id, y es como lo escupen todas nuestras consultas.
  assert.equal(interpretar(id.toUpperCase()).tipo, "avisoId");
});

test("lo que no identifica nada se devuelve como texto, sin inventar", () => {
  assert.deepEqual(interpretar("el cobro de la E.I."), { tipo: "texto", texto: "el cobro de la E.I." });
  assert.deepEqual(interpretar(""), { tipo: "texto", texto: "" });
  assert.deepEqual(interpretar(null), { tipo: "texto", texto: "" });
  // Tres caracteres se quedan cortos para una ficha (el mínimo es 4).
  assert.equal(interpretar("abc").tipo, "texto");
});

test("el where de Sequelize que sale de cada uno", () => {
  assert.deepEqual(comoBuscarElAviso("AV-0169"), { numero: 169 });
  assert.deepEqual(comoBuscarElAviso("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  });
  // Una ficha identifica la TAREA: el aviso se busca por la columna que la
  // guarda (`registro_ficha`), que es el vínculo que existe desde el 02/09/2026.
  assert.deepEqual(comoBuscarElAviso("s55hv5"), { registroFicha: "s55hv5" });
  assert.equal(comoBuscarElAviso("el cobro de la E.I."), null);
});
