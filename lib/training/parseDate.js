/**
 * Parser de fechas tolerante para los Excel de import del módulo training.
 *
 * Acepta:
 *   - Instancia `Date` (ya parseada por ExcelJS para celdas formateadas como
 *     fecha).
 *   - `number` = serial Excel (días desde 1900-01-00 con el bug del año 1900).
 *   - `string` en uno de estos formatos, en este orden:
 *       1. AAAA-MM-DD     (ISO)
 *       2. DD-MM-AAAA     (formato europeo preferido)
 *       3. DD/MM/AAAA     (se normaliza a guiones antes de probar)
 *
 * Rechaza explícitamente:
 *   - Año fuera de [1900, 2100].
 *   - Mes fuera de [1, 12], día fuera de [1, 31].
 *   - Fechas inexistentes (ej. 31-02-2024 / 30-02-2024).
 *   - Strings vacíos, null, undefined.
 *   - Cualquier otro tipo (boolean, object).
 *
 * El motivo del cambio: el `new Date(str)` nativo interpreta DD-MM-AAAA como
 * MM-DD-AAAA en muchos locales, y "32-13-2020" se acepta como inválido sin
 * señalar la razón. Aquí la respuesta es explícita y trazable en el preview.
 *
 * Resultado: `{ ok: true, date: Date }` en éxito,
 *            `{ ok: false, reason: string }` en error.
 */

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === "") {
    return { ok: false, reason: "vacio" };
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { ok: false, reason: "date_invalida" };
    return validateYMD(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    return excelSerialToDate(value);
  }
  if (typeof value !== "string") {
    return { ok: false, reason: "tipo_no_soportado" };
  }

  const s = value.trim().replace(/\//g, "-");
  if (!s) return { ok: false, reason: "vacio" };

  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    return validateYMD(+m[1], +m[2], +m[3]);
  }
  if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s))) {
    return validateYMD(+m[3], +m[2], +m[1]);
  }
  return { ok: false, reason: "formato_no_reconocido" };
}

function validateYMD(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { ok: false, reason: "componentes_invalidos" };
  }
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { ok: false, reason: "ano_fuera_de_rango" };
  }
  if (month < 1 || month > 12) {
    return { ok: false, reason: "mes_invalido" };
  }
  if (day < 1 || day > 31) {
    return { ok: false, reason: "dia_invalido" };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // 31 de febrero → JS lo "corrige" a 2-3 marzo. Si el día redondeado difiere
  // del recibido, la fecha era inexistente.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, reason: "fecha_inexistente" };
  }
  return { ok: true, date };
}

/**
 * Excel usa días desde 1900-01-00 con el bug histórico que cuenta 1900 como
 * bisiesto. La fórmula práctica para celdas tipo "Fecha" en Excel/LibreOffice
 * después del 1900-03-01 es:  Date.UTC(1899, 11, 30) + serial * 86400000.
 * Para celdas con fechas anteriores hay drift de 1 día — irrelevante aquí
 * porque nadie nace antes de 1900 en este sistema.
 */
function excelSerialToDate(serial) {
  if (!Number.isFinite(serial) || serial <= 0) {
    return { ok: false, reason: "serial_invalido" };
  }
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  const date = new Date(ms);
  if (isNaN(date.getTime())) return { ok: false, reason: "serial_invalido" };
  return validateYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Helpers para tests de humo en línea. NO se exponen como API pública del
 * módulo — son ejecutables sueltos cuando un dev quiera comprobar a mano que
 * los casos canónicos siguen verdes. No reemplazan tests reales (no los hay
 * aún en el repo, ver backlog en docs/modules/training.md).
 */
export function _smokeTests() {
  const cases = [
    // [input, expectedOk, expectedISO|expectedReason]
    ["1985-05-12", true, "1985-05-12"],
    ["12-05-1985", true, "1985-05-12"],
    ["12/05/1985", true, "1985-05-12"],
    ["1985-5-12", true, "1985-05-12"],
    ["5-1-1985", true, "1985-01-05"],
    ["2024-02-29", true, "2024-02-29"],     // bisiesto válido
    ["29-02-2023", false, "fecha_inexistente"], // 2023 no bisiesto
    ["31-02-2024", false, "fecha_inexistente"],
    ["32-13-2020", false, "mes_invalido"],   // mes 13 falla antes que día
    ["00-05-1985", false, "dia_invalido"],
    ["12-05-1899", false, "ano_fuera_de_rango"],
    ["12-05-2101", false, "ano_fuera_de_rango"],
    ["hola", false, "formato_no_reconocido"],
    ["", false, "vacio"],
    [null, false, "vacio"],
    [undefined, false, "vacio"],
    [new Date(Date.UTC(1990, 10, 23)), true, "1990-11-23"],
    [31_092, true, "1985-02-14"],             // serial Excel (días desde 1899-12-30)
    [true, false, "tipo_no_soportado"],
  ];
  const results = [];
  for (const [input, expectedOk, expected] of cases) {
    const r = parseFlexibleDate(input);
    const actualOk = r.ok;
    const actual = r.ok ? r.date.toISOString().slice(0, 10) : r.reason;
    const pass = actualOk === expectedOk && actual === expected;
    results.push({ input, expectedOk, expected, actualOk, actual, pass });
  }
  return results;
}
