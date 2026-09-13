// @prueba ligera — funciones puras de lib/clinica y lectura del código de dos rutas;
// sin base de datos, sin servidor, sin .env.
/**
 * _smoke-informe-pruebas-ia.mjs — la IA del informe VE la tabla de puntuaciones
 * del diagnóstico (13/09/2026, T5).
 *
 *   node scripts/_smoke-informe-pruebas-ia.mjs
 *
 * Por qué existe: hasta ese día ni «Unir en informe» ni el dictado del informe
 * mandaban `contentSections.pruebas` al modelo —es clave reservada, no
 * apartado—, y la regla dura de `saberClinico.js` prohíbe citar una puntuación
 * que no conste. La integración clínica y la conclusión salían sin resultados.
 *
 * Lo que se fija:
 *
 *   1. `pruebasParaLaIA` pasa a texto SOLO lo que consta: sin columnas vacías,
 *      «ninguna» si no hay filas, sin cifras que no estuvieran en la tabla.
 *   2. `mensajeDeInforme` pone la tabla detrás del material y delante de lo ya
 *      escrito; sin tabla, el mensaje es IDÉNTICO al de antes; en la beca no
 *      viaja.
 *   3. El tope (`MAX_PRUEBAS_PARA_IA`) deja pasar un diagnóstico completo con
 *      interpretaciones largas y el máximo de `normalizarPruebas` lo supera (el
 *      413 es alcanzable).
 *   4. Un apartado NUEVO titulado «Resultados de la evaluación» se descarta
 *      cuando la tabla viaja (el PDF ya la imprime con ese título).
 *   5. Las dos rutas la leen de lo guardado, cortan con 413 ANTES de llamar a
 *      la IA y siguen con el guard de la demo (texto: ¿sigue el if donde estaba?).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pruebasParaLaIA, MAX_PRUEBAS_PARA_IA, TITULO_RESULTADOS, PLANTILLA_DIAGNOSTICO } from "../lib/clinica/pruebasDiagnosticas.js";
import {
  mensajeDeInforme,
  tablaDePruebasParaLaIA,
  bloquesOcupados,
  bloquesDelInforme,
  CABECERA_PRUEBAS_IA,
} from "../lib/clinica/informeMaterial.js";
import { apartadosPropuestos, CLAVE_NUEVOS } from "../lib/clinica/apartadosPropuestos.js";

const CI = [{ nombre: "WISC-V", area: "cognitiva", resultados: [{ escala: "CI total", pc: "50" }] }];

/** Los números COMPLETOS de un texto, como conjunto («50» no contiene un «5»). */
const numeros = (s) => new Set(String(s).match(/\d+(?:[.,]\d+)?/g) ?? []);

/* ═══ 1 · pruebasParaLaIA ═════════════════════════════════════════════════ */

describe("pruebasParaLaIA: lo que consta y nada más", () => {
  it("(a) nombre, área, escala y solo las columnas escritas", () => {
    const t = pruebasParaLaIA(CI);
    assert.ok(t.includes("### Prueba: WISC-V"), t);
    assert.ok(t.includes("Área: Capacidad cognitiva e inteligencia"), t);
    assert.ok(t.includes("CI total"), t);
    assert.ok(t.includes("percentil: 50"), t);
    assert.ok(!t.includes("puntuación directa"), "una columna en blanco no sale");
    assert.ok(!t.includes("puntuación típica"), "una columna en blanco no sale");
  });

  it("(b) una prueba sin filas lo dice, y no trae ni un número", () => {
    const t = pruebasParaLaIA([{ nombre: "Stroop" }]);
    assert.ok(t.includes("Puntuaciones anotadas: ninguna."), t);
    assert.ok(!/\d/.test(t), t);
  });

  it("(c) sin pruebas válidas, cadena vacía", () => {
    for (const bruto of [null, {}, "x", [{ nombre: "" }], [{ resultados: [{ pd: "3" }] }]]) {
      assert.equal(pruebasParaLaIA(bruto), "", JSON.stringify(bruto));
    }
  });

  it("(d) no inventa cifras: los números de la salida están en la entrada", () => {
    const entrada = [
      {
        nombre: "WISC-V",
        area: "cognitiva",
        resultados: [
          { escala: "Índice de Comprensión Verbal (ICV)", pd: "45", pt: "108", pc: "70", clasificacion: "Medio-alto" },
          { escala: "Índice de Memoria de Trabajo (IMT)", pd: "31", pt: "92", pc: "30", clasificacion: "Medio" },
        ],
        interpretacion: "Perfil homogéneo.",
      },
      {
        nombre: "ENFEN",
        area: "ejecutivas",
        resultados: [{ escala: "Fluidez fonológica", pd: "12", pt: "5", pc: "8,5" }],
      },
    ];
    const salida = numeros(pruebasParaLaIA(entrada));
    const permitidos = numeros(JSON.stringify(entrada));
    assert.ok(salida.size > 0);
    for (const n of salida) assert.ok(permitidos.has(n), `la salida trae «${n}», que no estaba en la tabla`);
  });

  it("(e) respeta el orden, dice «sin puntuación anotada» y nombra «Otras pruebas»", () => {
    const t = pruebasParaLaIA([
      { nombre: "Primera", area: "otras", resultados: [{ escala: "Solo escala" }, { escala: "Segunda fila", pd: "7" }] },
      { nombre: "Segunda", area: "memoria" },
    ]);
    assert.ok(t.indexOf("### Prueba: Primera") < t.indexOf("### Prueba: Segunda"));
    assert.ok(t.indexOf("Solo escala") < t.indexOf("Segunda fila"));
    assert.ok(t.includes("- Solo escala — sin puntuación anotada"), t);
    assert.ok(t.includes("- Segunda fila — puntuación directa: 7"), t);
    assert.ok(t.includes("Área: Otras pruebas"), t);
    assert.ok(t.includes("Área: Memoria"), t);
  });

  it("(f) «Qué evalúa» e «Interpretación» solo si hay texto", () => {
    const sin = pruebasParaLaIA(CI);
    assert.ok(!sin.includes("Qué evalúa:"));
    assert.ok(!sin.includes("Interpretación escrita por la profesional:"));
    const con = pruebasParaLaIA([{ ...CI[0], descripcion: "Inteligencia.", interpretacion: "Dentro de la media." }]);
    assert.ok(con.includes("Qué evalúa: Inteligencia."), con);
    assert.ok(con.includes("Interpretación escrita por la profesional: Dentro de la media."), con);
  });
});

