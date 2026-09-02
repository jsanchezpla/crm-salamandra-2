// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-factura-a-nombre-de-tutor.mjs — la factura a nombre de un tutor de la
 * familia (02/09/2026, decisión de Rodrigo).
 *
 *   node scripts/_smoke-factura-a-nombre-de-tutor.mjs
 *
 * El pagador sigue siendo la ficha de la familia; lo que cambia es a quién se
 * le emite: nombre y DNI del tutor, con la dirección fiscal de la familia. Esta
 * prueba fija la foto que se congela al emitir, lo que se imprime en un
 * borrador (sin foto todavía) y que un tutor sin DNI se detecta antes de
 * emitir, que es el caso que dejaría una factura sin NIF.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tutorDe, fotoFiscalDeTutor, datosFiscalesDe, aNombreDe, faltaParaEmitirATutor, ATRIBUTOS_PARA_CONGELAR } from "../lib/billing/datosFiscales.js";
import { ATRIBUTOS_CLIENTE_FACTURA } from "../lib/billing/nifCliente.js";

const MADRE = { id: "11111111-1111-4111-8111-111111111111", name: "Marta Pérez López", relationship: "madre", dni: "12345678A", phone: "600", email: "m@x.es", signer: true };
const PADRE = { id: "22222222-2222-4222-8222-222222222222", name: "Luis Gómez Ruiz", relationship: "padre", dni: null, signer: true };
const FAMILIA = {
  id: "c1",
  name: "Familia Gómez Pérez",
  fiscalName: "Luis Gómez Ruiz",
  taxId: "99999999R",
  fiscalAddress: "C/ Mayor 1",
  fiscalZip: "28001",
  fiscalCity: "Madrid",
  fiscalCountry: "ES",
  guardians: [MADRE, PADRE],
};

describe("tutorDe", () => {
  it("encuentra al tutor por su id dentro de la ficha, y null si no está", () => {
    assert.equal(tutorDe(FAMILIA, MADRE.id)?.name, MADRE.name);
    assert.equal(tutorDe(FAMILIA, "33333333-3333-4333-8333-333333333333"), null);
    assert.equal(tutorDe({ ...FAMILIA, guardians: null }, MADRE.id), null);
    assert.equal(tutorDe(FAMILIA, null), null);
  });
});

describe("fotoFiscalDeTutor", () => {
  it("congela nombre y DNI del tutor con la dirección de la familia", () => {
    assert.deepEqual(fotoFiscalDeTutor(MADRE, FAMILIA), {
      nombre: "Marta Pérez López",
      nif: "12345678A",
      direccion: "C/ Mayor 1",
      cp: "28001",
      ciudad: "Madrid",
      pais: "ES",
    });
  });
  it("sin tutor no hay foto", () => {
    assert.equal(fotoFiscalDeTutor(null, FAMILIA), null);
  });
});

describe("datosFiscalesDe con tutor", () => {
  it("un borrador a nombre del tutor imprime al tutor (sin foto todavía)", () => {
    const d = datosFiscalesDe({ guardianId: MADRE.id, fiscalSnapshot: null }, FAMILIA);
    assert.equal(d.nombre, "Marta Pérez López");
    assert.equal(d.nif, "12345678A");
    assert.equal(d.direccion, "C/ Mayor 1");
    assert.equal(d.congelado, false);
  });
  it("una factura emitida imprime su foto, aunque el tutor haya cambiado después", () => {
    const d = datosFiscalesDe({ guardianId: MADRE.id, fiscalSnapshot: { nombre: "Marta Pérez", nif: "12345678A" } }, { ...FAMILIA, guardians: [] });
    assert.equal(d.nombre, "Marta Pérez");
    assert.equal(d.congelado, true);
  });
  it("sin tutor, lo de siempre: la ficha de la familia", () => {
    const d = datosFiscalesDe({ guardianId: null, fiscalSnapshot: null }, FAMILIA);
    assert.equal(d.nombre, "Luis Gómez Ruiz");
    assert.equal(d.nif, "99999999R");
  });
  it("un tutor que ya no está en la ficha cae a la familia, no a un nombre vacío", () => {
    const d = datosFiscalesDe({ guardianId: "33333333-3333-4333-8333-333333333333", fiscalSnapshot: null }, FAMILIA);
    assert.equal(d.nombre, "Luis Gómez Ruiz");
  });
});

describe("aNombreDe y faltaParaEmitirATutor", () => {
  it("dice a nombre de quién va, y null cuando va a nombre de la ficha", () => {
    assert.equal(aNombreDe({ guardianId: MADRE.id }, FAMILIA), "Marta Pérez López");
    assert.equal(aNombreDe({ guardianId: MADRE.id, fiscalSnapshot: { nombre: "Marta P.", nif: "x" } }, { ...FAMILIA, guardians: [] }), "Marta P.");
    assert.equal(aNombreDe({ guardianId: null }, FAMILIA), null);
  });
  it("antes de emitir: el tutor tiene que existir y tener DNI", () => {
    assert.equal(faltaParaEmitirATutor({ guardianId: MADRE.id }, FAMILIA), null);
    assert.match(faltaParaEmitirATutor({ guardianId: PADRE.id }, FAMILIA), /DNI/);
    assert.match(faltaParaEmitirATutor({ guardianId: "33333333-3333-4333-8333-333333333333" }, FAMILIA), /ya no está/);
    assert.equal(faltaParaEmitirATutor({ guardianId: null }, FAMILIA), null);
  });
});

describe("las listas blancas y los tutores", () => {
  it("para congelar al emitir se piden los guardians; la lista de los listados NO los lleva (DNI y teléfono no viajan)", () => {
    assert.ok(ATRIBUTOS_PARA_CONGELAR.includes("guardians"));
    assert.equal(ATRIBUTOS_CLIENTE_FACTURA.includes("guardians"), false);
  });
});
