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
import { etiquetaDe, ETIQUETAS, ETIQUETAS_COORDINACION, diaDe, claveSesion } from "./_organizate-historial.js";

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

describe("la clave de idempotencia — los dos lados tienen que dar lo mismo", () => {
  // El 04/09/2026 no lo hacían: la base devuelve `session_date` como Date
  // (es timestamptz) y el volcado trae texto. Ninguna clave casaba, la tabla
  // pareció vacía y una reimportación duplicó 22.154 sesiones en producción.
  it("un Date de la base y el texto del volcado dan el MISMO día", () => {
    assert.equal(diaDe(new Date("2026-02-10T00:00:00.000Z")), "2026-02-10");
    assert.equal(diaDe("2026-02-10"), "2026-02-10");
    assert.equal(diaDe(new Date("2026-02-10T00:00:00.000Z")), diaDe("2026-02-10"));
  });

  it("y por tanto la clave entera coincide — esto es lo que se rompió", () => {
    const id = "8f2c1d3e-0000-4000-8000-000000000001";
    const texto = "Objetivo + Actividad trabajo de mesa con apoyo visual. Desempeño bien.";
    const deLaBase = claveSesion(id, new Date("2026-02-10T00:00:00.000Z"), texto);
    const delVolcado = claveSesion(id, "2026-02-10", texto);
    assert.equal(deLaBase, delVolcado);
  });

  it("distingue lo que TIENE que distinguir: paciente, día y texto", () => {
    const t = "Objetivo + Actividad lectura.";
    assert.notEqual(claveSesion("a", "2026-02-10", t), claveSesion("b", "2026-02-10", t));
    assert.notEqual(claveSesion("a", "2026-02-10", t), claveSesion("a", "2026-02-11", t));
    assert.notEqual(claveSesion("a", "2026-02-10", t), claveSesion("a", "2026-02-10", "Otra cosa distinta."));
  });

  it("dos sesiones del mismo día y niño con textos distintos NO son la misma", () => {
    // Una terapeuta puede escribir dos el mismo día; la clave usa el texto
    // original justo para eso.
    const a = claveSesion("n1", "2026-02-10", "Objetivo + Actividad primera sesión de la mañana, trabajo de lenguaje.");
    const b = claveSesion("n1", "2026-02-10", "Objetivo + Actividad segunda sesión, refuerzo de lectoescritura.");
    assert.notEqual(a, b);
  });

  it("solo mira los primeros 80 caracteres, y aguanta nulos sin romper", () => {
    const largo = "x".repeat(200);
    assert.equal(claveSesion("n1", "2026-02-10", largo), claveSesion("n1", "2026-02-10", largo + "y"));
    assert.equal(claveSesion("n1", "2026-02-10", null), "n1|2026-02-10|");
    assert.equal(diaDe(null), "");
    assert.equal(diaDe("no es una fecha"), "");
    assert.equal(diaDe(new Date("vaya")), "");
  });

  it("una fecha ISO con hora se queda en su día, sin construir un Date", () => {
    assert.equal(diaDe("2026-02-10T23:30:00.000Z"), "2026-02-10");
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
