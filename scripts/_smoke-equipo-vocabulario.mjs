/**
 * _smoke-equipo-vocabulario.mjs — cómo se llama al equipo en cada centro.
 *
 * @prueba ligera
 *
 * Vigila las dos formas de equivocarse con `vocabularioEquipo()`:
 *
 *   1. Que una demo o una cuenta general hable de «terapeutas» (Rodrigo,
 *      03/09/2026: lo de Aumenta con nombre propio, neutro en las demás).
 *   2. Que un centro clínico nuevo salga hablando de «miembros» porque
 *      alguien tuviera que apuntarlo en una lista.
 *
 * Y una tercera, más tonta y más fácil: que un vocabulario se quede sin
 * alguna de las formas que la agenda usa, y salga «undefined» en pantalla.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VOCABULARIO_MIEMBRO,
  VOCABULARIO_TERAPEUTA,
  equipoSonTerapeutas,
  vocabularioEquipo,
} from "../lib/team/vocabulario.js";

const con = (...mods) => (k) => mods.includes(k);

describe("qué centro habla de terapeutas", () => {
  it("con el módulo de Clínica, terapeutas", () => {
    assert.equal(vocabularioEquipo(con("citas", "team", "clinica", "pacientes")), VOCABULARIO_TERAPEUTA);
    assert.equal(equipoSonTerapeutas(con("clinica")), true);
  });

  it("una agencia, una consulta de nutrición o una empresa hablan de miembros", () => {
    assert.equal(vocabularioEquipo(con("citas", "team", "clients", "leads")), VOCABULARIO_MIEMBRO);
    assert.equal(vocabularioEquipo(con("citas", "team", "nutricion")), VOCABULARIO_MIEMBRO);
    assert.equal(vocabularioEquipo(con("booking", "team")), VOCABULARIO_MIEMBRO);
  });

  it("ante la duda, el neutro", () => {
    assert.equal(vocabularioEquipo(() => false), VOCABULARIO_MIEMBRO);
    assert.equal(vocabularioEquipo(() => undefined), VOCABULARIO_MIEMBRO);
  });
});

describe("los dos vocabularios tienen las mismas formas", () => {
  const formas = ["singular", "plural", "un", "otro", "ese", "ninguno", "los", "porRotulo"];
  for (const v of [VOCABULARIO_MIEMBRO, VOCABULARIO_TERAPEUTA]) {
    it(`«${v.singular}» tiene todas las formas y ninguna vacía`, () => {
      for (const f of formas) assert.ok(typeof v[f] === "string" && v[f].trim().length > 0, f);
    });
  }

  it("el género va con la palabra: «otra terapeuta», «otro miembro»", () => {
    assert.equal(VOCABULARIO_TERAPEUTA.otro, "otra terapeuta");
    assert.equal(VOCABULARIO_MIEMBRO.otro, "otro miembro");
    assert.equal(VOCABULARIO_MIEMBRO.ninguno, "ningún miembro");
  });

  it("el botón de la agenda", () => {
    assert.equal(VOCABULARIO_TERAPEUTA.porRotulo, "Por terapeuta");
    assert.equal(VOCABULARIO_MIEMBRO.porRotulo, "Por miembro");
  });
});
