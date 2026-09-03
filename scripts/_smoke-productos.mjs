// @prueba ligera — funciones puras de /lib y texto del fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-productos.mjs — el módulo Productos: qué cuenta como venta, y que
 * Inventario, Pedidos y Tienda siguen colgando de él (03/09/2026).
 *
 *   node scripts/_smoke-productos.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Rodrigo pidió agrupar los tres en «Productos», con básico y avanzado, y que
 * el producto con su valor viviera SOLO ahí. Lo que esta prueba fija:
 *
 *   1. `agregarVentas` (lib/productos/ventas.js): lo que DEVUELVE. Un
 *      carrito de la tienda es un borrador hasta que se paga, y contarlo sería
 *      contar dinero que no ha entrado; los cancelados van aparte; el ranking
 *      va por importe; «sin vender» son los activos que no aparecen.
 *   2. Las puertas, por texto (lo que CLAUDE.md admite para «¿sigue el if
 *      donde estaba?»): el endpoint de productos exige `productos`, el menú
 *      cuelga los tres del avanzado, la Tienda ya no manda `salePrice`, e
 *      Inventario ya no da de alta productos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { agregarVentas, ESTADOS_VENTA } from "../lib/productos/ventas.js";
import { CATALOGO, moduloPorClave } from "../lib/provisioning/catalogo.js";
import { MODULE_KEYS } from "../lib/tenant/moduleKeys.js";
import { MODULES, ONE_OFF } from "./_module-migrations.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const lee = (rel) => readFileSync(join(RAIZ, rel), "utf8");

/* ── Datos ──────────────────────────────────────────────────────────────── */

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function pedido(id, status, lines, extra = {}) {
  const total = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  return { id, status, total: total.toFixed(2), origin: "manual", createdAt: new Date(2026, 8, 3, 10, 0), lines, ...extra };
}
const linea = (productId, productName, quantity, unitPrice) => ({
  productId, productName, quantity, unitPrice, lineTotal: (quantity * unitPrice).toFixed(2),
});

const PEDIDOS = [
  pedido("o1", "completed", [linea(P1, "Camiseta", 2, 20), linea(P2, "Taza", 1, 12)]),
  pedido("o2", "confirmed", [linea(P1, "Camiseta", 1, 20)], { origin: "tienda", createdAt: new Date(2026, 7, 28, 9, 0) }),
  pedido("o3", "draft", [linea(P3, "Póster", 5, 8)], { origin: "tienda" }),
  pedido("o4", "cancelled", [linea(P2, "Taza", 3, 12)]),
  pedido("o5", "shipped", [linea(null, "Envío urgente", 1, 6)]),
];
const ACTIVOS = [{ id: P1, name: "Camiseta" }, { id: P2, name: "Taza" }, { id: P3, name: "Póster" }];

/* ── agregarVentas ──────────────────────────────────────────────────────── */

