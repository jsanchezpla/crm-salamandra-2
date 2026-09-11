/**
 * _smoke-contacto-pagador-ficha.mjs — la tarjeta «Contacto (pagador)» de la
 * ficha del paciente cae a la ficha de la familia y a sus tutores cuando no
 * hay métodos de contacto (lib/clinica/serialize.js, 11/09/2026, AV-0124).
 *
 * @prueba ligera
 */
import test from "node:test";
import assert from "node:assert/strict";
import { payerContactsOf } from "../lib/clinica/serialize.js";

test("con métodos de contacto mandan ellos, tal cual", () => {
  const r = payerContactsOf({
    email: "ficha@casa.es",
    phone: "600000000",
    contactMethods: [{ id: "m1", kind: "email", value: "madre@casa.es", label: "madre", isPrimary: true }],
  });
  assert.deepEqual(r, [{ id: "m1", kind: "email", value: "madre@casa.es", label: "madre", isPrimary: true }]);
});

test("sin métodos de contacto sale lo de la ficha, etiquetado «ficha»", () => {
  const r = payerContactsOf({ email: " ficha@casa.es ", phone: "600000000", contactMethods: [], guardians: [] });
  assert.deepEqual(r, [
    { id: "ficha-phone", kind: "phone", value: "600000000", label: "ficha", isPrimary: false },
    { id: "ficha-email", kind: "email", value: "ficha@casa.es", label: "ficha", isPrimary: false },
  ]);
});

test("lo que la ficha no tiene se busca en un tutor, etiquetado «tutor»", () => {
  const r = payerContactsOf({
    email: null,
    phone: "",
    contactMethods: [],
    guardians: [{ name: "Padre", phone: "", email: "" }, { name: "Madre", phone: "611111111", email: "madre@casa.es" }],
  });
  assert.deepEqual(r, [
    { id: "ficha-phone", kind: "phone", value: "611111111", label: "tutor", isPrimary: false },
    { id: "ficha-email", kind: "email", value: "madre@casa.es", label: "tutor", isPrimary: false },
  ]);
});

test("sin nada en ningún sitio, lista vacía (la pantalla dice que no hay contacto)", () => {
  assert.deepEqual(payerContactsOf({ email: null, phone: null, guardians: [] }), []);
  assert.deepEqual(payerContactsOf(null), []);
});
