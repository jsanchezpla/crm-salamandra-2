// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fichaje-parsers.mjs — los dos lectores del Excel del reloj de fichar
 * saben de quién es cada fila, a qué día va y de dónde salen los minutos
 * (19/08/2026).
 *
 *   node scripts/_smoke-fichaje-parsers.mjs
 *   node --test-name-pattern="diasDeLaHoja" scripts/_smoke-fichaje-parsers.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El módulo Fichaje es universal por dentro; el LECTOR es de cada cliente
 * (`lib/fichaje/parsers/`). Hoy hay dos: el de Aumenta, que lee el fichero
 * real de su reloj —un libro por mes, una hoja por semana («02-6», «9-13»…),
 * bloques por persona con L/M/X/J/V, entrada y salida previstas y reales— y
 * el genérico, el de la plantilla descargable (Persona · Fecha · Entrada ·
 * Salida · Horas · Nota), que usa cualquier cliente sin lector propio.
 * `_smoke-fichaje-horas.mjs` ya fija cómo se lee UNA celda; esta fija cómo se
 * lee el FICHERO: de qué persona es cada fila, a qué fecha va, de dónde salen
 * los minutos y qué se avisa. Un lector que se equivoca de persona o de día es
 * una nómina mal pagada, y se equivoca en silencio.
 *
 * Las reglas están escritas en los comentarios de los dos lectores y cada una
 * es aquí un `it`:
 *
 *   · Aumenta: la columna de nombres también lleva anotaciones («BAJA»,
 *     «MÉDICO», «JUSTIFICANTE DE MÉDICO») y una con día L justo debajo de un
 *     nombre solo es una anotación sobre su lunes, no una persona que se lleva
 *     las horas de Victoria; los bloques no son de tamaño fijo (se recorre de
 *     nombre a nombre); las fórmulas del Excel no sirven para pagar (los
 *     minutos se recalculan de las horas reales y el total del Excel solo se
 *     usa cuando no hay horas, y se dice de dónde salió); el nombre de la hoja
 *     no sabe el mes, el periodo lo pone quien importa y se comprueba que el
 *     primer día caiga en lunes; «M-1» y «M-2» son dos tramos del mismo día.
 *   · Genérico: la cabecera se busca por NOMBRE en las diez primeras filas, no
 *     por posición; una fila de otro mes se rechaza; dos filas del mismo día
 *     son dos tramos; el que leía `value` en vez de `date` no importaba ni
 *     una jornada (pasó).
 *
 * Las hojas se fabrican aquí a mano con la forma mínima que leen los lectores
 * (`worksheets`, `name`, `rowCount`, `columnCount`,
 * `getRow(r).getCell(c).value`): no hace falta ExcelJS para probar la lógica,
 * y así la prueba no abre ningún fichero ni depende de la zona horaria (todas
 * las fechas van en UTC, como las entrega ExcelJS).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parse as parseAumenta,
  diasDeLaHoja,
  meta as metaAumenta,
} from "../lib/fichaje/parsers/aumenta.js";
import {
  parse as parseGenerico,
  localizarColumnas,
  meta as metaGenerico,
} from "../lib/fichaje/parsers/generico.js";

// ── Un libro de ExcelJS de mentira, con lo justo que miran los lectores ─────

/**
 * Una hoja: nombre y matriz de celdas. `filas[0]` es la fila 1 del Excel y
 * `filas[0][0]` la columna A, como lo numera ExcelJS (1-indexado).
 */
function hoja(nombre, filas) {
  return {
    name: nombre,
    rowCount: filas.length,
    columnCount: filas.reduce((m, f) => Math.max(m, f.length), 0),
    getRow(r) {
      const fila = filas[r - 1] ?? [];
      return { getCell: (c) => ({ value: fila[c - 1] ?? null }) };
    },
  };
}

const libro = (...hojas) => ({ worksheets: hojas });

/** La hora «HH:MM» tal como ExcelJS la entrega: un Date con época 1899-12-30, en UTC. */
const horaExcel = (h, m = 0) => new Date(Date.UTC(1899, 11, 30, h, m));
/** Un día del calendario como lo entrega ExcelJS: medianoche UTC. */
const diaExcel = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
/** Una celda con fórmula: el valor es un objeto con `result`. */
const formula = (result) => ({ formula: "=G5-D5", result });

// ── El fichero de Aumenta ───────────────────────────────────────────────────

/** Marzo de 2026: el día 2 cae en lunes, como en el fichero real («02-6», «9-13»…). */
const MARZO = "2026-03";

/** La fila 1 del fichero real: rótulos que el lector no lee. */
const CABECERA_AUMENTA = [
  "NOMBRE",
  "DÍA",
  "ENTRADA",
  "ENTRADA REAL",
  null,
  "SALIDA",
  "SALIDA REAL",
  null,
  "HORAS",
  "HORAS REALES",
];

/**
 * Una fila del Excel de Aumenta por el nombre de cada columna: C1 nombre, C2
 * día, C3 entrada prevista, C4 entrada real, C6 salida prevista, C7 salida
 * real, C9 horas previstas (fórmula), C10 horas fichadas (fórmula). Las
 * columnas 5, 8 y 11 el lector no las mira.
 */
function filaAumenta({
  nombre = null,
  dia = null,
  entradaPrev = null,
  entrada = null,
  salidaPrev = null,
  salida = null,
  horasPrev = null,
  horasFich = null,
} = {}) {
  return [nombre, dia, entradaPrev, entrada, null, salidaPrev, salida, null, horasPrev, horasFich];
}

/** Una hoja semanal de Aumenta: la cabecera en la fila 1 y lo demás debajo. */
const semana = (nombre, filas) => hoja(nombre, [CABECERA_AUMENTA, ...filas]);

/** El bloque de una persona con el nombre en la fila del lunes: [[día, entrada, salida], …]. */
function bloque(nombre, dias) {
  return dias.map(([dia, entrada, salida], i) =>
    filaAumenta({ nombre: i === 0 ? nombre : null, dia, entrada, salida })
  );
}

const SEMANA_ENTERA = [
  ["L", "08:30", "17:00"],
  ["M", "08:30", "17:00"],
  ["X", "08:30", "17:00"],
  ["J", "08:30", "17:00"],
  ["V", "08:30", "15:00"],
];

const NI_UNA_JORNADA = {
  nivel: "error",
  texto: "No se ha encontrado ni una jornada en el fichero.",
};
const PERIODO_INVALIDO = {
  filas: [],
  anotaciones: [],
  avisos: [{ nivel: "error", texto: "Periodo inválido (se espera YYYY-MM)" }],
  nombres: [],
};

/** Lo que importa de cada fila para leer un listado de un vistazo. */
const resumen = (filas) => filas.map((f) => [f.nombreExcel, f.fecha, f.diaLetra, f.minutos]);

// ═══════════════════════════════════════════════════════════════════════════
// parsers/aumenta.js
// ═══════════════════════════════════════════════════════════════════════════

describe("meta: cada lector dice quién es", () => {
  it("aumenta y generico llevan clave, nombre y descripción", () => {
    assert.equal(metaAumenta.key, "aumenta");
    assert.equal(metaGenerico.key, "generico");
    for (const m of [metaAumenta, metaGenerico]) {
      assert.equal(typeof m.nombre, "string");
      assert.equal(typeof m.descripcion, "string");
    }
  });
});