describe("agregarVentas: qué cuenta como venta y cómo se agrupa", () => {
  it("sin pedidos, todo a cero y sin filas; los activos salen todos como «sin vender»", () => {
    assert.deepEqual(agregarVentas([], { activos: ACTIVOS }), {
      totales: { pedidos: 0, importe: 0, unidades: 0, ticketMedio: 0, cancelados: 0, borradores: 0 },
      porProducto: [],
      porMes: [],
      porOrigen: [],
      sinVentas: 3,
      productosActivos: 3,
    });
    assert.deepEqual(agregarVentas().totales.pedidos, 0);
  });

  it("los cuatro estados que cuentan son confirmado, en preparación, enviado y completado; el borrador y el cancelado NO", () => {
    assert.deepEqual(ESTADOS_VENTA, ["confirmed", "preparing", "shipped", "completed"]);
    const r = agregarVentas(PEDIDOS, { activos: ACTIVOS });
    // o1 (52) + o2 (20) + o5 (6): el borrador o3 (40) y el cancelado o4 (36) fuera.
    assert.equal(r.totales.pedidos, 3);
    assert.equal(r.totales.importe, 78);
    assert.equal(r.totales.unidades, 5);
    assert.equal(r.totales.ticketMedio, 26);
    assert.equal(r.totales.cancelados, 1);
    assert.equal(r.totales.borradores, 1);
  });

  it("el ranking va por importe, suma unidades y cuenta en cuántos pedidos salió cada producto", () => {
    const r = agregarVentas(PEDIDOS, { activos: ACTIVOS });
    assert.deepEqual(
      r.porProducto.map((f) => [f.productId, f.nombre, f.unidades, f.importe, f.pedidos]),
      [
        [P1, "Camiseta", 3, 60, 2],
        [P2, "Taza", 1, 12, 1],
        [null, "Envío urgente", 1, 6, 1],
      ]
    );
  });

  it("«sin vender» son los activos que no aparecen en ninguna venta: el póster solo estaba en un borrador", () => {
    assert.equal(agregarVentas(PEDIDOS, { activos: ACTIVOS }).sinVentas, 1);
  });

  it("por mes va en local ('AAAA-MM') y ordenado; por origen, de más a menos importe", () => {
    const r = agregarVentas(PEDIDOS, { activos: ACTIVOS });
    assert.deepEqual(
      r.porMes.map((m) => [m.mes, m.pedidos, m.importe, m.unidades]),
      [
        ["2026-08", 1, 20, 1],
        ["2026-09", 2, 58, 4],
      ]
    );
    assert.deepEqual(
      r.porOrigen.map((o) => [o.origen, o.pedidos, o.importe]),
      [
        ["manual", 2, 58],
        ["tienda", 1, 20],
      ]
    );
  });

  it("cifras que llegan como texto (DECIMAL de Postgres) o rotas se suman igual, y sin `lines` no revienta", () => {
    const r = agregarVentas([
      { id: "a", status: "completed", total: "10.50", createdAt: new Date(2026, 0, 1), lines: [{ productId: P1, productName: "X", quantity: "1.5", lineTotal: "10.50" }] },
      { id: "b", status: "completed", total: "no", createdAt: new Date(2026, 0, 2) },
    ]);
    assert.equal(r.totales.importe, 10.5);
    assert.equal(r.totales.unidades, 1.5);
    assert.equal(r.totales.pedidos, 2);
  });

  it("no toca los pedidos que le dan", () => {
    const copia = JSON.parse(JSON.stringify(PEDIDOS));
    agregarVentas(PEDIDOS, { activos: ACTIVOS });
    assert.deepEqual(JSON.parse(JSON.stringify(PEDIDOS)), copia);
  });
});

/* ── Las claves y el catálogo ───────────────────────────────────────────── */

describe("Productos en el catálogo, en las claves y en el mapa de migraciones", () => {
  it("el grupo «Productos» vende los cinco, en este orden: básico, avanzado, Inventario, Pedidos, Tienda", () => {
    const grupo = CATALOGO.find((g) => g.grupo === "Productos");
    assert.ok(grupo, "falta el grupo Productos");
    assert.deepEqual(grupo.modulos.map((m) => m.key), ["productos", "productos_avanzado", "inventory", "orders", "tienda"]);
    assert.equal(moduloPorClave("productos").requiere, undefined);
    assert.deepEqual(moduloPorClave("productos_avanzado").requiere, ["productos"]);
  });

  it("Pedidos, Inventario y Tienda ya no se venden en «Dinero» ni en «Captación y web»", () => {
    for (const g of CATALOGO) {
      if (g.grupo === "Productos") continue;
      for (const k of ["inventory", "orders", "tienda"]) {
        assert.ok(!g.modulos.some((m) => m.key === k), `${k} sigue en «${g.grupo}»`);
      }
    }
  });

  it("las claves canónicas existen y son las de la base", () => {
    assert.equal(MODULE_KEYS.PRODUCTOS, "productos");
    assert.equal(MODULE_KEYS.PRODUCTOS_AVANZADO, "productos_avanzado");
    assert.equal(MODULE_KEYS.INVENTORY, "inventory");
    assert.equal(MODULE_KEYS.ORDERS, "orders");
  });

  it("el mapa de migraciones conoce los dos niveles (comparten la tabla con Inventario) y Pedidos por fin crea sus tablas", () => {
    assert.deepEqual(MODULES.productos, ["migrate-inventario-rework"]);
    assert.deepEqual(MODULES.productos_avanzado, ["migrate-inventario-rework"]);
    assert.deepEqual(MODULES.orders, ["migrate-orders"]);
    assert.ok(MODULES.inventory.includes("migrate-inventario-rework"));
    assert.ok("migrate-productos" in ONE_OFF, "el reparto a quien tenía el trío es de MASTER: va en ONE_OFF");
  });
});

