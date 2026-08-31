// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fichaje-parser-reloj.mjs — el volcado MENSUAL del reloj de fichar de
 * Aumenta se lee de los marcajes en crudo, y un .xls se abre igual que un .xlsx
 * (31/08/2026).
 *
 *   node scripts/_smoke-fichaje-parser-reloj.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Desde julio de 2026 Aumenta ya no rellena la hoja semanal a mano: sube el
 * fichero que exporta la máquina («Julio 2026.xls», formato BINARIO 97-2003).
 * Trae cinco hojas y solo una dice la verdad: «Registro asistencia», los
 * marcajes en crudo por persona y día. Las demás son cálculos del reloj contra
 * su cuadro de turnos, y SE EQUIVOCAN: en el fichero real de julio, a
 * Estefanía el día 3 la hoja «Anormal» le pone «salida: Falta» cuando los
 * marcajes dicen 09:00 y 14:20. Leer la hoja equivocada es pagar mal.
 *
 * Lo que esta prueba fija, regla a regla (`lib/fichaje/parsers/aumentaReloj.js`
 * y `lib/fichaje/leerLibro.js`):
 *
 *   · el lector `aumenta` RECONOCE el volcado del reloj y delega solo (el
 *     mismo tenant re-importa meses viejos en el formato semanal);
 *   · los marcajes se emparejan EN ORDEN (1º-2º, 3º-4º: mañana y tarde son dos
 *     tramos) y los minutos se recalculan de ellos;
 *   · un marcaje SUELTO entra como jornada de 0 minutos con su nota — en la
 *     pantalla del mes saldrá «Entrada sin salida» y se corrige ahí; ni se
 *     esconde en el preview ni se le inventan horas;
 *   · el mes del fichero («07/01/2026 ~ 07/31/2026», formato AMERICANO) se
 *     comprueba contra el periodo elegido: si no cuadran, no se lee NADA;
 *   · texto ilegible en una celda de marcajes bloquea la fila DICIENDO qué
 *     ponía, no la tira en silencio;
 *   · quien está en el reloj sin un solo marcaje se avisa, pero NO bloquea el
 *     mapeo (no aporta horas que proteger);
 *   · y `leerLibro` abre el .xls binario de verdad (round-trip con SheetJS) y
 *     el .xlsx de siempre, decidiendo por los bytes y no por la extensión.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

import { parse as parseReloj, hojaDeMarcajes, meta } from "../lib/fichaje/parsers/aumentaReloj.js";
import { parse as parseAumenta } from "../lib/fichaje/parsers/aumenta.js";
import { leerLibro } from "../lib/fichaje/leerLibro.js";

// ── Un libro de ExcelJS de mentira, con lo justo que miran los lectores ─────

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

/** La fila de números de día del reloj: 1..31 en columnas. */
const filaDias = (hasta = 31) => Array.from({ length: hasta }, (_, i) => i + 1);

/** La fila «ID : n … Nombre : fulana», con los rótulos donde los pone el reloj. */
const filaId = (id, nombre) => {
  const f = [];
  f[0] = "ID :";
  f[2] = String(id);
  f[7] = "Nombre :";
  f[9] = nombre;
  f[15] = "Dept. :";
  f[17] = "Not Set1";
  return f;
};

/** La fila de marcajes: `{dia: "08:46\n14:05\n"}` → celdas en su columna. */
const filaMarcajes = (porDia) => {
  const f = [];
  for (const [dia, celda] of Object.entries(porDia)) f[Number(dia) - 1] = celda;
  return f;
};

/** El volcado mínimo del reloj: cabecera con rango, y bloques por persona. */
function libroReloj({ rango = "07/01/2026 ~ 07/31/2026", bloques }) {
  const filas = [["Registro asistencia"], [], ["Date :", null, rango]];
  for (const [nombre, marcajes, id] of bloques) {
    filas.push(filaDias());
    filas.push(filaId(id ?? filas.length, nombre));
    if (marcajes !== null) filas.push(filaMarcajes(marcajes));
  }
  return libro(hoja("Resum. de asis.", [["Resum. de asis."]]), hoja("Registro asistencia", filas));
}

const JULIO = "2026-07";
const deAna = (r) => r.filas.filter((f) => f.nombreExcel === "ana");

