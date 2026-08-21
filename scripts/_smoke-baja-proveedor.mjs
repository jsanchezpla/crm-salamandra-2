// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-baja-proveedor.mjs — borrar un proveedor mira las DOS cosas que
 * cuelgan de él, no solo los gastos (21/08/2026).
 *
 *   node scripts/_smoke-baja-proveedor.mjs
 *   node --test-name-pattern="almacén" scripts/_smoke-baja-proveedor.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * `DELETE /api/proveedores/[id]` elige entre dar de baja (conservar el
 * histórico) y borrar de verdad contando los usos. Los contaba solo en Gastos:
 * un proveedor del que solo hay mercancía daba cero usos y se BORRABA. Como
 * `StockEntry.supplierId` es un UUID sin clave foránea, no saltaba ningún
 * error; las entradas se quedaban apuntando a un proveedor inexistente y el
 * almacén perdía de quién vino la mercancía. Con facturación pasaba igual en
 * cuanto ese proveedor no tuviera ni un gasto.
 *
 * Lo que se fija aquí es lo que DEVUELVE `decidirBajaProveedor`: si borra o da
 * de baja, cuántos usos ve y —lo segundo que faltaba— que el mensaje diga de
 * QUÉ son esos usos, porque con dos fuentes un número pelado ya no explica por
 * qué el proveedor sigue en la lista.
 *
 * La última parte lee el texto del endpoint: ahí el texto ES la prueba (¿sigue
 * contando el almacén y gateado por su módulo?), que es justo el `if` que
 * faltaba.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decidirBajaProveedor } from "../lib/billing/bajaProveedor.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("decidirBajaProveedor — cuándo se borra de verdad", () => {
  it("borra solo si no cuelga nada de él: es el proveedor creado por error", () => {
    const d = decidirBajaProveedor({ gastos: 0, entradas: 0 });
    assert.equal(d.borrar, true);
    assert.equal(d.usos, 0);
    assert.deepEqual(d.desglose, { gastos: 0, entradas: 0 });
  });

  it("no borra un proveedor que solo tiene entradas de almacén (el fallo)", () => {
    const d = decidirBajaProveedor({ gastos: 0, entradas: 4 });
    assert.equal(d.borrar, false);
    assert.equal(d.usos, 4);
  });

  it("tampoco lo borra cuando hay facturación pero ese proveedor no tiene gastos", () => {
    // El caso que se colaba incluso con billing encendido: 0 gastos, y el
    // almacén lleno.
    assert.equal(decidirBajaProveedor({ gastos: 0, entradas: 1 }).borrar, false);
  });

  it("no borra un proveedor que solo tiene gastos, como siempre", () => {
    const d = decidirBajaProveedor({ gastos: 3, entradas: 0 });
    assert.equal(d.borrar, false);
    assert.equal(d.usos, 3);
  });

  it("suma los usos de las dos fuentes", () => {
    assert.equal(decidirBajaProveedor({ gastos: 3, entradas: 2 }).usos, 5);
  });
});

describe("decidirBajaProveedor — un recuento sin mirar no es un recuento en cero", () => {
  it("sin Inventario no cuenta entradas y lo deja en null, no en 0", () => {
    const d = decidirBajaProveedor({ gastos: 2, entradas: null });
    assert.deepEqual(d.desglose, { gastos: 2, entradas: null });
  });

  it("al borrar, no promete haber mirado el módulo que no está", () => {
    // Sin Inventario el mensaje no puede decir «no tenía entradas de almacén»:
    // nadie las ha contado.
    assert.equal(decidirBajaProveedor({ gastos: 0 }).mensaje, "Eliminado: no tenía gastos");
    assert.equal(
      decidirBajaProveedor({ entradas: 0 }).mensaje,
      "Eliminado: no tenía entradas de almacén"
    );
    assert.equal(
      decidirBajaProveedor({ gastos: 0, entradas: 0 }).mensaje,
      "Eliminado: no tenía gastos ni entradas de almacén"
    );
  });

  it("sin recuentos (ni un módulo) no inventa nada: no cuelga nada, se borra", () => {
    const d = decidirBajaProveedor();
    assert.equal(d.borrar, true);
    assert.equal(d.mensaje, "Eliminado");
  });
});

describe("decidirBajaProveedor — el mensaje dice DE QUÉ son los usos", () => {
  it("nombra las dos fuentes cuando las dos tienen algo", () => {
    assert.equal(
      decidirBajaProveedor({ gastos: 3, entradas: 2 }).mensaje,
      "Dado de baja: tiene 3 gastos y 2 entradas de almacén asociados"
    );
  });

  it("no nombra la fuente que está a cero: no aporta nada al porqué", () => {
    assert.equal(
      decidirBajaProveedor({ gastos: 0, entradas: 4 }).mensaje,
      "Dado de baja: tiene 4 entradas de almacén asociadas"
    );
    assert.equal(
      decidirBajaProveedor({ gastos: 7, entradas: 0 }).mensaje,
      "Dado de baja: tiene 7 gastos asociados"
    );
  });

  it("concuerda en singular y en género, que es lo que lee una persona", () => {
    assert.equal(
      decidirBajaProveedor({ gastos: 1, entradas: 0 }).mensaje,
      "Dado de baja: tiene 1 gasto asociado"
    );
    assert.equal(
      decidirBajaProveedor({ gastos: 0, entradas: 1 }).mensaje,
      "Dado de baja: tiene 1 entrada de almacén asociada"
    );
    // Mezcla de géneros → masculino plural.
    assert.equal(
      decidirBajaProveedor({ gastos: 1, entradas: 1 }).mensaje,
      "Dado de baja: tiene 1 gasto y 1 entrada de almacén asociados"
    );
  });

  it("ya no queda el «gasto(s)» que salía cuando solo se miraba una fuente", () => {
    assert.ok(!decidirBajaProveedor({ gastos: 2, entradas: 2 }).mensaje.includes("(s)"));
  });
});

describe("decidirBajaProveedor — lo que llega raro no borra por accidente", () => {
  it("un recuento que no es número no cuenta como cero silencioso… salvo que lo sea", () => {
    // `count()` siempre devuelve número; esto es la red por si alguien le pasa
    // el resultado de otra cosa. Lo ilegible vale 0, pero queda escrito.
    assert.equal(decidirBajaProveedor({ gastos: "3", entradas: 0 }).usos, 3);
    assert.equal(decidirBajaProveedor({ gastos: "hola", entradas: 0 }).usos, 0);
    assert.equal(decidirBajaProveedor({ gastos: -5, entradas: 0 }).usos, 0);
  });
});

describe("El endpoint sigue contando el almacén", () => {
  const ruta = readFileSync(join(RAIZ, "app", "api", "proveedores", "[id]", "route.js"), "utf8");
  const borrado = ruta.slice(ruta.indexOf("export const DELETE"));

  it("cuenta StockEntry, gateado por su propio módulo", () => {
    assert.ok(borrado.includes("StockEntry.count"), "el DELETE dejó de contar el almacén");
    assert.ok(borrado.includes('hasModule("inventory")'), "el recuento va gateado por su módulo");
  });

  it("cuenta los gastos gateado por el suyo, como estaba", () => {
    assert.ok(borrado.includes("Cost.count"));
    assert.ok(borrado.includes('hasModule("billing")'));
  });

  it("sigue distinguiendo dar de baja de borrar en la auditoría", () => {
    assert.ok(borrado.includes('action: "suppliers.deactivated"'));
    assert.ok(borrado.includes('action: "suppliers.deleted"'));
  });
});
