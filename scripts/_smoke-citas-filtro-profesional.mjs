// @prueba ligera — funciones puras de /lib; importa `Op` de sequelize, pero no
// abre ninguna conexión: sin base, sin servidor, sin .env.
/**
 * _smoke-citas-filtro-profesional.mjs — filtrar por una profesional enseña SOLO
 * las suyas (25/08/2026).
 *
 *   node scripts/_smoke-citas-filtro-profesional.mjs
 *   node --test-name-pattern="sin asignar" scripts/_smoke-citas-filtro-profesional.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, 24/08/2026: «En el calendario se solapan agendas. Estoy
 * seleccionando solo el de una terapeuta y me aparecen solapados otras dos
 * aunque están desactivados del menú.»
 *
 * No eran de otras dos: eran las que no son de nadie. El endpoint del
 * calendario, al filtrar por profesional, añadía SIEMPRE un `OR team_member_id
 * IS NULL` «para no perderlas de vista». Medido en producción el 25/08/2026 con
 * la cuenta de Aumenta, semana del 7 al 13 de septiembre, filtrando por la
 * profesional con más agenda:
 *
 *     103 citas en pantalla · 33 suyas · 70 sin profesional
 *
 * Y como los 57 tipos de cita de Aumenta no tienen color, esas 70 caían al
 * verde por defecto `#3F6E5B`, el mismo que usan las citas de los 3 miembros
 * del equipo sin color de avatar. Por eso se leían como de otra persona.
 *
 * ── QUÉ FIJA ESTA PRUEBA ───────────────────────────────────────────────────
 *
 * Lo que DEVUELVEN las dos funciones, no cómo están escritas. Y sobre todo la
 * aserción que habría cazado el fallo: **filtrar por personas no puede producir
 * ninguna condición que case con NULL**. Se comprueba mirando los símbolos del
 * fragmento de `where`, que es donde vivía el `Op.or`.
 *
 * La otra mitad —que las sin asignar no se pierdan— también se fija: existen
 * porque se pueden PEDIR, con `sin-asignar` como uno más de la lista.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import {
  SIN_PROFESIONAL,
  COLOR_CITA_POR_DEFECTO,
  trocearFiltroDeProfesionales,
} from "../lib/citas/filtros.js";
import { filtroDeProfesionales, soloLoSuyo } from "../lib/citas/visibilidad.js";

/** Ids de mentira, pero con forma de UUID: la columna es `uuid` de verdad. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

/** ¿Este fragmento de where puede casar con una cita sin profesional? */
function caeConNulos(fragmento) {
  if (fragmento === null || typeof fragmento !== "object") return false;
  const claves = [...Object.getOwnPropertySymbols(fragmento), ...Object.keys(fragmento)];
  for (const k of claves) {
    if (k === Op.is && fragmento[k] === null) return true;
    const v = fragmento[k];
    if (Array.isArray(v) && v.some(caeConNulos)) return true;
  }
  return false;
}

describe("el centinela de «sin asignar»", () => {
  test("no puede chocar con el id de una ficha de equipo", () => {
    // Los ids del equipo son UUID. Si el centinela lo fuera, un día coincidiría.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.equal(UUID.test(SIN_PROFESIONAL), false);
    assert.equal(SIN_PROFESIONAL, "sin-asignar");
  });

  test("el color por defecto es el que pinta el endpoint", () => {
    assert.equal(COLOR_CITA_POR_DEFECTO, "#3F6E5B");
  });
});

