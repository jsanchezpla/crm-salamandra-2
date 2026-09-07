// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-objetivos-del-plan.mjs — los objetivos del Plan con su terapeuta
 * (07/09/2026, AV-0061 de Aumenta: «pacientes compartidos, objetivos por
 * especialidad»).
 *
 *   node scripts/_smoke-objetivos-del-plan.mjs
 *
 * La regla vive en `lib/clinica/objetivosDelPlan.js`: acepta los textos de
 * siempre y los objetos nuevos, no pierde ninguno, no repite, y agrupa por
 * terapeuta con quien escribe primero.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizarObjetivos, textosDeObjetivos, agruparPorTerapeuta, MAX_OBJETIVOS } from "../lib/clinica/objetivosDelPlan.js";

const LOGO = "11111111-1111-4111-8111-111111111111";
const PSICO = "22222222-2222-4222-8222-222222222222";

describe("normalizarObjetivos", () => {
  it("un plan viejo (textos) sigue valiendo: cada texto es un objetivo sin terapeuta", () => {
    assert.deepEqual(normalizarObjetivos(["Atención sostenida", "  Turnos  "]), [
      { texto: "Atención sostenida", terapeutaId: null },
      { texto: "Turnos", terapeutaId: null },
    ]);
  });
  it("los objetos llevan su terapeuta, y un id que no es UUID se descarta (no el objetivo)", () => {
    assert.deepEqual(normalizarObjetivos([{ texto: "Frases de 3 elementos", terapeutaId: LOGO }, { texto: "x", terapeutaId: "pepe" }]), [
      { texto: "Frases de 3 elementos", terapeutaId: LOGO },
      { texto: "x", terapeutaId: null },
    ]);
  });
  it("vacíos fuera; el mismo texto en dos terapeutas se queda, repetido en la misma no", () => {
    const r = normalizarObjetivos([
      "", { texto: "  " }, null, 7,
      { texto: "Turnos", terapeutaId: LOGO }, { texto: "turnos", terapeutaId: LOGO }, { texto: "Turnos", terapeutaId: PSICO },
    ]);
    assert.equal(r.length, 2);
  });
  it("tope y recorte", () => {
    const muchos = Array.from({ length: 60 }, (_, i) => `Objetivo ${i}`);
    assert.equal(normalizarObjetivos(muchos).length, MAX_OBJETIVOS);
    assert.equal(normalizarObjetivos(["a".repeat(500)])[0].texto.length, 300);
  });
});

describe("textosDeObjetivos", () => {
  it("solo los textos, en orden, de las dos formas", () => {
    assert.deepEqual(textosDeObjetivos(["A", { texto: "B", terapeutaId: LOGO }]), ["A", "B"]);
  });
});

describe("agruparPorTerapeuta", () => {
  const terapeutas = [{ id: PSICO, nombre: "Ana Psico", especialidad: "psicologia" }, { id: LOGO, nombre: "Eva Logo", especialidad: "logopedia" }];
  it("un grupo por terapeuta del paciente (aunque no tenga objetivos), quien escribe primero, y los sueltos al final", () => {
    const g = agruparPorTerapeuta(["Viejo suelto", { texto: "Fonemas", terapeutaId: LOGO }], { terapeutas, yo: LOGO });
    assert.deepEqual(g.map((x) => x.nombre), ["Eva Logo", "Ana Psico", "Sin terapeuta"]);
    assert.equal(g[0].esYo, true);
    assert.equal(g[0].especialidad, "logopedia");
    assert.deepEqual(g[0].objetivos.map((o) => o.texto), ["Fonemas"]);
    assert.deepEqual(g[1].objetivos, []);
    assert.deepEqual(g[2].objetivos.map((o) => o.texto), ["Viejo suelto"]);
  });
  it("un terapeuta que ya no es del paciente conserva su grupo con el nombre del equipo", () => {
    const g = agruparPorTerapeuta([{ texto: "Antiguo", terapeutaId: PSICO }], { terapeutas: [], equipo: [{ id: PSICO, displayName: "Ana Psico" }] });
    assert.deepEqual(g.map((x) => x.nombre), ["Ana Psico"]);
    const sin = agruparPorTerapeuta([{ texto: "Antiguo", terapeutaId: PSICO }], {});
    assert.equal(sin[0].nombre, "Terapeuta que ya no está");
  });
});
