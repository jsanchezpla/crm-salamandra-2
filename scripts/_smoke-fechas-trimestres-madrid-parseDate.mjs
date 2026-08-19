// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fechas-trimestres-madrid-parseDate.mjs — cuatro piezas pequeñas de
 * fechas, y cuáles de ellas miran el reloj del proceso (19/08/2026).
 *
 *   node scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs
 *   node --test-name-pattern="madrid" scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs
 *   TZ=UTC node scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs      (Git Bash)
 *   $env:TZ="UTC"; node scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs; Remove-Item Env:TZ
 *
 * Prueba lo que DEVUELVEN:
 *   · lib/clinica/trimestres.js   — trimestres escolares (T1 sep–dic, T2 ene–mar,
 *                                   T3 abr–jun o abr–jul) para secuenciar informes
 *   · lib/utils/madridDate.js     — «hoy» y «el día de hoy va de X a Y» en hora de
 *                                   Madrid, corra donde corra el servidor
 *   · lib/billing/invoiceStatus.js — estado efectivo de una factura (vencida por
 *                                   fecha y cobros, sin tocar la fila)
 *   · lib/training/parseDate.js   — fechas de los Excel de formación y fichaje:
 *                                   serial de Excel, DD/MM/AAAA, DD-MM-AAAA, ISO
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El 19/08/2026 se midió dentro del contenedor de producción que Node corría en
 * UTC mientras el CRM se escribió y se prueba en Windows con Europe/Madrid: 42
 * ficheros del servidor usan fechas locales sin zona (el año del número de
 * factura, el «hoy» de la portada, los trimestres de clínica, PDFs…) y daban
 * otra cosa entre las 00:00 y las 02:00 de Madrid. El mismo día el servicio
 * `app` del compose pasó a `TZ=Europe/Madrid` (8d89d70). Ninguna de estas cuatro
 * piezas tenía prueba: la única red era leer el código.
 *
 * Esta prueba fija dos cosas. Primero, las reglas de negocio: que julio solo
 * cuenta como T3 si el tenant lo pide, que agosto no es de nadie, que el día de
 * Madrid dura 23 h el último domingo de marzo y 25 el de octubre, que una
 * factura vence el día DESPUÉS de su vencimiento y no el mismo, que «05-12-1985»
 * es el 5 de diciembre y no el 12 de mayo, que un serial de Excel con hora
 * pierde la hora. Segundo, y es lo que más importa tras el cambio de zona: qué
 * piezas NO miran el reloj del proceso (madridDate, parseDate con texto y con
 * seriales, invoiceStatus) y cuáles SÍ (trimestres.js entero, y parseDate si le
 * llega una Date construida en hora local). Los `it` de estas últimas están
 * escritos para pasar en Madrid y en UTC, pero cada uno dice qué sale en cada
 * zona. Por eso se lanza dos veces: con la zona de la máquina y con TZ=UTC.
 *
 * Lo que hoy devuelve algo raro se deja escrito tal cual y marcado SOSPECHOSO,
 * no se arregla aquí: `trimesterOf(null)` cae en el 2º trimestre de 1969,
 * `effectiveStatus` cuenta el «hoy» en UTC (no en Madrid), un `dueDate` que
 * llegue como Date nunca vence y un «hoy» vacío («») tampoco vence nada.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  trimestreConJulio,
  schoolYearOf,
  trimestersOf,
  trimesterOf,
  trimesterRange,
  schoolYearLabel,
} from "../lib/clinica/trimestres.js";
import { madridToday, madridYearMonth, madridDayRange } from "../lib/utils/madridDate.js";
import {
  effectiveStatus,
  withEffectiveStatus,
  withEffectiveStatusList,
} from "../lib/billing/invoiceStatus.js";
import { parseFlexibleDate, _smokeTests } from "../lib/training/parseDate.js";

/* ── Ayudas ──────────────────────────────────────────────────────────────── */

const ISO = (d) => d.toISOString();
const HORA = 3600 * 1000;
/** Un instante a MEDIODÍA UTC: es el mismo día civil en cualquier zona entre -11 y +11. */
const mediodia = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12));
/** Lo que devuelve parseFlexibleDate, resumido: el día (YYYY-MM-DD) o el motivo. */
const dia = (v) => {
  const r = parseFlexibleDate(v);
  return r.ok ? r.date.toISOString().slice(0, 10) : r.reason;
};
/** Una factura emitida de 100 € sin cobrar que venció el 19/08/2026. */
const facturaVencida = (extra = {}) => ({
  status: "issued",
  dueDate: "2026-08-19",
  total: 100,
  paidAmount: 0,
  ...extra,
});

