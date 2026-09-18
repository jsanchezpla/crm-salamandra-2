// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tipos-de-bono.mjs — el desplegable de «Tipo de bono» enseña bonos,
 * no el catálogo entero (18/09/2026, Aumenta).
 *
 *   node scripts/_smoke-tipos-de-bono.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 * «Al crear un bono, al elegir el tipo de bono, que solo salgan las citas con
 * bono y no todas.» En producción Aumenta tiene 72 tipos de cita y solo 5 con
 * bonos detrás.
 *
 * Lo que fija esta prueba son las tres cosas que, si se tuercen, hacen daño:
 *
 *   1. Que un tipo SUELTO con bonos ya dados siga saliendo. Si se cae, el bono
 *      de 4 sesiones que alguien vendió sobre un tipo normal no se puede ni
 *      encontrar ni corregir: es dinero escondido.
 *   2. Que el resto no se BORRE, solo se guarde detrás: dar un bono sobre un
 *      tipo suelto es legítimo y tiene que seguir pudiéndose.
 *   3. Que un centro sin ningún tipo de bono vea el catálogo entero y no un
 *      desplegable vacío, que parece roto y deja sin dar el primer bono.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  sesionesDelCatalogo,
  bonosDados,
  esTipoDeBono,
  repartirTiposDeBono,
  tiposParaElegirBono,
  tiposQueSePuedenDar,
} from "../lib/billing/tiposDeBono.js";

test("las sesiones se leen con cualquiera de sus tres nombres", () => {
  assert.equal(sesionesDelCatalogo({ sesionesDelTipo: 5 }), 5);
  assert.equal(sesionesDelCatalogo({ sesiones: 6 }), 6);
  assert.equal(sesionesDelCatalogo({ sessionsCount: 10 }), 10);
  // Sin decirlo, una: es una cita suelta, no un bono de cero sesiones.
  assert.equal(sesionesDelCatalogo({}), 1);
  assert.equal(sesionesDelCatalogo(null), 1);
  assert.equal(sesionesDelCatalogo({ sesionesDelTipo: null }), 1);
});

test("los bonos dados cuentan vivos y cerrados", () => {
  assert.equal(bonosDados({ bonos: 3, cerrados: 2 }), 5);
  assert.equal(bonosDados({ bonos: 0, cerrados: 4 }), 4);
  assert.equal(bonosDados({}), 0);
});

test("es tipo de bono el pack del catálogo y el suelto que ya lleva bonos", () => {
  assert.equal(esTipoDeBono({ name: "Logopedia 5", sesionesDelTipo: 5 }), true);
  // El caso que no se puede perder: suelto, pero con bonos dados detrás.
  assert.equal(esTipoDeBono({ name: "Terapia", sesionesDelTipo: 1, bonos: 2 }), true);
  // Cerrados también: un bono agotado sigue siendo dinero que pasó por ahí.
  assert.equal(esTipoDeBono({ name: "Terapia", sesionesDelTipo: 1, cerrados: 1 }), true);
  // Y la cita suelta de siempre, no.
  assert.equal(esTipoDeBono({ name: "Primera visita", sesionesDelTipo: 1 }), false);
  assert.equal(esTipoDeBono({ name: "Primera visita" }), false);
});

test("repartir no borra el resto y conserva el orden", () => {
  const catalogo = [
    { id: "a", name: "Primera visita", sesionesDelTipo: 1 },
    { id: "b", name: "Bono 5", sesionesDelTipo: 5 },
    { id: "c", name: "Revisión", sesionesDelTipo: 1 },
    { id: "d", name: "Terapia", sesionesDelTipo: 1, bonos: 2 },
  ];
  const { deBono, resto, hayResto } = repartirTiposDeBono(catalogo);
  assert.deepEqual(deBono.map((t) => t.id), ["b", "d"]);
  assert.deepEqual(resto.map((t) => t.id), ["a", "c"]);
  assert.equal(hayResto, true);
  // Ninguno se pierde por el camino.
  assert.equal(deBono.length + resto.length, catalogo.length);
});

test("sin tipos que abrir no se ofrece «ver todos»", () => {
  const { hayResto } = repartirTiposDeBono([{ id: "b", sesionesDelTipo: 5 }]);
  assert.equal(hayResto, false);
});

test("el desplegable enseña los de bono, y todos cuando se pide", () => {
  const catalogo = [
    { id: "a", sesionesDelTipo: 1 },
    { id: "b", sesionesDelTipo: 5 },
  ];
  assert.deepEqual(tiposParaElegirBono(catalogo).map((t) => t.id), ["b"]);
  assert.deepEqual(tiposParaElegirBono(catalogo, { todos: true }).map((t) => t.id), ["a", "b"]);
});

test("un tipo borrado del catálogo no se puede volver a dar", () => {
  const filas = [
    { id: "a", name: "PSICOLOGIA 45", sesionesDelTipo: 5, enElCatalogo: true },
    { id: "b", name: "(tipo de bono borrado del catálogo)", sesionesDelTipo: null, bonos: 2, enElCatalogo: false },
  ];
  assert.deepEqual(tiposQueSePuedenDar(filas).map((t) => t.id), ["a"]);
  // Pero SIGUE siendo un tipo de bono: la lista y su filtro tienen que poder
  // enseñarlo, que ahí es dinero que hay que ver.
  assert.equal(esTipoDeBono(filas[1]), true);
});

test("quien no dice si está en el catálogo se queda", () => {
  // Los tipos crudos de /api/citas/event-types no traen el campo; no saber no
  // es lo mismo que estar borrado, y filtrarlos dejaría el cajón vacío.
  const crudos = [{ id: "a", sessionsCount: 5 }, { id: "b", sessionsCount: 1 }];
  assert.deepEqual(tiposQueSePuedenDar(crudos).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(tiposQueSePuedenDar([]), []);
});

test("un centro sin ningún tipo de bono ve el catálogo entero, no una lista vacía", () => {
  const catalogo = [{ id: "a", sesionesDelTipo: 1 }, { id: "b", sesionesDelTipo: 1 }];
  assert.deepEqual(tiposParaElegirBono(catalogo).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(tiposParaElegirBono([]), []);
});
