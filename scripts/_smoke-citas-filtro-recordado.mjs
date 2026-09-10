// @prueba ligera — funciones puras de /lib, con un almacén de mentira: sin
// navegador, sin base, sin servidor.
/**
 * _smoke-citas-filtro-recordado.mjs — la profesional que se estaba mirando
 * sigue puesta al volver a Citas, y solo diez minutos (10/09/2026).
 *
 *   node scripts/_smoke-citas-filtro-recordado.mjs
 *   node --test-name-pattern="caduca" scripts/_smoke-citas-filtro-recordado.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 *
 * Rosa (Aumenta), 10/09/2026: «Cada vez que salgo de Citas a otra pestaña del
 * CRM y vuelvo, me salen todas las terapeutas sin seleccionar ninguna.»
 * Dirección reparte la agenda de dieciocho personas entrando y saliendo decenas
 * de veces al día, y cada regreso costaba volver a buscar a la misma persona.
 *
 * ── QUÉ FIJA ESTA PRUEBA ───────────────────────────────────────────────────
 *
 * Lo que DEVUELVE `recuperarFiltroDeProfesional`, que es lo que decide qué ve
 * quien vuelve. Y en particular las cuatro reglas que no se ven a simple vista:
 * el plazo corto (para que la agenda no amanezca acotada por lo del viernes),
 * que el recuerdo es de QUIEN lo puso (en recepción se comparte ordenador),
 * que «Todo el equipo» se recuerda igual que una lista, y que una ficha de
 * equipo borrada no puede dejar la agenda en blanco.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MINUTOS_DE_MEMORIA,
  CLAVE_FILTRO_PROFESIONAL,
  recuperarFiltroDeProfesional,
  recordarFiltroDeProfesional,
  olvidarFiltroDeProfesional,
} from "../lib/citas/filtroRecordado.js";

/** Un `localStorage` de mentira: lo mismo que usa la pantalla, sin navegador. */
function almacenFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
    get tamaño() { return datos.size; },
  };
}

const ARACELI = "11111111-1111-4111-8111-111111111111";
const OLGA = "22222222-2222-4222-8222-222222222222";
const ROSA_USER = "user-rosa";
const AHORA = Date.parse("2026-09-10T10:00:00Z");
const UN_MINUTO = 60 * 1000;

describe("la profesional mirada se repone al volver", () => {
  test("lo que se anotó hace un minuto se repone tal cual", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA });
    const repuesto = recuperarFiltroDeProfesional(almacen, {
      userId: ROSA_USER,
      idsValidos: [ARACELI, OLGA],
      ahora: AHORA + UN_MINUTO,
    });
    assert.deepEqual(repuesto, { ids: [ARACELI] });
  });

  test("«Todo el equipo» se recuerda igual que una lista", () => {
    // Si esto devolviera `null`, la pantalla caería en su preselección y
    // devolvería a quien mira SU agenda justo después de haber pedido la de
    // todos: el filtro se sentiría embrujado.
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: null, ahora: AHORA });
    const repuesto = recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, ahora: AHORA });
    assert.deepEqual(repuesto, { ids: null });
  });

  test("la lista vacía es «todos», como en el desplegable", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [], ahora: AHORA });
    assert.deepEqual(recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, ahora: AHORA }), { ids: null });
  });

  test("varias a la vez se reponen todas", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI, OLGA], ahora: AHORA });
    const repuesto = recuperarFiltroDeProfesional(almacen, {
      userId: ROSA_USER,
      idsValidos: [ARACELI, OLGA],
      ahora: AHORA,
    });
    assert.deepEqual(repuesto, { ids: [ARACELI, OLGA] });
  });
});

