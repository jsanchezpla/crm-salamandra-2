// @prueba ligera — funciones puras de /lib con modelos falsos; sin base, sin servidor, sin .env.
/**
 * _smoke-fichaje-preview-mapeos.mjs — el preview del volcado cuenta las filas
 * CON los nombres ya asignados en el modal (31/08/2026).
 *
 *   node scripts/_smoke-fichaje-preview-mapeos.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El primer volcado del fichero del reloj de Aumenta (julio 2026): OCHO
 * nombres y ninguno casaba exacto con el equipo. Todas las filas salían
 * bloqueadas («no está mapeado a nadie»), `totales.listas` era 0, y el botón
 * del modal exige `listas > 0`… así que por mucho que se asignara a todo el
 * mundo en los desplegables, el botón se quedaba en gris para siempre. En
 * marzo no se vio porque algún nombre casaba solo y `listas` nunca era 0.
 *
 * El arreglo: `previsualizar` acepta `mapeos` (lo ya elegido en el modal) y
 * los aplica EN MEMORIA al recontar — sin guardar ningún alias, que eso es de
 * `aplicar`. Esta prueba fija las cuatro reglas:
 *
 *   · sin mapeos, un nombre que no casa bloquea sus filas y `puedeAplicarse`
 *     es false (lo de siempre);
 *   · con el mapeo puesto, las mismas filas quedan LISTAS, el pendiente
 *     desaparece y `puedeAplicarse` se enciende;
 *   · un mapeo a alguien que no está en el equipo activo se ignora;
 *   · un mapeo NO pisa un nombre que ya casaba exacto por sí solo.
 *
 * Los modelos de Sequelize se sustituyen por objetos con las tres llamadas que
 * hace `previsualizar` (findAll, findOne, count): la función no distingue, y
 * así la prueba corre sin base de datos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { previsualizar } from "../lib/fichaje/importar.js";

// ── Un libro del reloj de mentira (la forma mínima que lee el lector) ──────

function hoja(nombre, filas) {
  return {
    name: nombre,
    rowCount: filas.length,
    columnCount: filas.reduce((m, f) => Math.max(m, f.length), 0),
    getRow(r) {
      const fila = filas[r - 1] ?? [];
      return { getCell: (c) => ({ value: fila[c - 1] ?? null }) };
    },
  };
}

const filaDias = () => Array.from({ length: 31 }, (_, i) => i + 1);
const filaId = (id, nombre) => {
  const f = [];
  f[0] = "ID :";
  f[2] = String(id);
  f[7] = "Nombre :";
  f[9] = nombre;
  return f;
};

/** Un volcado del reloj con una sola persona: «rosa», día 2, 08:46–14:05. */
function libroReloj() {
  const marcajes = [];
  marcajes[1] = "08:46\n14:05\n";
  return {
    worksheets: [
      hoja("Registro asistencia", [
        ["Registro asistencia"],
        [],
        ["Date :", null, "07/01/2026 ~ 07/31/2026"],
        filaDias(),
        filaId(1, "rosa"),
        marcajes,
      ]),
    ],
  };
}

// ── Modelos falsos: lo justo que `previsualizar` les pide ──────────────────

function modelos(personas) {
  return {
    TeamMember: { findAll: async () => personas },
    Fichaje: { count: async () => 0 },
    FichajeImport: { findOne: async () => null },
  };
}

const persona = (id, displayName) => ({ id, displayName, email: null, customFields: {} });

const PERIODO = "2026-07";

describe("previsualizar con mapeos: el recuento del modal es el de verdad", () => {
  it("sin mapeos, el nombre que no casa bloquea sus filas y no se puede aplicar", async () => {
    const p = await previsualizar({
      workbook: libroReloj(),
      periodo: PERIODO,
      slug: "aumenta",
      tenantModels: modelos([persona("id-rosa", "Rosa García Pérez")]),
    });
    assert.equal(p.totales.listas, 0);
    assert.equal(p.totales.bloqueadas, 1);
    assert.equal(p.pendientesDeMapeo.length, 1);
    assert.equal(p.pendientesDeMapeo[0].nombre, "rosa");
    assert.equal(p.puedeAplicarse, false);
  });

  it("con el mapeo puesto, las mismas filas quedan listas y el botón se puede encender", async () => {
    const p = await previsualizar({
      workbook: libroReloj(),
      periodo: PERIODO,
      slug: "aumenta",
      tenantModels: modelos([persona("id-rosa", "Rosa García Pérez")]),
      mapeos: { rosa: "id-rosa" },
    });
    assert.equal(p.totales.listas, 1);
    assert.equal(p.totales.bloqueadas, 0);
    assert.equal(p.totales.minutos, 5 * 60 + 19);
    assert.equal(p.pendientesDeMapeo.length, 0);
    assert.equal(p.puedeAplicarse, true);
    assert.deepEqual(
      p.resumenPorPersona.map((r) => [r.nombre, r.minutos]),
      [["Rosa García Pérez", 319]]
    );
  });

  it("un mapeo a alguien que no está en el equipo activo se ignora", async () => {
    const p = await previsualizar({
      workbook: libroReloj(),
      periodo: PERIODO,
      slug: "aumenta",
      tenantModels: modelos([persona("id-rosa", "Rosa García Pérez")]),
      mapeos: { rosa: "id-de-fuera" },
    });
    assert.equal(p.totales.listas, 0);
    assert.equal(p.pendientesDeMapeo.length, 1);
    assert.equal(p.puedeAplicarse, false);
  });

  it("un mapeo no pisa un nombre que ya casaba exacto por sí solo", async () => {
    const p = await previsualizar({
      workbook: libroReloj(),
      periodo: PERIODO,
      slug: "aumenta",
      // «rosa» casa EXACTO con la primera persona; el mapeo intenta desviarla.
      tenantModels: modelos([persona("id-rosa", "rosa"), persona("id-blanca", "Blanca Ruiz")]),
      mapeos: { rosa: "id-blanca" },
    });
    assert.equal(p.totales.listas, 1);
    assert.deepEqual(
      p.resumenPorPersona.map((r) => [r.nombre, r.minutos]),
      [["rosa", 319]]
    );
  });
});
