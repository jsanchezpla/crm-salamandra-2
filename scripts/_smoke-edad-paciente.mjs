// @prueba ligera
/**
 * _smoke-edad-paciente.mjs — la edad de un paciente sale de su fecha de
 * nacimiento (03/09/2026, AV-0034).
 *
 *   node --test scripts/_smoke-edad-paciente.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { edadDe, fechaNacimientoCorta } from "../lib/clinica/edad.js";
import { edadDe as edadDeIa } from "../lib/clinica/objetivosIa.js";
import { serializePatient } from "../lib/clinica/serialize.js";

const HOY = new Date("2026-09-03T12:00:00");

describe("edadDe: la fecha manda, la edad escrita es el respaldo", () => {
  it("cumple hoy, cumplió ayer, cumple mañana", () => {
    assert.equal(edadDe({ birthDate: "2018-09-03" }, HOY), 8);
    assert.equal(edadDe({ birthDate: "2018-09-02" }, HOY), 8);
    assert.equal(edadDe({ birthDate: "2018-09-04" }, HOY), 7);
  });
  it("con fecha, la edad escrita se ignora aunque esté", () => {
    assert.equal(edadDe({ birthDate: "2016-01-15", age: 3 }, HOY), 10);
  });
  it("sin fecha (o con una fecha rota) vale la edad escrita; sin nada, null", () => {
    assert.equal(edadDe({ age: 6 }, HOY), 6);
    assert.equal(edadDe({ birthDate: "no es fecha", age: 9 }, HOY), 9);
    assert.equal(edadDe({ age: "x" }, HOY), null);
    assert.equal(edadDe({}, HOY), null);
    assert.equal(edadDe(null, HOY), null);
  });
  it("objetivosIa.js sigue dando la MISMA función (nada de dos edades)", () => {
    assert.equal(edadDeIa, edadDe);
  });
});

describe("fechaNacimientoCorta", () => {
  it("el DATEONLY de la base sale dd/mm/aaaa sin pasar por la zona horaria", () => {
    assert.equal(fechaNacimientoCorta("2017-03-12"), "12/03/2017");
    assert.equal(fechaNacimientoCorta("2017-03-12T00:00:00.000Z"), "12/03/2017");
  });
  it("sin fecha, cadena vacía (se concatena sin comprobar)", () => {
    assert.equal(fechaNacimientoCorta(null), "");
    assert.equal(fechaNacimientoCorta(""), "");
    assert.equal(fechaNacimientoCorta("basura"), "");
  });
});

describe("serializePatient lleva la edad calculada y la fecha", () => {
  const fila = (extra) => ({
    toJSON: () => ({ id: "p-1", firstName: "Ana", lastName: "Pérez", status: "active", objectives: [], ...extra }),
  });
  it("con fecha: edad calculada, age tal cual, birthDate tal cual", () => {
    const p = serializePatient(fila({ birthDate: "2018-09-04", age: 3 }));
    assert.equal(p.birthDate, "2018-09-04");
    assert.equal(p.age, 3);
    assert.equal(typeof p.edad, "number");
    assert.ok(p.edad >= 7);
  });
  it("sin fecha: la edad es la escrita", () => {
    const p = serializePatient(fila({ age: 11 }));
    assert.equal(p.edad, 11);
    assert.equal(p.birthDate, null);
  });
});
