// @prueba ligera
/**
 * A qué correos se avisa a una familia (06/09/2026, Rodrigo: «manda el correo
 * también a los tutores cuando la ficha no tenga»): el registro de sesión
 * publicado y la factura van al correo de la ficha y, si no lo tiene, a todos
 * los tutores que tengan uno. `lib/clients/contactoDeFicha.js`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { correosParaAvisar } from "../lib/clients/contactoDeFicha.js";
import { motivoParaNoAvisar } from "../lib/clinica/correoRegistro.js";

const tutores = [
  { id: "t1", name: "Marta", relationship: "madre", email: "marta@example.com" },
  { id: "t2", name: "Luis", relationship: "padre", email: " LUIS@example.com " },
  { id: "t3", name: "Abuela", relationship: "otro", email: "" },
  { id: "t4", name: "Repetida", relationship: "tutor", email: "marta@example.com" },
  { id: "t5", name: "Mal", relationship: "tutor", email: "esto no es un correo" },
];

describe("correosParaAvisar — la ficha manda, los tutores son el respaldo", () => {
  it("con correo en la ficha, solo ese, aunque los tutores tengan otros", () => {
    assert.deepEqual(correosParaAvisar({ email: "familia@example.com", guardians: tutores }), {
      correos: ["familia@example.com"],
      deTutores: false,
    });
  });
  it("sin correo en la ficha, todos los tutores con uno válido, sin repetir", () => {
    const r = correosParaAvisar({ email: "  ", guardians: tutores });
    assert.deepEqual(r.correos, ["marta@example.com", "LUIS@example.com"]);
    assert.equal(r.deTutores, true);
  });
  it("un correo de ficha que no es un correo no cuenta: se mira a los tutores", () => {
    assert.deepEqual(correosParaAvisar({ email: "sin arroba", guardians: tutores }).correos, ["marta@example.com", "LUIS@example.com"]);
  });
  it("sin correo en ninguna parte, lista vacía y sin inventar", () => {
    assert.deepEqual(correosParaAvisar({ email: null, guardians: [{ id: "x", name: "Nadie" }] }), { correos: [], deTutores: false });
    assert.deepEqual(correosParaAvisar(null), { correos: [], deTutores: false });
  });
});

describe("motivoParaNoAvisar — dice por qué, y ya no culpa solo a la ficha", () => {
  it("con correos no hay motivo", () => {
    assert.equal(motivoParaNoAvisar({ correos: ["a@b.co"] }), null);
    assert.equal(motivoParaNoAvisar({ email: "a@b.co" }), null);
  });
  it("sin correos, el motivo nombra a la ficha y a los tutores", () => {
    const m = motivoParaNoAvisar({ correos: [] });
    assert.match(m, /ficha/);
    assert.match(m, /tutores/);
    assert.match(motivoParaNoAvisar({}), /tutores/);
  });
});