/* ══════════════════════════════════════════════════════════════════════════
 * lib/clinica/trimestres.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("trimestreConJulio: el interruptor del tenant solo está encendido con true de verdad", () => {
  it("settings.clinica.trimestreConJulio === true → encendido", () => {
    assert.equal(trimestreConJulio({ settings: { clinica: { trimestreConJulio: true } } }), true);
  });
  it("false, «true» en texto, 1 o ausente → apagado", () => {
    assert.equal(trimestreConJulio({ settings: { clinica: { trimestreConJulio: false } } }), false);
    assert.equal(
      trimestreConJulio({ settings: { clinica: { trimestreConJulio: "true" } } }),
      false
    );
    assert.equal(trimestreConJulio({ settings: { clinica: { trimestreConJulio: 1 } } }), false);
    assert.equal(trimestreConJulio({ settings: { clinica: {} } }), false);
    assert.equal(trimestreConJulio({ settings: {} }), false);
  });
  it("sin tenant o sin settings no revienta: apagado", () => {
    assert.equal(trimestreConJulio(null), false);
    assert.equal(trimestreConJulio(undefined), false);
    assert.equal(trimestreConJulio({}), false);
    assert.equal(trimestreConJulio({ settings: null }), false);
  });
});

describe("schoolYearOf: el curso se nombra por el año en que empieza, y empieza en septiembre", () => {
  it("de septiembre a diciembre el curso es el año en curso", () => {
    assert.equal(schoolYearOf(mediodia(2026, 9, 15)), 2026);
    assert.equal(schoolYearOf(mediodia(2026, 12, 15)), 2026);
  });
  it("de enero a agosto el curso es el año anterior (agosto incluido, aunque no sea de ningún trimestre)", () => {
    assert.equal(schoolYearOf(mediodia(2027, 1, 15)), 2026);
    assert.equal(schoolYearOf(mediodia(2027, 6, 15)), 2026);
    assert.equal(schoolYearOf(mediodia(2027, 8, 15)), 2026);
  });
  it("acepta una cadena ISO igual que una Date", () => {
    assert.equal(schoolYearOf("2026-09-15T12:00:00Z"), 2026);
    assert.equal(schoolYearOf("2027-03-15T12:00:00Z"), 2026);
  });
  it("schoolYearLabel pinta «inicio-fin»", () => {
    assert.equal(schoolYearLabel(2026), "2026-2027");
    assert.equal(schoolYearLabel(1999), "1999-2000");
  });
  it("con una fecha que no es fecha no avisa: null cae en 1969 (el epoch) y undefined o texto dan NaN", () => {
    // SOSPECHOSO: `new Date(null)` es el 1 de enero de 1970, así que null → curso 1969 sin
    // quejarse; undefined y «hola» son Invalid Date y salen como NaN, no como null. Hoy
    // los que llaman pasan `new Date()`, así que no muerde; se deja escrito lo que hace.
    assert.equal(schoolYearOf(null), 1969);
    assert.ok(Number.isNaN(schoolYearOf(undefined)));
    assert.ok(Number.isNaN(schoolYearOf("hola")));
  });
});

describe("trimestersOf: T1 septiembre–diciembre, T2 enero–marzo, T3 abril–junio (o hasta julio si el tenant lo pide)", () => {
  it("el curso 2026 sin la opción de julio", () => {
    assert.deepEqual(trimestersOf(2026), [
      {
        key: "T1",
        label: "1er trimestre",
        start: { year: 2026, month: 9 },
        end: { year: 2026, month: 12 },
      },
      {
        key: "T2",
        label: "2º trimestre",
        start: { year: 2027, month: 1 },
        end: { year: 2027, month: 3 },
      },
      {
        key: "T3",
        label: "3er trimestre",
        start: { year: 2027, month: 4 },
        end: { year: 2027, month: 6 },
      },
    ]);
  });
  it("con la opción de julio solo cambia el final del T3: julio; T1 y T2 igual", () => {
    const sin = trimestersOf(2026);
    const con = trimestersOf(2026, { conJulio: true });
    assert.deepEqual(con[0], sin[0]);
    assert.deepEqual(con[1], sin[1]);
    assert.deepEqual(con[2], { ...sin[2], end: { year: 2027, month: 7 } });
  });
  it("T2 y T3 caen en el año siguiente al del inicio del curso", () => {
    const [t1, t2, t3] = trimestersOf(2030);
    assert.equal(t1.start.year, 2030);
    assert.equal(t2.start.year, 2031);
    assert.equal(t3.end.year, 2031);
  });
});

describe("trimesterOf: en qué trimestre cae una fecha (y en cuál no cae ninguna)", () => {
  it("septiembre y diciembre son T1 del curso que empieza ese año", () => {
    assert.deepEqual(trimesterOf(mediodia(2026, 9, 1)), {
      ...trimestersOf(2026)[0],
      schoolYear: 2026,
    });
    assert.equal(trimesterOf(mediodia(2026, 12, 31)).key, "T1");
  });
  it("enero y marzo son T2 del curso que empezó el año ANTERIOR", () => {
    const t = trimesterOf(mediodia(2027, 1, 1));
    assert.equal(t.key, "T2");
    assert.equal(t.schoolYear, 2026);
    assert.equal(trimesterOf(mediodia(2027, 3, 31)).key, "T2");
  });
  it("abril y junio son T3", () => {
    assert.equal(trimesterOf(mediodia(2027, 4, 1)).key, "T3");
    assert.equal(trimesterOf(mediodia(2027, 6, 30)).key, "T3");
  });
  it("julio no es de nadie sin la opción, y es T3 con ella (decisión de Rodrigo, 28/07/2026)", () => {
    assert.equal(trimesterOf(mediodia(2027, 7, 1)), null);
    assert.equal(trimesterOf(mediodia(2027, 7, 31)), null);
    const conJulio = trimesterOf(mediodia(2027, 7, 15), { conJulio: true });
    assert.equal(conJulio.key, "T3");
    assert.equal(conJulio.schoolYear, 2026);
    assert.deepEqual(conJulio.end, { year: 2027, month: 7 });
  });
  it("agosto no es de nadie, con opción o sin ella", () => {
    assert.equal(trimesterOf(mediodia(2027, 8, 15)), null);
    assert.equal(trimesterOf(mediodia(2027, 8, 15), { conJulio: true }), null);
    assert.equal(trimesterOf(mediodia(2027, 8, 1), { conJulio: true }), null);
    assert.equal(trimesterOf(mediodia(2027, 8, 31), { conJulio: true }), null);
  });
  it("acepta cadena ISO igual que Date, y devuelve el trimestre de trimestersOf más el curso", () => {
    assert.deepEqual(trimesterOf("2027-02-15T12:00:00Z"), {
      ...trimestersOf(2026)[1],
      schoolYear: 2026,
    });
  });
  it("acepta también un timestamp numérico (milisegundos desde el epoch), como schoolYearOf", () => {
    assert.equal(trimesterOf(Date.UTC(2026, 8, 15, 12)).key, "T1");
    assert.equal(trimesterOf(Date.UTC(2027, 6, 15, 12), { conJulio: true }).key, "T3");
    assert.equal(schoolYearOf(Date.UTC(2027, 2, 15, 12)), 2026);
  });
  it("una fecha que no es fecha (texto, vacío, undefined) → null", () => {
    assert.equal(trimesterOf("hola"), null);
    assert.equal(trimesterOf(""), null);
    assert.equal(trimesterOf(undefined), null);
    assert.equal(trimesterOf(new Date("x")), null);
  });
  it("null NO da null: cae en el curso 1969 (el epoch; en Madrid y en UTC, su T2)", () => {
    // SOSPECHOSO: `new Date(null)` es 1970-01-01 y pasa el filtro de Invalid Date. Un
    // `trimesterOf(paciente.fechaX)` con la columna a null diría «2º trimestre 1969» en vez de
    // «fuera de trimestre». Hoy nadie le pasa null (los endpoints pasan `new Date()`).
    const t = trimesterOf(null);
    assert.notEqual(t, null);
    assert.equal(t.schoolYear, 1969);
    if ([-120, -60, 0].includes(new Date(0).getTimezoneOffset())) assert.equal(t.key, "T2");
  });
});

describe("trimesterRange: del día 1 del primer mes al día 1 del mes siguiente al último, en hora local", () => {
  const [t1, t2, t3] = trimestersOf(2026);
  const [, , t3Julio] = trimestersOf(2026, { conJulio: true });
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

  it("T1 2026: [1 sep 2026 00:00, 1 ene 2027 00:00) — diciembre rueda al enero del año siguiente", () => {
    const { start, end } = trimesterRange(t1);
    assert.deepEqual(ymd(start), [2026, 9, 1, 0, 0]);
    assert.deepEqual(ymd(end), [2027, 1, 1, 0, 0]);
  });
  it("T2: [1 ene, 1 abr) y T3 sin julio: [1 abr, 1 jul)", () => {
    assert.deepEqual(ymd(trimesterRange(t2).start), [2027, 1, 1, 0, 0]);
    assert.deepEqual(ymd(trimesterRange(t2).end), [2027, 4, 1, 0, 0]);
    assert.deepEqual(ymd(trimesterRange(t3).start), [2027, 4, 1, 0, 0]);
    assert.deepEqual(ymd(trimesterRange(t3).end), [2027, 7, 1, 0, 0]);
  });
  it("T3 con julio acaba el 1 de agosto (exclusivo): el 31 de julio entra, el 1 de agosto no", () => {
    assert.deepEqual(ymd(trimesterRange(t3Julio).end), [2027, 8, 1, 0, 0]);
  });
  it("el fin es exclusivo y siempre posterior al inicio", () => {
    for (const t of [t1, t2, t3, t3Julio]) {
      const { start, end } = trimesterRange(t);
      assert.ok(start instanceof Date && end instanceof Date);
      assert.ok(start < end, `${t.key}: ${ISO(start)} < ${ISO(end)}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * lib/utils/madridDate.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("madridToday / madridYearMonth: el día de HOY es el de Madrid, corra el proceso donde corra", () => {
  it("en verano (+02:00) a las 22:30Z ya es mañana en Madrid; a las 21:59Z todavía no", () => {
    assert.equal(madridToday(new Date("2026-08-19T22:30:00Z")), "2026-08-20");
    assert.equal(madridToday(new Date("2026-08-19T21:59:59Z")), "2026-08-19");
    assert.equal(madridToday(new Date("2026-08-19T22:00:00Z")), "2026-08-20");
  });
  it("en invierno (+01:00) el corte es a las 23:00Z", () => {
    assert.equal(madridToday(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
    assert.equal(madridToday(new Date("2026-01-15T22:30:00Z")), "2026-01-15");
    assert.equal(madridToday(new Date("2026-01-15T23:00:00Z")), "2026-01-16");
  });
  it("madridYearMonth cruza el mes y el año por el reloj de Madrid, y da números (no texto)", () => {
    assert.deepEqual(madridYearMonth(new Date("2026-08-31T22:30:00Z")), { year: 2026, month: 9 });
    assert.deepEqual(madridYearMonth(new Date("2026-12-31T23:30:00Z")), { year: 2027, month: 1 });
    assert.deepEqual(madridYearMonth(new Date("2026-12-31T22:30:00Z")), { year: 2026, month: 12 });
  });
  it("sin argumento usan el reloj de ahora: YYYY-MM-DD y { year, month } coherentes entre sí", () => {
    const hoy = madridToday();
    assert.match(hoy, /^\d{4}-\d{2}-\d{2}$/);
    const { year, month } = madridYearMonth();
    assert.equal(typeof year, "number");
    assert.ok(month >= 1 && month <= 12);
    assert.ok(year >= 2026);
  });
  it("una Date inválida, o un texto en vez de Date, no devuelve basura: revienta con RangeError", () => {
    // Intl no formatea NaN. Mejor un error a la cara que un «hoy» inventado en la bandeja.
    assert.throws(() => madridToday(new Date("x")), RangeError);
    assert.throws(() => madridToday("2026-08-19"), RangeError);
    assert.throws(() => madridYearMonth(new Date("x")), RangeError);
    assert.throws(() => madridDayRange(new Date("x")), RangeError);
  });
});

describe("madridDayRange: de la medianoche de Madrid a la siguiente, como instantes reales", () => {
  it("un día de verano: [22:00Z de la víspera, 22:00Z de hoy), 24 h", () => {
    const { start, end } = madridDayRange(new Date("2026-08-19T10:00:00Z"));
    assert.equal(ISO(start), "2026-08-18T22:00:00.000Z");
    assert.equal(ISO(end), "2026-08-19T22:00:00.000Z");
    assert.equal((end - start) / HORA, 24);
  });
  it("un día de invierno: [23:00Z de la víspera, 23:00Z de hoy)", () => {
    const { start, end } = madridDayRange(new Date("2026-01-15T10:00:00Z"));
    assert.equal(ISO(start), "2026-01-14T23:00:00.000Z");
    assert.equal(ISO(end), "2026-01-15T23:00:00.000Z");
  });
  it("a las 23:59:59 de Madrid sigue siendo hoy; a las 00:00:00 ya es mañana", () => {
    const tarde = madridDayRange(new Date("2026-08-19T21:59:59Z"));
    assert.equal(ISO(tarde.start), "2026-08-18T22:00:00.000Z");
    const yaManana = madridDayRange(new Date("2026-08-19T22:00:00Z"));
    assert.equal(ISO(yaManana.start), "2026-08-19T22:00:00.000Z");
    assert.equal(ISO(yaManana.end), "2026-08-20T22:00:00.000Z");
  });
  it("el día del cambio a verano (29/03/2026) dura 23 h: empieza en +01:00 y acaba en +02:00", () => {
    const { start, end } = madridDayRange(new Date("2026-03-29T10:00:00Z"));
    assert.equal(ISO(start), "2026-03-28T23:00:00.000Z");
    assert.equal(ISO(end), "2026-03-29T22:00:00.000Z");
    assert.equal((end - start) / HORA, 23);
  });
  it("el día del cambio a invierno (25/10/2026) dura 25 h, y la hora repetida (00:30Z y 01:30Z) cae en el mismo día", () => {
    const { start, end } = madridDayRange(new Date("2026-10-25T10:00:00Z"));
    assert.equal(ISO(start), "2026-10-24T22:00:00.000Z");
    assert.equal(ISO(end), "2026-10-25T23:00:00.000Z");
    assert.equal((end - start) / HORA, 25);
    assert.equal(
      ISO(madridDayRange(new Date("2026-10-25T00:30:00Z")).start),
      "2026-10-24T22:00:00.000Z"
    );
    assert.equal(
      ISO(madridDayRange(new Date("2026-10-25T01:30:00Z")).start),
      "2026-10-24T22:00:00.000Z"
    );
  });
  it("la víspera del cambio a verano acaba justo donde empieza el día corto, y el día largo donde empieza el siguiente: sin huecos ni solapes", () => {
    const vispera = madridDayRange(new Date("2026-03-28T12:00:00Z"));
    const corto = madridDayRange(new Date("2026-03-29T12:00:00Z"));
    assert.equal(ISO(vispera.end), ISO(corto.start));
    assert.equal((vispera.end - vispera.start) / HORA, 24);
    const largo = madridDayRange(new Date("2026-10-25T12:00:00Z"));
    const siguiente = madridDayRange(new Date("2026-10-26T12:00:00Z"));
    assert.equal(ISO(largo.end), ISO(siguiente.start));
    assert.equal((siguiente.end - siguiente.start) / HORA, 24);
  });
  it("sin argumento: ahora cae dentro del rango y el día dura 23, 24 o 25 h", () => {
    const ahora = new Date();
    const { start, end } = madridDayRange();
    assert.ok(start instanceof Date && end instanceof Date);
    assert.ok(start <= ahora && ahora < end, `${ISO(start)} <= ${ISO(ahora)} < ${ISO(end)}`);
    assert.ok([23, 24, 25].includes((end - start) / HORA));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * lib/billing/invoiceStatus.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("effectiveStatus: emitida, sin cobrar del todo y con el vencimiento pasado → vencida", () => {
  it("issued, sent y partially_paid pasan a overdue al día siguiente del vencimiento", () => {
    for (const status of ["issued", "sent", "partially_paid"]) {
      assert.equal(effectiveStatus(facturaVencida({ status }), "2026-08-20"), "overdue", status);
    }
  });
  it("el MISMO día del vencimiento aún no está vencida; la víspera tampoco", () => {
    assert.equal(effectiveStatus(facturaVencida(), "2026-08-19"), "issued");
    assert.equal(effectiveStatus(facturaVencida(), "2026-08-18"), "issued");
  });
  it("cobrada entera no vence aunque siga en issued; con 0,0049 € de margen por redondeo", () => {
    assert.equal(effectiveStatus(facturaVencida({ paidAmount: 100 }), "2026-08-20"), "issued");
    assert.equal(effectiveStatus(facturaVencida({ paidAmount: 99.996 }), "2026-08-20"), "issued");
    assert.equal(effectiveStatus(facturaVencida({ paidAmount: 99.99 }), "2026-08-20"), "overdue");
    assert.equal(effectiveStatus(facturaVencida({ paidAmount: 150 }), "2026-08-20"), "issued");
  });
  it("importes como texto (DECIMAL de la base) se comparan como números", () => {
    assert.equal(
      effectiveStatus(facturaVencida({ total: "100.00", paidAmount: "99.99" }), "2026-08-20"),
      "overdue"
    );
    assert.equal(
      effectiveStatus(facturaVencida({ total: "100.00", paidAmount: "100.00" }), "2026-08-20"),
      "issued"
    );
  });
  it("una factura de 0 € o sin total nunca vence; sin paidAmount se cuenta como 0 cobrado", () => {
    assert.equal(
      effectiveStatus(facturaVencida({ total: 0, paidAmount: 0 }), "2026-08-20"),
      "issued"
    );
    assert.equal(
      effectiveStatus(facturaVencida({ total: null, paidAmount: null }), "2026-08-20"),
      "issued"
    );
    assert.equal(effectiveStatus(facturaVencida({ paidAmount: null }), "2026-08-20"), "overdue");
    assert.equal(
      effectiveStatus(facturaVencida({ paidAmount: undefined }), "2026-08-20"),
      "overdue"
    );
  });
  it("sin fecha de vencimiento no hay nada que vencer", () => {
    assert.equal(effectiveStatus(facturaVencida({ dueDate: null }), "2026-08-20"), "issued");
    assert.equal(effectiveStatus(facturaVencida({ dueDate: "" }), "2026-08-20"), "issued");
    assert.equal(effectiveStatus(facturaVencida({ dueDate: undefined }), "2026-08-20"), "issued");
  });
  it("los estados terminales o sin emitir se devuelven tal cual aunque estén vencidos y sin cobrar", () => {
    for (const status of ["cancelled", "rectified", "draft", "paid"]) {
      assert.equal(effectiveStatus(facturaVencida({ status }), "2026-08-20"), status);
    }
  });
  it("el overdue persistido a mano prevalece, incluso si ya está cobrada o aún no ha vencido", () => {
    assert.equal(
      effectiveStatus(facturaVencida({ status: "overdue", paidAmount: 100 }), "2026-08-20"),
      "overdue"
    );
    assert.equal(effectiveStatus(facturaVencida({ status: "overdue" }), "2026-08-01"), "overdue");
  });
  it("un estado desconocido o ausente se devuelve tal cual, sin calcular nada", () => {
    assert.equal(effectiveStatus(facturaVencida({ status: "pending" }), "2026-08-20"), "pending");
    assert.equal(effectiveStatus(facturaVencida({ status: undefined }), "2026-08-20"), undefined);
  });
  it("sin factura devuelve undefined", () => {
    assert.equal(effectiveStatus(null), undefined);
    assert.equal(effectiveStatus(undefined), undefined);
  });
  it("«hoy» puede venir como YYYY-MM-DD, como ISO con hora (se queda con el día) o como Date", () => {
    assert.equal(effectiveStatus(facturaVencida(), "2026-08-20"), "overdue");
    assert.equal(effectiveStatus(facturaVencida(), "2026-08-20T09:15:00.000Z"), "overdue");
    assert.equal(effectiveStatus(facturaVencida(), "2026-08-19T23:59:59.000Z"), "issued");
    assert.equal(effectiveStatus(facturaVencida(), new Date("2026-08-20T09:15:00Z")), "overdue");
  });
  it("sin «hoy» (como lo llaman los endpoints), o con uno que no es ni Date ni texto, se usa el reloj de ahora", () => {
    const pasada = facturaVencida({ dueDate: "2000-01-01" });
    const futura = facturaVencida({ dueDate: "2999-12-31" });
    assert.equal(effectiveStatus(pasada), "overdue");
    assert.equal(effectiveStatus(futura), "issued");
    assert.equal(effectiveStatus(pasada, null), "overdue");
    assert.equal(effectiveStatus(pasada, 12345), "overdue");
    assert.equal(withEffectiveStatus(pasada).status, "overdue");
    assert.deepEqual(
      withEffectiveStatusList([pasada, futura]).map((f) => f.status),
      ["overdue", "issued"]
    );
  });
  it("un «hoy» vacío («») NO cae al reloj: se compara con «» y ningún día es anterior, así que nunca vence", () => {
    // SOSPECHOSO (menor): null y número caen a `new Date()`, pero «» es string y se queda como
    // «»; `"2000-01-01" < ""` es false. Nadie pasa «» hoy (los endpoints no pasan nada), se deja dicho.
    assert.equal(effectiveStatus(facturaVencida({ dueDate: "2000-01-01" }), ""), "issued");
  });
  it("un dueDate con hora (ISO) también se compara por su día", () => {
    assert.equal(
      effectiveStatus(facturaVencida({ dueDate: "2026-08-19T10:00:00.000Z" }), "2026-08-20"),
      "overdue"
    );
    assert.equal(
      effectiveStatus(facturaVencida({ dueDate: "2026-08-20T10:00:00.000Z" }), "2026-08-20"),
      "issued"
    );
  });
  it("cuando «hoy» es una Date, el día es el de UTC y no el de Madrid: a las 00:30 de Madrid la factura de ayer aún no vence", () => {
    // SOSPECHOSO: `todayIsoDate` usa `toISOString()`, que es UTC. Da lo mismo en qué zona corra el
    // proceso (por eso este `it` pasa igual con TZ=UTC), pero entre las 00:00 y las 02:00 de Madrid
    // en verano (01:00 en invierno) una factura que venció ayer sigue sin salir como vencida: el
    // día de negocio es el de Madrid (`madridToday` existe para eso). Dos horas de retraso, nada más.
    const madrugadaDel20 = new Date("2026-08-19T22:30:00Z"); // 00:30 del 20/08 en Madrid
    assert.equal(effectiveStatus(facturaVencida(), madrugadaDel20), "issued");
    assert.equal(effectiveStatus(facturaVencida(), new Date("2026-08-20T00:00:00Z")), "overdue");
  });
  it("un dueDate que llegue como Date nunca vence (se compara «Wed Aug 19» con «2026-08-20»)", () => {
    // SOSPECHOSO: `String(dueDate).slice(0, 10)` de una Date es «Wed Aug 19», y una letra siempre
    // es «mayor» que un dígito al comparar texto, así que nunca es < hoy. En el modelo `dueDate` es
    // DATEONLY (llega como texto), por eso no muerde; pero `today` sí acepta Date y `dueDate` no.
    const comoDate = facturaVencida({ dueDate: new Date("2026-08-01T12:00:00Z") });
    assert.equal(effectiveStatus(comoDate, "2026-08-20"), "issued");
    assert.equal(effectiveStatus(comoDate, "2030-01-01"), "issued");
  });
});

describe("withEffectiveStatus / withEffectiveStatusList: objeto plano con el status reescrito, sin tocar el original", () => {
  it("de un objeto plano devuelve una copia con status efectivo y deja el original como estaba", () => {
    const original = facturaVencida();
    const json = withEffectiveStatus(original, "2026-08-20");
    assert.equal(json.status, "overdue");
    assert.equal(original.status, "issued");
    assert.notEqual(json, original);
    assert.deepEqual(json, { ...original, status: "overdue" });
  });
  it("si no vence, el status se queda igual (pero sigue siendo una copia)", () => {
    const original = facturaVencida({ paidAmount: 100 });
    const json = withEffectiveStatus(original, "2026-08-20");
    assert.equal(json.status, "issued");
    assert.notEqual(json, original);
  });
  it("de una instancia con toJSON() usa lo que devuelve toJSON (campos incluidos)", () => {
    const instancia = {
      status: "issued",
      toJSON() {
        return { ...facturaVencida(), numero: "F-2026-0001" };
      },
    };
    const json = withEffectiveStatus(instancia, "2026-08-20");
    assert.equal(json.status, "overdue");
    assert.equal(json.numero, "F-2026-0001");
    assert.equal(typeof json.toJSON, "undefined");
  });
  it("null y undefined salen como entran", () => {
    assert.equal(withEffectiveStatus(null), null);
    assert.equal(withEffectiveStatus(undefined), undefined);
  });
  it("la lista: una por una, en el mismo orden, sin tocar los originales", () => {
    const lista = [
      facturaVencida(),
      facturaVencida({ status: "paid" }),
      facturaVencida({ paidAmount: 100 }),
    ];
    const salida = withEffectiveStatusList(lista, "2026-08-20");
    assert.deepEqual(
      salida.map((f) => f.status),
      ["overdue", "paid", "issued"]
    );
    assert.deepEqual(
      lista.map((f) => f.status),
      ["issued", "paid", "issued"]
    );
    assert.equal(salida.length, 3);
  });
  it("lista vacía → []; null → null; undefined → undefined", () => {
    assert.deepEqual(withEffectiveStatusList([], "2026-08-20"), []);
    assert.equal(withEffectiveStatusList(null), null);
    assert.equal(withEffectiveStatusList(undefined), undefined);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * lib/training/parseDate.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("parseFlexibleDate con texto: ISO, DD-MM-AAAA y DD/MM/AAAA, el día va DELANTE", () => {
  it("AAAA-MM-DD, DD-MM-AAAA y DD/MM/AAAA dan el mismo día", () => {
    assert.equal(dia("1985-05-12"), "1985-05-12");
    assert.equal(dia("12-05-1985"), "1985-05-12");
    assert.equal(dia("12/05/1985"), "1985-05-12");
  });
  it("«05-12-1985» es el 5 de diciembre, no el 12 de mayo (por eso no se usa new Date(str))", () => {
    assert.equal(dia("05-12-1985"), "1985-12-05");
    assert.equal(dia("05/12/1985"), "1985-12-05");
  });
  it("las barras se normalizan a guiones también en ISO, y el día o el mes pueden ir sin cero", () => {
    assert.equal(dia("1985/05/12"), "1985-05-12");
    assert.equal(dia("1985-5-12"), "1985-05-12");
    assert.equal(dia("5-1-1985"), "1985-01-05");
    assert.equal(dia("5/1/1985"), "1985-01-05");
  });
  it("los espacios de los extremos no molestan", () => {
    assert.equal(dia("  12/05/1985  "), "1985-05-12");
  });
  it("la fecha devuelta es la medianoche UTC de ese día, sin hora", () => {
    const r = parseFlexibleDate("12/05/1985");
    assert.equal(r.ok, true);
    assert.ok(r.date instanceof Date);
    assert.equal(r.date.toISOString(), "1985-05-12T00:00:00.000Z");
  });
  it("bisiestos: el 29/02/2024 existe; el 29/02/2023, el 31/02 y el 31/04 no", () => {
    assert.equal(dia("2024-02-29"), "2024-02-29");
    assert.equal(dia("29-02-2023"), "fecha_inexistente");
    assert.equal(dia("31-02-2024"), "fecha_inexistente");
    assert.equal(dia("31/04/2024"), "fecha_inexistente");
    assert.equal(dia("2024-2-30"), "fecha_inexistente");
  });
  it("el orden de los motivos: año fuera de rango antes que mes, mes antes que día", () => {
    assert.equal(dia("32-13-1899"), "ano_fuera_de_rango");
    assert.equal(dia("32-13-2020"), "mes_invalido");
    assert.equal(dia("32-12-2020"), "dia_invalido");
    assert.equal(dia("00-05-1985"), "dia_invalido");
    assert.equal(dia("12-00-1985"), "mes_invalido");
  });
  it("los años van de 1900 a 2100, los dos incluidos", () => {
    assert.equal(dia("1900-01-01"), "1900-01-01");
    assert.equal(dia("2100-12-31"), "2100-12-31");
    assert.equal(dia("31-12-1899"), "ano_fuera_de_rango");
    assert.equal(dia("01-01-2101"), "ano_fuera_de_rango");
  });
  it("lo que no es uno de los tres formatos se rechaza: año de dos cifras, puntos, hora detrás, texto", () => {
    assert.equal(dia("12-05-85"), "formato_no_reconocido");
    assert.equal(dia("12.05.1985"), "formato_no_reconocido");
    assert.equal(dia("12-05-1985 10:00"), "formato_no_reconocido");
    assert.equal(dia("2024-02-29T00:00"), "formato_no_reconocido");
    assert.equal(dia("hola"), "formato_no_reconocido");
  });
  it("vacío, solo espacios, null y undefined son «vacio»", () => {
    assert.equal(dia(""), "vacio");
    assert.equal(dia("   "), "vacio");
    assert.equal(dia(null), "vacio");
    assert.equal(dia(undefined), "vacio");
  });
  it("un fallo devuelve { ok: false, reason } y nada más; un acierto { ok: true, date }", () => {
    assert.deepEqual(parseFlexibleDate("hola"), { ok: false, reason: "formato_no_reconocido" });
    assert.deepEqual(Object.keys(parseFlexibleDate("12/05/1985")).sort(), ["date", "ok"]);
  });
});

describe("parseFlexibleDate con Date y con serial de Excel", () => {
  it("una Date se lee por sus componentes UTC (así las construye ExcelJS)", () => {
    assert.equal(dia(new Date(Date.UTC(1990, 10, 23))), "1990-11-23");
    assert.equal(dia(new Date("1990-11-23T23:59:59.000Z")), "1990-11-23");
  });
  it("una Date inválida es «date_invalida», no «vacio»", () => {
    assert.equal(dia(new Date("x")), "date_invalida");
  });
  it("serial de Excel: 31092 → 14/02/1985, 45658 → 01/01/2025", () => {
    assert.equal(dia(31_092), "1985-02-14");
    assert.equal(dia(45_658), "2025-01-01");
  });
  it("un serial con decimales (fecha y hora en la celda) pierde la hora: medianoche UTC de ese día", () => {
    const r = parseFlexibleDate(45_658.75); // 01/01/2025 18:00
    assert.equal(r.ok, true);
    assert.equal(r.date.toISOString(), "2025-01-01T00:00:00.000Z");
  });
  it("desde el 01/03/1900 (serial 61) la fórmula coincide con Excel; antes hay un día de deriva, documentado", () => {
    assert.equal(dia(61), "1900-03-01");
    // Excel dice 28/02/1900 del 59 y del 60 el 29/02/1900 (que no existió); aquí 27 y 28. Y el serial 1
    // (01/01/1900 en Excel) cae en 1899 y se rechaza. Nadie nace antes de 1900 en este sistema.
    assert.equal(dia(60), "1900-02-28");
    assert.equal(dia(2), "1900-01-01");
    assert.equal(dia(1), "ano_fuera_de_rango");
  });
  it("serial 0, negativo, NaN o Infinity → serial_invalido; uno enorme → año fuera de rango", () => {
    assert.equal(dia(0), "serial_invalido");
    assert.equal(dia(-5), "serial_invalido");
    assert.equal(dia(NaN), "serial_invalido");
    assert.equal(dia(Infinity), "serial_invalido");
    assert.equal(dia(1_000_000), "ano_fuera_de_rango");
  });
  it("el último serial válido es el del 31/12/2100 (73415); el siguiente ya se rechaza", () => {
    assert.equal(dia(73_415), "2100-12-31");
    assert.equal(dia(73_416), "ano_fuera_de_rango");
  });
  it("boolean, objeto y array → tipo_no_soportado", () => {
    assert.equal(dia(true), "tipo_no_soportado");
    assert.equal(dia(false), "tipo_no_soportado");
    assert.equal(dia({}), "tipo_no_soportado");
    assert.equal(dia([]), "tipo_no_soportado");
  });
  it("los casos canónicos que el propio fichero lleva en _smokeTests() siguen todos en verde", () => {
    const resultados = _smokeTests();
    assert.ok(resultados.length >= 19);
    const rotos = resultados.filter((r) => !r.pass);
    assert.deepEqual(rotos, []);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Lo que SÍ mira el reloj del proceso
 * ══════════════════════════════════════════════════════════════════════════ */

