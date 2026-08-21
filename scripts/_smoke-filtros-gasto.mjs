// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-filtros-gasto.mjs — con qué filtros se pide la lista de gastos y con
 * cuáles se baja su Excel (21/08/2026).
 *
 *   node scripts/_smoke-filtros-gasto.mjs
 *   node --test-name-pattern="proveedor" scripts/_smoke-filtros-gasto.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * La pantalla de Costes armaba la consulta dos veces —una para la tabla y otra
 * para el enlace del Excel— con dos listas de filtros escritas a mano. Los dos
 * endpoints aceptan `supplierId`, `employeeId`, `partnerId` y `clientId`, y la
 * pantalla no mandaba ninguno: solo se alcanzaban montando la URL a mano. Al
 * añadir el desplegable de proveedor, si la lista lo aprende y el Excel no, el
 * botón se baja un fichero que no es lo que hay en pantalla y nadie se entera,
 * porque un filtro que el endpoint no recibe no da error: devuelve TODO.
 *
 * `paramsFiltrosGasto` es ese único sitio. Lo que se fija aquí es lo que
 * DEVUELVE: qué claves viajan, cuáles no viajan por venir vacías y que la misma
 * entrada dé la misma query para la tabla y para el Excel.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paramsFiltrosGasto, urlConFiltros, FILTROS_GASTO } from "../lib/billing/filtrosGasto.js";

const PROVEEDOR = "6f1d0a3c-1111-4b0e-9a2b-0c0d0e0f1122";
const EMPLEADO = "b2c3d4e5-2222-4f10-8a3b-1d2e3f405161";

describe("paramsFiltrosGasto — el filtro de proveedor viaja", () => {
  it("manda el proveedor elegido", () => {
    const params = paramsFiltrosGasto({ supplierId: PROVEEDOR });
    assert.equal(params.get("supplierId"), PROVEEDOR);
    assert.equal(params.toString(), `supplierId=${PROVEEDOR}`);
  });

  it("lo manda junto al resto de filtros de la pantalla", () => {
    const params = paramsFiltrosGasto({
      type: "material",
      category: "variable",
      supplierId: PROVEEDOR,
      from: "2026-01-01",
      to: "2026-03-31",
    });
    assert.deepEqual([...params.entries()], [
      ["type", "material"],
      ["category", "variable"],
      ["supplierId", PROVEEDOR],
      ["from", "2026-01-01"],
      ["to", "2026-03-31"],
    ]);
  });

  it("figura en la lista de filtros que entienden los dos endpoints", () => {
    assert.ok(FILTROS_GASTO.includes("supplierId"));
  });
});

describe("paramsFiltrosGasto — lo que no viaja", () => {
  it("un desplegable sin elegir no se manda", () => {
    const params = paramsFiltrosGasto({ type: "", category: "   ", supplierId: null, from: undefined });
    assert.equal(params.toString(), "");
  });

  it("no inventa un filtro que la pantalla no ofrece", () => {
    const params = paramsFiltrosGasto({ type: "rent" });
    assert.equal(params.has("employeeId"), false);
    assert.equal(params.has("partnerId"), false);
    assert.equal(params.has("clientId"), false);
  });

  it("ignora claves que no son filtros de gasto, vengan como vengan", () => {
    const params = paramsFiltrosGasto({ q: "folios", limit: 500, taxBase: 100 });
    assert.equal(params.toString(), "");
  });

  it("sin filtros, o con algo que no es un objeto, no devuelve nada", () => {
    assert.equal(paramsFiltrosGasto().toString(), "");
    assert.equal(paramsFiltrosGasto(null).toString(), "");
    assert.equal(paramsFiltrosGasto("type=rent").toString(), "");
  });
});

describe("paramsFiltrosGasto — la tabla y el Excel piden lo mismo", () => {
  const filtros = { category: "fixed", supplierId: PROVEEDOR, from: "2026-08-01" };

  it("el orden y el sitio no cambian la query", () => {
    const alReves = { from: "2026-08-01", supplierId: PROVEEDOR, category: "fixed" };
    assert.equal(paramsFiltrosGasto(filtros).toString(), paramsFiltrosGasto(alReves).toString());
  });

  it("la tabla añade su orden sin tocar los filtros", () => {
    const tabla = paramsFiltrosGasto(filtros, { sortBy: "total", sortDir: "desc" });
    const excel = paramsFiltrosGasto(filtros);
    assert.equal(tabla.get("sortBy"), "total");
    assert.equal(tabla.get("sortDir"), "desc");
    for (const clave of FILTROS_GASTO) {
      assert.equal(tabla.get(clave), excel.get(clave), `el filtro ${clave} discrepa entre tabla y Excel`);
    }
  });

  it("un orden a medias tampoco mete claves vacías", () => {
    const params = paramsFiltrosGasto({}, { sortBy: "", sortDir: null });
    assert.equal(params.toString(), "");
  });
});

describe("paramsFiltrosGasto — la limpieza de los valores", () => {
  it("recorta los espacios de alrededor", () => {
    assert.equal(paramsFiltrosGasto({ supplierId: ` ${PROVEEDOR} ` }).get("supplierId"), PROVEEDOR);
  });

  it("acepta los filtros que hoy solo se alcanzan a mano, si algún día tienen pantalla", () => {
    const params = paramsFiltrosGasto({ employeeId: EMPLEADO, partnerId: "socio-1", clientId: "cli-9" });
    assert.equal(params.get("employeeId"), EMPLEADO);
    assert.equal(params.get("partnerId"), "socio-1");
    assert.equal(params.get("clientId"), "cli-9");
  });
});

describe("urlConFiltros — el enlace del Excel", () => {
  it("cuelga la query de la ruta", () => {
    const url = urlConFiltros("/api/billing/exports/expenses", paramsFiltrosGasto({ supplierId: PROVEEDOR }));
    assert.equal(url, `/api/billing/exports/expenses?supplierId=${PROVEEDOR}`);
  });

  it("sin filtros no deja un interrogante suelto", () => {
    assert.equal(
      urlConFiltros("/api/billing/exports/expenses", paramsFiltrosGasto({})),
      "/api/billing/exports/expenses"
    );
  });

  it("sin parámetros ninguno devuelve la ruta tal cual", () => {
    assert.equal(urlConFiltros("/api/billing/exports/expenses"), "/api/billing/exports/expenses");
  });
});
