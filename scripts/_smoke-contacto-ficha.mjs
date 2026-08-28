// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-contacto-ficha.mjs — el correo escondido en el tutor (28/08/2026).
 *
 *   node scripts/_smoke-contacto-ficha.mjs
 *   node --test-name-pattern="tutor" scripts/_smoke-contacto-ficha.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Lau, de Aumenta: «al generar una cita siempre me pide mail y teléfono … me
 * tengo que salir, buscar esa info, anotarla a lápiz y papel y luego hacer la
 * cita». Parte de esas veces el dato ya estaba en el CRM, pero en el padre o en
 * la madre (`Client.guardians`), no en la ficha de la familia — que es lo
 * normal en un centro de menores. Ninguna pantalla de Citas lo miraba.
 *
 * Medido en producción ese día sobre las 1.083 fichas de Aumenta: de las 330
 * sin correo, 65 lo tienen en un tutor; de las 234 sin teléfono, ninguna.
 *
 * `lib/clients/contactoDeFicha.js` es ese «si no tiene X mira en Y», y esta
 * prueba fija lo que DEVUELVE: quién gana, qué pasa con los huecos, y —lo que
 * de verdad importa— que `guardians` NO sale hacia el navegador, porque lleva
 * el DNI de los progenitores dentro.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { contactoDeFicha, fichaConContacto, datosAlElegirFicha } from "../lib/clients/contactoDeFicha.js";

const tutor = (extra) => ({ id: "g1", name: "Madre", relationship: "madre", dni: "00000000T", ...extra });

describe("contactoDeFicha — manda la ficha, el tutor es el respaldo", () => {
  test("con correo y teléfono propios, los tutores no pintan nada", () => {
    const r = contactoDeFicha({
      email: "familia@ejemplo.es",
      phone: "600111222",
      guardians: [tutor({ email: "madre@ejemplo.es", phone: "600999888" })],
    });
    assert.equal(r.email, "familia@ejemplo.es");
    assert.equal(r.phone, "600111222");
    assert.equal(r.emailDeTutor, false);
    assert.equal(r.phoneDeTutor, false);
  });

  test("sin correo en la ficha, se coge el del tutor y se dice que viene de ahí", () => {
    const r = contactoDeFicha({ email: null, phone: "600111222", guardians: [tutor({ email: "madre@ejemplo.es" })] });
    assert.equal(r.email, "madre@ejemplo.es");
    assert.equal(r.emailDeTutor, true);
    // El teléfono lo tenía la ficha: ese no se toca ni se marca.
    assert.equal(r.phone, "600111222");
    assert.equal(r.phoneDeTutor, false);
  });

  test("cadena vacía cuenta como no tener (es lo que hay en la base, no null)", () => {
    const r = contactoDeFicha({ email: "   ", phone: "", guardians: [tutor({ email: "madre@ejemplo.es", phone: "600999888" })] });
    assert.equal(r.email, "madre@ejemplo.es");
    assert.equal(r.phone, "600999888");
  });

  test("gana el PRIMER tutor que tenga el dato, no el primero de la lista", () => {
    const r = contactoDeFicha({
      email: null,
      phone: null,
      guardians: [tutor({ id: "g1", email: "", phone: null }), tutor({ id: "g2", email: "padre@ejemplo.es", phone: "600333444" })],
    });
    assert.equal(r.email, "padre@ejemplo.es");
    assert.equal(r.phone, "600333444");
  });

  test("el correo puede venir de un tutor y el teléfono de otro", () => {
    const r = contactoDeFicha({
      email: null,
      phone: null,
      guardians: [tutor({ id: "g1", email: "madre@ejemplo.es" }), tutor({ id: "g2", phone: "600333444" })],
    });
    assert.equal(r.email, "madre@ejemplo.es");
    assert.equal(r.phone, "600333444");
    assert.equal(r.emailDeTutor, true);
    assert.equal(r.phoneDeTutor, true);
  });

  test("sin nada en ninguna parte devuelve null, no undefined ni cadena vacía", () => {
    const r = contactoDeFicha({ email: null, phone: null, guardians: [] });
    assert.equal(r.email, null);
    assert.equal(r.phone, null);
    assert.equal(r.emailDeTutor, false);
    assert.equal(r.phoneDeTutor, false);
  });

  test("aguanta basura: sin guardians, guardians que no es lista, tutores nulos", () => {
    assert.equal(contactoDeFicha({ email: null }).email, null);
    assert.equal(contactoDeFicha({ email: null, guardians: "no soy una lista" }).email, null);
    assert.equal(contactoDeFicha({ email: null, guardians: [null, undefined, 7] }).email, null);
    assert.equal(contactoDeFicha(null).email, null);
    assert.equal(contactoDeFicha(undefined).phone, null);
  });
});

