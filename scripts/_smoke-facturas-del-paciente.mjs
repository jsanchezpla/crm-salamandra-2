// @prueba ligera
/**
 * _smoke-facturas-del-paciente.mjs — qué facturas se ven en la ficha de un
 * paciente (09/09/2026).
 *
 * Rodrigo: «las facturas que sobran déjalas en la ficha de familia y pónselas a
 * todos los pacientes por igual, por si las buscan en uno de los pacientes de
 * cada familia que les salgan».
 *
 * Son las 2.964 de 76 familias con hermanos que llegaron del volcado sin decir
 * de qué hijo eran. Lo que esta prueba defiende es CÓMO se hace: al mirar y no
 * duplicando filas, y sin colar nunca la factura de un hermano en la ficha del
 * otro — que sería peor que no enseñar ninguna.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  whereFacturasDelPaciente,
  esDeLaFamilia,
  repartirFacturas,
} from "../lib/billing/facturasDelPaciente.js";

// Un doble de los operadores de Sequelize: solo hace falta que `Op.or` sea una
// clave estable, no el símbolo de verdad.
const Op = { or: Symbol.for("or") };

const HUGO = "p-hugo";
const CASA = "c-casa";

test("sin pedirlo, solo las suyas: lo de siempre", () => {
  assert.deepEqual(whereFacturasDelPaciente({ patientId: HUGO, clientId: CASA, Op }), { patientId: HUGO });
});

test("con las de la familia, las suyas O las que no son de ningún hermano", () => {
  const w = whereFacturasDelPaciente({ patientId: HUGO, clientId: CASA, conLasDeLaFamilia: true, Op });
  assert.deepEqual(w[Op.or], [{ patientId: HUGO }, { clientId: CASA, patientId: null }]);
});

test("EL CASO QUE NO PUEDE PASAR: la factura de un hermano no entra", () => {
  /*
   * La segunda rama exige `patientId: null`. Sin eso, «las de mi familia»
   * incluiría las de mi hermana, y en la ficha de Hugo saldrían las de Marta
   * con su nombre y su importe. Eso no es un despiste de pantalla: es enseñar
   * la facturación de otro paciente.
   */
  const w = whereFacturasDelPaciente({ patientId: HUGO, clientId: CASA, conLasDeLaFamilia: true, Op });
  const rama = w[Op.or][1];
  assert.equal(rama.patientId, null, "la rama de la familia tiene que exigir SIN paciente");
  assert.equal(rama.clientId, CASA);
});

test("sin familia conocida no se abre la puerta", () => {
  // Un paciente sin ficha de familia enlazada: se queda con las suyas y ya. Si
  // no, `clientId: null` traería TODAS las facturas sin paciente del centro.
  for (const clientId of [null, undefined, ""]) {
    assert.deepEqual(
      whereFacturasDelPaciente({ patientId: HUGO, clientId, conLasDeLaFamilia: true, Op }),
      { patientId: HUGO },
      String(clientId),
    );
  }
});

test("«de la familia» es no tener paciente, no ser de otro", () => {
  assert.equal(esDeLaFamilia({ id: 1, patientId: null }), true);
  assert.equal(esDeLaFamilia({ id: 2, patientId: "" }), true);
  assert.equal(esDeLaFamilia({ id: 3 }), true);
  assert.equal(esDeLaFamilia({ id: 4, patientId: HUGO }), false);
  assert.equal(esDeLaFamilia(null), true);
});

test("el reparto para la pantalla", () => {
  const lista = [
    { id: 1, patientId: HUGO },
    { id: 2, patientId: null },
    { id: 3, patientId: HUGO },
    { id: 4, patientId: null },
  ];
  const r = repartirFacturas(lista);
  assert.deepEqual(r.suyas.map((f) => f.id), [1, 3]);
  assert.deepEqual(r.deLaFamilia.map((f) => f.id), [2, 4]);
  // Ninguna se pierde ni se cuenta dos veces: es lo que hace que el total de la
  // ficha siga cuadrando.
  assert.equal(r.suyas.length + r.deLaFamilia.length, lista.length);
});

test("lo que llega roto no rompe la ficha", () => {
  assert.deepEqual(repartirFacturas(null), { suyas: [], deLaFamilia: [] });
  assert.deepEqual(repartirFacturas([]), { suyas: [], deLaFamilia: [] });
  assert.deepEqual(whereFacturasDelPaciente({ patientId: HUGO, Op }), { patientId: HUGO });
});
