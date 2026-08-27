/**
 * _smoke-citas-ficha.mjs — el botón que lleva de una cita a la ficha.
 *
 * @prueba ligera
 *
 * Prueba lo que DEVUELVE `fichaDeLaCita()`, no cómo está escrita. Lo que vigila
 * de verdad son las dos formas de equivocarse aquí:
 *
 *   1. Enseñar el botón cuando no hay ficha detrás (URL con `undefined`, 404 con
 *      pinta de fallo del CRM).
 *   2. Rotularlo a fuego como «Cliente», que dejaría la agenda de Laura
 *      hablando de clientes mientras su menú dice «Pacientes».
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fichaDeLaCita } from "../lib/citas/fichaDeLaCita.js";
import {
  VOCABULARIO_CLIENTE,
  VOCABULARIO_CONTRATANTE,
  VOCABULARIO_PACIENTE,
  vocabularioCliente,
} from "../lib/clients/vocabulario.js";

const CITA = { id: "b-1", clientId: "c-123", clientName: "Una familia" };

describe("cuándo NO hay botón", () => {
  it("una cita sin ficha enlazada no lleva a ningún sitio", () => {
    // Las 26 citas de cada demo están así: nombre escrito y nada más.
    assert.equal(fichaDeLaCita({ id: "b-1", clientName: "Alguien" }, { conClientes: true }), null);
  });

  it("clientId vacío o en blanco tampoco cuenta", () => {
    assert.equal(fichaDeLaCita({ clientId: "" }, { conClientes: true }), null);
    assert.equal(fichaDeLaCita({ clientId: "   " }, { conClientes: true }), null);
    assert.equal(fichaDeLaCita({ clientId: null }, { conClientes: true }), null);
  });

  it("sin el módulo de Clientes no se ofrece una pantalla que no existe", () => {
    assert.equal(fichaDeLaCita(CITA, { conClientes: false }), null);
  });

  it("ante la duda, no hay botón: `conClientes` tiene que decirse", () => {
    // Si el servidor no lo resolvió, el defecto es callar. Un botón a una
    // pantalla que el centro no tiene manda a alguien a pedir un módulo.
    assert.equal(fichaDeLaCita(CITA), null);
    assert.equal(fichaDeLaCita(CITA, {}), null);
  });

  it("no revienta con una cita que no llega", () => {
    assert.equal(fichaDeLaCita(null, { conClientes: true }), null);
    assert.equal(fichaDeLaCita(undefined, { conClientes: true }), null);
  });
});

describe("a dónde lleva", () => {
  it("a la ficha de esa cuenta, y nunca con «undefined» dentro", () => {
    const f = fichaDeLaCita(CITA, { conClientes: true });
    assert.equal(f.href, "/clientes/c-123");
    assert.ok(!f.href.includes("undefined"), "la URL no puede llevar undefined");
  });
});

describe("cómo se llama el botón: por MÓDULOS, no a fuego", () => {
  it("un centro clínico manda a la familia que paga: «Cliente»", () => {
    // Aumenta: pacientes + clinica. El paciente tiene su propio botón al lado.
    const suyo = vocabularioCliente((k) => ["clients", "citas", "pacientes", "clinica"].includes(k));
    assert.equal(fichaDeLaCita(CITA, { conClientes: true, vocabulario: suyo }).rotulo, "Cliente");
  });

  it("en una consulta de nutrición esa ficha ES la paciente: «Paciente»", () => {
    // nutri_laura: nutricion sin pacientes ni clinica. Es el caso que hasta el
    // 27/08/2026 se quedaba SIN ningún botón en toda la agenda.
    const suyo = vocabularioCliente((k) => ["clients", "citas", "nutricion"].includes(k));
    assert.equal(suyo, VOCABULARIO_PACIENTE);
    assert.equal(fichaDeLaCita(CITA, { conClientes: true, vocabulario: suyo }).rotulo, "Paciente");
  });

  it("con el módulo de contrataciones, «Contratante»", () => {
    const suyo = vocabularioCliente((k) => ["clients", "citas", "booking"].includes(k));
    assert.equal(suyo, VOCABULARIO_CONTRATANTE);
    assert.equal(fichaDeLaCita(CITA, { conClientes: true, vocabulario: suyo }).rotulo, "Contratante");
  });

  it("sin vocabulario, el de siempre", () => {
    assert.equal(fichaDeLaCita(CITA, { conClientes: true }).rotulo, "Cliente");
    assert.equal(VOCABULARIO_CLIENTE.singular, "cliente");
  });

  it("el rótulo sale con mayúscula, como los demás del modal", () => {
    // «Email», «Teléfono», «Profesional», «Paciente»: la fila de al lado manda.
    for (const v of [VOCABULARIO_CLIENTE, VOCABULARIO_PACIENTE, VOCABULARIO_CONTRATANTE]) {
      const r = fichaDeLaCita(CITA, { conClientes: true, vocabulario: v }).rotulo;
      assert.equal(r, r[0].toUpperCase() + r.slice(1));
      assert.ok(r.length > 0);
    }
  });

  it("un vocabulario roto no deja el botón sin nombre", () => {
    assert.equal(fichaDeLaCita(CITA, { conClientes: true, vocabulario: {} }).rotulo, "Cliente");
    assert.equal(fichaDeLaCita(CITA, { conClientes: true, vocabulario: null }).rotulo, "Cliente");
  });
});