describe("diasDeLaHoja: qué días cubre una hoja, sacado de su nombre", () => {
  it("las cuatro hojas del fichero real: «02-6», «9-13», «16-20», «23-27 PENDIENTE»", () => {
    assert.deepEqual(diasDeLaHoja("02-6"), { desde: 2, hasta: 6 });
    assert.deepEqual(diasDeLaHoja("9-13"), { desde: 9, hasta: 13 });
    assert.deepEqual(diasDeLaHoja("16-20"), { desde: 16, hasta: 20 });
    assert.deepEqual(diasDeLaHoja("23-27 PENDIENTE"), { desde: 23, hasta: 27 });
  });
  it("texto delante o detrás no molesta: «Semana 2-6», «2-6 (revisar)»", () => {
    assert.deepEqual(diasDeLaHoja("Semana 2-6"), { desde: 2, hasta: 6 });
    assert.deepEqual(diasDeLaHoja("2-6 (revisar)"), { desde: 2, hasta: 6 });
  });
  it("admite guion corto, largo, raya y la «a», con o sin espacios: «2–6», «2 — 6», «2 a 6», «2 A 6»", () => {
    for (const n of ["2–6", "2 — 6", "2 a 6", "2 A 6", "2 - 6"]) {
      assert.deepEqual(diasDeLaHoja(n), { desde: 2, hasta: 6 }, n);
    }
  });
  it("un solo día («2-2») y el mes entero («1-31») valen", () => {
    assert.deepEqual(diasDeLaHoja("2-2"), { desde: 2, hasta: 2 });
    assert.deepEqual(diasDeLaHoja("1-31"), { desde: 1, hasta: 31 });
  });
  it("sin rango reconocible, null: «Hoja1», «Marzo», «», null, undefined", () => {
    for (const n of ["Hoja1", "Marzo", "", null, undefined]) {
      assert.equal(diasDeLaHoja(n), null, String(n));
    }
  });
  it("fuera de 1..31 o al revés, null: «0-5», «30-32», «13-9»", () => {
    assert.equal(diasDeLaHoja("0-5"), null);
    assert.equal(diasDeLaHoja("30-32"), null);
    assert.equal(diasDeLaHoja("13-9"), null);
  });
  it("«2026-03» no es un rango de días (lo que casa, «26-03», va al revés): null", () => {
    assert.equal(diasDeLaHoja("2026-03"), null);
  });
});

describe("parse (Aumenta): el periodo lo pone quien importa, y las hojas se leen por su nombre", () => {
  it("un periodo que no es AAAA-MM devuelve el error y nada más, sin mirar el libro", async () => {
    const wb = libro(semana("02-6", bloque("ARACELI", SEMANA_ENTERA)));
    for (const periodo of ["", null, undefined, "2026-3", "03/2026", "2026-03-01", 202603]) {
      assert.deepEqual(await parseAumenta(wb, { periodo }), PERIODO_INVALIDO, String(periodo));
    }
  });
  it("un libro sin hojas: solo el error «ni una jornada»", async () => {
    assert.deepEqual(await parseAumenta(libro(), { periodo: MARZO }), {
      filas: [],
      anotaciones: [],
      avisos: [NI_UNA_JORNADA],
      nombres: [],
    });
  });
  it("una hoja cuyo nombre no dice qué días cubre se salta CON aviso de error, y las demás se leen", async () => {
    const wb = libro(
      hoja("Resumen", [CABECERA_AUMENTA, ...bloque("ARACELI", SEMANA_ENTERA)]),
      semana("02-6", bloque("BEA", SEMANA_ENTERA))
    );
    const r = await parseAumenta(wb, { periodo: MARZO });
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "error");
    assert.match(r.avisos[0].texto, /«Resumen»/);
    assert.match(r.avisos[0].texto, /No se ha leído/);
    assert.deepEqual(r.nombres, ["BEA"]);
    assert.equal(r.filas.length, 5);
    assert.ok(r.filas.every((f) => f.hoja === "02-6"));
  });
  it("una hoja que empieza más allá del último día del mes («30-31» en febrero) se salta con error", async () => {
    const wb = libro(semana("30-31", bloque("ARACELI", SEMANA_ENTERA)));
    const r = await parseAumenta(wb, { periodo: "2026-02" });
    assert.deepEqual(r.filas, []);
    const [hojaFuera, niUna] = r.avisos;
    assert.equal(hojaFuera.nivel, "error");
    assert.match(hojaFuera.texto, /«30-31» empieza el día 30/);
    assert.match(hojaFuera.texto, /2026-02 solo tiene 28 días/);
    assert.deepEqual(niUna, NI_UNA_JORNADA);
  });
  it("«02-6» de marzo de 2026 empieza en lunes: sin aviso, y L..V son del 02 al 06", async () => {
    const r = await parseAumenta(libro(semana("02-6", bloque("ARACELI", SEMANA_ENTERA))), {
      periodo: MARZO,
    });
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(
      r.filas.map((f) => [f.diaLetra, f.fecha]),
      [
        ["L", "2026-03-02"],
        ["M", "2026-03-03"],
        ["X", "2026-03-04"],
        ["J", "2026-03-05"],
        ["V", "2026-03-06"],
      ]
    );
  });
  it("si el primer día NO cae en lunes se lee igual, pero se avisa y las fechas cuentan L, M, X… desde ese día", async () => {
    // El 3 de marzo de 2026 es martes.
    const r = await parseAumenta(libro(semana("03-7", bloque("ARACELI", SEMANA_ENTERA))), {
      periodo: MARZO,
    });
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(r.avisos[0].texto, /el día 3 de 2026-03 no cae en lunes/);
    assert.deepEqual(
      r.filas.map((f) => f.fecha),
      ["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"]
    );
  });
  it("el mismo libro en otro mes cambia todas las fechas: el nombre de la hoja no sabe el mes", async () => {
    // El 2 de febrero de 2026 también es lunes.
    const wb = libro(semana("02-6", bloque("ARACELI", SEMANA_ENTERA)));
    const feb = await parseAumenta(wb, { periodo: "2026-02" });
    assert.deepEqual(feb.avisos, []);
    assert.equal(feb.filas[0].fecha, "2026-02-02");
    assert.equal(feb.filas[4].fecha, "2026-02-06");
  });
  it("una semana que se sale del mes («30-31» de marzo): L y M se leen, X, J y V se saltan con aviso", async () => {
    const r = await parseAumenta(libro(semana("30-31", bloque("ARACELI", SEMANA_ENTERA))), {
      periodo: MARZO,
    });
    assert.deepEqual(
      r.filas.map((f) => [f.diaLetra, f.fecha]),
      [
        ["L", "2026-03-30"],
        ["M", "2026-03-31"],
      ]
    );
    assert.equal(r.avisos.length, 3);
    assert.ok(r.avisos.every((a) => a.nivel === "aviso" && /Fila saltada/.test(a.texto)));
    assert.match(r.avisos[0].texto, /ARACELI: el X de la hoja «30-31» caería en el día 32/);
    assert.match(r.avisos[2].texto, /el V .* día 34/);
  });
  it("la fila 1 es la cabecera y no se lee, aunque lleve un nombre y horas", async () => {
    const wb = libro(
      hoja("02-6", [
        filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", salida: "17:00" }),
      ])
    );
    const r = await parseAumenta(wb, { periodo: MARZO });
    assert.deepEqual(r.filas, []);
    assert.deepEqual(r.nombres, []);
    assert.deepEqual(r.avisos, [NI_UNA_JORNADA]);
  });
});

