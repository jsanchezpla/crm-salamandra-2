// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-informe-marca.mjs — la paleta del PDF del informe sale de la marca del
 * cliente y NUNCA deja de salir (28/08/2026).
 *
 *   node scripts/_smoke-informe-marca.mjs
 *   node --test-name-pattern="sin marca" scripts/_smoke-informe-marca.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 *
 * El informe clínico rediseñado es un documento de color: portada a sangre con
 * fondo teñido y dos manchas, número grande al margen de cada apartado, filete
 * de acento bajo cada titular. Ocho tonos. Si se escriben en el generador, el
 * informe de CUALQUIER centro sale con los morados de Aumenta — y el generador
 * es del módulo base: lo usan las cuatro demos y quien venga detrás.
 *
 * `lib/clinica/marcaInforme.js` los deriva de `tenant.settings.brand`. Esta
 * prueba fija dos cosas:
 *
 *   1. Que la derivación es la que se dio por buena mirando la maqueta. Si
 *      alguien cambia una constante de mezcla, el informe de Aumenta cambia de
 *      color sin que nadie lo mire: aquí salta.
 *   2. Que NUNCA devuelve algo que pdfkit no sepa pintar. Esto no es paranoia:
 *      medido el 28/08/2026, las tres demos por oficio no tienen marca ninguna
 *      y Aumenta no tiene `accentColor`. Un color a null que llegue a
 *      `doc.fill()` tira el PDF, y entonces una familia se queda sin su informe
 *      por un campo vacío en una tabla de configuración.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leerHex, normalizarHex, mezclar, aclarar, paletaDeInforme } from "../lib/clinica/marcaInforme.js";

const HEX = /^#[0-9A-F]{6}$/;

/** La marca REAL de Aumenta en producción (comprobada el 28/08/2026). */
const AUMENTA = { primaryColor: "#563EA6", secondaryColor: "#15063F" };

describe("leerHex", () => {
  it("entiende el formato largo, con y sin almohadilla", () => {
    assert.deepEqual(leerHex("#563EA6"), { r: 0x56, g: 0x3e, b: 0xa6 });
    assert.deepEqual(leerHex("563EA6"), { r: 0x56, g: 0x3e, b: 0xa6 });
  });

  it("entiende el formato corto de tres cifras", () => {
    assert.deepEqual(leerHex("#F0C"), { r: 255, g: 0, b: 0xcc });
  });

  it("no distingue mayúsculas ni se atraganta con espacios", () => {
    assert.deepEqual(leerHex("  #ff0188  "), leerHex("#FF0188"));
  });

  it("devuelve null con cualquier cosa que no sea un color", () => {
    for (const malo of [null, undefined, "", "rojo", "#12345", "#GGGGGG", 42, {}, []]) {
      assert.equal(leerHex(malo), null, `debería rechazar ${JSON.stringify(malo)}`);
    }
  });

  it("rechaza los NÚMEROS, aunque sus cifras parezcan un color corto", () => {
    // 123 se leía como el atajo «#123» y entraba: lo cazó esta prueba.
    for (const n of [123, 112233, 0]) assert.equal(leerHex(n), null);
  });
});

describe("normalizarHex", () => {
  it("devuelve siempre la forma larga en mayúsculas", () => {
    assert.equal(normalizarHex("#f0c"), "#FF00CC");
    assert.equal(normalizarHex("  563ea6 "), "#563EA6");
    assert.equal(normalizarHex("#FF0188"), "#FF0188");
  });

  it("devuelve null con lo que no es un color", () => {
    assert.equal(normalizarHex("rojo"), null);
    assert.equal(normalizarHex(123), null);
  });
});

describe("mezclar", () => {
  it("con t=0 devuelve el primero y con t=1 el segundo", () => {
    assert.equal(mezclar("#000000", "#FFFFFF", 0), "#000000");
    assert.equal(mezclar("#000000", "#FFFFFF", 1), "#FFFFFF");
  });

  it("con t=0.5 cae en medio", () => {
    assert.equal(mezclar("#000000", "#FFFFFF", 0.5), "#808080");
  });

  it("recorta la t fuera de rango en vez de salirse del color", () => {
    assert.equal(mezclar("#000000", "#FFFFFF", 5), "#FFFFFF");
    assert.equal(mezclar("#000000", "#FFFFFF", -3), "#000000");
    assert.equal(mezclar("#000000", "#FFFFFF", NaN), "#000000");
  });

  it("devuelve null si alguno de los dos no es un color", () => {
    assert.equal(mezclar("rojo", "#FFFFFF", 0.5), null);
    assert.equal(mezclar("#FFFFFF", null, 0.5), null);
  });

  it("aclarar del todo es blanco, y nada es el mismo color", () => {
    assert.equal(aclarar("#563EA6", 1), "#FFFFFF");
    assert.equal(aclarar("#563EA6", 0), "#563EA6");
  });
});