describe("fichaConContacto — lo que sale hacia el navegador", () => {
  test("⚠️ guardians NO viaja: lleva el DNI de los progenitores dentro", () => {
    const salida = fichaConContacto({
      id: "c1",
      name: "Familia Ejemplo",
      email: null,
      phone: null,
      status: "active",
      guardians: [tutor({ email: "madre@ejemplo.es", dni: "12345678Z" })],
    });
    assert.equal("guardians" in salida, false);
    assert.equal(JSON.stringify(salida).includes("12345678Z"), false);
  });

  test("el resto de la ficha se conserva tal cual", () => {
    const salida = fichaConContacto({ id: "c1", name: "Familia", email: "f@e.es", phone: "600", status: "active", pacientes: [] });
    assert.equal(salida.id, "c1");
    assert.equal(salida.name, "Familia");
    assert.equal(salida.status, "active");
    assert.deepEqual(salida.pacientes, []);
  });

  test("rescata el correo del tutor y lo marca, para que la pantalla pueda decirlo", () => {
    const salida = fichaConContacto({ id: "c1", name: "F", email: "", phone: "600111222", guardians: [tutor({ email: "madre@ejemplo.es" })] });
    assert.equal(salida.email, "madre@ejemplo.es");
    assert.equal(salida.phone, "600111222");
    assert.equal(salida.contactoDeTutor, true);
  });

  test("sin rescate, la marca es false (no undefined: la pantalla la lee)", () => {
    const salida = fichaConContacto({ id: "c1", name: "F", email: "f@e.es", phone: "600", guardians: [] });
    assert.equal(salida.contactoDeTutor, false);
  });

  test("no revienta con lo que no es una ficha", () => {
    assert.equal(fichaConContacto(null), null);
    assert.equal(fichaConContacto(undefined), undefined);
  });
});

describe("datosAlElegirFicha — el correo NO se pega a la familia anterior", () => {
  const conCorreo = { id: "A", name: "Familia A", email: "a@ejemplo.es", phone: "600111111" };
  const sinNada = { id: "B", name: "Familia B", email: null, phone: null };

  test("⚠️ cambiar a una familia SIN correo BORRA el de la anterior", () => {
    // El fallo de verdad: la cita de B se habría enviado al correo de A.
    const prev = { clientId: "A", clientName: "Familia A", clientEmail: "a@ejemplo.es", clientPhone: "600111111" };
    const r = datosAlElegirFicha(prev, sinNada);
    assert.equal(r.clientId, "B");
    assert.equal(r.clientName, "Familia B");
    assert.equal(r.clientEmail, "");
    assert.equal(r.clientPhone, "");
  });

  test("cambiar de familia trae el contacto de la nueva, no una mezcla de las dos", () => {
    const prev = { clientId: "A", clientEmail: "a@ejemplo.es", clientPhone: "600111111" };
    const r = datosAlElegirFicha(prev, { id: "B", name: "Familia B", email: "b@ejemplo.es", phone: null });
    assert.equal(r.clientEmail, "b@ejemplo.es");
    assert.equal(r.clientPhone, "");
  });

  test("la MISMA familia respeta lo tecleado a mano", () => {
    // Quien apunta la cita ha escrito el correo que le acaban de dictar por
    // teléfono; volver a elegir la misma ficha no puede borrárselo.
    const prev = { clientId: "B", clientName: "Familia B", clientEmail: "escrito@mano.es", clientPhone: "600999999" };
    const r = datosAlElegirFicha(prev, sinNada);
    assert.equal(r.clientEmail, "escrito@mano.es");
    assert.equal(r.clientPhone, "600999999");
  });

  test("la MISMA familia rellena el hueco vacío, y donde la ficha tiene dato manda la ficha", () => {
    // Volver a elegir la misma ficha es un gesto deliberado: se relee de la
    // ficha, que es la fuente de verdad. Lo tecleado solo sobrevive donde la
    // ficha no tiene nada que decir (el test de arriba).
    const prev = { clientId: "A", clientName: "Familia A", clientEmail: "", clientPhone: "600222222" };
    const r = datosAlElegirFicha(prev, conCorreo);
    assert.equal(r.clientEmail, "a@ejemplo.es");
    assert.equal(r.clientPhone, "600111111");
  });

  test("desde un formulario en blanco pone la ficha entera", () => {
    const r = datosAlElegirFicha({}, conCorreo);
    assert.deepEqual(r, {
      clientId: "A",
      clientName: "Familia A",
      clientEmail: "a@ejemplo.es",
      clientPhone: "600111111",
    });
  });

  test("sin ficha no toca nada: devuelve un objeto vacío para esparcir", () => {
    assert.deepEqual(datosAlElegirFicha({ clientId: "A" }, null), {});
    assert.deepEqual(datosAlElegirFicha({ clientId: "A" }, { name: "sin id" }), {});
  });

  test("aguanta un formulario nulo", () => {
    assert.equal(datosAlElegirFicha(null, conCorreo).clientId, "A");
  });
});