describe("parse (Aumenta): bloques por persona y anotaciones en la columna de nombres", () => {
  it("el nombre en la fila del lunes abre bloque y esa misma fila es su lunes", async () => {
    const r = await parseAumenta(libro(semana("02-6", bloque("ARACELI", SEMANA_ENTERA))), {
      periodo: MARZO,
    });
    assert.deepEqual(r.nombres, ["ARACELI"]);
    assert.deepEqual(resumen(r.filas), [
      ["ARACELI", "2026-03-02", "L", 510],
      ["ARACELI", "2026-03-03", "M", 510],
      ["ARACELI", "2026-03-04", "X", 510],
      ["ARACELI", "2026-03-05", "J", 510],
      ["ARACELI", "2026-03-06", "V", 390],
    ]);
    assert.deepEqual(
      r.filas.map((f) => f.fila),
      [2, 3, 4, 5, 6]
    );
  });
  it("el nombre en una fila sola (sin día) también abre bloque, y los días vienen debajo", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI" }),
      ...SEMANA_ENTERA.map(([dia, entrada, salida]) => filaAumenta({ dia, entrada, salida })),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI"]);
    assert.equal(r.filas.length, 5);
    assert.deepEqual(
      r.filas.map((f) => f.fila),
      [3, 4, 5, 6, 7]
    );
    assert.ok(r.filas.every((f) => f.nombreExcel === "ARACELI"));
  });
  it("los bloques no son de tamaño fijo: se recorre de nombre a nombre (5 días, fila en blanco, 3 días, 5 días)", async () => {
    const filas = [
      ...bloque("ARACELI", SEMANA_ENTERA),
      filaAumenta(),
      filaAumenta({ nombre: "BEA" }),
      ...SEMANA_ENTERA.slice(0, 3).map(([dia, entrada, salida]) =>
        filaAumenta({ dia, entrada, salida })
      ),
      ...bloque("CARMEN", SEMANA_ENTERA),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI", "BEA", "CARMEN"]);
    const porPersona = {};
    for (const f of r.filas) porPersona[f.nombreExcel] = (porPersona[f.nombreExcel] || 0) + 1;
    assert.deepEqual(porPersona, { ARACELI: 5, BEA: 3, CARMEN: 5 });
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(r.anotaciones, []);
  });
  it("un texto en la columna de nombres con día M/X/J/V es una ANOTACIÓN sobre ese día de la persona abierta, no una persona", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ dia: "M", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ nombre: "BAJA", dia: "X" }),
      filaAumenta({ nombre: "*MÉDICO", dia: "J", entrada: "11:00", salida: "17:00" }),
      filaAumenta({ dia: "V", entrada: "08:30", salida: "15:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI"]);
    assert.deepEqual(r.anotaciones, [
      { nombreExcel: "ARACELI", fecha: "2026-03-04", texto: "BAJA", hoja: "02-6", fila: 4 },
      { nombreExcel: "ARACELI", fecha: "2026-03-05", texto: "*MÉDICO", hoja: "02-6", fila: 5 },
    ]);
    // El día anotado con horas se lee como jornada de la persona (llegó tarde del médico);
    // el anotado sin horas es un día no trabajado y no sale.
    assert.deepEqual(resumen(r.filas), [
      ["ARACELI", "2026-03-02", "L", 510],
      ["ARACELI", "2026-03-03", "M", 510],
      ["ARACELI", "2026-03-05", "J", 360],
      ["ARACELI", "2026-03-06", "V", 390],
    ]);
  });
  it("«VICTORIA» sola en una fila y «JUSTIFICANTE DE MÉDICO» debajo con día L: anotación sobre su lunes, y las horas son de Victoria", async () => {
    const filas = [
      filaAumenta({ nombre: "VICTORIA" }),
      filaAumenta({
        nombre: "JUSTIFICANTE DE MÉDICO",
        dia: "L",
        entrada: "09:00",
        salida: "14:00",
      }),
      filaAumenta({ dia: "M", entrada: "09:00", salida: "14:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["VICTORIA"]);
    assert.deepEqual(r.anotaciones, [
      {
        nombreExcel: "VICTORIA",
        fecha: "2026-03-02",
        texto: "JUSTIFICANTE DE MÉDICO",
        hoja: "02-6",
        fila: 3,
      },
    ]);
    assert.deepEqual(resumen(r.filas), [
      ["VICTORIA", "2026-03-02", "L", 300],
      ["VICTORIA", "2026-03-03", "M", 300],
    ]);
  });
  it("pero si la persona anterior YA tiene días leídos, un texto con día L es una persona nueva", async () => {
    const filas = [...bloque("ARACELI", SEMANA_ENTERA), ...bloque("BEA", SEMANA_ENTERA)];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI", "BEA"]);
    assert.deepEqual(r.anotaciones, []);
    assert.deepEqual(
      r.filas.filter((f) => f.nombreExcel === "BEA").map((f) => f.fila),
      [7, 8, 9, 10, 11]
    );
  });
  it("los días en blanco de una persona cuentan como días leídos: un nombre con L detrás de cinco filas vacías es persona nueva", async () => {
    const filas = [
      filaAumenta({ nombre: "VICTORIA" }),
      ...["L", "M", "X", "J", "V"].map((dia) => filaAumenta({ dia })),
      ...bloque("ISA", SEMANA_ENTERA),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ISA", "VICTORIA"]);
    assert.deepEqual(r.anotaciones, []);
    assert.ok(r.filas.every((f) => f.nombreExcel === "ISA"));
    assert.equal(r.filas.length, 5);
  });
  it("el reverso de la regla de Victoria: un nombre solo SIN ninguna fila de día debajo se traga al siguiente nombre con L", async () => {
    // Es el punto ciego documentado en aumenta.js: con cero días leídos, el
    // texto con L de la fila siguiente se lee como anotación sobre el lunes de
    // la persona abierta. En el fichero real no pasa porque cada persona lleva
    // sus cinco filas de día aunque estén vacías (ver el `it` anterior).
    const filas = [filaAumenta({ nombre: "VICTORIA" }), ...bloque("ISA", SEMANA_ENTERA)];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["VICTORIA"]);
    assert.deepEqual(
      r.anotaciones.map((a) => [a.nombreExcel, a.texto, a.fecha]),
      [["VICTORIA", "ISA", "2026-03-02"]]
    );
    assert.ok(r.filas.every((f) => f.nombreExcel === "VICTORIA"));
  });
  it("una anotación que cae en lunes detrás de una persona con días se lee como persona: el fallo seguro, se ve en el preview", async () => {
    const filas = [
      ...bloque("ARACELI", SEMANA_ENTERA),
      filaAumenta({ nombre: "BAJA", dia: "L" }),
      filaAumenta({ dia: "M", entrada: "08:30", salida: "17:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI", "BAJA"]);
    assert.deepEqual(r.anotaciones, []);
    assert.deepEqual(resumen(r.filas).at(-1), ["BAJA", "2026-03-03", "M", 510]);
  });
  it("un texto con día M/X/J/V antes de ninguna persona se ignora con aviso", async () => {
    const filas = [filaAumenta({ nombre: "MÉDICO", dia: "M", entrada: "10:00", salida: "17:00" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas, []);
    assert.deepEqual(r.nombres, []);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(
      r.avisos[0].texto,
      /«MÉDICO» \(hoja 02-6, fila 2\) aparece antes de ninguna persona/
    );
    assert.deepEqual(r.avisos[1], NI_UNA_JORNADA);
  });
  it("una fila con día y horas pero sin persona abierta se salta sin decir nada", async () => {
    const filas = [filaAumenta({ dia: "M", entrada: "08:30", salida: "17:00" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas, []);
    assert.deepEqual(r.avisos, [NI_UNA_JORNADA]);
  });
  it("el día admite minúscula y espacios («l», « M », «x»); S y D (fin de semana) no son días y la fila se salta", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "l", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ dia: " M ", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ dia: "x", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ dia: "S", entrada: "09:00", salida: "13:00" }),
      filaAumenta({ dia: "D", entrada: "09:00", salida: "13:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => f.diaLetra),
      ["L", "M", "X"]
    );
    assert.deepEqual(r.avisos, []);
  });
  it("«M-1» y «M-2» son dos tramos del mismo martes (mañana y tarde): dos filas, misma fecha, diaLetra distinta; «X/1» también vale", async () => {
    const filas = [
      filaAumenta({ nombre: "ROSA", dia: "L", entrada: "09:00", salida: "14:00" }),
      filaAumenta({ dia: "M-1", entrada: "09:00", salida: "13:00" }),
      filaAumenta({ dia: "M-2", entrada: "15:00", salida: "19:00" }),
      filaAumenta({ dia: "X/1", entrada: "09:00", salida: "13:00" }),
      filaAumenta({ dia: "X / 2", entrada: "15:00", salida: "19:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(resumen(r.filas), [
      ["ROSA", "2026-03-02", "L", 300],
      ["ROSA", "2026-03-03", "M-1", 240],
      ["ROSA", "2026-03-03", "M-2", 240],
      ["ROSA", "2026-03-04", "X-1", 240],
      ["ROSA", "2026-03-04", "X-2", 240],
    ]);
    assert.deepEqual(r.nombres, ["ROSA"]);
  });
  it("el lunes también puede ir en dos tramos: «L-1» con nombre abre bloque y «L-2» es el segundo tramo del mismo lunes", async () => {
    const filas = [
      filaAumenta({ nombre: "ROSA", dia: "L-1", entrada: "09:00", salida: "13:00" }),
      filaAumenta({ dia: "L-2", entrada: "15:00", salida: "19:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ROSA"]);
    assert.deepEqual(resumen(r.filas), [
      ["ROSA", "2026-03-02", "L-1", 240],
      ["ROSA", "2026-03-02", "L-2", 240],
    ]);
  });
  it("un Date en la columna de nombres no es ni nombre ni anotación: la fila se lee como día de la persona abierta", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ nombre: diaExcel(2026, 3, 3), dia: "M", entrada: "08:30", salida: "17:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ARACELI"]);
    assert.deepEqual(r.anotaciones, []);
    assert.deepEqual(resumen(r.filas)[1], ["ARACELI", "2026-03-03", "M", 510]);
  });
  it("nombres: únicos entre hojas y ordenados en español (ÁLVARO antes que ARACELI, no al final)", async () => {
    const wb = libro(
      semana("02-6", [...bloque("BEA", SEMANA_ENTERA), ...bloque("ARACELI", SEMANA_ENTERA)]),
      semana("9-13", [...bloque("ARACELI", SEMANA_ENTERA), ...bloque("ÁLVARO", SEMANA_ENTERA)])
    );
    const r = await parseAumenta(wb, { periodo: MARZO });
    assert.deepEqual(r.nombres, ["ÁLVARO", "ARACELI", "BEA"]);
    assert.equal(r.filas.length, 20);
  });
  it("una anotación en una semana que se sale del mes NO se guarda con una fecha que no existe: se descarta, y la fila ya avisa de que se salta", async () => {
    // Nació de que la fecha de la anotación se calculaba con rango.desde +
    // índice del día SIN comprobar que cupiera en el mes, mientras la jornada
    // de esa MISMA fila sí lo comprobaba y se saltaba con aviso: en «30-31» de
    // marzo la anotación en J salía como «2026-03-33». No se quedaba en
    // pantalla —el resumen del lote se persiste (`importar.js`)—, así que el
    // día imposible acababa escrito en el registro del import.
    const filas = [
      ...bloque("ARACELI", SEMANA_ENTERA.slice(0, 2)),
      filaAumenta({ nombre: "MÉDICO", dia: "J" }),
    ];
    const r = await parseAumenta(libro(semana("30-31", filas)), { periodo: MARZO });
    assert.deepEqual(r.anotaciones, []);
    // No se pierde en silencio: la misma fila sale con su «Fila saltada».
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0].texto, /el J de la hoja «30-31» caería en el día 33/);
    assert.match(r.avisos[0].texto, /Fila saltada/);
  });
  it("la anotación de un día que SÍ cabe en el mes se sigue guardando con su fecha", async () => {
    // El reverso del `it` anterior: lo que se descarta es el día imposible, no
    // las anotaciones de las hojas que se salen del mes.
    const filas = [
      ...bloque("ARACELI", SEMANA_ENTERA.slice(0, 2)),
      filaAumenta({ nombre: "MÉDICO", dia: "M" }),
    ];
    const r = await parseAumenta(libro(semana("30-31", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.anotaciones.map((a) => [a.texto, a.fecha]),
      [["MÉDICO", "2026-03-31"]]
    );
  });
});

describe("parse (Aumenta): de dónde salen los minutos de cada jornada", () => {
  it("la forma completa de una fila: horas formateadas, minutos recalculados, fuente, hoja y fila", async () => {
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entradaPrev: "08:30",
        entrada: "08:35",
        salidaPrev: "17:00",
        salida: "17:10",
        horasPrev: formula(horaExcel(8, 30)),
        horasFich: formula(horaExcel(8, 35)),
      }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas, [
      {
        nombreExcel: "ARACELI",
        fecha: "2026-03-02",
        diaLetra: "L",
        entrada: "08:35",
        salida: "17:10",
        entradaPrevista: "08:30",
        salidaPrevista: "17:00",
        minutos: 515,
        minutosPrevistos: 510,
        fuente: "horas",
        cruzaMedianoche: false,
        hoja: "02-6",
        fila: 2,
        errores: [],
      },
    ]);
  });
  it("con entrada y salida reales los minutos se recalculan de las horas y la columna calculada del Excel se IGNORA (fuente «horas»)", async () => {
    // La fórmula del fichero real devuelve cosas como 21.000000000000245, que
    // como duración serían 21 h: si se usara, pagaría 21 h por una jornada de 8h30.
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entrada: "08:30",
        salida: "17:00",
        horasFich: 21.000000000000245,
      }),
      filaAumenta({ dia: "M", entrada: "08:30", salida: "17:00", horasFich: horaExcel(2, 0) }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.fuente]),
      [
        [510, "horas"],
        [510, "horas"],
      ]
    );
  });
  it("sin horas reales pero con total del Excel: se usa el total y se dice (fuente «total_excel»)", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", horasFich: "7:30" }),
      filaAumenta({ dia: "M", horasFich: formula(horaExcel(8, 30)) }),
      filaAumenta({ dia: "X", horasFich: 0.3541666666666667 }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.fuente, f.entrada, f.salida, f.errores]),
      [
        [450, "total_excel", null, null, []],
        [510, "total_excel", null, null, []],
        [510, "total_excel", null, null, []],
      ]
    );
  });
  it("un total del Excel de cero o negativo (la fórmula restando contra una salida vacía) no cuenta: sin horas, la fila se descarta en silencio", async () => {
    // Es el límite del `it` de abajo («un total que no se entiende … SALE»): lo
    // que hay en estas celdas lo escribió la FÓRMULA del Excel, no una persona,
    // y un cero o una fecha anterior a la época son su forma de decir «este día
    // está en blanco». Sacarlos al preview llenaría de rojo un fichero
    // correcto. Solo el TEXTO que no se entiende bloquea la fila.
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", horasFich: 0 }),
      filaAumenta({ dia: "M", horasFich: new Date(Date.UTC(1899, 11, 29, 8, 4)) }),
      filaAumenta({ dia: "X", horasFich: "0" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas, []);
    assert.deepEqual(r.nombres, ["ARACELI"]);
    assert.deepEqual(r.avisos, [NI_UNA_JORNADA]);
  });
  it("un total que no se entiende («abc», «8 horas») sin horas NO se descarta: la fila SALE con el error, y dice qué celda no se entendió", async () => {
    // Nació de que la fila se trataba como vacía ANTES de mirar si había algo
    // que no se entendió, así que el error «no se ha podido leer ninguna hora»
    // que el lector escribe no podía salir nunca. Quien teclea «8 horas» en la
    // casilla del total es la persona del centro rellenando su Excel, y lo que
    // desaparecía sin un solo aviso era una jornada del control horario: lo que
    // se paga y lo que se enseña en una inspección.
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", horasFich: "abc" }),
      filaAumenta({ dia: "M", horasFich: "8 horas" }),
      filaAumenta({ dia: "X", horasFich: "8:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(resumen(r.filas), [
      ["ARACELI", "2026-03-02", "L", null],
      ["ARACELI", "2026-03-03", "M", null],
      ["ARACELI", "2026-03-04", "X", 480],
    ]);
    assert.deepEqual(
      r.filas.map((f) => f.errores),
      [
        ["no se ha podido leer ninguna hora (el total de horas dice «abc»)"],
        ["no se ha podido leer ninguna hora (el total de horas dice «8 horas»)"],
        [],
      ]
    );
    // Es un error DE LA FILA, que la bloquea en el preview, no un aviso suelto.
    assert.deepEqual(r.avisos, []);
  });
  it("lo mismo en las columnas de entrada y salida: un texto que no se entiende no hace desaparecer el día", async () => {
    // La misma causa, en las otras dos celdas de las que salen los minutos.
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "de 9 a 2", salida: "por la tarde" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos, f.errores]),
      [
        [
          null,
          null,
          null,
          [
            "no se ha podido leer ninguna hora (la entrada dice «de 9 a 2», la salida dice «por la tarde»)",
          ],
        ],
      ]
    );
  });
  it("el texto que no se entiende se RECORTA en el error: una celda enorme no convierte el preview en varios megas", async () => {
    // El error de la fila viaja al preview dentro del `motivo` de la fila
    // bloqueada (`lib/fichaje/importar.js`), y de ahí al JSON de la respuesta.
    // Una celda de Excel admite 32.767 caracteres y el preview manda hasta 200
    // filas bloqueadas con tres celdas cada una: sin recortar, un texto pegado
    // por error en la columna del total pesaba medio mega en quince filas
    // (medido el 21/08/2026). `parseHoraDelDia` ya recorta su propio motivo.
    const enorme = "texto pegado sin querer ".repeat(200);
    const filas = [filaAumenta({ nombre: "ARACELI", dia: "L", horasFich: enorme })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas[0].errores, [
      "no se ha podido leer ninguna hora (el total de horas dice «texto pegado sin querer texto pegado sin…»)",
    ]);
    // Y lo corto se sigue enseñando entero, sin puntos suspensivos.
    const corto = await parseAumenta(
      libro(semana("02-6", [filaAumenta({ nombre: "ARACELI", dia: "L", horasFich: "8 horas" })])),
      { periodo: MARZO }
    );
    assert.deepEqual(corto.filas[0].errores, [
      "no se ha podido leer ninguna hora (el total de horas dice «8 horas»)",
    ]);
  });
  it("una fila sin entrada, sin salida y sin total es un día no trabajado: se descarta sin aviso", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", salida: "17:00" }),
      filaAumenta({ dia: "M" }),
      filaAumenta({ dia: "X" }),
      filaAumenta({ dia: "J" }),
      filaAumenta({ dia: "V", entrada: "08:30", salida: "15:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => f.diaLetra),
      ["L", "V"]
    );
    assert.deepEqual(r.avisos, []);
  });
  it("solo entrada (o solo salida) y sin total: la fila SALE, con minutos null y el error que dice qué falta", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30" }),
      filaAumenta({ dia: "M", salida: "17:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos, f.fuente, f.errores]),
      [
        ["08:30", null, null, null, ["solo consta la entrada y no hay total de horas"]],
        [null, "17:00", null, null, ["solo consta la salida y no hay total de horas"]],
      ]
    );
  });
  it("solo entrada pero CON total del Excel: se usa el total, se conserva la entrada y no hay error", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", horasFich: "8:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos, f.fuente, f.errores]),
      [["08:30", null, 480, "total_excel", []]]
    );
  });
  it("salida anterior a la entrada: turno de noche, se suman 24 h y se marca cruzaMedianoche", async () => {
    const filas = [filaAumenta({ nombre: "NOCHE", dia: "L", entrada: "22:00", salida: "06:00" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.equal(r.filas[0].minutos, 480);
    assert.equal(r.filas[0].cruzaMedianoche, true);
    assert.deepEqual(r.filas[0].errores, []);
  });
  it("entrada y salida intercambiadas (17:00 → 08:30): la fila ENTRA como jornada que cruza la medianoche (15h 30min), sin error, pero con un aviso que dice que la salida es anterior a la entrada", async () => {
    // `minutosEntre` devuelve `cruzaMedianoche` para que «quien llama decida si
    // eso merece un aviso» (parseHora.js), y el lector decide que sí: un turno
    // de noche es legítimo (la fila no es error), pero en un centro de día lo
    // más probable es que las dos celdas estén cambiadas, y el preview tiene
    // que decirlo ANTES de aplicar, no el resumen del mes después.
    const filas = [filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "17:00", salida: "08:30" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.cruzaMedianoche, f.errores]),
      [[930, true, []]]
    );
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(r.avisos[0].texto, /^ARACELI: el L de la hoja «02-6» \(fila 2\)/);
    assert.match(r.avisos[0].texto, /la salida \(08:30\) anterior a la entrada \(17:00\)/);
    assert.match(r.avisos[0].texto, /cruza la medianoche \(15h 30min\)/);
  });
  it("entrada igual que salida: una jornada de 0 minutos sale como fila válida (un total del Excel a 0 sí se descarta)", async () => {
    // SOSPECHOSO: con el total del Excel se exige `> 0`; con las horas no, así
    // que «09:00 → 09:00» (la misma celda copiada dos veces) entra en el lote
    // con 0 minutos y fuente «horas», sin error. Lo señala después el resumen
    // del mes como «jornada corta», no el preview.
    const filas = [filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "09:00", salida: "09:00" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.fuente, f.cruzaMedianoche, f.errores]),
      [[0, "horas", false, []]]
    );
  });
  it("más de 16 h es error («la jornada saldría de N h»), venga de las horas o del total; 16 h justas, no", async () => {
    const filas = [
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:00", salida: "01:00" }),
      filaAumenta({ dia: "M", horasFich: "20:00" }),
      filaAumenta({ dia: "X", entrada: "06:00", salida: "22:00" }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.errores]),
      [
        [1020, ["la jornada saldría de 17 h"]],
        [1200, ["la jornada saldría de 20 h"]],
        [960, []],
      ]
    );
  });
  it("16 h y un minuto ya es error, y el mensaje redondea a «16 h»", async () => {
    // SOSPECHOSO (cosmético): el umbral es «más de 16 h» pero el texto redondea
    // los minutos a horas, así que 961 minutos dicen «la jornada saldría de 16 h»,
    // que es justo la cifra permitida. Quien lo lea en el preview no sabrá por
    // qué 16 h es error.
    const filas = [filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "06:00", salida: "22:01" })];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(r.filas[0].errores, ["la jornada saldría de 16 h"]);
  });
  it("los minutos PREVISTOS salen del horario (C3/C6); sin horario, de la columna calculada (C9); sin nada, null", async () => {
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entradaPrev: "08:30",
        salidaPrev: "17:00",
        entrada: "08:30",
        salida: "17:00",
      }),
      filaAumenta({ dia: "M", horasPrev: "8:00", entrada: "08:30", salida: "17:00" }),
      filaAumenta({
        dia: "X",
        horasPrev: formula(0.3541666666666667),
        entrada: "08:30",
        salida: "17:00",
      }),
      filaAumenta({ dia: "J", entrada: "08:30", salida: "17:00" }),
      // Con horario Y columna calculada, manda el horario.
      filaAumenta({
        dia: "V",
        entradaPrev: "09:00",
        salidaPrev: "14:00",
        horasPrev: "8",
        entrada: "09:00",
        salida: "14:00",
      }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.diaLetra, f.minutosPrevistos, f.entradaPrevista, f.salidaPrevista]),
      [
        ["L", 510, "08:30", "17:00"],
        ["M", 480, null, null],
        ["X", 510, null, null],
        ["J", null, null, null],
        ["V", 300, "09:00", "14:00"],
      ]
    );
  });
  it("un horario previsto con la salida antes que la entrada suma 24 h, pero AVISA, igual que en las horas reales", async () => {
    // Nació de que `minutosPrevistos` tiraba el `cruzaMedianoche` que devuelve
    // `minutosEntre`, mientras las horas REALES sí lo convertían en aviso. La
    // errata es la misma —dos celdas cambiadas en el Excel del reloj— y lo que
    // sale mal son las horas extra del mes, que se restan contra los previstos
    // (`lib/fichaje/totales.js`) y se guardan en la fila (`minutosPrevistos`).
    // Un horario de noche es legítimo, así que la fila entra: avisada, no rota.
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entradaPrev: "09:00",
        salidaPrev: "08:00",
        entrada: "09:00",
        salida: "14:00",
      }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.equal(r.filas[0].minutosPrevistos, 1380);
    assert.deepEqual(r.filas[0].errores, []);
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(r.avisos[0].texto, /^ARACELI: el L de la hoja «02-6» \(fila 2\)/);
    assert.match(
      r.avisos[0].texto,
      /la salida prevista \(08:00\) anterior a la entrada prevista \(09:00\)/
    );
    assert.match(r.avisos[0].texto, /un horario de 23h cruzando la medianoche/);
  });
  it("un horario previsto normal no avisa de nada, y un horario de noche de verdad («22:00 → 06:00») avisa una sola vez", async () => {
    // El reverso: el aviso es del cruce, no de tener horario. Y la fila con
    // horario Y horas reales cruzando la medianoche saca sus DOS avisos, uno
    // por cada par de celdas, porque son dos erratas distintas de arreglar.
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entradaPrev: "08:30",
        salidaPrev: "17:00",
        entrada: "08:30",
        salida: "17:00",
      }),
      filaAumenta({
        dia: "M",
        entradaPrev: "22:00",
        salidaPrev: "06:00",
        entrada: "22:00",
        salida: "06:00",
      }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.minutosPrevistos]),
      [
        [510, 510],
        [480, 480],
      ]
    );
    assert.equal(r.avisos.length, 2);
    assert.match(r.avisos[0].texto, /el M .* tiene la salida \(06:00\) anterior a la entrada/);
    assert.match(r.avisos[1].texto, /el M .* la salida prevista \(06:00\) anterior/);
  });
  it("la misma hora como Date de ExcelJS, fracción de día, texto o fórmula da los mismos minutos y el mismo «HH:MM»", async () => {
    const filas = [
      filaAumenta({
        nombre: "ARACELI",
        dia: "L",
        entrada: horaExcel(8, 30),
        salida: horaExcel(17, 0),
      }),
      filaAumenta({ dia: "M", entrada: 0.3541666666666667, salida: 0.7083333333333334 }),
      filaAumenta({ dia: "X", entrada: "8:30", salida: "17:00" }),
      filaAumenta({ dia: "J", entrada: formula("08:30"), salida: formula(horaExcel(17, 0)) }),
    ];
    const r = await parseAumenta(libro(semana("02-6", filas)), { periodo: MARZO });
    assert.equal(r.filas.length, 4);
    for (const f of r.filas) {
      assert.deepEqual(
        [f.entrada, f.salida, f.minutos, f.fuente],
        ["08:30", "17:00", 510, "horas"]
      );
    }
  });
  it("hoja y fila son los del Excel (1-indexados), para poder señalar la celda en el preview", async () => {
    const filas = [
      filaAumenta(),
      filaAumenta(),
      filaAumenta({ nombre: "ARACELI", dia: "L", entrada: "08:30", salida: "17:00" }),
    ];
    const r = await parseAumenta(libro(semana("9-13", filas)), { periodo: MARZO });
    assert.equal(r.filas[0].hoja, "9-13");
    assert.equal(r.filas[0].fila, 4);
    assert.equal(r.filas[0].fecha, "2026-03-09");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parsers/generico.js
// ═══════════════════════════════════════════════════════════════════════════

const PLANTILLA = ["Persona", "Fecha", "Entrada", "Salida", "Horas", "Nota"];

describe("localizarColumnas (genérico): la cabecera se busca por nombre, no por posición", () => {
  it("la plantilla tal cual, en la fila 1: Persona · Fecha · Entrada · Salida · Horas · Nota", () => {
    assert.deepEqual(localizarColumnas(hoja("Fichajes", [PLANTILLA])), {
      fila: 1,
      mapa: { persona: 1, fecha: 2, entrada: 3, salida: 4, horas: 5, nota: 6 },
    });
  });
  it("da igual el orden y que haya columnas de más: cada una se encuentra por su rótulo", () => {
    const cab = ["Nº", "Fecha", "Nombre", "Centro", "Hasta", "Desde"];
    assert.deepEqual(localizarColumnas(hoja("x", [cab])), {
      fila: 1,
      mapa: { fecha: 2, persona: 3, salida: 5, entrada: 6 },
    });
  });
  it("los sinónimos de cada columna", () => {
    const casos = [
      [
        ["Trabajador", "Día", "Inicio", "Fin", "Total", "Observaciones"],
        { persona: 1, fecha: 2, entrada: 3, salida: 4, horas: 5, nota: 6 },
      ],
      [
        ["Empleada", "Date", "Hora entrada", "Hora salida", "Horas trabajadas", "Comentario"],
        { persona: 1, fecha: 2, entrada: 3, salida: 4, horas: 5, nota: 6 },
      ],
      [
        ["terapeuta", "day", "desde", "hasta", "duracion", "incidencia"],
        { persona: 1, fecha: 2, entrada: 3, salida: 4, horas: 5, nota: 6 },
      ],
      [["Empleado", "Fecha", "Tiempo", "Notas"], { persona: 1, fecha: 2, horas: 3, nota: 4 }],
    ];
    for (const [cab, mapa] of casos) {
      assert.deepEqual(localizarColumnas(hoja("x", [cab])).mapa, mapa, cab.join(" | "));
    }
  });
  it("mayúsculas, acentos y espacios alrededor no importan: «  PERSONA », «FECHA», «Duración»", () => {
    const cab = ["  PERSONA ", "FECHA", "ENTRADA", "SALIDA", "Duración", "OBSERVACIONES "];
    assert.deepEqual(localizarColumnas(hoja("x", [cab])).mapa, {
      persona: 1,
      fecha: 2,
      entrada: 3,
      salida: 4,
      horas: 5,
      nota: 6,
    });
  });
  it("la cabecera puede estar en cualquiera de las 10 primeras filas (título encima); en la 11 ya no se encuentra", () => {
    const conTitulo = hoja("x", [["Fichajes de marzo"], [], PLANTILLA]);
    assert.equal(localizarColumnas(conTitulo).fila, 3);
    const enLa10 = hoja("x", [...Array.from({ length: 9 }, () => []), PLANTILLA]);
    assert.equal(localizarColumnas(enLa10).fila, 10);
    const enLa11 = hoja("x", [...Array.from({ length: 10 }, () => []), PLANTILLA]);
    assert.equal(localizarColumnas(enLa11), null);
  });
  it("sin «Persona» o sin «Fecha» no hay cabecera: null (también con la hoja vacía)", () => {
    assert.equal(localizarColumnas(hoja("x", [["Fecha", "Entrada", "Salida"]])), null);
    assert.equal(localizarColumnas(hoja("x", [["Persona", "Entrada", "Salida"]])), null);
    assert.equal(localizarColumnas(hoja("x", [])), null);
    assert.equal(localizarColumnas(hoja("x", [[]])), null);
  });
  it("si dos rótulos valen para la misma columna, gana el primero por la izquierda", () => {
    assert.deepEqual(localizarColumnas(hoja("x", [["Nombre", "Persona", "Fecha", "Día"]])).mapa, {
      persona: 1,
      fecha: 3,
    });
  });
  it("una cabecera con solo Persona y Fecha vale, y las demás columnas quedan sin índice", () => {
    assert.deepEqual(localizarColumnas(hoja("x", [["Persona", "Fecha"]])), {
      fila: 1,
      mapa: { persona: 1, fecha: 2 },
    });
  });
  it("un rótulo con texto enriquecido o con fórmula se lee por su contenido; un número no es un rótulo", () => {
    const cab = [{ richText: [{ text: "Per" }, { text: "sona" }] }, formula("Fecha"), 42];
    assert.deepEqual(localizarColumnas(hoja("x", [cab])), {
      fila: 1,
      mapa: { persona: 1, fecha: 2 },
    });
  });
});

/** Un libro genérico de una hoja con la plantilla en la fila 1 y las filas dadas debajo. */
const plantilla = (filas, nombre = "Fichajes") => libro(hoja(nombre, [PLANTILLA, ...filas]));

describe("parse (genérico): una fila, un tramo", () => {
  it("un periodo que no es AAAA-MM devuelve el mismo error que el lector de Aumenta", async () => {
    const wb = plantilla([["Ana", "2026-03-02", "08:00", "16:00"]]);
    for (const periodo of ["", null, undefined, "2026-3", "03/2026"]) {
      assert.deepEqual(await parseGenerico(wb, { periodo }), PERIODO_INVALIDO, String(periodo));
    }
  });
  it("la forma completa de una fila: sin día de la semana ni previstos, con nota recortada", async () => {
    const wb = plantilla([
      ["Ana López", diaExcel(2026, 3, 2), "08:30", "17:00", null, " llegó tarde "],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(r, {
      filas: [
        {
          nombreExcel: "Ana López",
          fecha: "2026-03-02",
          diaLetra: null,
          entrada: "08:30",
          salida: "17:00",
          entradaPrevista: null,
          salidaPrevista: null,
          minutos: 510,
          minutosPrevistos: null,
          fuente: "horas",
          cruzaMedianoche: false,
          hoja: "Fichajes",
          fila: 2,
          nota: "llegó tarde",
          errores: [],
        },
      ],
      anotaciones: [],
      avisos: [],
      nombres: ["Ana López"],
    });
  });
  it("la fecha como Date, «2026-03-15», «15/03/2026», «15-03-2026», «2026-3-15» o serial 46096 es siempre «2026-03-15»", async () => {
    const formas = [
      diaExcel(2026, 3, 15),
      "2026-03-15",
      "15/03/2026",
      "15-03-2026",
      "2026-3-15",
      46096,
    ];
    const wb = plantilla(formas.map((f) => ["Ana", f, "08:00", "16:00"]));
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.equal(r.filas.length, formas.length);
    for (const f of r.filas) {
      assert.equal(f.fecha, "2026-03-15");
      assert.deepEqual(f.errores, []);
    }
  });
  it("una Fecha con hora dentro (la celda era fecha-y-hora) es ese día, también a las 23:59: no se corre al siguiente", async () => {
    const wb = plantilla([
      ["Ana", new Date(Date.UTC(2026, 2, 2, 10, 30)), "08:00", "16:00"],
      ["Ana", new Date(Date.UTC(2026, 2, 2, 23, 59)), "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.fecha, f.errores]),
      [
        ["2026-03-02", []],
        ["2026-03-02", []],
      ]
    );
  });
  it("una fecha que no se entiende: la fila SALE con fecha null y un motivo legible, no un código", async () => {
    const casos = [
      ["hola", "la fecha no se entiende (usa 2026-03-15 o 15/03/2026)"],
      ["31/02/2026", "ese día no existe en ese mes"],
      ["15/13/2026", "el mes no existe"],
      ["32/01/2026", "el día no existe"],
      ["15/03/1800", "el año está fuera de rango"],
      [true, "esa celda no contiene una fecha"],
      [new Date("no es fecha"), "la fecha no es válida"],
      [-1, "la fecha no se entiende"],
    ];
    const wb = plantilla(casos.map(([f]) => ["Ana", f, "08:00", "16:00"]));
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.fecha, f.errores]),
      casos.map(([, motivo]) => [null, [motivo]])
    );
  });
  it("una fila de otro mes dentro del fichero del mes se rechaza con su motivo (la pantalla filtra por periodo)", async () => {
    const wb = plantilla([
      ["Ana", "2026-04-01", "08:00", "16:00"],
      ["Ana", "2026-02-28", "08:00", "16:00"],
      ["Ana", "2026-03-31", "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.fecha, f.errores]),
      [
        ["2026-04-01", ["la fecha 2026-04-01 no es de 2026-03"]],
        ["2026-02-28", ["la fecha 2026-02-28 no es de 2026-03"]],
        ["2026-03-31", []],
      ]
    );
  });
  it("sin persona pero con fecha: error «falta la persona» y el nombre vacío no entra en la lista de nombres", async () => {
    const wb = plantilla([[null, "2026-03-02", "08:00", "16:00"]]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.equal(r.filas[0].nombreExcel, "");
    assert.deepEqual(r.filas[0].errores, ["falta la persona"]);
    assert.deepEqual(r.nombres, []);
  });
  it("con persona pero sin fecha: error «falta la fecha»", async () => {
    const wb = plantilla([["Ana", null, "08:00", "16:00"]]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.equal(r.filas[0].fecha, null);
    assert.deepEqual(r.filas[0].errores, ["falta la fecha"]);
  });
  it("una fila vacía del todo (sin persona ni fecha) se salta sin ruido, y la numeración de filas se conserva", async () => {
    const wb = plantilla([
      ["Ana", "2026-03-02", "08:00", "16:00"],
      [],
      [null, null, null, null, null, null],
      [null, "", "08:00", "16:00"],
      ["Ana", "2026-03-03", "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => f.fila),
      [2, 6]
    );
    assert.deepEqual(r.avisos, []);
  });
  it("una fila sin persona cuya fecha son solo espacios SÍ se salta: es una fila en blanco, no tres errores", async () => {
    // Nació de que la fila vacía se detectaba con `fechaBruta === ""` sin
    // recortar, mientras la persona sí se recortaba antes de mirarla. Un Excel
    // con espacios sueltos en las filas del final es lo normal, y lo que veía
    // quien importa era un preview con errores inventados («falta la persona»,
    // «falta la fecha», «no hay horas…») que además contaban en `rowsError`:
    // justo lo que hace desconfiar del lote entero.
    const wb = plantilla([
      ["Ana", "2026-03-02", "08:00", "16:00"],
      [null, "   "],
      [null, "\t "],
      ["Ana", "2026-03-03", "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => f.fila),
      [2, 5]
    );
    assert.deepEqual(r.avisos, []);
  });
  it("pero los espacios solo tapan la fila si TAMPOCO hay persona: con una de las dos, la fila sale con su error", async () => {
    // El límite: recortar es para reconocer la fila en blanco, no para perdonar
    // una fecha que falta en una fila que sí lleva a alguien.
    const wb = plantilla([
      [null, "2026-03-02", "08:00", "16:00"],
      ["Ana", "   ", "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.fila, f.nombreExcel, f.fecha, f.errores]),
      [
        [2, "", "2026-03-02", ["falta la persona"]],
        [3, "Ana", null, ["falta la fecha"]],
      ]
    );
  });
  it("con entrada y salida los minutos salen de las horas (y la columna Horas se ignora); sin ellas, de Horas: «7:30», «7,5», «7.5» y 8 son lo que dicen", async () => {
    const wb = plantilla([
      ["Ana", "2026-03-02", "08:00", "16:00", "99"],
      ["Ana", "2026-03-03", null, null, "7:30"],
      ["Ana", "2026-03-04", null, null, "7,5"],
      ["Ana", "2026-03-05", null, null, "7.5"],
      ["Ana", "2026-03-06", null, null, 8],
      ["Ana", "2026-03-09", null, null, horaExcel(7, 45)],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.fuente]),
      [
        [480, "horas"],
        [450, "total_excel"],
        [450, "total_excel"],
        [450, "total_excel"],
        [480, "total_excel"],
        [465, "total_excel"],
      ]
    );
    assert.ok(r.filas.every((f) => f.errores.length === 0));
  });
  it("con solo una de las dos horas se cae a la columna Horas; si tampoco hay, error y minutos null", async () => {
    const wb = plantilla([
      ["Ana", "2026-03-02", "08:00", null, "8"],
      ["Ana", "2026-03-03", null, "16:00", "8"],
      ["Ana", "2026-03-04", "08:00", null, null],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos, f.fuente, f.errores]),
      [
        ["08:00", null, 480, "total_excel", []],
        [null, "16:00", 480, "total_excel", []],
        ["08:00", null, null, null, ["no hay horas ni total del que sacar la jornada"]],
      ]
    );
  });
  it("Horas a cero o negativa no es un total: error", async () => {
    const wb = plantilla([
      ["Ana", "2026-03-02", null, null, 0],
      ["Ana", "2026-03-03", null, null, "0"],
      ["Ana", "2026-03-04", null, null, new Date(Date.UTC(1899, 11, 29, 8, 4))],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    for (const f of r.filas) {
      assert.equal(f.minutos, null);
      assert.deepEqual(f.errores, ["no hay horas ni total del que sacar la jornada"]);
    }
  });
  it("salida anterior a la entrada: turno de noche, +24 h y cruzaMedianoche", async () => {
    const wb = plantilla([["Ana", "2026-03-02", "22:00", "06:00"]]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.equal(r.filas[0].minutos, 480);
    assert.equal(r.filas[0].cruzaMedianoche, true);
    assert.deepEqual(r.filas[0].errores, []);
  });
  it("entrada y salida intercambiadas (17:00 → 08:30) también aquí ENTRAN como 15h 30min con cruzaMedianoche, sin error, y con el aviso de que la salida es anterior a la entrada", async () => {
    // La misma regla que en el lector de Aumenta (ver el `it` homólogo arriba):
    // la fila no es error, pero el preview lo dice antes de aplicar.
    const wb = plantilla([["Ana", "2026-03-02", "17:00", "08:30"]]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.minutos, f.cruzaMedianoche, f.errores]),
      [[930, true, []]]
    );
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(r.avisos[0].texto, /^Ana · 2026-03-02 \(hoja Fichajes, fila 2\)/);
    assert.match(r.avisos[0].texto, /la salida \(08:30\) es anterior a la entrada \(17:00\)/);
    assert.match(r.avisos[0].texto, /cruza la medianoche \(15h 30min\)/);
  });
  it("una jornada de más de 16 h entra SIN error (a diferencia del lector de Aumenta): el «jornada larga» lo pone después el resumen del mes", async () => {
    const wb = plantilla([["Ana", "2026-03-02", "06:00", "23:00"]]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.equal(r.filas[0].minutos, 1020);
    assert.deepEqual(r.filas[0].errores, []);
  });
  it("dos filas de la misma persona el mismo día son dos tramos (mañana y tarde), no un error", async () => {
    const wb = plantilla([
      ["Ana", "2026-03-02", "09:00", "13:00"],
      ["Ana", "2026-03-02", "15:00", "19:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.nombreExcel, f.fecha, f.entrada, f.salida, f.minutos, f.errores]),
      [
        ["Ana", "2026-03-02", "09:00", "13:00", 240, []],
        ["Ana", "2026-03-02", "15:00", "19:00", 240, []],
      ]
    );
    assert.deepEqual(r.nombres, ["Ana"]);
  });
  it("la nota se recorta; vacía, de espacios o sin columna Nota, null", async () => {
    const conNota = plantilla([
      ["Ana", "2026-03-02", "08:00", "16:00", null, " médico "],
      ["Ana", "2026-03-03", "08:00", "16:00", null, ""],
      ["Ana", "2026-03-04", "08:00", "16:00", null, "   "],
      ["Ana", "2026-03-05", "08:00", "16:00", null, null],
    ]);
    const r = await parseGenerico(conNota, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => f.nota),
      ["médico", null, null, null]
    );
    const sinColumna = libro(
      hoja("x", [
        ["Persona", "Fecha", "Entrada", "Salida"],
        ["Ana", "2026-03-02", "08:00", "16:00", null, "esto no es la nota"],
      ])
    );
    assert.equal((await parseGenerico(sinColumna, { periodo: MARZO })).filas[0].nota, null);
  });
  it("sin columnas de Entrada/Salida ni de Horas en la cabecera, ninguna fila tiene jornada y todas lo dicen", async () => {
    const wb = libro(
      hoja("x", [
        ["Persona", "Fecha"],
        ["Ana", "2026-03-02", "08:00", "16:00"],
      ])
    );
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos, f.fuente, f.errores]),
      [[null, null, null, null, ["no hay horas ni total del que sacar la jornada"]]]
    );
  });
  it("una hoja sin cabecera se salta con AVISO (no error) y las demás se leen; si ninguna tiene nada, además el error «ni una jornada»", async () => {
    const sinCab = hoja("Resumen", [["Total de horas", 160]]);
    const conDatos = hoja("Marzo", [PLANTILLA, ["Ana", "2026-03-02", "08:00", "16:00"]]);
    const r = await parseGenerico(libro(sinCab, conDatos), { periodo: MARZO });
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].nivel, "aviso");
    assert.match(r.avisos[0].texto, /«Resumen» no tiene columnas «Persona» y «Fecha»/);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].hoja, "Marzo");

    const nada = await parseGenerico(libro(sinCab), { periodo: MARZO });
    assert.deepEqual(nada.filas, []);
    assert.equal(nada.avisos.length, 2);
    assert.deepEqual(nada.avisos[1], NI_UNA_JORNADA);
  });
  it("un libro sin hojas: solo el error «ni una jornada»", async () => {
    assert.deepEqual(await parseGenerico(libro(), { periodo: MARZO }), {
      filas: [],
      anotaciones: [],
      avisos: [NI_UNA_JORNADA],
      nombres: [],
    });
  });
  it("nombres: únicos, sin vacíos, recortados y ordenados en español", async () => {
    const wb = plantilla([
      ["Zoe", "2026-03-02", "08:00", "16:00"],
      ["  Álvaro ", "2026-03-02", "08:00", "16:00"],
      ["Zoe", "2026-03-03", "08:00", "16:00"],
      [null, "2026-03-03", "08:00", "16:00"],
      ["Beatriz", "2026-03-02", "08:00", "16:00"],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(r.nombres, ["Álvaro", "Beatriz", "Zoe"]);
    assert.equal(r.filas[1].nombreExcel, "Álvaro");
  });
  it("celdas con fórmula o texto enriquecido se leen por su contenido", async () => {
    const wb = plantilla([
      [
        { richText: [{ text: "Ana" }, { text: " López" }] },
        formula(diaExcel(2026, 3, 2)),
        formula("08:00"),
        formula(horaExcel(16, 0)),
      ],
    ]);
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.nombreExcel, f.fecha, f.entrada, f.salida, f.minutos]),
      [["Ana López", "2026-03-02", "08:00", "16:00", 480]]
    );
  });
  it("con la cabecera en la fila 3, los datos empiezan en la 4 y `fila` lo dice; varias hojas se leen todas", async () => {
    const wb = libro(
      hoja("Marzo", [["Fichajes"], [], PLANTILLA, ["Ana", "2026-03-02", "08:00", "16:00"]]),
      hoja("Extras", [PLANTILLA, ["Bea", "2026-03-09", "08:00", "12:00"]])
    );
    const r = await parseGenerico(wb, { periodo: MARZO });
    assert.deepEqual(
      r.filas.map((f) => [f.hoja, f.fila, f.nombreExcel]),
      [
        ["Marzo", 4, "Ana"],
        ["Extras", 2, "Bea"],
      ]
    );
    assert.deepEqual(r.nombres, ["Ana", "Bea"]);
  });
});