// ── El lector del reloj ─────────────────────────────────────────────────────

describe("aumentaReloj: los marcajes en crudo mandan", () => {
  it("dos marcajes son un tramo, con los minutos recalculados de ellos", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 2: "08:46\n14:05\n" }]] }),
      { periodo: JULIO }
    );
    assert.equal(r.filas.length, 1);
    const f = r.filas[0];
    assert.equal(f.nombreExcel, "ana");
    assert.equal(f.fecha, "2026-07-02");
    assert.equal(f.entrada, "08:46");
    assert.equal(f.salida, "14:05");
    assert.equal(f.minutos, 5 * 60 + 19);
    assert.deepEqual(f.errores, []);
    assert.deepEqual(r.nombres, ["ana"]);
  });

  it("cuatro marcajes son DOS tramos del mismo día (mañana y tarde)", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 5: "08:00\n14:00\n15:00\n19:00\n" }]] }),
      { periodo: JULIO }
    );
    assert.equal(r.filas.length, 2);
    assert.deepEqual(
      r.filas.map((f) => [f.entrada, f.salida, f.minutos]),
      [["08:00", "14:00", 360], ["15:00", "19:00", 240]]
    );
    assert.ok(r.filas.every((f) => f.fecha === "2026-07-05"));
  });

  it("un marcaje suelto entra con 0 minutos, su hora y su nota — no se esconde ni se adivina", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 1: "14:48\n", 3: "10:59\n19:17\n19:23\n" }]] }),
      { periodo: JULIO }
    );
    // Día 1: solo el suelto. Día 3: un tramo entero Y el tercero suelto.
    const sueltos = r.filas.filter((f) => f.fuente === "marcaje_suelto");
    assert.equal(sueltos.length, 2);
    assert.deepEqual(
      sueltos.map((f) => [f.fecha, f.entrada, f.salida, f.minutos]),
      [["2026-07-01", "14:48", null, 0], ["2026-07-03", "19:23", null, 0]]
    );
    assert.ok(sueltos.every((f) => f.errores.length === 0 && f.nota));
    const tramo = r.filas.find((f) => f.fuente === "marcajes");
    assert.deepEqual([tramo.entrada, tramo.salida, tramo.minutos], ["10:59", "19:17", 8 * 60 + 18]);
    // Y el aviso agregado que explica qué va a pasar con ellos.
    assert.ok(r.avisos.some((a) => a.nivel === "aviso" && a.texto.includes("marcaje suelto")));
  });

  it("el mes del fichero (formato americano) se comprueba: si no cuadra, no se lee nada", async () => {
    const r = await parseReloj(libroReloj({ bloques: [["ana", { 2: "08:00\n14:00\n" }]] }), {
      periodo: "2026-08",
    });
    assert.equal(r.filas.length, 0);
    assert.equal(r.nombres.length, 0);
    assert.ok(r.avisos.some((a) => a.nivel === "error" && a.texto.includes("07/2026")));
  });

  it("sin la hoja «Registro asistencia» se dice qué hojas trae y no se lee nada", async () => {
    const r = await parseReloj(libro(hoja("Anormal", [["Anormal"]])), { periodo: JULIO });
    assert.equal(r.filas.length, 0);
    assert.ok(r.avisos.some((a) => a.nivel === "error" && a.texto.includes("«Anormal»")));
  });

  it("texto ilegible en la celda bloquea la fila DICIENDO qué ponía, no la tira", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 4: "8 horas\n" }]] }),
      { periodo: JULIO }
    );
    assert.equal(r.filas.length, 1);
    assert.ok(r.filas[0].errores[0].includes("«8 horas»"));
    // Bloqueada pero visible: el nombre sigue exigiendo mapeo, son horas de alguien.
    assert.deepEqual(r.nombres, ["ana"]);
  });

  it("quien está en el reloj sin un solo marcaje se avisa pero no exige mapeo", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 2: "08:00\n14:00\n" }], ["cris", {}]] }),
      { periodo: JULIO }
    );
    assert.deepEqual(r.nombres, ["ana"]);
    assert.ok(r.avisos.some((a) => a.texto.includes("«cris»") && a.texto.includes("ni un marcaje")));
  });

  it("marcajes sin nombre se saltan avisando: nada se importa sin saber de quién es", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["", { 2: "08:00\n14:00\n" }]] }),
      { periodo: JULIO }
    );
    assert.equal(r.filas.length + r.nombres.length, 0);
    assert.ok(r.avisos.some((a) => a.texto.includes("sin nombre")));
  });

  it("una salida antes que la entrada cuenta cruzando la medianoche y avisa; más de 16 h bloquea", async () => {
    const r = await parseReloj(
      libroReloj({ bloques: [["ana", { 2: "23:00\n01:00\n", 3: "01:00\n19:00\n" }]] }),
      { periodo: JULIO }
    );
    const noche = deAna(r).find((f) => f.fecha === "2026-07-02");
    assert.equal(noche.minutos, 120);
    assert.equal(noche.cruzaMedianoche, true);
    assert.ok(r.avisos.some((a) => a.texto.includes("cruza la medianoche")));
    const larga = deAna(r).find((f) => f.fecha === "2026-07-03");
    assert.ok(larga.errores[0].includes("18 h"));
  });

  it("un día que no existe en el mes se salta con aviso (no se inventa un 31 de junio)", async () => {
    const r = await parseReloj(
      libroReloj({
        rango: "06/01/2026 ~ 06/30/2026",
        bloques: [["ana", { 30: "08:00\n14:00\n", 31: "08:00\n14:00\n" }]],
      }),
      { periodo: "2026-06" }
    );
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].fecha, "2026-06-30");
    assert.ok(r.avisos.some((a) => a.texto.includes("día 31")));
  });

  it("el lector «aumenta» reconoce el volcado del reloj y delega solo", async () => {
    const wb = libroReloj({ bloques: [["ana", { 2: "08:46\n14:05\n" }]] });
    assert.ok(hojaDeMarcajes(wb));
    const r = await parseAumenta(wb, { periodo: JULIO });
    assert.deepEqual(r.nombres, ["ana"]);
    assert.equal(r.filas[0].fuente, "marcajes");
    // Y el formato semanal de siempre NO se confunde con el del reloj.
    assert.equal(hojaDeMarcajes(libro(hoja("02-6", [["ROSA"]]))), null);
    assert.equal(meta.key, "aumenta_reloj");
  });
});

