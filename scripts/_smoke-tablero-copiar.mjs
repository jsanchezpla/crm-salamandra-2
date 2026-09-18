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
 *
 * Desde el 18/09/2026 fija también la línea que dice CON QUÉ se vuelve a abrir
 * la tarea (`/incidencia AV-0169`). Es lo que hace que pegarla en un chat nuevo
 * no sea un callejón sin salida, así que importa que se prefiera el `AV-####`
 * —llega al aviso Y a la tarea— y que no se escriba ninguna orden cuando no
 * hay con qué llamarla.
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
        "Para abrirla entera: /incidencia k7m2p9",
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

describe("con qué se vuelve a abrir la tarea", () => {
  const conAviso = { ref: "AV-0169", slug: "aumenta", cliente: "Aumenta" };

  it("prefiere el AV al de la ficha, y dice la ficha entre paréntesis", () => {
    // El AV llega a los dos lados —el hilo del Buzón y su tarea—; la ficha
    // sola llega solo a la tarea. Por eso manda el AV.
    const texto = tareaComoTexto(tarea({ aviso: conAviso }));
    assert.match(texto, /Para abrirla entera: \/incidencia AV-0169 {3}\(ficha k7m2p9\)/);
  });

  it("sin aviso, se abre por la ficha y sin paréntesis", () => {
    const texto = tareaComoTexto(tarea({ aviso: null }));
    assert.match(texto, /Para abrirla entera: \/incidencia k7m2p9$/m);
    assert.doesNotMatch(texto, /ficha k7m2p9\)/);
  });

  it("sin ficha pero con aviso, se abre por el AV", () => {
    const texto = tareaComoTexto(tarea({ id: null, aviso: conAviso }));
    assert.match(texto, /Para abrirla entera: \/incidencia AV-0169$/m);
  });

  it("sin ninguno de los dos no se inventa una orden que no va a funcionar", () => {
    const texto = tareaComoTexto(tarea({ id: null, aviso: null }));
    assert.doesNotMatch(texto, /incidencia/);
  });

  it("la línea va arriba, con la identidad, y no dentro del cuerpo", () => {
    const lineas = tareaComoTexto(tarea({ aviso: conAviso })).split("\n");
    assert.equal(lineas[0], "Buzón - Fallo: No se guarda la cita");
    assert.equal(lineas[1], "Cliente: aumenta");
    assert.match(lineas[2], /^Para abrirla entera:/);
  });
});
