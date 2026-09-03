// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tablero-copiar.mjs — el botón «Copiar» del Registro (03/09/2026).
 *
 *   node scripts/_smoke-tablero-copiar.mjs
 *
 * Fija el texto que va al portapapeles (`lib/tablero/copiar.js`): el orden de
 * siempre —título, cliente, cuerpo, solución— y, cuando la tarea lleva
 * capturas, el INDICADOR que pidió Rodrigo: cuántas son, cómo se llaman y la
 * orden que las baja al repo por la ficha. Sin capturas, ni una palabra de
 * ellas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tareaComoTexto } from "../lib/tablero/copiar.js";

const tarea = (extra = {}) => ({
  id: "k7m2p9",
  titulo: "Buzón - Fallo: No se guarda la cita",
  quien: "aumenta",
  cuerpo: "**Lo que nos cuentan.** Cambio la hora y vuelve a la de antes.\n\n*Dónde*: `/citas`.",
  solucion: "",
  capturas: [],
  ...extra,
});

describe("tareaComoTexto", () => {
  it("título, cliente, cuerpo y solución, en ese orden y sin nada de capturas si no hay", () => {
    const texto = tareaComoTexto(tarea({ solucion: "  Mirar buildMadridDate.  " }));
    assert.equal(
      texto,
      [
        "Buzón - Fallo: No se guarda la cita",
        "Cliente: aumenta",
        "",
        "**Lo que nos cuentan.** Cambio la hora y vuelve a la de antes.\n\n*Dónde*: `/citas`.",
        "",
        "Solución propuesta:",
        "Mirar buildMadridDate.",
      ].join("\n")
    );
    assert.doesNotMatch(texto, /captura/i);
  });

  it("sin cliente ni cuerpo ni solución, solo el título", () => {
    assert.equal(tareaComoTexto({ titulo: "Solo título", quien: "", cuerpo: "  ", solucion: null }), "Solo título");
  });

  it("con capturas dice cuántas, cuáles y la orden que las baja por la ficha", () => {
    const texto = tareaComoTexto(
      tarea({
        capturas: [
          { id: "a", nombre: "agenda.png", bytes: 419_430 },
          { id: "b", nombre: "detalle.jpg", bytes: 0 },
        ],
      })
    );
    const cola = texto.split("\n").slice(-5);
    assert.deepEqual(cola, [
      "",
      "Esta tarea lleva 2 capturas de pantalla en el Registro. Míralas antes de tocar nada:",
      "  - agenda.png (0,4 MB)",
      "  - detalle.jpg",
      "Para bajarlas al repo: node scripts/registro.mjs capturas k7m2p9   (quedan en docs/registro/capturas/k7m2p9/)",
    ]);
  });

  it("una sola va en singular, y sin ficha manda al tablero en vez de a una orden que no puede funcionar", () => {
    const una = tareaComoTexto(tarea({ capturas: [{ id: "a", nombre: "x.png", bytes: 10 }] }));
    assert.match(una, /lleva 1 captura de pantalla en el Registro\. Mírala antes/);
    assert.match(una, /registro\.mjs capturas k7m2p9/);
    const sinFicha = tareaComoTexto(tarea({ id: null, capturas: [{ id: "a", nombre: "x.png", bytes: 10 }] }));
    assert.doesNotMatch(sinFicha, /registro\.mjs/);
    assert.match(sinFicha, /Para verlas: \/admin\/tablero/);
  });
});
