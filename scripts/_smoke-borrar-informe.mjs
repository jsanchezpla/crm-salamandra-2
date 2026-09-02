// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-borrar-informe.mjs — quién puede borrar un informe clínico
 * (02/09/2026, AV-0021 de Aumenta).
 *
 *   node scripts/_smoke-borrar-informe.mjs
 *
 * Un informe de prueba se quedaba para siempre porque no había DELETE. La
 * regla que Rodrigo eligió —solo borradores; quien lo firma o dirección; un
 * informe entregado no se borra nunca— vive en `lib/clinica/alcanceInformes.js`
 * y esta prueba la fija caso a caso, porque el que falla aquí es el que borra
 * un informe que una familia ya ha leído.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { puedeBorrarInforme, motivoParaNoBorrar, esDireccion } from "../lib/clinica/alcanceInformes.js";

const borrador = { status: "draft", therapistId: "t1" };

describe("puedeBorrarInforme", () => {
  it("dirección borra cualquier borrador, también los de otras terapeutas", () => {
    assert.equal(puedeBorrarInforme({ esAdmin: true, row: borrador, teamMemberId: null }), true);
    assert.equal(puedeBorrarInforme({ esAdmin: true, row: borrador, teamMemberId: "otra" }), true);
  });

  it("la terapeuta que lo firma borra su borrador; otra terapeuta, no", () => {
    assert.equal(puedeBorrarInforme({ esAdmin: false, row: borrador, teamMemberId: "t1" }), true);
    assert.equal(puedeBorrarInforme({ esAdmin: false, row: borrador, teamMemberId: "t2" }), false);
    assert.equal(puedeBorrarInforme({ esAdmin: false, row: borrador, teamMemberId: null }), false);
  });

  it("un informe revisado o entregado no lo borra NADIE, ni dirección", () => {
    for (const status of ["reviewed", "delivered"]) {
      assert.equal(puedeBorrarInforme({ esAdmin: true, row: { status, therapistId: "t1" }, teamMemberId: "t1" }), false, status);
      assert.equal(puedeBorrarInforme({ esAdmin: false, row: { status, therapistId: "t1" }, teamMemberId: "t1" }), false, status);
    }
  });

  it("sin informe no hay nada que borrar", () => {
    assert.equal(puedeBorrarInforme({ esAdmin: true, row: null, teamMemberId: "t1" }), false);
  });
});

describe("motivoParaNoBorrar", () => {
  it("dice por qué, en las palabras de quien lo intenta, y null cuando sí puede", () => {
    assert.equal(motivoParaNoBorrar({ esAdmin: false, row: borrador, teamMemberId: "t1" }), null);
    assert.match(motivoParaNoBorrar({ esAdmin: true, row: { status: "delivered" }, teamMemberId: null }), /entregado/);
    assert.match(motivoParaNoBorrar({ esAdmin: false, row: borrador, teamMemberId: "t2" }), /dirección/);
    assert.match(motivoParaNoBorrar({ esAdmin: true, row: null, teamMemberId: null }), /no existe/);
  });
});

describe("esDireccion", () => {
  it("admin y superadmin son dirección; user, no; nada, no", () => {
    assert.equal(esDireccion("admin"), true);
    assert.equal(esDireccion("superadmin"), true);
    assert.equal(esDireccion("user"), false);
    assert.equal(esDireccion(undefined), false);
  });
});