// ── leerLibro: el .xls binario del reloj se abre de verdad ──────────────────

describe("leerLibro: .xls y .xlsx por los bytes, no por la extensión", () => {
  it("un .xls binario (round-trip con SheetJS) conserva hojas, textos multilínea y números", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Registro asistencia"],
      [],
      ["Date :", null, "07/01/2026 ~ 07/31/2026"],
      filaDias(),
      ["ID :", null, "1", null, null, null, null, "Nombre :", null, "ana"],
      ["08:46\n14:05\n", null, "09:00\n"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registro asistencia");
    const xls = XLSX.write(wb, { type: "buffer", bookType: "xls" });

    // Es de verdad el contenedor binario CDF, no un zip renombrado.
    assert.deepEqual([...xls.slice(0, 4)], [0xd0, 0xcf, 0x11, 0xe0]);

    const workbook = await leerLibro(xls);
    const hojaWs = workbook.worksheets[0];
    assert.equal(hojaWs.name, "Registro asistencia");
    assert.equal(hojaWs.getRow(6).getCell(1).value, "08:46\n14:05\n");
    assert.equal(Number(hojaWs.getRow(4).getCell(2).value), 2);

    // Y el lector entero funciona sobre lo convertido.
    const r = await parseReloj(workbook, { periodo: JULIO });
    assert.equal(r.filas.length, 2); // el tramo del día 1 y el suelto del día 3
    assert.deepEqual(r.nombres, ["ana"]);
  });

  it("un .xlsx de ExcelJS se abre por el camino de siempre", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("02-6").getRow(1).getCell(1).value = "ROSA";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const leido = await leerLibro(buffer);
    assert.equal(leido.worksheets[0].name, "02-6");
    assert.equal(leido.worksheets[0].getRow(1).getCell(1).value, "ROSA");
  });

  it("lo que no es un Excel lanza con un mensaje en cristiano", async () => {
    await assert.rejects(() => leerLibro(Buffer.from("hola, soy un csv")), /no parece un Excel/);
  });
});
