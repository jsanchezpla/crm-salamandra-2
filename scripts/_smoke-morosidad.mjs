// @prueba ligera
/**
 * Cómo se lee la lista de morosos (`lib/billing/morosidad.js`, 09/09/2026).
 *
 * Lo que se prueba es lo que Rosa no podía hacer: separar quién debe de verdad
 * de quién no tiene cuota escrita, ver el importe, y que el buscador de la
 * pantalla mueva también esta lista.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  etiquetaDeMoroso,
  filtrarMorosos,
  repartirMorosos,
  resumenDeMorosidad,
} from "../lib/billing/morosidad.js";

const CON_CUOTA = { clientId: "1", name: "Familia Álvarez", tieneCuota: true, debe: 60, conceptos: ["Logopedia"] };
const CON_CUOTA_MESES = { clientId: "2", name: "Familia Bueno", tieneCuota: true, mesesSeguidos: 3, conceptos: ["Psicología"] };
const SIN_CUOTA = { clientId: "3", name: "Familia Cuesta", tieneCuota: false, mesesSeguidos: 2, conceptos: [] };

test("reparte por si la familia tiene cuota escrita", () => {
  const { conCuota, sinCuota } = repartirMorosos([CON_CUOTA, SIN_CUOTA, CON_CUOTA_MESES]);
  assert.deepEqual(conCuota.map((m) => m.clientId), ["1", "2"]);
  assert.deepEqual(sinCuota.map((m) => m.clientId), ["3"]);
});

test("sin `tieneCuota` la familia cae del lado de las que no la tienen", () => {
  // Un cliente viejo de la caché del navegador no trae el campo: mejor que
  // salga bajo el rótulo honesto que disfrazado de deuda.
  const { conCuota, sinCuota } = repartirMorosos([{ clientId: "9", name: "X" }]);
  assert.equal(conCuota.length, 0);
  assert.equal(sinCuota.length, 1);
});

test("el importe manda sobre el número de meses", () => {
  assert.equal(etiquetaDeMoroso(CON_CUOTA).texto, "debe 60,00 €");
  assert.equal(etiquetaDeMoroso(CON_CUOTA).tono, "importe");
});

test("con cuota y sin importe, se cuentan los meses y suben de tono", () => {
  assert.equal(etiquetaDeMoroso(CON_CUOTA_MESES).texto, "3 meses");
  assert.equal(etiquetaDeMoroso(CON_CUOTA_MESES).tono, "grave");
  assert.equal(etiquetaDeMoroso({ tieneCuota: true, mesesSeguidos: 1 }).texto, "1 mes");
  assert.equal(etiquetaDeMoroso({ tieneCuota: true, mesesSeguidos: 2 }).tono, "medio");
});

test("sin cuota escrita no se cuentan meses: se dice que no hay cuota", () => {
  // Es el caso de 683 de las 959 familias de Aumenta. Contarle meses a quien
  // nadie le ha escrito una cuota es acusarle de una deuda inventada.
  assert.equal(etiquetaDeMoroso(SIN_CUOTA).texto, "sin cuota escrita");
});

test("un importe se enseña aunque la familia no tenga cuota escrita", () => {
  // Puede pasar: un cobro suelto pendiente sin cuota detrás. Si hay un importe
  // de verdad, gana.
  assert.equal(etiquetaDeMoroso({ tieneCuota: false, debe: 12.5 }).texto, "debe 12,50 €");
});

test("el buscador filtra por nombre, contacto y concepto", () => {
  const lista = [CON_CUOTA, CON_CUOTA_MESES, SIN_CUOTA];
  assert.deepEqual(filtrarMorosos(lista, "bueno").map((m) => m.clientId), ["2"]);
  assert.deepEqual(filtrarMorosos(lista, "logopedia").map((m) => m.clientId), ["1"]);
  assert.deepEqual(filtrarMorosos(lista, "cuesta").map((m) => m.clientId), ["3"]);
});

test("el buscador ignora acentos y mayúsculas", () => {
  // «Álvarez» escrito sin tilde tiene que encontrarla: es como se teclea.
  assert.equal(filtrarMorosos([CON_CUOTA], "ALVAREZ").length, 1);
  assert.equal(filtrarMorosos([CON_CUOTA], "álvarez").length, 1);
});

test("sin texto no se filtra nada", () => {
  const lista = [CON_CUOTA, SIN_CUOTA];
  assert.equal(filtrarMorosos(lista, "").length, 2);
  assert.equal(filtrarMorosos(lista, "   ").length, 2);
});

test("el resumen cuenta lo que hay en cada bloque, en singular y en plural", () => {
  const r = resumenDeMorosidad({ conCuota: [CON_CUOTA], sinCuota: [SIN_CUOTA, CON_CUOTA_MESES], alDia: 274, familias: 959 });
  assert.equal(r.conCuota, "1 familia debe este mes");
  assert.equal(r.sinCuota, "2 familias con paciente activo y sin cuota escrita");
  assert.equal(r.alDia, "274 al día · 959 familias con paciente activo");
});

test("aguanta que no le pasen nada", () => {
  assert.deepEqual(repartirMorosos(), { conCuota: [], sinCuota: [] });
  assert.deepEqual(filtrarMorosos(), []);
  assert.equal(typeof etiquetaDeMoroso().texto, "string");
});
