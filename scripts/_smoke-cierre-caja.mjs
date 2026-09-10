// @prueba ligera — regex sobre tres ficheros; sin base, sin servidor, sin .env.
/**
 * _smoke-cierre-caja.mjs — el cierre de caja lo escribe el sistema, no la
 * memoria de quien está en recepción (10/09/2026, petición de Aumenta).
 *
 *   node scripts/_smoke-cierre-caja.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, contando lo que pasaba en el centro: «en el botón de cerrar caja
 * Rosa escribe lo que quiere y lo correcto es que escriba el sistema el
 * efectivo que se ha ingresado y el que se ha retirado para hacer el cierre
 * total; eso se calcula con las entradas y salidas». Y era literal: el CRM
 * pedía primero el conteo y solo después enseñaba la cuenta, con la idea de
 * que la cifra objetivo no estuviera a la vista mientras se contaba el cajón.
 * La idea era buena y lo que ocurría era otra cosa: el número se escribía de
 * memoria y el cierre no salía de ningún sitio.
 *
 * Lo que se fija aquí, por lo que tiene que seguir habiendo en el código:
 *
 *   · que la cuenta salga SOLA al abrir el cierre (nada de un botón de
 *     «Comprobar» que la esconda) y que el conteo se abra ya escrito;
 *   · que la cuenta lleve el ARRASTRE de los días que nadie cerró: sin él, el
 *     efectivo de un martes sin cerrar desaparecía del esperado del miércoles;
 *   · que un cajón a CERO haya que confirmarlo —«la caja nunca queda a cero
 *     porque hay que mantener efectivo para hacer el cambio a los pacientes»—
 *     y que lo exija el servidor, no solo la pantalla;
 *   · y que la columna «Queda en caja» del resumen por día enseñe ese mismo
 *     saldo, que es el sentido de todo el encargo: una sola cifra por caja.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

const ruta = lee("../app/api/arqueo/cierres/route.js");
const pagina = lee("../app/(dashboard)/facturacion/arqueo/page.jsx");
const resumen = lee("../app/(dashboard)/facturacion/_components/ResumenCaja.jsx");

describe("la cuenta del cierre la hace el servidor", () => {
  it("y es la misma función que usa el resto del dinero de la caja", () => {
    assert.match(ruta, /import \{ saldoDeMovimientos, esperadoAlCerrar, fondoSugerido \}/);
    assert.match(ruta, /esperado: esperadoAlCerrar\(\{ fondo: base, arrastre/);
  });

  it("con los días que quedaron sin cerrar entre medias", () => {
    const calc = ruta.slice(ruta.indexOf("async function calcularEsperado"), ruta.indexOf("export const GET"));
    assert.match(calc, /const desde = corre\(fondo\.fecha, 1\);/);
    assert.match(calc, /const hasta = corre\(fecha, -1\);/);
    assert.match(calc, /arrastre = \{ desde, hasta, dias: cuantosDias\(desde, hasta\)/);
  });

  it("y sin arqueo anterior no se inventa desde cuándo arrastrar", () => {
    const calc = ruta.slice(ruta.indexOf("async function calcularEsperado"), ruta.indexOf("export const GET"));
    assert.match(calc, /if \(fondo && fondo\.fecha < fecha\)/);
  });

  it("lo que se guarda lo recalcula el POST, no se fía de la pantalla", () => {
    const post = ruta.slice(ruta.indexOf("export const POST"));
    assert.match(post, /await calcularEsperado\(tenantModels, body\.cashPointId, body\.closeDate, openingAmount\)/);
    assert.match(post, /const difference = \+\(countedAmount - esperado\)\.toFixed\(2\);/);
  });
});

describe("un cajón a cero se pregunta", () => {
  it("el servidor no lo deja pasar sin confirmar", () => {
    assert.match(ruta, /countedAmount === 0 && body\.cajaVaciaConfirmada !== true/);
    assert.match(ruta, /El cajón se quedaría a 0 €/);
  });

  it("y la pantalla lo pide con una casilla, no con letra pequeña", () => {
    assert.match(pagina, /const dejaLaCajaVacia = contado === 0;/);
    assert.match(pagina, /checked=\{cajaVaciaOk\}/);
    assert.match(pagina, /disabled=\{saving \|\| previo === null \|\| \(dejaLaCajaVacia && !cajaVaciaOk\)\}/);
    assert.match(pagina, /cajaVaciaConfirmada: cajaVaciaOk/);
  });
});

describe("la pantalla del cierre", () => {
  it("pide la cuenta al abrir, sin botón de por medio", () => {
    assert.ok(!/onClick=\{comprobar\}/.test(pagina), "el botón de «Comprobar» ya no existe");
    assert.match(pagina, /if \(!showCierre \|\| !cajaId \|\| !form\.closeDate\) return undefined;/);
    assert.match(pagina, /\}, \[showCierre, cajaId, form\.closeDate\]\);/);
  });

  it("abre el conteo ya escrito, y deja de escribirlo en cuanto lo tocan", () => {
    assert.match(pagina, /if \(esperado === null \|\| tocado\.current\.contado\) return;/);
    assert.match(pagina, /tocado\.current\.contado = true;/);
  });

  it("rehace la suma al vuelo cuando se corrige el fondo", () => {
    assert.match(
      pagina,
      /Number\(form\.openingAmount \|\| 0\) \+ Number\(previo\.arrastre\?\.importe \|\| 0\) \+ Number\(previo\.netoDelDia \|\| 0\)/
    );
  });

  it("y enseña de dónde sale cada euro", () => {
    assert.match(pagina, /Cobros en efectivo del día \(\{previo\.numCobros\}\)/);
    assert.match(pagina, /Entradas de caja apuntadas/);
    assert.match(pagina, /Salidas de caja apuntadas/);
    assert.match(pagina, /Días sin cerrar desde el/);
    assert.match(pagina, /Debería quedar en el cajón/);
  });
});

describe("el resumen por día enseña el mismo saldo", () => {
  it("con su columna, pegada al efectivo", () => {
    const cabecera = resumen.slice(resumen.indexOf("<thead"), resumen.indexOf("</thead>"));
    assert.match(cabecera, /Entradas y salidas/);
    assert.match(cabecera, /Queda en caja/);
    // El orden importa: el cajón se lee de izquierda a derecha, y la tarjeta y
    // el banco no pasan por él.
    assert.ok(cabecera.indexOf("Queda en caja") < cabecera.indexOf("Tarjeta"));
  });

  it("y el pie no la suma: lo que queda es el saldo del último día", () => {
    const pie = resumen.slice(resumen.indexOf("<tfoot>"), resumen.indexOf("</tfoot>"));
    assert.match(pie, /fmtMoney\(datos\.enCajaAlFinal\)/);
  });
});
