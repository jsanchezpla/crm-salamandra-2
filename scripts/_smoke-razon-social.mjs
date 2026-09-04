// @prueba ligera
/**
 * _smoke-razon-social.mjs — a nombre de quién se factura a una familia
 * (04/09/2026).
 *
 * Fija `lib/billing/razonSocial.js`. Tres promesas que no se pueden romper:
 *
 *   · Lo que sale hacia el navegador NO lleva DNI ni teléfono (la lista la
 *     construye el servidor y viaja tal cual a las pantallas de dinero).
 *   · Un tutor que ya no está en la ficha NO deja la factura apuntando a nadie.
 *   · La ficha sin tutor elegido se comporta EXACTAMENTE como antes de hoy.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  opcionesDeRazonSocial,
  razonSocialPorDefecto,
  nombreDeRazonSocial,
  limpiarRazonSocialPorDefecto,
  LA_FICHA,
} from "../lib/billing/razonSocial.js";

const MADRE = "11111111-1111-4111-8111-111111111111";
const PADRE = "22222222-2222-4222-8222-222222222222";

const familia = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Familia Pérez",
  fiscalName: "Ana Pérez Ruiz",
  guardians: [
    { id: MADRE, name: "Ana Pérez", relationship: "madre", dni: "12345678Z", phone: "600111222" },
    { id: PADRE, name: "Luis Gómez", relationship: "padre", dni: null, phone: "600333444" },
  ],
};

test("la ficha va primero y luego cada tutor", () => {
  const ops = opcionesDeRazonSocial(familia);
  assert.equal(ops.length, 3);
  assert.equal(ops[0].value, LA_FICHA);
  assert.equal(ops[0].label, "Ana Pérez Ruiz");
  assert.equal(ops[1].value, MADRE);
  assert.match(ops[1].label, /Ana Pérez · Madre/);
});

test("el tutor sin DNI sale, y sale MARCADO", () => {
  // Esconderlo dejaría a quien factura sin entender por qué falta alguien; el
  // freno de verdad está en la emisión (`faltaParaEmitirATutor`).
  const padre = opcionesDeRazonSocial(familia).find((o) => o.value === PADRE);
  assert.equal(padre.sinDni, true);
  assert.match(padre.label, /sin DNI/);
});

test("las opciones NO llevan DNI ni teléfono: viajan al navegador", () => {
  const serializado = JSON.stringify(opcionesDeRazonSocial(familia));
  assert.equal(serializado.includes("12345678Z"), false, "el DNI no puede salir");
  assert.equal(serializado.includes("600111222"), false, "el teléfono no puede salir");
  assert.equal(serializado.includes("600333444"), false, "el teléfono no puede salir");
});

test("sin razón social escrita, la ficha se llama por su nombre", () => {
  const ops = opcionesDeRazonSocial({ name: "Familia Pérez", guardians: [] });
  assert.equal(ops[0].label, "Familia Pérez");
  assert.equal(ops.length, 1, "sin tutores solo está la ficha: no hay nada que elegir");
});

test("una entrada de tutor sin nombre o sin id no es una opción", () => {
  const ops = opcionesDeRazonSocial({
    name: "X",
    guardians: [
      { id: MADRE, name: "   " },
      { id: "no-es-un-uuid", name: "Fulana" },
      null,
      "texto suelto",
    ],
  });
  assert.equal(ops.length, 1);
});

test("el defecto de la ficha es el tutor guardado", () => {
  assert.equal(razonSocialPorDefecto({ ...familia, fiscalGuardianId: PADRE }), PADRE);
  assert.equal(razonSocialPorDefecto({ ...familia, fiscal_guardian_id: MADRE }), MADRE);
});

test("un tutor que ya NO está en la ficha cae a la ficha", () => {
  // Se borró de la pestaña de tutores: mejor facturar a nombre de la familia
  // —que es correcto— que a un id que no existe.
  const huerfano = { ...familia, fiscalGuardianId: "99999999-9999-4999-8999-999999999999" };
  assert.equal(razonSocialPorDefecto(huerfano), LA_FICHA);
  assert.equal(nombreDeRazonSocial(huerfano, huerfano.fiscalGuardianId), "Ana Pérez Ruiz");
});

test("sin nada elegido, todo sigue como antes de hoy", () => {
  assert.equal(razonSocialPorDefecto(familia), LA_FICHA);
  assert.equal(razonSocialPorDefecto(null), LA_FICHA);
  assert.equal(nombreDeRazonSocial(familia, LA_FICHA), "Ana Pérez Ruiz");
  assert.equal(nombreDeRazonSocial(familia, null), "Ana Pérez Ruiz");
});

test("nombreDeRazonSocial dice el nombre del tutor elegido", () => {
  assert.equal(nombreDeRazonSocial(familia, PADRE), "Luis Gómez");
  // Da igual cómo venga escrito el id.
  assert.equal(nombreDeRazonSocial(familia, PADRE.toUpperCase()), "Luis Gómez");
});

test("al guardar, un id que no es de esta ficha NO se guarda", () => {
  assert.equal(limpiarRazonSocialPorDefecto(MADRE, familia.guardians), MADRE);
  assert.equal(limpiarRazonSocialPorDefecto("99999999-9999-4999-8999-999999999999", familia.guardians), null);
  assert.equal(limpiarRazonSocialPorDefecto("", familia.guardians), null);
  assert.equal(limpiarRazonSocialPorDefecto(null, familia.guardians), null);
  assert.equal(limpiarRazonSocialPorDefecto(MADRE, null), null);
  // Y no revienta con basura.
  assert.equal(limpiarRazonSocialPorDefecto({ id: MADRE }, familia.guardians), null);
});
