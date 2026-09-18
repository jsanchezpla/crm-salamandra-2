// @prueba ligera — lee ficheros del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-export-cobros.mjs — el Excel de Cobros lleva nombre y hace caso al
 * buscador (18/09/2026, AV de Aumenta).
 *
 *   node scripts/_smoke-export-cobros.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * «revisar el excel de cobros, no tienen en cuenta los cobros filtrados y crea
 * todos y sin nombre». Las dos cosas pasaban:
 *
 *   · La hoja no tenía columna de cliente ni de paciente. En producción 216 de
 *     los 352 cobros de Aumenta no tienen factura, así que en esas filas la
 *     única columna que podía identificar a alguien decía «—».
 *   · La pantalla mandaba al Excel `method/status/from/to` pero NO `q`, la
 *     búsqueda por texto: con un nombre escrito en el buscador, la tabla
 *     enseñaba sus cobros y el Excel se bajaba todos.
 *
 * Aquí se comprueba sobre el TEXTO de los dos ficheros, porque lo que se puede
 * volver a romper es justo eso: que la pantalla añada un filtro y se olvide de
 * pasárselo al Excel, o que alguien recorte las columnas. La regla de la
 * búsqueda en sí (qué palabras casan con qué) ya la prueba
 * `_smoke-busqueda-cobros.mjs`; esto solo vigila que el Excel la use.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagina = readFileSync(join(raiz, "app/(dashboard)/facturacion/cobros/page.jsx"), "utf8");
const ruta = readFileSync(join(raiz, "app/api/billing/exports/payments/route.js"), "utf8");

/** Los filtros que la pantalla mete en la URL del Excel. */
function filtrosQueManda(texto) {
  return new Set([...texto.matchAll(/exportParams\.set\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/** Los parámetros que el endpoint del Excel lee de la URL. */
function filtrosQueLee(texto) {
  return new Set([...texto.matchAll(/searchParams\.get\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

describe("el Excel de Cobros y la pantalla filtran lo mismo", () => {
  it("la pantalla le manda la búsqueda al Excel", () => {
    assert.ok(
      filtrosQueManda(pagina).has("q"),
      "La pantalla no pone `q` en exportParams: el Excel volverá a bajarse todos los cobros",
    );
  });

  it("el Excel lee TODOS los filtros que la pantalla manda", () => {
    const lee = filtrosQueLee(ruta);
    const olvidados = [...filtrosQueManda(pagina)].filter((k) => !lee.has(k));
    assert.deepEqual(
      olvidados,
      [],
      `La pantalla manda filtros que el Excel ignora: ${olvidados.join(", ")}`,
    );
  });

  it("el Excel usa las MISMAS reglas de búsqueda que el listado", () => {
    assert.match(ruta, /whereDeBusquedaCobros/, "El Excel no usa lib/billing/busquedaCobros.js");
    assert.match(ruta, /familiasConPacienteQueCasa/, "El Excel no busca por el paciente de la familia");
  });
});

describe("el Excel de Cobros dice de quién es cada cobro", () => {
  it("tiene columna de cliente", () => {
    assert.match(ruta, /header:\s*"Cliente"/, "La hoja no lleva columna «Cliente»");
  });

  it("tiene columna de paciente donde hay pacientes", () => {
    assert.match(ruta, /header:\s*"Paciente"/, "La hoja no lleva columna «Paciente»");
    assert.match(ruta, /conPaciente\s*\?/, "La columna de paciente no está gateada por tener pacientes");
  });

  it("trae el cliente por los dos caminos: el del cobro y el de su factura", () => {
    assert.match(
      ruta,
      /p\.client\s*\?\?\s*inv\?\.client/,
      "El Excel solo mira uno de los dos caminos: los 216 cobros sin factura de Aumenta saldrían sin nombre",
    );
  });
});
