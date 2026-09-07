// @prueba ligera
/**
 * _smoke-razon-social.mjs — a nombre de quién se factura a una familia
 * (04/09/2026).
 *
 * Fija `lib/billing/razonSocial.js`. Cuatro promesas que no se pueden romper:
 *
 *   · Lo que sale hacia el navegador NO lleva DNI ni teléfono (la lista la
 *     construye el servidor y viaja tal cual a las pantallas de dinero).
 *   · Un tutor que ya no está en la ficha NO deja la factura apuntando a nadie.
 *   · Una razón social o un NIF escritos a mano MANDAN sobre el cálculo.
 *   · Sin nada escrito, la factura sale a nombre del TUTOR PRINCIPAL y con su
 *     DNI (08/09/2026), y el titular de la ficha gana al primero de la lista.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  opcionesDeRazonSocial,
  razonSocialPorDefecto,
  razonSocialGuardada,
  razonSocialAutomatica,
  tutorPrincipalDe,
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
  // Con razón social escrita, la primera opción sigue siendo la ficha.
  assert.equal(ops[0].label, "Ana Pérez Ruiz (la ficha)");
  assert.equal(ops[0].automatico, false);
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
  assert.equal(ops[0].label, "Familia Pérez (la ficha)");
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
  // Y lo guardado se lee tal cual: el desplegable de la ficha no calcula.
  assert.equal(razonSocialGuardada({ ...familia, fiscalGuardianId: PADRE }), PADRE);
});

test("un tutor que ya NO está en la ficha cae a la ficha", () => {
  // Se borró de la pestaña de tutores: mejor facturar a nombre de la familia
  // —que es correcto— que a un id que no existe.
  const huerfano = { ...familia, fiscalGuardianId: "99999999-9999-4999-8999-999999999999" };
  assert.equal(razonSocialPorDefecto(huerfano), LA_FICHA);
  assert.equal(nombreDeRazonSocial(huerfano, huerfano.fiscalGuardianId), "Ana Pérez Ruiz");
});

test("con razón social escrita, esa manda y no se calcula nada", () => {
  // `familia` lleva `fiscalName`: alguien decidió a nombre de quién se factura.
  assert.equal(razonSocialPorDefecto(familia), LA_FICHA);
  assert.equal(razonSocialAutomatica(familia), null);
  assert.equal(razonSocialPorDefecto(null), LA_FICHA);
  assert.equal(nombreDeRazonSocial(familia, LA_FICHA), "Ana Pérez Ruiz");
  assert.equal(nombreDeRazonSocial(familia, null), "Ana Pérez Ruiz");
});

test("nombreDeRazonSocial dice el nombre del tutor elegido", () => {
  assert.equal(nombreDeRazonSocial(familia, PADRE), "Luis Gómez");
  // Da igual cómo venga escrito el id.
  assert.equal(nombreDeRazonSocial(familia, PADRE.toUpperCase()), "Luis Gómez");
});

/* ── EL TUTOR PRINCIPAL (08/09/2026, Rodrigo) ────────────────────────────────
 * «Tiene que ser el nombre del tutor principal y su DNI hasta que se
 * especifique lo contrario». Sin esto, en Aumenta 894 facturas salieron a
 * nombre de un menor porque nadie había entrado a elegir tutor en 1.094 fichas.
 */

// La ficha se llama como el niño y lleva el DNI del niño: no es de ningún tutor.
const delNino = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Adrián Sánchez Rodríguez",
  taxId: "49012403R",
  guardians: [
    { id: PADRE, name: "Ramón Sánchez Zárate", relationship: "padre", dni: "51326004D", phone: "600555666" },
    { id: MADRE, name: "Marta Rodríguez Nieto", relationship: "madre", dni: "22222222J" },
  ],
};

test("sin nada escrito, la factura va al tutor principal y no a la ficha", () => {
  assert.equal(razonSocialPorDefecto(delNino), PADRE);
  assert.equal(tutorPrincipalDe(delNino).name, "Ramón Sánchez Zárate");
  assert.equal(nombreDeRazonSocial(delNino, razonSocialPorDefecto(delNino)), "Ramón Sánchez Zárate");
  // Y NO se ha guardado nada en la ficha: el desplegable sigue en «Automático».
  assert.equal(razonSocialGuardada(delNino), LA_FICHA);
});

test("si el DNI de la ficha es el de un tutor, ese es el principal aunque no sea el primero", () => {
  // El caso de 365 familias de Aumenta: la madre es la titular y el padre está
  // el primero de la lista. Coger «el primero» les cambiaría de progenitor la
  // factura; con esta regla solo se les corrige el nombre, no el NIF.
  const titularMadre = { ...delNino, name: "Ainhoa Vicente de la Llave", taxId: "22222222J" };
  assert.equal(razonSocialPorDefecto(titularMadre), MADRE);
  // Y da igual cómo esté escrito el documento: puntos, guiones y minúsculas.
  assert.equal(razonSocialPorDefecto({ ...titularMadre, taxId: " 22.222.222-j " }), MADRE);
});

test("un tutor sin DNI no puede ser el principal: no se podría emitir a su nombre", () => {
  const sinDniElPrimero = {
    ...delNino,
    guardians: [{ ...delNino.guardians[0], dni: "  " }, delNino.guardians[1]],
  };
  assert.equal(razonSocialPorDefecto(sinDniElPrimero), MADRE);
});

test("sin ningún tutor con DNI, se factura a la ficha exactamente como antes", () => {
  const nadie = { ...delNino, guardians: delNino.guardians.map((g) => ({ ...g, dni: null })) };
  assert.equal(razonSocialPorDefecto(nadie), LA_FICHA);
  assert.equal(tutorPrincipalDe(nadie), null);
  assert.equal(razonSocialPorDefecto({ ...delNino, guardians: [] }), LA_FICHA);
});

test("un NIF de facturación escrito a mano también manda sobre el cálculo", () => {
  // Es la vía de la empresa o la fundación que paga: se escribió a propósito,
  // y el día del despliegue no se le puede cambiar el destinatario en silencio.
  assert.equal(razonSocialPorDefecto({ ...delNino, fiscalTaxId: "B12345678" }), LA_FICHA);
  assert.equal(razonSocialPorDefecto({ ...delNino, fiscalName: "Fundación X" }), LA_FICHA);
  // Y el tutor elegido a mano sigue ganando a todo.
  assert.equal(razonSocialPorDefecto({ ...delNino, fiscalGuardianId: MADRE }), MADRE);
});

test("la primera opción dice que es automática, y sin DNI a la vista", () => {
  const ops = opcionesDeRazonSocial(delNino);
  assert.equal(ops[0].value, LA_FICHA);
  assert.equal(ops[0].automatico, true);
  assert.equal(ops[0].label, "Automático · Ramón Sánchez Zárate (tutor principal)");
  const serializado = JSON.stringify(ops);
  assert.equal(serializado.includes("51326004D"), false, "el DNI no puede salir");
  assert.equal(serializado.includes("600555666"), false, "el teléfono no puede salir");
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