describe("paletaDeInforme · la marca de Aumenta", () => {
  it("usa sus dos colores tal cual vienen", () => {
    const p = paletaDeInforme(AUMENTA);
    assert.equal(p.principal, "#563EA6");
    assert.equal(p.oscuro, "#15063F");
  });

  it("da los tintes que se dieron por buenos en la maqueta", () => {
    const p = paletaDeInforme(AUMENTA);
    assert.equal(p.tinteSuave, "#F9F8FC", "el fondo de la portada");
    assert.equal(p.tinte, "#EEECF6", "las manchas de la portada");
    assert.equal(p.tinteFuerte, "#D0C9E6", "el número grande de cada apartado");
    assert.equal(p.principalMedio, "#8F80C4", "la línea de contexto del titular");
  });

  it("sin acento propio, el acento ES el principal (un documento a un color)", () => {
    const p = paletaDeInforme(AUMENTA);
    assert.equal(p.acento, p.principal);
    assert.equal(p.calido, p.tinte, "y la mancha cálida se funde con la otra");
  });

  it("con el magenta del logo como acento, la mancha cálida se vuelve rosa", () => {
    const p = paletaDeInforme({ ...AUMENTA, accentColor: "#FF0188" });
    assert.equal(p.acento, "#FF0188");
    assert.equal(p.calido, "#FFE6F3");
    assert.notEqual(p.calido, p.tinte);
  });
});

describe("paletaDeInforme · cuando la marca no está", () => {
  // El caso REAL: demo_clinica, demo_nutricion y demo_agencia no tienen marca.
  const NADA = [null, undefined, {}, { primaryColor: null, secondaryColor: "" }];

  it("cae a una pizarra neutra en vez de reventar", () => {
    for (const b of NADA) {
      const p = paletaDeInforme(b);
      assert.equal(p.principal, "#334155", `con ${JSON.stringify(b)}`);
      assert.equal(p.oscuro, "#0F172A");
    }
  });

  it("cada color malo cae por su cuenta, sin llevarse al bueno por delante", () => {
    const p = paletaDeInforme({ primaryColor: "#563EA6", secondaryColor: "no soy un color" });
    assert.equal(p.principal, "#563EA6", "el que estaba bien se respeta");
    assert.equal(p.oscuro, "#0F172A", "y solo cae el que estaba mal");
  });

  it("un acento con basura dentro no ensucia la paleta", () => {
    const p = paletaDeInforme({ ...AUMENTA, accentColor: "javascript:alert(1)" });
    assert.equal(p.acento, p.principal);
  });
});

describe("paletaDeInforme · el contrato con pdfkit", () => {
  // Esta es la que de verdad importa: pdfkit no valida, pinta. Un null aquí
  // tira el PDF y la familia se queda sin informe.
  const RAROS = [
    null, undefined, {}, [], 0, "", "no soy un objeto",
    { primaryColor: 123, secondaryColor: {} },
    { primaryColor: "#FFF", secondaryColor: "#000", accentColor: "#F0C" },
    { primaryColor: "#FFFFFF", secondaryColor: "#FFFFFF" },
    { primaryColor: "#000000", secondaryColor: "#000000", accentColor: "#000000" },
  ];

  it("TODOS los colores son hex de seis cifras, entre cualquier basura", () => {
    for (const b of RAROS) {
      const p = paletaDeInforme(b);
      for (const [clave, valor] of Object.entries(p)) {
        assert.match(valor, HEX, `${clave} con brand=${JSON.stringify(b)}`);
      }
    }
  });

  it("siempre están las doce claves que el generador pinta", () => {
    const esperadas = [
      "tinta", "suave", "filete", "blanco", "oscuro", "principal",
      "principalMedio", "acento", "tinte", "tinteSuave", "tinteFuerte", "calido",
    ].sort();
    for (const b of RAROS) {
      assert.deepEqual(Object.keys(paletaDeInforme(b)).sort(), esperadas);
    }
  });

  it("guarda la forma canónica, no lo que venía en la base", () => {
    // La paleta se comparaba y se pintaba con el valor CRUDO: un "#F0C" o un
    // color con espacios delante llegaban tal cual a pdfkit.
    const p = paletaDeInforme({ primaryColor: " #f0c ", secondaryColor: "#ABC" });
    assert.equal(p.principal, "#FF00CC");
    assert.equal(p.oscuro, "#AABBCC");
  });

  it("no lanza nunca, pase lo que pase", () => {
    for (const b of RAROS) assert.doesNotThrow(() => paletaDeInforme(b));
  });

  it("el texto y el papel no dependen de la marca: un informe se lee", () => {
    const a = paletaDeInforme(AUMENTA);
    const b = paletaDeInforme({ primaryColor: "#FF0000", secondaryColor: "#00FF00" });
    assert.equal(a.tinta, b.tinta);
    assert.equal(a.suave, b.suave);
    assert.equal(a.blanco, "#FFFFFF");
  });
});