describe("el plazo es corto", () => {
  test("justo antes de los diez minutos todavía vale", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA });
    const casi = AHORA + MINUTOS_DE_MEMORIA * UN_MINUTO - 1;
    assert.deepEqual(
      recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, idsValidos: [ARACELI], ahora: casi }),
      { ids: [ARACELI] }
    );
  });

  test("pasados los diez minutos caduca y se borra", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA });
    const tarde = AHORA + MINUTOS_DE_MEMORIA * UN_MINUTO + 1;
    assert.equal(
      recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, idsValidos: [ARACELI], ahora: tarde }),
      null
    );
    // Y no queda basura: el lunes por la mañana no hay nada que reponer.
    assert.equal(almacen.getItem(CLAVE_FILTRO_PROFESIONAL), null);
  });

  test("un sello del futuro (reloj cambiado) tampoco vale", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA + 60 * UN_MINUTO });
    assert.equal(recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, ahora: AHORA }), null);
  });
});

describe("el recuerdo es de quien lo puso", () => {
  test("otra persona en el mismo ordenador no lo hereda", () => {
    // En recepción se comparte equipo: sin esto, quien entra después abriría la
    // agenda acotada a la terapeuta que miró la anterior.
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA });
    assert.equal(recuperarFiltroDeProfesional(almacen, { userId: "user-olga", ahora: AHORA }), null);
  });

  test("sin saber quién mira, no se repone nada", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI], ahora: AHORA });
    assert.equal(recuperarFiltroDeProfesional(almacen, { userId: null, ahora: AHORA }), null);
  });

  test("sin usuario tampoco se anota", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: null, ids: [ARACELI], ahora: AHORA });
    assert.equal(almacen.tamaño, 0);
  });
});

describe("nunca deja la agenda en blanco", () => {
  test("una ficha de equipo que ya no existe se descarta y manda el arranque de siempre", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [OLGA], ahora: AHORA });
    assert.equal(
      recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, idsValidos: [ARACELI], ahora: AHORA }),
      null
    );
  });

  test("de dos recordadas, si solo queda una se repone esa", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: [ARACELI, OLGA], ahora: AHORA });
    assert.deepEqual(
      recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, idsValidos: [ARACELI], ahora: AHORA }),
      { ids: [ARACELI] }
    );
  });

  test("«Sin asignar» se repone si sigue siendo una opción", () => {
    const almacen = almacenFalso();
    recordarFiltroDeProfesional(almacen, { userId: ROSA_USER, ids: ["sin-asignar"], ahora: AHORA });
    assert.deepEqual(
      recuperarFiltroDeProfesional(almacen, {
        userId: ROSA_USER,
        idsValidos: [ARACELI, "sin-asignar"],
        ahora: AHORA,
      }),
      { ids: ["sin-asignar"] }
    );
  });
});

describe("sin memoria, todo sigue funcionando", () => {
  test("sin almacén no se rompe ni se repone nada", () => {
    assert.equal(recuperarFiltroDeProfesional(null, { userId: ROSA_USER, ahora: AHORA }), null);
    assert.doesNotThrow(() => recordarFiltroDeProfesional(null, { userId: ROSA_USER, ids: [ARACELI] }));
    assert.doesNotThrow(() => olvidarFiltroDeProfesional(null));
  });

  test("un almacén que lanza al leer o escribir no tumba la agenda", () => {
    const roto = {
      getItem() { throw new Error("modo privado"); },
      setItem() { throw new Error("cuota llena"); },
      removeItem() { throw new Error("modo privado"); },
    };
    assert.equal(recuperarFiltroDeProfesional(roto, { userId: ROSA_USER, ahora: AHORA }), null);
    assert.doesNotThrow(() => recordarFiltroDeProfesional(roto, { userId: ROSA_USER, ids: [ARACELI] }));
    assert.doesNotThrow(() => olvidarFiltroDeProfesional(roto));
  });

  test("basura en la clave se tira, no se repone", () => {
    const almacen = almacenFalso({ [CLAVE_FILTRO_PROFESIONAL]: "{esto no es json" });
    assert.equal(recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, ahora: AHORA }), null);
    assert.equal(almacen.getItem(CLAVE_FILTRO_PROFESIONAL), null);
  });

  test("un guardado sin sello no vale", () => {
    const almacen = almacenFalso({
      [CLAVE_FILTRO_PROFESIONAL]: JSON.stringify({ u: ROSA_USER, ids: [ARACELI] }),
    });
    assert.equal(recuperarFiltroDeProfesional(almacen, { userId: ROSA_USER, ahora: AHORA }), null);
  });
});
