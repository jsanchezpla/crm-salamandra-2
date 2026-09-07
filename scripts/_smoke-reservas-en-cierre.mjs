// @prueba ligera — regex sobre el fuente del script; sin base, sin servidor, sin .env.
/**
 * _smoke-reservas-en-cierre.mjs — la copia de Organízate no pone armazón en los
 * días que el centro CIERRA (07/09/2026).
 *
 *   node scripts/_smoke-reservas-en-cierre.mjs
 *
 * `actualizar-agenda-organizate.js` es una herramienta de línea de órdenes que
 * habla con la base: no se puede llamar a trozos desde una prueba ligera. Lo
 * que se vigila aquí es que el `if` siga donde tiene que estar, que es
 * exactamente para lo que valen las pruebas sobre el fuente:
 *
 *   · que las reservas se salten los días de `blocked_days` (si no, cada pasada
 *     vuelve a poner «DESCANSO» en Nochebuena: eran 727 bloqueos en 16 días);
 *   · que el salto vaya DENTRO del bucle de reservas y DESPUÉS del corte por
 *     `--desde`, para no tocar nada anterior a la fecha pedida;
 *   · que los festivos se sigan cargando de `blocked_days` y que las citas
 *     sigan usándolos (no se ha roto lo que ya funcionaba);
 *   · y que el informe diga cuántas se han saltado, porque un filtro que no se
 *     cuenta es un filtro que nadie revisa.
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

describe("los días de cierre no llevan armazón", () => {
  it("las reservas se saltan los días de blocked_days", () => {
    const bucle = trozo("for (const r of volcado.reservas)", "const actuales = await m.TeamBlock.findAll");
    assert.match(bucle, /festivos\.has\(r\.fecha\)/, "el bucle de reservas no mira los festivos");
    assert.match(bucle, /bloquesEnCierre\+\+/, "no se cuentan las saltadas");
  });

  it("el salto va después del corte por --desde: nada anterior se toca", () => {
    const bucle = trozo("for (const r of volcado.reservas)", "const actuales = await m.TeamBlock.findAll");
    assert.ok(
      bucle.indexOf("r.fecha < DESDE") < bucle.indexOf("festivos.has(r.fecha)"),
      "el filtro de festivos tiene que ir DESPUÉS del corte por fecha",
    );
  });

  it("los festivos se siguen cargando de blocked_days", () => {
    assert.match(src, /m\.BlockedDay\.findAll\(\{ attributes: \["date"\] \}\)/);
    assert.match(src, /festivos = new Set\(/);
  });

  it("las citas siguen respetando los festivos (no se ha roto lo de antes)", () => {
    assert.match(src, /festivos\.has\(c\.fecha\)/, "las citas ya no miran los festivos");
    assert.match(src, /MOTIVO_FESTIVO/);
  });

  it("el informe dice cuántas reservas se han saltado", () => {
    assert.match(src, /Reservas saltadas por caer en día de cierre/);
  });

  it("sigue habiendo ensayo en seco: sin --confirm no escribe", () => {
    assert.match(src, /const CONFIRM = args\.includes\("--confirm"\)/);
  });
});
