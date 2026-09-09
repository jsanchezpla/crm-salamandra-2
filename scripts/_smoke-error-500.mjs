// @prueba ligera
/**
 * _smoke-error-500.mjs — un 500 tiene que dejar rastro (09/09/2026, AV-0101).
 *
 * POR QUÉ EXISTE. Olga escribió «no funciona el apartado de cobros, aparece
 * como error interno» y **no se pudo contestar**: `serverError` no escribía en
 * ninguna parte. Lo usan las ~285 rutas del CRM, así que durante meses
 * cualquier fallo de servidor fue igual de invisible: la pantalla decía «Error
 * interno del servidor» y no quedaba una sola línea que buscar.
 *
 * Esta prueba defiende las dos mitades del arreglo, que se rompen por separado:
 *
 *   · **La referencia llega a la persona.** Sin eso, el aviso siguiente vuelve
 *     a decir «no funciona» y estamos donde estábamos.
 *   · **La consulta SQL no se escribe.** Un error de Sequelize lleva la
 *     consulta con sus VALORES dentro —un correo, un DNI, el nombre de un
 *     menor— y el log del servidor lo lee cualquiera que entre.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { lineaDeLog, mensajeDeError, referenciaDeError } from "../lib/utils/errorInterno.js";

const REF = /ref\. ([A-Z0-9]{6,12})/;

test("la referencia del mensaje es la MISMA que la del log", () => {
  // Es lo único que importa de las dos piezas juntas: si no casan, la persona
  // copia un código que no lleva a ninguna parte.
  const ref = referenciaDeError();
  const err = new Error("algo se rompió");
  const m = mensajeDeError(err, ref, { produccion: true }).match(REF);
  assert.ok(m, "el mensaje no lleva referencia");
  assert.equal(m[1], ref);
  assert.ok(lineaDeLog(err, ref).includes(ref), "el log no lleva la referencia");
});

test("cada error tiene la suya: dos seguidos no se confunden", () => {
  const a = referenciaDeError(1757400000000, 0.123456);
  const b = referenciaDeError(1757400000000, 0.987654);
  assert.notEqual(a, b, "dos errores en el mismo milisegundo comparten referencia");
  assert.notEqual(referenciaDeError(1757400000000, 0.5), referenciaDeError(1757400060000, 0.5));
});

test("la referencia se puede leer en voz alta por teléfono", () => {
  for (let i = 0; i < 200; i += 1) {
    const r = referenciaDeError();
    assert.match(r, /^[A-Z0-9]{6,12}$/, `referencia rara: «${r}»`);
  }
  // Y con un azar que da una cola corta, sigue teniendo largo suficiente.
  assert.match(referenciaDeError(1757400000000, 0), /^[A-Z0-9]{6,12}$/);
});

test("el log lleva el nombre, el mensaje y la traza, que es lo que se busca", () => {
  const err = new TypeError("no se puede leer 'x'");
  const l = lineaDeLog(err, "K2P9XA3F");
  assert.match(l, /^\[500 K2P9XA3F\]/);
  assert.match(l, /TypeError/);
  assert.match(l, /no se puede leer 'x'/);
  assert.match(l, /_smoke-error-500/, "sin traza no se sabe qué ruta fue");
});

test("de un error de base se guarda DÓNDE duele, nunca con qué valores", () => {
  /*
   * El caso real: un `SequelizeDatabaseError` trae dentro `parent.sql` con la
   * consulta entera y sus parámetros. Ahí van correos y nombres de pacientes.
   */
  const err = new Error("column MailingCampaign.tipo does not exist");
  err.name = "SequelizeDatabaseError";
  err.parent = {
    code: "42703",
    table: "mailing_campaigns",
    column: "tipo",
    sql: "SELECT * FROM pacientes WHERE email = 'nuria@ejemplo.com'",
  };
  const l = lineaDeLog(err, "ABC123");
  assert.match(l, /pg=42703/);
  assert.match(l, /tabla=mailing_campaigns/);
  assert.match(l, /columna=tipo/);
  assert.ok(!l.includes("nuria@ejemplo.com"), "SE HA ESCRITO UN CORREO EN EL LOG");
  assert.ok(!l.includes("SELECT"), "se ha escrito la consulta entera en el log");
});

test("en producción no se le enseña a nadie el mensaje de dentro", () => {
  const err = new Error('relation "crm_aumenta.mailing_sends" does not exist');
  const m = mensajeDeError(err, "ABC123", { produccion: true });
  assert.ok(!m.includes("relation"), "el mensaje interno se ha colado en la respuesta");
  assert.ok(!m.includes("crm_aumenta"), "el nombre del schema se ha colado en la respuesta");
  assert.match(m, /Error interno del servidor/);
  assert.match(m, REF, "pero la referencia sí tiene que salir");
});

test("en local sí se ve el mensaje, que es donde sirve", () => {
  const m = mensajeDeError(new Error("falta la columna x"), "ABC123", { produccion: false });
  assert.match(m, /falta la columna x/);
  assert.match(m, REF);
});

test("un error sin nada dentro tampoco lo tumba", () => {
  for (const bicho of [null, undefined, "una cadena", { raro: true }, 42]) {
    const l = lineaDeLog(bicho, "ABC123");
    assert.match(l, /^\[500 ABC123\]/);
    assert.match(mensajeDeError(bicho, "ABC123", { produccion: true }), REF);
    assert.match(mensajeDeError(bicho, "ABC123", { produccion: false }), REF);
  }
});