describe("trocearFiltroDeProfesionales", () => {
  test("sin parámetro no hay filtro: «todos»", () => {
    assert.equal(trocearFiltroDeProfesionales(null), null);
    assert.equal(trocearFiltroDeProfesionales(undefined), null);
    assert.equal(trocearFiltroDeProfesionales(""), null);
  });

  test("una lista que se queda vacía tampoco filtra", () => {
    // El MultiSelect no manda listas vacías nunca, pero la query la escribe
    // cualquiera a mano: una coma suelta no puede vaciar el calendario.
    assert.equal(trocearFiltroDeProfesionales(","), null);
    assert.equal(trocearFiltroDeProfesionales("  ,  , "), null);
  });

  test("personas sueltas, con los espacios recortados", () => {
    assert.deepEqual(trocearFiltroDeProfesionales(` ${A} , ${B} `), {
      ids: [A, B],
      incluirSinAsignar: false,
    });
  });

  test("«sin asignar» sale de la lista de ids y se marca aparte", () => {
    assert.deepEqual(trocearFiltroDeProfesionales(`${A},${SIN_PROFESIONAL},${B}`), {
      ids: [A, B],
      incluirSinAsignar: true,
    });
  });

  test("«sin asignar» a solas deja la lista de personas vacía", () => {
    assert.deepEqual(trocearFiltroDeProfesionales(SIN_PROFESIONAL), {
      ids: [],
      incluirSinAsignar: true,
    });
  });

  test("lo que no es un UUID no llega a la consulta", () => {
    /*
     * `team_member_id` es `uuid` en PostgreSQL. Mandarle basura no devuelve
     * cero filas: revienta la consulta con un 22P02 y deja el calendario en
     * blanco. Pasó en local el 25/08/2026 con un `'&teamMemberIds=' + undefined`.
     */
    assert.equal(trocearFiltroDeProfesionales("undefined"), null);
    assert.equal(trocearFiltroDeProfesionales("null,, 7 "), null);
    assert.equal(trocearFiltroDeProfesionales("'; DROP TABLE bookings; --"), null);
    // Pero una persona buena entre basura sigue valiendo.
    assert.deepEqual(trocearFiltroDeProfesionales(`undefined,${A}`), {
      ids: [A],
      incluirSinAsignar: false,
    });
    // Y la basura no se lleva por delante a «sin asignar».
    assert.deepEqual(trocearFiltroDeProfesionales(`undefined,${SIN_PROFESIONAL}`), {
      ids: [],
      incluirSinAsignar: true,
    });
  });
});

describe("filtroDeProfesionales — el where del calendario", () => {
  test("sin filtro, no toca el where", () => {
    assert.equal(filtroDeProfesionales(null), null);
    assert.equal(filtroDeProfesionales(""), null);
    assert.equal(filtroDeProfesionales(","), null);
    assert.equal(filtroDeProfesionales("undefined"), null);
  });

  test("EL FALLO DE RODRIGO: filtrar por personas NO puede colar las de nadie", () => {
    assert.deepEqual(filtroDeProfesionales(A), { [Op.in]: [A] });
    assert.equal(caeConNulos(filtroDeProfesionales(A)), false);
    assert.equal(caeConNulos(filtroDeProfesionales(`${A},${B},${C}`)), false);
  });

  test("pero se pueden pedir: «sin asignar» es una opción más", () => {
    assert.equal(caeConNulos(filtroDeProfesionales(`${A},${SIN_PROFESIONAL}`)), true);
    assert.deepEqual(filtroDeProfesionales(`${A},${SIN_PROFESIONAL}`), {
      [Op.or]: [{ [Op.in]: [A] }, { [Op.is]: null }],
    });
  });

  test("«sin asignar» a solas es la cola de reparto, y nada más", () => {
    const f = filtroDeProfesionales(SIN_PROFESIONAL);
    assert.deepEqual(f, { [Op.is]: null });
    assert.equal(caeConNulos(f), true);
    // Y no arrastra ninguna persona.
    assert.equal(Op.in in f, false);
  });
});

describe("lo que NO cambia: el permiso de quien solo ve lo suyo", () => {
  test("sigue viendo las citas que no son de nadie", () => {
    /*
     * Aquí las sin asignar SÍ entran, y es deliberado: en nutri_laura son la
     * mitad de la agenda —entran por la web sin profesional— y esconderlas
     * dejaría a la profesional mirando un calendario casi vacío. Un permiso
     * («qué puedo ver») no es una elección («qué he pedido ver»).
     */
    assert.equal(caeConNulos(soloLoSuyo("una-ficha")), true);
  });

  test("y sin saber quién mira, no destapa a nadie más", () => {
    const f = soloLoSuyo(null);
    const iguales = f[Op.or].find((c) => Op.eq in c)[Op.eq];
    assert.equal(iguales, "00000000-0000-0000-0000-000000000000");
  });
});
