/**
 * lib/fichaje/leerLibro.js — abrir el Excel del fichaje, sea `.xlsx` o `.xls`.
 *
 * Existe por un hecho muy concreto (31/08/2026): el reloj de fichar de Aumenta
 * exporta su volcado mensual en `.xls`, el formato BINARIO de Excel 97-2003, y
 * ExcelJS solo sabe abrir `.xlsx`. Pedirle al centro que abra el fichero y lo
 * re-guarde como `.xlsx` cada mes es pedir un paso manual que un mes se hará
 * mal y otro no se hará: el fichero se lee TAL CUAL lo escupe el reloj.
 *
 * El `.xls` lo lee SheetJS y aquí se convierte a un Workbook de ExcelJS, para
 * que los lectores de `parsers/` sigan hablando UN solo idioma (celdas de
 * ExcelJS, con `valorDeCelda` y compañía). Los valores que sobreviven a la
 * conversión son los que los lectores usan: textos (incluidos los marcajes
 * multilínea del reloj, «08:46\n14:05\n») y números (fechas y horas seriales de
 * Excel, que `parseHora.js` ya entiende como fracción de día).
 *
 * ⚠️ La dependencia `xlsx` está anclada al tarball del CDN OFICIAL de SheetJS
 * (`cdn.sheetjs.com`), no al registro de npm: el paquete de npm está congelado
 * en 0.18.5 con vulnerabilidades conocidas (prototype pollution, ReDoS) que las
 * versiones del CDN tienen arregladas. Si algún día se actualiza, del CDN.
 *
 * El formato se decide por los PRIMEROS BYTES, no por la extensión: un `.xls`
 * renombrado a `.xlsx` (pasa más de lo que parece) se abre igual de bien.
 *
 *   D0 CF 11 E0 → contenedor CDF, el `.xls` binario
 *   50 4B       → un zip, el `.xlsx`
 */

import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

function esXlsBinario(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

function esZip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Buffer → Workbook de ExcelJS, venga como venga.
 *
 * Lanza con un mensaje en cristiano si el fichero no es ninguna de las dos
 * cosas; quien llama (las rutas de import) lo convierte en su 422.
 */
export async function leerLibro(buffer) {
  if (esXlsBinario(buffer)) {
    const libro = XLSX.read(buffer, { type: "buffer" });
    const workbook = new ExcelJS.Workbook();
    for (const nombre of libro.SheetNames) {
      const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], {
        header: 1,
        raw: true,
        defval: null,
      });
      const ws = workbook.addWorksheet(nombre);
      filas.forEach((fila, r) => {
        fila.forEach((valor, c) => {
          if (valor === null || valor === undefined || valor === "") return;
          ws.getRow(r + 1).getCell(c + 1).value = valor;
        });
      });
    }
    return workbook;
  }

  if (esZip(buffer)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  throw new Error("El fichero no parece un Excel (ni .xlsx ni .xls)");
}
