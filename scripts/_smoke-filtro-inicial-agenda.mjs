// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-filtro-inicial-agenda.mjs — con qué filtro se abre la pantalla de
 * Citas (10/09/2026).
 *
 *   node scripts/_smoke-filtro-inicial-agenda.mjs
 *   node --test-name-pattern="administración" scripts/_smoke-filtro-inicial-agenda.mjs
 *
 * ── DE QUÉ QUEJA REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, 10/09/2026: «En Citas, Olga y Rosa tienen agenda propia y no tiene
 * sentido. Deberían ver automáticamente la de todos, igual que admin.»
 *
 * Desde el 01/09/2026 la agenda se abre acotada a quien mira, que es lo que
 * quiere una terapeuta con 1.300 citas. Olga y Rosa llevan la administración de
 * Aumenta y no atienden a nadie: entre las dos tienen CERO citas, así que esa
 * misma preselección les abría el calendario EN BLANCO, con las 18 agendas del
 * centro escondidas detrás de un clic que nadie sabía que había que dar.
 *
 * La regla que se fija aquí es la del DEPARTAMENTO, no la del rol: en Aumenta
 * las dos son `admin`, pero dirección también lo es y sí pasa consulta, así que
 * a dirección la preselección le sigue sirviendo. Se prueba lo que DEVUELVE la
 * función, no cómo está escrita: el JSX solo la llama.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filtroAlAbrirLaAgenda, llevaLaAdministracion } from "../lib/citas/filtroInicialAgenda.js";

// Las fichas de producción de Aumenta (01/09/2026), por si algún día hay que
// releer esto con la foto delante.
const OLGA = "65e1df0b-3363-42f6-92a0-e8a156430573"; // Administración
const ROSA = "3a646cc4-5678-4fd0-a239-58e1e2070a97"; // Contabilidad
const DIRECCION = "bde3a8f4-b1d4-437c-8ee8-7e5a37112f49"; // Isabel, 54 citas
const TERAPEUTA = "689d04b8-bfac-41bf-a183-048a00ed8043"; // Araceli, 1.356 citas

const ADMINISTRACION = [OLGA, ROSA];

describe("filtroAlAbrirLaAgenda", () => {
  it("abre la agenda de quien mira cuando atiende a pacientes", () => {
    assert.deepEqual(
      filtroAlAbrirLaAgenda({ miFichaId: TERAPEUTA, idsAdministracion: ADMINISTRACION }),
      [TERAPEUTA]
    );
  });

  it("no acota nada a quien lleva la administración del centro", () => {
    assert.equal(filtroAlAbrirLaAgenda({ miFichaId: OLGA, idsAdministracion: ADMINISTRACION }), null);
    assert.equal(filtroAlAbrirLaAgenda({ miFichaId: ROSA, idsAdministracion: ADMINISTRACION }), null);
  });

  it("dirección sí se preselecciona: es admin, pero pasa consulta", () => {
    assert.deepEqual(
      filtroAlAbrirLaAgenda({ miFichaId: DIRECCION, idsAdministracion: ADMINISTRACION }),
      [DIRECCION]
    );
  });

  it("sin ficha de equipo se abre el centro entero", () => {
    assert.equal(filtroAlAbrirLaAgenda({ miFichaId: null, idsAdministracion: ADMINISTRACION }), null);
    assert.equal(filtroAlAbrirLaAgenda({}), null);
    assert.equal(filtroAlAbrirLaAgenda(), null);
  });

  it("sin lista de administración manda la regla de siempre", () => {
    // La lista llega en la MISMA respuesta que el equipo, pero si un día no
    // viniera, nadie es administración y la agenda se abre como el 01/09.
    assert.deepEqual(filtroAlAbrirLaAgenda({ miFichaId: OLGA }), [OLGA]);
    assert.deepEqual(filtroAlAbrirLaAgenda({ miFichaId: OLGA, idsAdministracion: [] }), [OLGA]);
  });
});

describe("llevaLaAdministracion", () => {
  it("dice que sí solo de quien está en la lista", () => {
    assert.equal(llevaLaAdministracion(OLGA, ADMINISTRACION), true);
    assert.equal(llevaLaAdministracion(TERAPEUTA, ADMINISTRACION), false);
  });

  it("aguanta lo que no es una lista o no es una ficha", () => {
    assert.equal(llevaLaAdministracion(OLGA, null), false);
    assert.equal(llevaLaAdministracion(OLGA, "administración"), false);
    assert.equal(llevaLaAdministracion(null, ADMINISTRACION), false);
    assert.equal(llevaLaAdministracion(undefined, ADMINISTRACION), false);
  });
});