/* ── Las puertas, por texto ─────────────────────────────────────────────── */

describe("las puertas: el producto y su valor son de Productos", () => {
  it("los endpoints del catálogo exigen `productos`, no `inventory`", () => {
    for (const rel of ["app/api/inventory/products/route.js", "app/api/inventory/products/[id]/route.js"]) {
      const src = lee(rel);
      assert.ok(src.includes('hasModule("productos")'), `${rel}: sin puerta productos`);
      assert.ok(!src.includes('hasModule("inventory")'), `${rel}: sigue gateado por inventory`);
    }
  });

  it("las entradas, los ajustes y las variantes siguen siendo de Inventario", () => {
    for (const rel of [
      "app/api/inventory/entries/route.js",
      "app/api/inventory/stock-movements/route.js",
      "app/api/inventory/products/[id]/variantes/route.js",
    ]) {
      assert.ok(lee(rel).includes('hasModule("inventory")'), `${rel}: perdió su puerta`);
    }
  });

  it("las estadísticas exigen el avanzado y dirección", () => {
    const src = lee("lib/productos/estadisticas.js");
    assert.ok(src.includes('ctx.hasModule("productos_avanzado")'));
    assert.ok(src.includes("ADMIN_ROLES.has(ctx.user?.role)"));
  });

  it("en el menú, Inventario, Pedidos y Tienda cuelgan de «Productos» y exigen el avanzado más su propia clave", () => {
    const src = lee("components/layout/Sidebar.jsx");
    assert.ok(/key: "productos",\s*\n\s*label: "Productos",\s*\n\s*href: "\/productos"/.test(src), "falta la entrada Productos");
    assert.ok(src.includes('requiresAll: ["productos_avanzado", "inventory"]'));
    assert.ok(src.includes('requiresAll: ["productos_avanzado", "orders"]'));
    assert.ok(src.includes('requiresAll: ["productos_avanzado", "tienda"]'));
    // Y ya no son entradas de primer nivel.
    for (const k of ["orders", "tienda", "inventory"]) {
      assert.ok(!new RegExp(`^\\s{8}key: "${k}",`, "m").test(src), `${k} sigue siendo una entrada suelta`);
    }
  });

  it("la Tienda ya no manda el precio al guardar la ficha, y remite a Productos", () => {
    const src = lee("modules/tienda/TiendaModule.jsx");
    assert.ok(!src.includes("salePrice: ficha.salePrice"), "la Tienda sigue escribiendo salePrice");
    assert.ok(!/setFicha\(\(f\) => \(\{ \.\.\.f, salePrice/.test(src), "la Tienda sigue con el precio editable");
    assert.ok(src.includes('href="/productos"'));
  });

  it("Inventario ya no da de alta ni edita productos: sin «Nuevo producto» ni panel de producto, y con enlace a Productos", () => {
    const src = lee("app/(dashboard)/inventario/page.jsx");
    assert.ok(!src.includes("Nuevo producto"), "Inventario sigue dando de alta productos");
    assert.ok(!src.includes('panel === "producto"'), "Inventario sigue con el panel de producto");
    assert.ok(src.includes('href="/productos"'));
  });

  it("la página de Productos hace notFound() sin el básico y pasa los cuatro flags al módulo", () => {
    const src = lee("app/(dashboard)/productos/page.jsx");
    assert.ok(src.includes("if (!activo) notFound();"));
    for (const p of ["avanzado", "conInventario", "conPedidos", "conTienda"]) assert.ok(src.includes(`${p}={${p}}`), p);
  });
});
