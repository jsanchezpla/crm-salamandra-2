// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-duplicada.mjs — cuándo una cuota nueva repite una viva
 * (18/09/2026, AV-0195).
 *
 *   node scripts/_smoke-cuota-duplicada.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 *
 * Aumenta, dos veces: «aunque el paciente no tenga esa cuota nos dice que ya
 * tiene una cuota activa» y «nos hemos metido a T.O. 60x1, hemos añadido a
 * Aumentín y no aparece; en las siguientes ya no nos deja crear la cuota».
 *
 * El alta se saltaba a quien tuviera CUALQUIER cuota viva. En producción eso
 * eran las 284 parejas cliente+paciente con cuota, y de las 7 que sí llevan
 * varias ninguna comparte concepto: el freno no paró nunca un duplicado de
 * verdad y sí impedía el alta de la segunda terapia.
 *
 * Lo que aquí se fija, por lo que DEVUELVE:
 *
 *  - DOS TERAPIAS DISTINTAS NO SON UN DUPLICADO: logopedia y T.O. conviven.
 *  - EL MISMO CONCEPTO SÍ: es el doble clic que el freno venía a parar, y da
 *    igual que la cuota vieja lleve además otras terapias.
 *  - SIN CONCEPTOS (importe suelto) solo choca con otra igual de suelta.
 *  - EL MOTIVO DICE CUÁL: «ya tiene esta cuota activa (Cuota T.O. 60x1)», que
 *    es lo que faltaba para que el centro no creyera que el alta se perdía.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cuotaQueRepite, motivoDeRepetida } from "../lib/billing/cuotaDuplicada.js";

const LOGO = "11111111-1111-4111-8111-111111111111";
const TO = "22222222-2222-4222-8222-222222222222";
const PSICO = "33333333-3333-4333-8333-333333333333";

const catalogo = new Map([
  [LOGO, { id: LOGO, name: "Cuota Logopedia 45x1" }],
  [TO, { id: TO, name: "Cuota T.O. 60x1" }],
  [PSICO, { id: PSICO, name: "Cuota Psicología 60x1" }],
]);

describe("cuotaQueRepite", () => {
  it("deja entrar una terapia distinta de la que ya paga", () => {
    const vivas = [{ id: "c1", conceptIds: [LOGO] }];
    assert.equal(cuotaQueRepite(vivas, [TO]), null);
  });

  it("para el doble clic: el mismo concepto otra vez", () => {
    const vivas = [{ id: "c1", conceptIds: [LOGO] }];
    assert.equal(cuotaQueRepite(vivas, [LOGO])?.id, "c1");
  });

  it("también cuando la vieja lleva ese concepto con otros al lado", () => {
    const vivas = [{ id: "c1", conceptIds: [LOGO, PSICO] }];
    assert.equal(cuotaQueRepite(vivas, [PSICO])?.id, "c1");
  });

  it("basta con que se repita UNO de los conceptos que llegan", () => {
    const vivas = [{ id: "c1", conceptIds: [TO] }];
    assert.equal(cuotaQueRepite(vivas, [LOGO, TO])?.id, "c1");
  });

  it("sin ninguna cuota viva no repite nada", () => {
    assert.equal(cuotaQueRepite([], [LOGO]), null);
    assert.equal(cuotaQueRepite(undefined, [LOGO]), null);
  });

  it("el importe suelto choca con otro importe suelto", () => {
    const vivas = [{ id: "c1", conceptIds: [] }];
    assert.equal(cuotaQueRepite(vivas, [])?.id, "c1");
  });

  it("pero un importe suelto no choca con una cuota de catálogo, ni al revés", () => {
    assert.equal(cuotaQueRepite([{ id: "c1", conceptIds: [LOGO] }], []), null);
    assert.equal(cuotaQueRepite([{ id: "c1", conceptIds: [] }], [LOGO]), null);
  });

  it("aguanta conceptIds nulo o con basura dentro", () => {
    assert.equal(cuotaQueRepite([{ id: "c1", conceptIds: null }], [])?.id, "c1");
    assert.equal(cuotaQueRepite([{ id: "c1", conceptIds: [LOGO] }], [null, "", LOGO])?.id, "c1");
  });

  it("devuelve la PRIMERA que choca, para poder enseñarla", () => {
    const vivas = [
      { id: "c1", conceptIds: [PSICO] },
      { id: "c2", conceptIds: [LOGO] },
    ];
    assert.equal(cuotaQueRepite(vivas, [LOGO, PSICO])?.id, "c1");
  });
});

describe("motivoDeRepetida", () => {
  it("nombra la cuota que choca", () => {
    assert.equal(
      motivoDeRepetida({ id: "c1", conceptIds: [TO] }, catalogo),
      "ya tiene esta cuota activa (Cuota T.O. 60x1)",
    );
  });

  it("nombra todas cuando la vieja lleva varias", () => {
    assert.equal(
      motivoDeRepetida({ id: "c1", conceptIds: [LOGO, PSICO] }, catalogo),
      "ya tiene esta cuota activa (Cuota Logopedia 45x1 + Cuota Psicología 60x1)",
    );
  });

  it("lo dice igual cuando es de importe suelto", () => {
    assert.equal(motivoDeRepetida({ id: "c1", conceptIds: [] }, catalogo), "ya tiene una cuota activa con importe suelto");
  });

  it("no se rompe si el concepto ya no está en el catálogo", () => {
    assert.equal(motivoDeRepetida({ id: "c1", conceptIds: ["fantasma"] }, catalogo), "ya tiene esta cuota activa");
    assert.equal(motivoDeRepetida({ id: "c1", conceptIds: [TO] }), "ya tiene esta cuota activa");
  });
});
