// @prueba ligera
// Fija lib/billing/busquedaCobros.js: la búsqueda de Cobros en el servidor.
import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { whereDeBusquedaCobros, patronDePalabra, joinsSinColumnas } from "../lib/billing/busquedaCobros.js";

test("todas las palabras, cada una en cualquiera de los campos", () => {
  const where = whereDeBusquedaCobros("garcia f-2026");
  const grupos = where[Op.and];
  assert.equal(grupos.length, 2);
  for (const g of grupos) {
    const campos = g[Op.or];
    assert.ok(campos.length >= 4);
    assert.ok("notes" in campos[0]);
    assert.ok("$client.name$" in campos[1]);
    assert.ok("$invoice.number$" in campos[2]);
    assert.ok("$invoice.client.name$" in campos[3]);
  }
});

test("con paciente, cada palabra busca también en su nombre y apellidos (03/09/2026)", () => {
  const con = whereDeBusquedaCobros("maria garcia", { conPaciente: true });
  for (const g of con[Op.and]) {
    const campos = g[Op.or];
    assert.ok(campos.some((c) => "$patient.first_name$" in c));
    assert.ok(campos.some((c) => "$patient.last_name$" in c));
  }
  // Sin la tabla de pacientes (el resto de tenants) no se toca el JOIN.
  const sin = whereDeBusquedaCobros("maria garcia");
  for (const g of sin[Op.and]) {
    assert.equal(g[Op.or].some((c) => "$patient.first_name$" in c), false);
  }
});

test("las tildes no se exigen: garcia casa García y nunez casa Núñez", () => {
  assert.match("García", new RegExp(patronDePalabra("garcia"), "i"));
  assert.match("Núñez", new RegExp(patronDePalabra("nunez"), "i"));
  assert.match("logopedia", new RegExp(patronDePalabra("logopedía"), "i"));
});

test("el método en cristiano también busca: «tarjeta» añade method=card", () => {
  const where = whereDeBusquedaCobros("tarjeta");
  const campos = where[Op.and][0][Op.or];
  assert.deepEqual(campos[campos.length - 1], { method: "card" });
  const sin = whereDeBusquedaCobros("garcia");
  assert.equal(sin[Op.and][0][Op.or].some((c) => "method" in c), false);
});

test("lo especial de una regex se escapa y no revienta la consulta", () => {
  const patron = patronDePalabra("f-2026 (2)");
  assert.doesNotThrow(() => new RegExp(patron));
  assert.match("f-2026 (2)", new RegExp(patron, "i"));
});

test("sin nada que buscar, null — y un pegote enorme se corta a seis palabras", () => {
  assert.equal(whereDeBusquedaCobros(""), null);
  assert.equal(whereDeBusquedaCobros("   "), null);
  assert.equal(whereDeBusquedaCobros(null), null);
  const where = whereDeBusquedaCobros("a b c d e f g h");
  assert.equal(where[Op.and].length, 6);
});

// ── Los JOIN de la suma, sin columnas (09/09/2026) ──────────────────────────
// Buscar en Cobros daba un 500: la consulta que suma los totales repetía los
// includes CON sus atributos, y `SUM(...)` junto a `invoice.id` sin GROUP BY
// lo rechaza PostgreSQL. Lo que se fija aquí es que el JOIN se conserva y las
// columnas desaparecen, incluidas las del include anidado.

const INCLUDES = [
  {
    model: "Invoice", as: "invoice",
    attributes: ["id", "number", "total", "status", "clientId", "issueDate"],
    include: [{ model: "Client", as: "client", attributes: ["id", "name"] }],
  },
  { model: "Client", as: "client", attributes: ["id", "name"] },
  { model: "Patient", as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
];

test("los JOIN de la suma se quedan sin columnas, también los anidados", () => {
  const secos = joinsSinColumnas(INCLUDES);
  assert.equal(secos.length, 3);
  for (const inc of secos) assert.deepEqual(inc.attributes, []);
  // El `client` que cuelga de `invoice` es el que rompía la consulta.
  assert.deepEqual(secos[0].include[0].attributes, []);
});

test("la asociación se conserva entera: solo se vacían los atributos", () => {
  const secos = joinsSinColumnas(INCLUDES);
  assert.equal(secos[0].model, "Invoice");
  assert.equal(secos[0].as, "invoice");
  assert.equal(secos[0].include[0].as, "client");
  // `required: false` es lo que evita que el JOIN de pacientes esconda cobros.
  assert.equal(secos[2].required, false);
});

test("los includes de entrada no se tocan", () => {
  joinsSinColumnas(INCLUDES);
  assert.deepEqual(INCLUDES[0].attributes, ["id", "number", "total", "status", "clientId", "issueDate"]);
  assert.deepEqual(INCLUDES[0].include[0].attributes, ["id", "name"]);
});

test("sin includes no revienta", () => {
  assert.deepEqual(joinsSinColumnas([]), []);
  assert.deepEqual(joinsSinColumnas(undefined), []);
  assert.deepEqual(joinsSinColumnas(null), []);
});
