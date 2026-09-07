// @prueba ligera — regex sobre el fuente del script; sin base, sin servidor, sin .env.
/**
 * _smoke-reserva-con-categoria.mjs — la copia de Organízate crea el bloqueo YA
 * clasificado (07/09/2026).
 *
 *   node scripts/_smoke-reserva-con-categoria.mjs
 *
 * Las categorías de bloqueo son las que colorean y filtran la agenda. Hasta el
 * 07/09/2026 la copia las dejaba vacías: 295 bloqueos entraron así el 02/09 y
 * 542 el 07/09, y hubo que pasarles después `backfill-categorias-bloqueo.js`.
 * Ahora se clasifican al crearlos, con la misma función que usa el relleno.
 *
 * `actualizar-agenda-organizate.js` habla con la base y no se puede llamar a
 * trozos desde una prueba ligera, así que aquí se vigila el fuente:
 *
 *   · que el bloqueo deseado lleve `categoryKey` puesto con
 *     `categoriaPorEtiqueta`, y no a mano con un `if` suelto;
 *   · que las categorías salgan del centro (`categoriasDe`) y no de las de
 *     fábrica: cargarlas es una decisión suya;
 *   · y —lo que de verdad importa— que la clave NO entre en la firma con la que
 *     se comparan los bloqueos que ya están puestos. Si entrara, la primera
 *     pasada borraría y recrearía miles de bloqueos y se llevaría por delante
 *     las categorías que alguien eligió a mano.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/actualizar-agenda-organizate.js", import.meta.url), "utf8");

/** El trozo del fichero entre dos marcas, para poder afirmar «dentro de». */
function trozo(desde, hasta) {
  const i = src.indexOf(desde);
  assert.ok(i > 0, `no encuentro «${desde}»`);
  const j = src.indexOf(hasta, i);
  assert.ok(j > i, `no encuentro «${hasta}» después`);
  return src.slice(i, j);
}

describe("el bloqueo de la copia nace con su categoría", () => {
  it("el bloqueo deseado lleva categoryKey con categoriaPorEtiqueta", () => {
    const bucle = trozo("for (const r of volcado.reservas)", "const actuales = await m.TeamBlock.findAll");
    assert.match(bucle, /categoryKey:\s*categoriaPorEtiqueta\(label, categorias\)/);
  });

  it("las categorías son las del centro, no las de fábrica", () => {
    assert.match(src, /import \{ categoriasDe, categoriaPorEtiqueta \} from "\.\.\/lib\/citas\/categoriasBloqueo\.js";/);
    assert.match(src, /const categorias = categoriasDe\(tenant\);/);
    assert.ok(
      !/categoriaPorEtiqueta\(\s*label\s*\)/.test(src),
      "sin segundo argumento caería a las categorías de fábrica",
    );
  });

  it("la categoría NO entra en la firma con la que se comparan los bloqueos", () => {
    const bucle = trozo("for (const r of volcado.reservas)", "const actuales = await m.TeamBlock.findAll");
    const firma = bucle.match(/const k = `[^`]*`/);
    assert.ok(firma, "no encuentro la firma del bloqueo");
    assert.ok(
      !firma[0].includes("categ"),
      `la firma no puede llevar la categoría dentro: ${firma[0]}`,
    );
    // La otra mitad: la firma de los que YA están puestos tiene que ser igual.
    const comparacion = trozo("const actuales = await m.TeamBlock.findAll", "for (const [k, v] of deseados)");
    assert.ok(!comparacion.includes("categ"), "la comparación tampoco mira la categoría");
    assert.match(comparacion, /attributes: \["id", "teamMemberId", "startAt", "endAt", "label"\]/);
  });

  it("sigue habiendo ensayo en seco: sin --confirm no escribe", () => {
    assert.match(src, /const CONFIRM = args\.includes\("--confirm"\)/);
  });
});