/* ═══ 2 · El mensaje ══════════════════════════════════════════════════════ */

describe("el mensaje que va al modelo", () => {
  it("(g) la tabla va detrás del material y delante de lo ya escrito, con sus reglas", () => {
    const m = mensajeDeInforme({ transcription: "Material.", bloques: bloquesDelInforme([]), pruebas: CI, tipo: "diagnostico" });
    for (const trozo of [CABECERA_PRUEBAS_IA, "WISC-V", "CI total", "percentil: 50", "consta como ADMINISTRADA", "«Resultados de la evaluación»"]) {
      assert.ok(m.includes(trozo), `falta «${trozo}»`);
    }
    assert.ok(m.indexOf(CABECERA_PRUEBAS_IA) > m.indexOf("Material."));

    const conEscrito = mensajeDeInforme({
      transcription: "Material.",
      escrito: { motivo_consulta: "algo" },
      bloques: bloquesDelInforme(PLANTILLA_DIAGNOSTICO.apartados),
      pruebas: CI,
      tipo: "diagnostico",
    });
    assert.ok(conEscrito.includes("YA HABÍA ESCRITO A MANO"));
    assert.ok(conEscrito.indexOf(CABECERA_PRUEBAS_IA) < conEscrito.indexOf("YA HABÍA ESCRITO A MANO"));
  });

  it("(h) sin tabla, el mensaje es EXACTAMENTE el de antes", () => {
    const base = { transcription: "Le doy el alta.", escrito: { motiveOfIntervention: "Lectura." }, bloques: bloquesDelInforme([]) };
    const viejo = mensajeDeInforme(base);
    // El texto de antes, fijado a mano (sacado del código de HEAD, 13/09/2026):
    // comparar la función consigo misma no vería un cambio que tocara a todos
    // los mensajes, ni el de la clave de `cacheDeRespuestas`.
    assert.equal(
      viejo,
      "LO QUE HA DICTADO O APUNTADO LA PROFESIONAL:\n\nLe doy el alta.\n\nLO QUE LA PROFESIONAL YA HABÍA ESCRITO A MANO (contexto, NO lo copies ni lo devuelvas):\n- Motivo de intervención: Lectura.\n\nTu propuesta sale del material de arriba. Úsalo solo para no contradecirla ni repetir lo que ya dijo con otras palabras.",
    );
    for (const pruebas of [undefined, [], null]) {
      const nuevo = mensajeDeInforme({ ...base, pruebas, tipo: "diagnostico" });
      assert.equal(nuevo, viejo);
      assert.ok(!nuevo.includes(CABECERA_PRUEBAS_IA));
    }
  });

  it("(i) en la beca la tabla no viaja", () => {
    assert.equal(tablaDePruebasParaLaIA({ pruebas: CI, tipo: "beca" }), "");
    const m = mensajeDeInforme({ transcription: "Material.", bloques: bloquesDelInforme([]), pruebas: CI, tipo: "beca" });
    assert.ok(!m.includes(CABECERA_PRUEBAS_IA));
  });
});

/* ═══ 3 · Tamaño ══════════════════════════════════════════════════════════ */

