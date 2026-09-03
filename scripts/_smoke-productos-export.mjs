// @prueba ligera — funciones de /lib sobre datos fijos; sin base, sin servidor, sin .env.
/**
 * _smoke-productos-export.mjs — el Excel y el PDF del bloque «Ventas» de
 * Productos avanzado cuentan lo mismo que la pantalla (03/09/2026).
 *
 *   node scripts/_smoke-productos-export.mjs
 *
 * Se construyen los dos ficheros a partir del MISMO objeto que devuelve
 * `agregarVentas` y se lee el Excel de vuelta con ExcelJS: lo que importa es
 * que las cifras que salen son las que entraron, no cómo está escrito el
 * generador. Del PDF se comprueba que es un PDF de verdad con las fuentes
 * cargadas (si `registerPoppins` fallara, no habría fichero).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { agregarVentas } from "../lib/productos/ventas.js";
import { buildVentasXlsx, buildVentasPdf, nombreDeFichero } from "../lib/productos/ventasExport.js";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function pedido(id, status, lines, extra = {}) {
  const total = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  return { id, status, total: total.toFixed(2), origin: "manual", createdAt: new Date(2026, 8, 3, 10, 0), lines, ...extra };
}
const linea = (productId, productName, quantity, unitPrice) => ({
  productId, productName, quantity, unitPrice, lineTotal: (quantity * unitPrice).toFixed(2),
});

const DATOS = {
  disponible: true,
  periodo: { desde: "2026-08-01", hasta: "2026-09-03" },
  ...agregarVentas(
    [
      pedido("o1", "completed", [linea(P1, "Camiseta", 2, 20), linea(P2, "Taza", 1, 12)]),
      pedido("o2", "confirmed", [linea(P1, "Camiseta", 1, 20)], { origin: "tienda", createdAt: new Date(2026, 7, 28, 9, 0) }),
      pedido("o3", "draft", [linea(P2, "Taza", 5, 12)], { origin: "tienda" }),
      pedido("o4", "shipped", [linea(null, "Envío urgente", 1, 6)]),
    ],
    { activos: [{ id: P1, name: "Camiseta" }, { id: P2, name: "Taza" }], costes: { [P1]: 8, [P2]: 5 }, fuenteCoste: "entradas" }
  ),
};

async function leerHojas(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const hojas = {};
  libro.eachSheet((h) => {
    const filas = [];
    h.eachRow((fila) => filas.push(fila.values.slice(1)));
    hojas[h.name] = filas;
  });
  return hojas;
}

describe("el Excel de ventas", () => {
  it("lleva las cuatro hojas y el resumen dice lo mismo que el cálculo, en números", async () => {
    const hojas = await leerHojas(await buildVentasXlsx(DATOS, { tenantName: "Centro de prueba" }));
    assert.deepEqual(Object.keys(hojas), ["Resumen", "Por producto", "Por mes", "Por origen"]);

    const resumen = Object.fromEntries(hojas.Resumen.slice(1).map(([, dato, valor]) => [dato, valor]));
    assert.equal(resumen["Importe vendido (€)"], 78);
    assert.equal(resumen["Pedidos"], 3);
    assert.equal(resumen["Unidades"], 5);
    assert.equal(resumen["Ticket medio (€)"], 26);
    assert.equal(resumen["Borradores (carritos sin pagar)"], 1);
    // Margen: Camiseta (60 − 24) + Taza (12 − 5) = 43, sobre 72 con coste.
    assert.equal(resumen["Margen (€)"], 43);
    assert.equal(resumen["Margen (%)"], 59.72);
    assert.equal(resumen["Sobre importe con coste (€)"], 72);
    assert.equal(resumen["Productos sin coste conocido"], 1);
    assert.match(String(resumen["Coste usado"]), /entradas de Inventario/);
  });

  it("«Por producto» es el ranking entero, con coste y margen, y «—» donde no se sabe", async () => {
    const hojas = await leerHojas(await buildVentasXlsx(DATOS));
    assert.deepEqual(hojas["Por producto"][0], ["Producto", "Unidades", "Pedidos", "Vendido (€)", "Coste unitario (€)", "Margen (€)"]);
    assert.deepEqual(hojas["Por producto"].slice(1), [
      ["Camiseta", 3, 2, 60, 8, 36],
      ["Taza", 1, 1, 12, 5, 7],
      ["Envío urgente", 1, 1, 6, "—", "—"],
    ]);
  });

  it("«Por mes» y «Por origen» van con sus etiquetas y sus cifras", async () => {
    const hojas = await leerHojas(await buildVentasXlsx(DATOS));
    assert.deepEqual(hojas["Por mes"].slice(1), [
      ["2026-08", 1, 1, 20],
      ["2026-09", 2, 4, 58],
    ]);
    assert.deepEqual(hojas["Por origen"].slice(1), [
      ["Mostrador", 2, 58],
      ["Tienda online", 1, 20],
    ]);
  });

  it("con tallas u opciones vendidas aparece «Por variante»; sin ellas, no", async () => {
    const V_M = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const conTallas = {
      disponible: true,
      periodo: DATOS.periodo,
      ...agregarVentas([
        pedido("t1", "completed", [
          { ...linea(P1, "Camiseta", 2, 20), variantId: V_M, variantName: "Talla M" },
          { ...linea(P1, "Camiseta", 1, 20), variantId: null, variantName: "Talla L" },
          linea(P2, "Taza", 1, 12),
        ]),
      ]),
    };
    const hojas = await leerHojas(await buildVentasXlsx(conTallas));
    assert.deepEqual(Object.keys(hojas), ["Resumen", "Por producto", "Por variante", "Por mes", "Por origen"]);
    assert.deepEqual(hojas["Por variante"].slice(1), [
      ["Camiseta", "Talla M", 2, 40],
      ["Camiseta", "Talla L", 1, 20],
    ]);
    assert.equal((await buildVentasPdf(conTallas)).subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("sin ventas, solo el resumen (nada de hojas vacías) y el margen en «—»", async () => {
    const vacio = { disponible: true, periodo: DATOS.periodo, ...agregarVentas([], { activos: [] }) };
    const hojas = await leerHojas(await buildVentasXlsx(vacio));
    assert.deepEqual(Object.keys(hojas), ["Resumen"]);
    const resumen = Object.fromEntries(hojas.Resumen.slice(1).map(([, dato, valor]) => [dato, valor]));
    assert.equal(resumen["Margen (€)"], "—");
    assert.equal(resumen["Margen (%)"], "—");
  });
});

describe("el PDF de ventas", () => {
  it("es un PDF con contenido, con y sin ventas", async () => {
    const pdf = await buildVentasPdf(DATOS, { tenantName: "Centro de prueba", brand: { primaryColor: "#123456" } });
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(pdf.length > 2000, "un PDF con tablas ocupa más que la cabecera");

    const vacio = { disponible: true, periodo: DATOS.periodo, ...agregarVentas([], { activos: [] }) };
    const pdf2 = await buildVentasPdf(vacio);
    assert.equal(pdf2.subarray(0, 5).toString("latin1"), "%PDF-");
  });
});

describe("el nombre del fichero", () => {
  it("lleva el periodo, que es lo que se busca luego en Descargas", () => {
    assert.equal(nombreDeFichero(DATOS), "Ventas 2026-08-01 a 2026-09-03");
  });
});
