// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-rotulo-bloqueo.mjs — qué pone en la caja de un bloqueo en la agenda y
 * de qué color se pintan las citas (03/09/2026, Aumenta).
 *
 *   node scripts/_smoke-rotulo-bloqueo.mjs
 *
 * Fija dos reglas que viven en /lib porque las leen dos calendarios y dos
 * endpoints: la caja del bloqueo dice SOLO la categoría (el motivo y la persona
 * se leen en el modal), y el color único del centro manda sobre el de la
 * persona sin tocar los grises de los estados apagados.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rotuloDeBloqueo, detalleDeBloqueo } from "../lib/citas/rotuloBloqueo.js";
import { colorCitasDe, colorDeCita } from "../lib/citas/colorCitas.js";
import { colorTextoSobre } from "../lib/citas/coloresBloqueo.js";

describe("rotuloDeBloqueo", () => {
  it("con categoría, solo la categoría: ni motivo ni persona", () => {
    assert.equal(rotuloDeBloqueo({ categoryLabel: "Reunión", label: "Preparar sesión", teamMemberName: "Laura" }), "Reunión");
  });
  it("sin categoría cae al motivo, y sin ninguno dice «Bloqueo» (una caja en blanco parece un hueco)", () => {
    assert.equal(rotuloDeBloqueo({ categoryLabel: null, label: "Vacaciones", teamMemberName: "Laura" }), "Vacaciones");
    assert.equal(rotuloDeBloqueo({ categoryLabel: "", label: "  ", teamMemberName: "Laura" }), "Bloqueo");
    assert.equal(rotuloDeBloqueo(null), "Bloqueo");
  });
  it("el clip se queda cuando cuelga algún documento", () => {
    assert.equal(rotuloDeBloqueo({ categoryLabel: "Reunión", documentos: 2 }), "Reunión 📎");
    assert.equal(rotuloDeBloqueo({ categoryLabel: "Reunión", documentos: 0 }), "Reunión");
  });
});

describe("detalleDeBloqueo", () => {
  it("motivo y persona, que es lo que se lee en el modal", () => {
    assert.equal(detalleDeBloqueo({ categoryLabel: "Reunión", label: "Preparar sesión", teamMemberName: "Laura" }), "Preparar sesión · Laura");
  });
  it("sin motivo (o igual que la categoría) solo la persona; sin persona, «Todo el centro»", () => {
    assert.equal(detalleDeBloqueo({ categoryLabel: "Reunión", label: "Reunión", teamMemberName: "Laura" }), "Laura");
    assert.equal(detalleDeBloqueo({ label: "", teamMemberName: null }), "Todo el centro");
  });
  it("sin categoría el título ya es el motivo: debajo no se repite", () => {
    assert.equal(detalleDeBloqueo({ categoryLabel: null, label: "Vacaciones", teamMemberName: "Laura" }), "Laura");
  });
});

describe("colorCitasDe", () => {
  it("un hex válido, en mayúsculas; cualquier otra cosa es «por persona» (null)", () => {
    assert.equal(colorCitasDe({ settings: { citas: { colorCitas: "#9bbdc7" } } }), "#9BBDC7");
    assert.equal(colorCitasDe({ settings: { citas: { colorCitas: " #9BBDC7 " } } }), "#9BBDC7");
    assert.equal(colorCitasDe({ settings: { citas: { colorCitas: "9BBDC7" } } }), null);
    assert.equal(colorCitasDe({ settings: { citas: { colorCitas: "" } } }), null);
    assert.equal(colorCitasDe({ settings: { citas: {} } }), null);
    assert.equal(colorCitasDe(null), null);
  });
});

describe("colorDeCita", () => {
  it("el único del centro manda; sin él, persona, tipo y el verde de siempre, en ese orden", () => {
    assert.equal(colorDeCita({ unico: "#9BBDC7", persona: "#FF0000", tipo: "#00FF00" }), "#9BBDC7");
    assert.equal(colorDeCita({ unico: null, persona: "#FF0000", tipo: "#00FF00" }), "#FF0000");
    assert.equal(colorDeCita({ unico: null, persona: null, tipo: "#00FF00" }), "#00FF00");
    assert.equal(colorDeCita({}), "#3F6E5B");
  });
  it("sobre el azul claro de Aumenta la letra sale negra; sobre el verde de siempre, blanca", () => {
    assert.equal(colorTextoSobre("#9BBDC7"), "#111111");
    assert.equal(colorTextoSobre("#3F6E5B"), "#FFFFFF");
  });
});
