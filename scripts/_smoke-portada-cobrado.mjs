// @prueba ligera
/**
 * _smoke-portada-cobrado.mjs — «Cobrado» de la portada son los COBROS.
 *
 * Fija el arreglo del 04/09/2026 (Rodrigo: «en la página de inicio los datos
 * del panel operativo de facturación no se actualizan»). La cifra salía del
 * `paid_amount` de las facturas EMITIDAS en el mes, y en un centro que cobra la
 * cuota primero y factura al cierre —Aumenta— eso son tres ceros clavados todo
 * el mes mientras el Panel operativo cuenta miles de euros. Ahora las dos
 * pantallas leen lo mismo: cobros completados con fecha de cobro dentro del
 * mes, tengan factura o no.
 *
 * Lógica pura con modelos de mentira: sin base de datos, sin servidor, sin .env.
 * (La marca «ligera» es obligatoria: abajo se nombran queries en comentarios.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortada } from "../lib/home/summary.js";

// Un mes SIN una sola factura y con cobros apuntados: el caso de Aumenta.
function modelos({ cobros = { n: 84, sum: 14701 } } = {}) {
  return {
    // Sin facturas: los agregados vuelven vacíos (SUM de cero filas es null) y
    // el COUNT a 0, que es justo lo que devuelve Postgres.
    Invoice: { findAll: async () => [{ n: 0, sum: null, billed: null, billedBase: null, collectedBase: null, billedTotal: null, invoiceCount: 0 }] },
    Cost: { findAll: async () => [] },
    Payment: { findAll: async () => [{ n: cobros.n, sum: cobros.sum }] },
  };
}

function ctxDe({ role = "admin", tenantModels } = {}) {
  const mods = new Set(["billing"]);
  return {
    hasModule: (k) => mods.has(k),
    tenantHasModule: (k) => mods.has(k),
    tenantModels: tenantModels || modelos(),
    tenantSequelize: null,
    user: { id: "u1", role },
    tenant: { settings: {} },
  };
}

test("un mes sin facturas pero con cobros: la portada enseña lo que ha entrado", async () => {
  const p = await buildPortada(ctxDe({ role: "admin" }));
  assert.ok(p.finance, "las cifras de dinero tienen que llegar");
  assert.equal(p.finance.month.billed, 0, "sin facturas, facturado es 0 y eso es verdad");
  assert.equal(p.finance.month.invoices, 0);
  assert.equal(p.finance.collected, 14701, "cobrado sale de los cobros, no de las facturas");
  assert.equal(p.finance.collectedCount, 84, "el pie cuenta cobros, no un % sobre lo facturado");
});

test("cobrado lo ve quien tiene Facturación, aunque no sea admin", async () => {
  // 04/09/2026, Rodrigo: en Aumenta las dos personas que llevan el dinero —Olga
  // y Rosa— no son admin, y ver dos ceros era justo lo contrario de proteger
  // nada. El gate es el módulo, no el rol.
  const p = await buildPortada(ctxDe({ role: "user" }));
  assert.ok(p.finance, "las cifras tienen que llegar");
  assert.equal(p.finance.collected, 14701);
  assert.equal(p.finance.collectedCount, 84);
  assert.equal(p.finance.month.billed, 0, "y el facturado sigue saliendo de las facturas");
});

test("sin el módulo de Facturación no llega ninguna cifra de dinero", async () => {
  const ctx = ctxDe({ role: "user" });
  ctx.hasModule = () => false;
  const p = await buildPortada(ctx);
  assert.equal(p.finance, null, "el gate sigue siendo el módulo");
});

test("sin tabla de cobros la portada no pierde las otras cifras", async () => {
  const mods = modelos();
  mods.Payment = {
    findAll: async () => {
      const err = new Error('relation "payments" does not exist');
      err.parent = { code: "42P01" };
      throw err;
    },
  };
  const p = await buildPortada(ctxDe({ role: "admin", tenantModels: mods }));
  assert.ok(p.finance, "facturado y vencido tienen que seguir llegando");
  assert.equal(p.finance.collected, null, "sin cobros que leer, la caja no se pinta");
});

test("el mes que se pide es el mes ENTERO, como el Panel operativo", async () => {
  let rangoCobros = null;
  const mods = modelos();
  mods.Payment = {
    findAll: async ({ where }) => {
      rangoCobros = where.paidAt;
      return [{ n: 1, sum: 50 }];
    },
  };
  await buildPortada(ctxDe({ role: "admin", tenantModels: mods }));
  const valores = Object.getOwnPropertySymbols(rangoCobros).map((s) => rangoCobros[s]);
  const [desde, hasta] = valores.map((v) => String(v).slice(0, 10));
  const hoy = new Date().toISOString().slice(0, 10);
  assert.equal(desde.slice(8), "01", "arranca el día 1: " + desde);
  assert.ok(hasta >= hoy, "llega al final del mes, no se corta hoy: " + hasta);
  assert.equal(desde.slice(0, 7), hasta.slice(0, 7), "de un solo mes");
});
