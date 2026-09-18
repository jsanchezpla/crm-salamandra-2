// @prueba ligera
/**
 * _smoke-rotulo-contacto-externo.mjs — el contacto de la agenda del paciente
 * que no tiene nombre (18/09/2026, AV-0102 de Aumenta).
 *
 * Lo que fija: que un contacto sin nombre se lea por su papel o por su centro
 * en vez de salir como una línea rota, y que se pueda GUARDAR sin inventarle un
 * nombre, que es lo que hasta hoy impedía corregir los 104 que hay así en
 * producción.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rotuloDeContactoExterno,
  vetoDeContactoExterno,
  SIN_NOMBRE,
} from "../lib/clinica/rotuloContactoExterno.js";

describe("cómo se lee un contacto externo", () => {
  it("con nombre, manda el nombre y el papel va al lado", () => {
    assert.deepEqual(
      rotuloDeContactoExterno({ name: "Natalia", role: "Orientadora", entity: "CEIP Salvador Dalí" }),
      { titulo: "Natalia", detalle: "Orientadora", anonimo: false }
    );
  });

  it("sin nombre, manda el PAPEL y se marca como anónimo", () => {
    // El caso de los 104 de Aumenta: «PT · IES África» sin nombre de persona.
    assert.deepEqual(
      rotuloDeContactoExterno({ name: "", role: "PT", entity: "IES África" }),
      { titulo: "PT", detalle: null, anonimo: true }
    );
  });

  it("sin nombre ni papel, queda el centro", () => {
    assert.deepEqual(
      rotuloDeContactoExterno({ name: null, role: null, entity: "CEIP Manuel de Falla" }),
      { titulo: "CEIP Manuel de Falla", detalle: null, anonimo: true }
    );
  });

  it("sin nada, se dice en voz alta en vez de dejar un hueco", () => {
    assert.equal(rotuloDeContactoExterno({}).titulo, SIN_NOMBRE);
    assert.equal(rotuloDeContactoExterno(null).titulo, SIN_NOMBRE);
    assert.equal(rotuloDeContactoExterno({ name: "   ", role: "  " }).titulo, SIN_NOMBRE);
    assert.equal(rotuloDeContactoExterno({}).anonimo, true);
  });

  it("los espacios sueltos no cuentan como nombre", () => {
    const r = rotuloDeContactoExterno({ name: "  ", role: "Tutora" });
    assert.equal(r.titulo, "Tutora");
    assert.equal(r.anonimo, true);
  });
});

describe("qué se puede guardar", () => {
  it("con nombre vale, y con papel también aunque no haya nombre", () => {
    assert.equal(vetoDeContactoExterno({ name: "Ana" }), null);
    assert.equal(vetoDeContactoExterno({ name: "", role: "Tutora" }), null);
    assert.equal(vetoDeContactoExterno({ role: "PT" }), null);
  });

  it("sin nombre Y sin papel no es nadie: se para", () => {
    assert.match(vetoDeContactoExterno({}), /al menos el nombre o el papel/);
    assert.match(vetoDeContactoExterno({ name: "  ", role: null }), /al menos el nombre o el papel/);
    // Un centro suelto tampoco basta: dice dónde, no quién.
    assert.ok(vetoDeContactoExterno({ entity: "IES África" }));
  });
});