describe("tamaño", () => {
  it("(j) un diagnóstico completo con interpretaciones largas cabe bajo el tope", () => {
    const fila = { escala: "Índice de Comprensión Verbal (ICV)", pd: "45", pt: "108", pc: "70", clasificacion: "Medio-alto" };
    const pruebas = Array.from({ length: 12 }, (_, i) => ({
      nombre: `Prueba ${i + 1}`,
      area: "cognitiva",
      descripcion: "d".repeat(300),
      resultados: Array.from({ length: 26 }, () => ({ ...fila })),
      interpretacion: "i".repeat(5000),
    }));
    const largo = pruebasParaLaIA(pruebas).length;
    assert.ok(largo > 90_000, `el fixture tiene que ser realista (${largo})`);
    assert.ok(largo <= MAX_PRUEBAS_PARA_IA, `${largo} > ${MAX_PRUEBAS_PARA_IA}: un diagnóstico completo daría 413`);
  });

  it("(k) el máximo que deja normalizarPruebas pasa del tope: el 413 es alcanzable", () => {
    const celda = "x".repeat(80);
    const pruebas = Array.from({ length: 40 }, (_, i) => ({
      nombre: `${i}`.padEnd(120, "n"),
      area: "cognitiva",
      descripcion: "d".repeat(5000),
      resultados: Array.from({ length: 40 }, () => ({ escala: celda, pd: celda, pt: celda, pc: celda, clasificacion: celda })),
      interpretacion: "i".repeat(5000),
    }));
    assert.ok(pruebasParaLaIA(pruebas).length > MAX_PRUEBAS_PARA_IA);
  });
});

/* ═══ 4 · Apartados nuevos ════════════════════════════════════════════════ */

describe("un apartado nuevo no duplica la tabla", () => {
  const propuesta = { [CLAVE_NUEVOS]: [{ titulo: TITULO_RESULTADOS, tipo: "párrafo", contenido: "CI total 50" }] };

  it("(l) con tabla, «Resultados de la evaluación» nuevo se descarta", () => {
    const ocupados = bloquesOcupados(bloquesDelInforme([]), { pruebas: CI, tipo: "diagnostico" });
    assert.deepEqual(apartadosPropuestos(propuesta, ocupados), []);
  });

  it("(m) sin tabla (o en la beca), los bloques no cambian y el apartado entra", () => {
    const b = bloquesDelInforme([]);
    for (const opciones of [{}, { pruebas: CI, tipo: "beca" }]) {
      const ocupados = bloquesOcupados(b, opciones);
      assert.deepEqual(ocupados.map((x) => x.key), b.map((x) => x.key));
      assert.equal(apartadosPropuestos(propuesta, ocupados).length, 1);
    }
  });
});

/* ═══ 5 · Las rutas ═══════════════════════════════════════════════════════ */

describe("las rutas (texto: ¿sigue el if donde estaba?)", () => {
  const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");

  for (const ruta of ["../app/api/clinica/diagnosticos/[id]/unir/route.js", "../app/api/clinica/reports/[id]/desde-material/route.js"]) {
    it(`(n) ${ruta.replace("../app/api/", "")}: tabla guardada, 413 antes de pagar, guard de demo`, () => {
      const src = leer(ruta);
      // En la LLAMADA a structureInforme, no en la de tablaDePruebasParaLaIA
      // (que también lleva `pruebas: cs[CLAVE_PRUEBAS]`): lo que se arregla es
      // que la IA vea la tabla.
      assert.match(src, /await structureInforme\(\{[^}]*\bpruebas: cs\[CLAVE_PRUEBAS\]/, "la tabla tiene que ir en la llamada a structureInforme");
      assert.match(src, /tablaDePruebas\.length > MAX_PRUEBAS_PARA_IA/);
      assert.match(src, /tipo: informe\.reportType \}/);
      assert.match(src, /assertNotDemoPaidCall\(ctx/);
      // Se compara con el USO del tope, no con el nombre suelto de la constante:
      // ese aparece en el import y el orden saldría bien siempre.
      const i413 = src.indexOf("tablaDePruebas.length > MAX_PRUEBAS_PARA_IA");
      const iLlamada = src.indexOf("await structureInforme(");
      assert.ok(i413 >= 0 && iLlamada >= 0 && i413 < iLlamada, "el 413 de la tabla tiene que ir antes de llamar a la IA");
    });
  }

  it("(o) structureInforme manda la tabla y la cuenta al descartar apartados nuevos", () => {
    const src = leer("../lib/clinica/structureInforme.js");
    assert.match(src, /mensajeDeInforme\(\{[^}]*\bpruebas\b[^}]*\btipo\b[^}]*\}\)/);
    assert.match(src, /apartadosPropuestos\(objeto, bloquesOcupados\(bloques,/);
  });
});