describe("lo que depende de la zona del proceso (por eso el contenedor va en Europe/Madrid desde el 19/08/2026)", () => {
  // Estos `it` pasan en Madrid y en UTC, pero lo que sale es DISTINTO en cada una, y lo
  // dicen. Si alguien quita `TZ=Europe/Madrid` del compose, producción vuelve a la
  // columna UTC sin que ninguna otra prueba lo note.

  it("trimesterOf a las 00:30 de Madrid del 1 de septiembre: en Madrid es T1; en UTC aún es 31 de agosto y no es de nadie", () => {
    // SOSPECHOSO (por diseño): trimestres.js usa getMonth()/getFullYear() locales. En el
    // contenedor en UTC (hasta el 19/08/2026) una sesión de las 00:30 del 1 de septiembre caía
    // «fuera de trimestre»; con TZ=Europe/Madrid cae en T1, que es lo que el centro espera.
    const instante = new Date("2026-09-01T00:30:00+02:00"); // = 2026-08-31T22:30:00Z
    const off = instante.getTimezoneOffset();
    const esperado = off <= -90 ? "T1" : null; // Madrid (-120): T1 · UTC (0): null
    assert.equal(trimesterOf(instante)?.key ?? null, esperado);
    if (off === -120) assert.equal(trimesterOf(instante).key, "T1");
    if (off === 0) assert.equal(trimesterOf(instante), null);
  });

  it("trimesterRange da la medianoche LOCAL del proceso: en Madrid 22:00Z de la víspera, en UTC 00:00Z", () => {
    // Es el rango que va a la consulta de sesiones e informes ([start, end)). Con el contenedor
    // en UTC, una sesión de las 01:00 de Madrid del 1 de septiembre quedaba en el trimestre
    // anterior; con TZ=Europe/Madrid, en el suyo.
    const { start, end } = trimesterRange(trimestersOf(2026)[0]);
    assert.equal(start.getTime(), Date.UTC(2026, 8, 1) + start.getTimezoneOffset() * 60_000);
    assert.equal(end.getTime(), Date.UTC(2027, 0, 1) + end.getTimezoneOffset() * 60_000);
    const off = start.getTimezoneOffset();
    if (off === -120) assert.equal(ISO(start), "2026-08-31T22:00:00.000Z"); // Madrid, verano
    if (off === 0) assert.equal(ISO(start), "2026-09-01T00:00:00.000Z"); // UTC
  });

  it("parseFlexibleDate con una Date de medianoche LOCAL: en Madrid da el día anterior, en UTC el mismo", () => {
    // SOSPECHOSO: lee getUTC*(). Las Dates de ExcelJS vienen en UTC y van bien; pero una Date
    // construida con `new Date(año, mes, día)` en un proceso al este de Greenwich pierde un día.
    // Con el contenedor ahora en Madrid, cualquier llamada que construya la Date en local (hoy
    // ninguna) importaría la víspera.
    const local = new Date(1990, 10, 23);
    const esperado = local.getTimezoneOffset() < 0 ? "1990-11-22" : "1990-11-23";
    assert.equal(dia(local), esperado);
  });

  it("y lo que NO depende: la misma llamada a madridDayRange, effectiveStatus y parseFlexibleDate(texto) sale igual en cualquier zona", () => {
    // Los `describe` de arriba ya lo demuestran al pasar dos veces; aquí queda dicho en una línea.
    assert.equal(
      ISO(madridDayRange(new Date("2026-08-19T10:00:00Z")).start),
      "2026-08-18T22:00:00.000Z"
    );
    assert.equal(effectiveStatus(facturaVencida(), new Date("2026-08-20T00:00:00Z")), "overdue");
    assert.equal(dia("01/09/2026"), "2026-09-01");
    assert.equal(dia(46_266), "2026-09-01");
  });
});
