// @prueba ligera — lee ficheros de scripts/ y funciones puras; sin base, sin servidor, sin .env.
/**
 * _smoke-migraciones-mapa.mjs — el mapa módulo → migraciones no tiene huecos
 * (03/09/2026).
 *
 *   node scripts/_smoke-migraciones-mapa.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * `node scripts/check-migration-order.js` llevaba días en rojo por dos
 * migraciones que nadie apuntó (`migrate-buzon-estados`, sin módulo ni
 * ONE_OFF; `migrate-fichaje-tipo-extra`, ilegible para el analizador y sin
 * arista). Es la CUARTA vez que pasa con una migración de master, y mientras
 * el chequeo está en rojo, la siguiente olvidada de verdad se esconde entre
 * las conocidas. El chequeo se lanza a mano; esto lo mete en `npm test`, que
 * se pasa antes de cada push, así que la próxima migración sin apuntar pone
 * la suite en rojo el mismo día.
 *
 * Prueba lo que DEVUELVEN `mapInconsistencies` y `blindSpots` —lo mismo que
 * imprime el chequeo—, no el texto del chequeo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapInconsistencies, ONE_OFF } from "./_module-migrations.js";
import { blindSpots, extractDeps, EXTRA_EDGES } from "./_migration-order.js";

test("toda migración existe como fichero y está en un módulo, en CORE o marcada como ONE_OFF", () => {
  const { sinOrden, huerfanas } = mapInconsistencies();
  assert.deepEqual(sinOrden, [], "declaradas en MODULES/CORE pero sin fichero");
  assert.deepEqual(huerfanas, [], "sin módulo asignado: nadie las ejecutaría. Añádelas a MODULES/CORE, o a ONE_OFF si son de master o de datos");
});

test("toda migración que el analizador no sabe leer está cubierta por una arista declarada o es ONE_OFF", () => {
  const ciegas = blindSpots(extractDeps());
  const sinCubrir = ciegas.filter((m) => !EXTRA_EDGES.some((e) => e.before === m || e.after === m) && !ONE_OFF[m]);
  assert.deepEqual(sinCubrir, [], "ilegibles y sin arista en EXTRA_EDGES (_migration-order.js): comprueba si dependen de otra migración");
});

test("las dos que dejaron el chequeo en rojo el 03/09/2026 siguen apuntadas", () => {
  assert.ok("migrate-buzon-estados" in ONE_OFF, "migrate-buzon-estados es de DATOS de master: va en ONE_OFF");
  assert.ok(
    EXTRA_EDGES.some((e) => e.before === "migrate-fichaje-module" && e.after === "migrate-fichaje-tipo-extra"),
    "el enum del fichaje nace con la tabla: tipo-extra va después de fichaje-module"
  );
});
