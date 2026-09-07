// @prueba ligera — regex sobre el fuente de dos endpoints; sin base, sin servidor.
/**
 * _smoke-morosidad-y-total-cobrado.mjs — dos cuentas de dinero que mentían
 * (07/09/2026, de la revisión del código de esa noche).
 *
 *   node scripts/_smoke-morosidad-y-total-cobrado.mjs
 *
 * 1. MOROSIDAD sacaba «debe 3,17 €» a familias que habían pagado justo lo que
 *    se les generó. `planDeCuotasDelMes` prorratea el mes de alta por SESIONES
 *    cuando se le pasan las citas (AV-0062) y la generación real se las pasa;
 *    esta pantalla no, así que recalculaba por días y las dos cuentas dejaban
 *    de dar lo mismo. Lo que se vigila es que las DOS llamadas —la que genera
 *    y la que comprueba— reciban `citasPorClave`, porque el fallo fue
 *    exactamente que una se quedó atrás.
 *
 * 2. El «TOTAL COBRADO» de Cobros ignoraba el filtro de estado: `where` ya
 *    trae el `status` de la pantalla y la suma lo machacaba con el suyo. Con
 *    «Pendiente» puesto, la tabla enseñaba pendientes y la cabecera lo
 *    completado del mes entero.
 *
 * Son endpoints: hablan con la base y no se pueden llamar a trozos desde una
 * prueba ligera. Se mira el fuente, que es para lo que valen estas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const morosidad = lee("../app/api/billing/morosidad/route.js");
const generar = lee("../app/api/billing/cuotas/generar/route.js");
const cobros = lee("../app/api/billing/payments/route.js");

/** Cuántas veces se llama a `planDeCuotasDelMes` y cuántas con las citas. */
function llamadas(src) {
  const todas = src.match(/planDeCuotasDelMes\(\{[\s\S]*?\}\)/g) ?? [];
  return { total: todas.length, conCitas: todas.filter((x) => x.includes("citasPorClave")).length };
}

describe("morosidad cuenta el mes igual que la generación", () => {
  it("la morosidad pasa las citas al plan de cuotas", () => {
    const { total, conCitas } = llamadas(morosidad);
    assert.ok(total > 0, "no encuentro la llamada a planDeCuotasDelMes");
    assert.equal(conCitas, total, "alguna llamada de morosidad se quedó sin citasPorClave");
  });

  it("la generación las sigue pasando en TODAS sus llamadas", () => {
    const { total, conCitas } = llamadas(generar);
    assert.ok(total >= 2, `esperaba al menos dos llamadas, encuentro ${total}`);
    assert.equal(conCitas, total, "alguna llamada de la generación se quedó sin citasPorClave");
  });

  it("las citas se cargan de una vez, no una por familia", () => {
    assert.match(morosidad, /import \{ citasDelMesParaCuotas \} from/);
    const dentroDelBucle = morosidad.slice(morosidad.indexOf("const esperadoDelMes"));
    assert.ok(
      !dentroDelBucle.includes("await citasDelMesParaCuotas"),
      "la carga de citas no puede estar dentro de lo que se llama por familia",
    );
  });
});

describe("el «Total cobrado» de Cobros hace caso al filtro de estado", () => {
  it("si el filtro pide un estado, el total del otro es 0", () => {
    assert.match(cobros, /const estadoPedido = where\.status \?\? null;/);
    const suma = cobros.slice(cobros.indexOf("const sumar = async"), cobros.indexOf("const totales ="));
    assert.match(suma, /if \(estadoPedido && estadoPedido !== estado\) return 0;/);
    assert.ok(
      suma.indexOf("return 0") < suma.indexOf("Payment.findAll"),
      "el corte tiene que ir ANTES de consultar, o vuelve a sumar de más",
    );
  });

  it("el filtro de estado sigue llegando al where", () => {
    assert.match(cobros, /if \(searchParams\.get\("status"\)\) where\.status = searchParams\.get\("status"\);/);
  });

  it("los totales siguen siendo los del filtro entero, no los de la página", () => {
    assert.match(cobros, /fn\("SUM", col\("Payment\.amount"\)\)/);
    assert.match(cobros, /const totales = \{ cobrado: await sumar\("completed"\), pendiente: await sumar\("pending"\) \};/);
  });
});
