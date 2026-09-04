// @prueba ligera — funciones puras de /scripts; sin base, sin servidor, sin .env.
/**
 * _smoke-organizate-etiquetas.mjs — qué es cada entrada del historial de
 * Organízate, y sobre todo la edad de los bebés (04/09/2026, AV-0041).
 *
 *   node scripts/_smoke-organizate-etiquetas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `etiquetaDe` decide si una entrada del historial es una sesión, una cita o
 * un acta, y de eso depende que el trabajo clínico de un niño entre o no en
 * el CRM. Se ancla a la edad que va justo detrás de la etiqueta.
 *
 * El ancla era solo `añ`. A un niño de menos de dos años Organízate le escribe
 * la edad en MESES —«Sesión 23me»—, así que esas entradas no encontraban el
 * ancla, salían «(sin edad)» y el importador las saltaba en silencio: 182
 * sesiones de 29 pacientes se quedaron fuera del volcado del 02/08/2026. Se
 * vio al ir a mirar AV-0041, que iba de otra cosa.
 *
 * Esta prueba fija las dos mitades del arreglo: que la edad en meses cuenta, y
 * que ampliar el ancla NO se lleva por delante nada de lo que ya funcionaba —
 * en particular, que un «hace 3 meses» escrito en mitad del texto no se
 * adelanta al ancla de verdad y convierte una sesión en «(no reconocido)».
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etiquetaDe, ETIQUETAS, ETIQUETAS_COORDINACION } from "./_organizate-historial.js";

/** Una entrada como las de Organízate: cabecera + etiqueta + edad + texto. */
const entrada = (etiqueta, edad, texto = "Objetivo + Actividad trabajo de mesa. Desempeño bien.") =>
  `ARACELI VIGARA MÉNDEZ Jueves, 23 de Abril, 17:57 ${etiqueta} ${edad}  ${texto}`;

describe("la edad en años, como siempre", () => {
  it("reconoce las etiquetas con «añ» pegado y con «años»", () => {
    assert.equal(etiquetaDe(entrada("Sesión", "14añ")), "Sesión");
    assert.equal(etiquetaDe(entrada("Sesión", "14 años")), "Sesión");
    assert.equal(etiquetaDe(entrada("Cita", "7añ")), "Cita");
    assert.equal(etiquetaDe(entrada("Cita cancelada", "7añ")), "Cita cancelada");
    assert.equal(etiquetaDe(entrada("Coordinación", "9añ")), "Coordinación");
  });

  it("«Cita cancelada» no se lee «Cita» (la lista va de la más larga a la más corta)", () => {
    assert.equal(etiquetaDe(entrada("Cita cancelada", "5añ")), "Cita cancelada");
    assert.equal(etiquetaDe(entrada("Coordinación Interprofesional", "5añ")), "Coordinación Interprofesional");
  });

  it("sin ancla no se inventa etiqueta, y con ancla pero etiqueta rara lo dice", () => {
    assert.equal(etiquetaDe("ARACELI Jueves, 23 de Abril  texto suelto"), "(sin edad)");
    assert.equal(etiquetaDe(entrada("Merienda", "6añ")), "(no reconocido)");
    assert.equal(etiquetaDe(null), "(sin edad)");
    assert.equal(etiquetaDe(""), "(sin edad)");
  });
});

describe("la edad en MESES — lo que se perdió (AV-0041)", () => {
  it("una sesión de un bebé cuenta como sesión", () => {
    assert.equal(etiquetaDe(entrada("Sesión", "23me")), "Sesión");
    assert.equal(etiquetaDe(entrada("Sesión", "17me")), "Sesión");
    assert.equal(etiquetaDe(entrada("Sesión", "8me")), "Sesión");
    assert.equal(etiquetaDe(entrada("Sesión", "23 me")), "Sesión");
  });

  it("las demás etiquetas también valen en meses", () => {
    assert.equal(etiquetaDe(entrada("Cita", "20me")), "Cita");
    assert.equal(etiquetaDe(entrada("Valoración", "19me")), "Valoración");
    assert.equal(etiquetaDe(entrada("Reuniones con la familia", "22me")), "Reuniones con la familia");
  });
});

describe("lo que el ancla nueva NO puede romper", () => {
  it("«hace 3 meses» en mitad del texto no se adelanta al ancla de verdad", () => {
    const txt = entrada("Sesión", "14añ", "Objetivo + Actividad la familia cuenta que hace 3 meses cambió de colegio.");
    assert.equal(etiquetaDe(txt), "Sesión");
  });

  it("tampoco «6 meses» ni «meses» sueltos antes de la etiqueta", () => {
    const txt = "ARACELI Jueves, 23 de Abril, 17:57 Sesión 14añ  Lleva 6 meses en el centro. Desempeño bien.";
    assert.equal(etiquetaDe(txt), "Sesión");
    // Y si SOLO hay «meses» y ninguna edad, sigue sin ancla: no se cuela nada.
    assert.equal(etiquetaDe("ARACELI Jueves, 23 de Abril  Lleva 6 meses viniendo."), "(sin edad)");
  });

  it("una edad de tres cifras en meses también entra (los 100 meses existen)", () => {
    assert.equal(etiquetaDe(entrada("Sesión", "108me")), "Sesión");
  });
});

describe("el catálogo de etiquetas", () => {
  it("las de coordinación son un subconjunto de las conocidas", () => {
    for (const e of ETIQUETAS_COORDINACION) assert.ok(ETIQUETAS.includes(e), e);
  });

  it("están ordenadas de la más larga a la más corta dentro de cada familia", () => {
    assert.ok(ETIQUETAS.indexOf("Cita cancelada") < ETIQUETAS.indexOf("Cita"));
    assert.ok(ETIQUETAS.indexOf("Coordinación Interprofesional") < ETIQUETAS.indexOf("Coordinación"));
  });
});
