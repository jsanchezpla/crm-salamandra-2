// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-slots.mjs — los huecos de la agenda y el offset de Madrid salen
 * IGUAL sea cual sea la zona horaria del servidor (19/08/2026).
 *
 *   node scripts/_smoke-citas-slots.mjs
 *   node --test-name-pattern="offset" scripts/_smoke-citas-slots.mjs
 *   TZ=UTC node scripts/_smoke-citas-slots.mjs      ← tiene que salir lo mismo
 *
 * Prueba `lib/citas/slots.js`: la generación de huecos de la reserva pública y
 * la resolución del offset de Madrid (+01:00 invierno / +02:00 verano) con
 * `Intl.DateTimeFormat`.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El 19/08/2026 se puso `TZ=Europe/Madrid` en el contenedor de producción
 * (commit 8d89d70): hasta ese día el servidor corría en UTC y 42 ficheros que
 * usan fechas locales sin zona iban una o dos horas por detrás. Las citas NO
 * estaban entre ellos, y esta prueba fija por qué: `slots.js` no usa la zona
 * del proceso. Resuelve el offset real de Madrid con `Intl` y construye los
 * instantes con `Date.UTC`, así que el widget ofrecía las 9:00 a las 9:00 con
 * el contenedor en UTC y las sigue ofreciendo a las 9:00 en Madrid.
 *
 * Lo que se rompería si alguien «simplificara» esto con `new Date(y, m, d, h)`
 * o `getHours()`: en local (Madrid) seguiría funcionando, y en cualquier
 * máquina en otra zona —un contenedor sin TZ, un CI, el portátil de alguien—
 * el widget ofrecería huecos una o dos horas desplazados, o el día de la semana
 * equivocado a partir de las 22:00 UTC. Por eso:
 *
 *   · cada `it` escribe los instantes en UTC (`…Z`) o con offset explícito y
 *     compara lo que DEVUELVE la función, nunca `getHours()` del proceso;
 *   · un bloque final lanza la misma lib en procesos hijos con TZ=UTC, Tokio,
 *     Los Ángeles y Kiritimati (+14, la zona más extrema) y exige la MISMA
 *     huella que el proceso padre: es la prueba de fuego de «no depende de la
 *     zona», y corre en cada `npm test` sin que nadie tenga que acordarse de
 *     lanzarla con TZ=UTC;
 *   · y quedan fijadas las reglas de los huecos: el bloque avanza de `duration`
 *     en `duration`, los descansos se RESTAN por dentro (Rodrigo, 07/08/2026;
 *     la smoke vieja `_smoke-descansos.mjs` lo cubre con `check()`), la
 *     antelación mínima, los solapes medio-abiertos, los festivos, el
 *     deduplicado, y que `dayHasAnySlot` dice lo mismo que el generador (si no,
 *     el mes pinta en verde un día sin huecos).
 *
 * Los `// SOSPECHOSO` son comportamientos de hoy que parecen fallos; se fijan
 * tal como salen y se apuntan aparte, no se arreglan desde una prueba.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as slots from "../lib/citas/slots.js";

const {
  getMadridDayOfWeek,
  getMadridParts,
  buildMadridDate,
  madridOffsetString,
  formatMadridTime,
  timeStrToMinutes,
  parseISODate,
  pickAvailabilitiesForEventType,
  desfaseDeInicio,
  duracionDeContacto,
  generateSlotsForDay,
  dayHasAnySlot,
  getMadridTodayMidnight,
  toMadridISOString,
  MADRID_TIMEZONE,
} = slots;

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── Utilidades ──────────────────────────────────────────────────────────── */

const en = (iso) => new Date(iso);
const iso = (date) => date.toISOString();

/** Un tipo de cita de 60 minutos sin descansos ni antelación; se le cambia lo que toque. */
const tipo = (extra = {}) => ({
  duration: 60,
  bufferBefore: 0,
  bufferAfter: 0,
  minNoticeHours: 0,
  ...extra,
});

// Un miércoles de verano y otro de invierno, ambos lejos de cualquier «ahora».
const VERANO = { year: 2027, month: 7, day: 14 }; // 14/07/2027, Madrid +02:00
const INVIERNO = { year: 2027, month: 1, day: 14 }; // 14/01/2027, Madrid +01:00
// Un «ahora» anterior a los dos días: la antelación mínima no recorta nada.
const ANTES = en("2027-01-01T00:00:00Z");

const tramo = (startTime, endTime) => ({ startTime, endTime });

/** Huecos de un día; devuelve los objetos enteros (time + datetime). */
function huecos({
  eventType = tipo(),
  availabilities = [tramo("09:00", "13:00")],
  date = VERANO,
  existingBookings = [],
  now = ANTES,
  blockedDates = null,
} = {}) {
  return generateSlotsForDay({
    eventType,
    availabilities,
    date,
    existingBookings,
    now,
    blockedDates,
  });
}

/** Solo las horas («09:00», «10:00»…), que es lo que se lee de un vistazo. */
const horas = (opts) => huecos(opts).map((s) => s.time);

/* ── getMadridParts / formatMadridTime ───────────────────────────────────── */

describe("getMadridParts / formatMadridTime: las componentes locales de Madrid de un instante", () => {
  it("en verano, las 10:00 UTC son las 12:00 de Madrid (+02:00)", () => {
    assert.deepEqual(getMadridParts(en("2026-08-19T10:00:00Z")), {
      year: 2026,
      month: 8,
      day: 19,
      hour: 12,
      minute: 0,
      second: 0,
    });
  });

  it("en invierno, las 10:00 UTC son las 11:00 de Madrid (+01:00)", () => {
    assert.deepEqual(getMadridParts(en("2026-01-15T10:00:00Z")), {
      year: 2026,
      month: 1,
      day: 15,
      hour: 11,
      minute: 0,
      second: 0,
    });
  });

  it("las 22:00 UTC de un día de verano ya son las 00:00 del día SIGUIENTE en Madrid (hora 0, nunca 24)", () => {
    assert.deepEqual(getMadridParts(en("2026-08-19T22:00:00Z")), {
      year: 2026,
      month: 8,
      day: 20,
      hour: 0,
      minute: 0,
      second: 0,
    });
    assert.deepEqual(getMadridParts(en("2026-08-19T21:59:59Z")), {
      year: 2026,
      month: 8,
      day: 19,
      hour: 23,
      minute: 59,
      second: 59,
    });
  });

  it("formatMadridTime da «HH:MM» local con ceros por delante", () => {
    assert.equal(formatMadridTime(en("2026-08-19T07:05:00Z")), "09:05");
    assert.equal(formatMadridTime(en("2026-08-19T22:00:00Z")), "00:00");
    assert.equal(formatMadridTime(en("2026-12-01T23:30:00Z")), "00:30");
  });
});

/* ── getMadridDayOfWeek ──────────────────────────────────────────────────── */

describe("getMadridDayOfWeek: el día de la semana es el de Madrid, no el de UTC", () => {
  it("un domingo a las 21:30 UTC de agosto sigue siendo domingo (0)", () => {
    assert.equal(getMadridDayOfWeek(en("2026-08-16T21:30:00Z")), 0);
  });

  it("el mismo domingo a las 22:30 UTC ya es lunes (1) en Madrid: +02:00", () => {
    assert.equal(getMadridDayOfWeek(en("2026-08-16T22:30:00Z")), 1);
  });

  it("en invierno el salto es una hora más tarde: 22:30 UTC domingo, 23:30 UTC lunes", () => {
    assert.equal(getMadridDayOfWeek(en("2026-01-18T22:30:00Z")), 0);
    assert.equal(getMadridDayOfWeek(en("2026-01-18T23:30:00Z")), 1);
  });

  it("sábado es 6, la convención de getDay()", () => {
    assert.equal(getMadridDayOfWeek(en("2026-08-22T12:00:00Z")), 6);
  });
});

/* ── buildMadridDate ─────────────────────────────────────────────────────── */

describe("buildMadridDate: el instante UTC que corresponde a una hora local de Madrid", () => {
  it("las 9:00 de un día de verano son las 07:00 UTC", () => {
    assert.equal(iso(buildMadridDate(2026, 8, 19, 9, 0)), "2026-08-19T07:00:00.000Z");
  });

  it("las 9:00 de un día de invierno son las 08:00 UTC", () => {
    assert.equal(iso(buildMadridDate(2026, 1, 15, 9, 0)), "2026-01-15T08:00:00.000Z");
  });

  it("las 00:00 de Madrid caen en la VÍSPERA en UTC (22:00 en verano, 23:00 en invierno)", () => {
    assert.equal(iso(buildMadridDate(2026, 8, 19, 0, 0)), "2026-08-18T22:00:00.000Z");
    assert.equal(iso(buildMadridDate(2026, 1, 15, 0, 0)), "2026-01-14T23:00:00.000Z");
  });

  it("el día del cambio a verano (29/03/2026) las 9:00 ya son +02:00; la víspera, +01:00", () => {
    assert.equal(iso(buildMadridDate(2026, 3, 29, 9, 0)), "2026-03-29T07:00:00.000Z");
    assert.equal(iso(buildMadridDate(2026, 3, 28, 9, 0)), "2026-03-28T08:00:00.000Z");
  });

  it("el día del cambio a invierno (25/10/2026) las 9:00 ya son +01:00; la víspera, +02:00", () => {
    assert.equal(iso(buildMadridDate(2026, 10, 25, 9, 0)), "2026-10-25T08:00:00.000Z");
    assert.equal(iso(buildMadridDate(2026, 10, 24, 9, 0)), "2026-10-24T07:00:00.000Z");
  });

  it("ida y vuelta: las componentes Madrid del instante construido son las que se pidieron", () => {
    const casos = [
      [2026, 1, 15, 9, 0],
      [2026, 8, 19, 17, 30],
      [2026, 8, 19, 0, 0],
      [2026, 8, 19, 23, 59],
      [2026, 3, 29, 0, 30],
      [2026, 3, 29, 3, 0],
      [2026, 3, 29, 9, 0],
      [2026, 10, 25, 0, 30],
      [2026, 10, 25, 3, 0],
      [2026, 10, 25, 9, 0],
      [2026, 12, 31, 23, 0],
    ];
    for (const [year, month, day, hour, minute] of casos) {
      const d = buildMadridDate(year, month, day, hour, minute);
      assert.deepEqual(
        getMadridParts(d),
        { year, month, day, hour, minute, second: 0 },
        `pedí ${year}-${month}-${day} ${hour}:${minute}`
      );
    }
  });

  // SOSPECHOSO: el offset se resuelve con UNA sola pasada (el offset que tiene
  // Madrid en el instante «como si fuera UTC»). Para la 01:00–01:59 local de los
  // dos días de cambio de hora esa aproximación cae al otro lado del salto y el
  // resultado se desvía una hora: el 29/03 la 01:30 sale como las 00:30, y el
  // 25/10 la 01:30 sale como las 02:30. Ningún centro da cita a esa hora; se
  // fija lo que devuelve HOY para que, si alguien lo arregla, se vea aquí.
  it("SOSPECHOSO: la 01:30 local de los días de cambio de hora sale una hora desviada", () => {
    // 29/03/2026: la 01:30 CET existe y es 00:30 UTC; sale 23:30 UTC (= 00:30 CET).
    assert.equal(iso(buildMadridDate(2026, 3, 29, 1, 30)), "2026-03-28T23:30:00.000Z");
    assert.equal(formatMadridTime(buildMadridDate(2026, 3, 29, 1, 30)), "00:30");
    // 25/10/2026: la 01:30 CEST existe y es 23:30 UTC de la víspera; sale 00:30 UTC (= 02:30 CEST).
    assert.equal(iso(buildMadridDate(2026, 10, 25, 1, 30)), "2026-10-25T00:30:00.000Z");
    assert.equal(formatMadridTime(buildMadridDate(2026, 10, 25, 1, 30)), "02:30");
  });

  it("la hora que NO existe el 29/03 (02:30) y la que existe dos veces el 25/10 (02:30) dan un instante válido", () => {
    // 02:30 del 29/03 no existe: devuelve las 01:30 CET. Es una convención, no un fallo.
    assert.equal(iso(buildMadridDate(2026, 3, 29, 2, 30)), "2026-03-29T00:30:00.000Z");
    // 02:30 del 25/10 existe dos veces: devuelve la segunda (CET, +01:00).
    assert.equal(iso(buildMadridDate(2026, 10, 25, 2, 30)), "2026-10-25T01:30:00.000Z");
  });
});

/* ── madridOffsetString ──────────────────────────────────────────────────── */

describe("madridOffsetString: «+02:00» en verano, «+01:00» en invierno, y cambia en el instante exacto", () => {
  it("verano +02:00, invierno +01:00", () => {
    assert.equal(madridOffsetString(en("2026-08-19T10:00:00Z")), "+02:00");
    assert.equal(madridOffsetString(en("2026-01-15T10:00:00Z")), "+01:00");
  });

  it("el cambio a verano es a la 01:00 UTC del 29/03/2026: un segundo antes +01:00, en el instante +02:00", () => {
    assert.equal(madridOffsetString(en("2026-03-29T00:59:59Z")), "+01:00");
    assert.equal(madridOffsetString(en("2026-03-29T01:00:00Z")), "+02:00");
  });

  it("el cambio a invierno es a la 01:00 UTC del 25/10/2026: un segundo antes +02:00, en el instante +01:00", () => {
    assert.equal(madridOffsetString(en("2026-10-25T00:59:59Z")), "+02:00");
    assert.equal(madridOffsetString(en("2026-10-25T01:00:00Z")), "+01:00");
  });
});

/* ── toMadridISOString ───────────────────────────────────────────────────── */

describe("toMadridISOString: el ISO que ve el widget lleva hora Y offset de Madrid", () => {
  it("el ejemplo de la cabecera del fichero: 07:00 UTC → «2026-05-30T09:00:00+02:00»", () => {
    assert.equal(toMadridISOString(en("2026-05-30T07:00:00Z")), "2026-05-30T09:00:00+02:00");
  });

  it("en invierno, con segundos y +01:00", () => {
    assert.equal(toMadridISOString(en("2026-12-01T08:15:30Z")), "2026-12-01T09:15:30+01:00");
  });

  it("las 22:00 UTC de verano se escriben como las 00:00 del día siguiente", () => {
    assert.equal(toMadridISOString(en("2026-08-19T22:00:00Z")), "2026-08-20T00:00:00+02:00");
  });

  it("alrededor del cambio de hora, cada lado con su offset", () => {
    assert.equal(toMadridISOString(en("2026-03-29T00:59:59Z")), "2026-03-29T01:59:59+01:00");
    assert.equal(toMadridISOString(en("2026-03-29T01:00:00Z")), "2026-03-29T03:00:00+02:00");
    assert.equal(toMadridISOString(en("2026-10-25T00:59:59Z")), "2026-10-25T02:59:59+02:00");
    assert.equal(toMadridISOString(en("2026-10-25T01:00:00Z")), "2026-10-25T02:00:00+01:00");
  });

  it("ida y vuelta: new Date(iso) vuelve al MISMO instante, también en los días de cambio de hora", () => {
    for (const s of [
      "2026-01-15T10:00:00Z",
      "2026-08-19T22:00:00Z",
      "2026-03-29T00:59:59Z",
      "2026-03-29T01:00:00Z",
      "2026-10-25T00:59:59Z",
      "2026-10-25T01:00:00Z",
      "2026-10-25T01:30:00Z",
    ]) {
      const d = en(s);
      assert.equal(new Date(toMadridISOString(d)).getTime(), d.getTime(), s);
    }
  });

  it("lo que construye buildMadridDate se escribe tal como se pidió", () => {
    assert.equal(
      toMadridISOString(buildMadridDate(2026, 5, 30, 9, 0)),
      "2026-05-30T09:00:00+02:00"
    );
    assert.equal(
      toMadridISOString(buildMadridDate(2026, 12, 24, 18, 45)),
      "2026-12-24T18:45:00+01:00"
    );
  });
});

/* ── getMadridTodayMidnight ──────────────────────────────────────────────── */

describe("getMadridTodayMidnight: las 00:00 de HOY en Madrid, no las 00:00 de UTC", () => {
  it("a las 22:30 UTC de un 14 de julio ya es 15 de julio en Madrid: devuelve las 22:00 UTC del 14", () => {
    assert.equal(
      iso(getMadridTodayMidnight(en("2027-07-14T22:30:00Z"))),
      "2027-07-14T22:00:00.000Z"
    );
  });

  it("una hora antes (21:30 UTC) aún es 14 de julio: devuelve las 22:00 UTC del 13", () => {
    assert.equal(
      iso(getMadridTodayMidnight(en("2027-07-14T21:30:00Z"))),
      "2027-07-13T22:00:00.000Z"
    );
  });

  it("en invierno el salto está en las 23:00 UTC", () => {
    assert.equal(
      iso(getMadridTodayMidnight(en("2027-01-14T23:30:00Z"))),
      "2027-01-14T23:00:00.000Z"
    );
    assert.equal(
      iso(getMadridTodayMidnight(en("2027-01-14T22:30:00Z"))),
      "2027-01-13T23:00:00.000Z"
    );
  });

  it("sin argumento usa el reloj de verdad: son las 00:00 Madrid de hoy, no más de 24 h atrás", () => {
    const ahora = Date.now();
    const hoy = getMadridTodayMidnight();
    assert.equal(formatMadridTime(hoy), "00:00");
    assert.ok(hoy.getTime() <= ahora);
    assert.ok(ahora - hoy.getTime() < 24 * 60 * 60 * 1000);
  });
});

/* ── timeStrToMinutes ────────────────────────────────────────────────────── */

describe("timeStrToMinutes: «HH:MM» o «HH:MM:SS» a minutos desde medianoche", () => {
  it("«09:00» son 540; «09:30:00» (el TIME de la base) 570; «00:00» es 0", () => {
    assert.equal(timeStrToMinutes("09:00"), 540);
    assert.equal(timeStrToMinutes("09:30:00"), 570);
    assert.equal(timeStrToMinutes("00:00"), 0);
  });

  it("sin valor (null, undefined, «», 0) devuelve null, no revienta", () => {
    assert.equal(timeStrToMinutes(null), null);
    assert.equal(timeStrToMinutes(undefined), null);
    assert.equal(timeStrToMinutes(""), null);
    assert.equal(timeStrToMinutes(0), null);
  });

  it("sin dos puntos o sin números, null", () => {
    assert.equal(timeStrToMinutes("9"), null);
    assert.equal(timeStrToMinutes("ab:cd"), null);
  });

  it("es tolerante con el formato, no valida rangos: « 9:5» son 545, «24:00» son 1440, «09:60» son 600", () => {
    // Las horas vienen de un TIME de la base, ya válido; la validación de lo que
    // escribe el usuario vive en lib/citas/validation.js.
    assert.equal(timeStrToMinutes(" 9:5"), 545);
    assert.equal(timeStrToMinutes("24:00"), 1440);
    assert.equal(timeStrToMinutes("09:60"), 600);
  });
});

/* ── parseISODate ────────────────────────────────────────────────────────── */

describe("parseISODate: solo «YYYY-MM-DD», a { year, month, day }", () => {
  it("«2026-08-19» → { 2026, 8, 19 }", () => {
    assert.deepEqual(parseISODate("2026-08-19"), { year: 2026, month: 8, day: 19 });
  });

  it("sin ceros, con barras, con hora, null o un número: null", () => {
    assert.equal(parseISODate("2026-8-19"), null);
    assert.equal(parseISODate("19/08/2026"), null);
    assert.equal(parseISODate("2026-08-19T00:00"), null);
    assert.equal(parseISODate(null), null);
    assert.equal(parseISODate(undefined), null);
    assert.equal(parseISODate(20260819), null);
  });

  it("mes 0 o 13, día 0 o 32: null", () => {
    assert.equal(parseISODate("2026-00-10"), null);
    assert.equal(parseISODate("2026-13-01"), null);
    assert.equal(parseISODate("2026-08-00"), null);
    assert.equal(parseISODate("2026-08-32"), null);
  });

  // SOSPECHOSO: solo comprueba 1–31, no el calendario. «2026-02-30» pasa, y
  // buildMadridDate lo rueda al 2 de marzo: el endpoint público contestaría con
  // los huecos de otro día. El widget nunca pide un 30 de febrero, de ahí que no
  // se haya notado.
  it("SOSPECHOSO: «2026-02-30» pasa el filtro y buildMadridDate lo rueda al 2 de marzo", () => {
    assert.deepEqual(parseISODate("2026-02-30"), { year: 2026, month: 2, day: 30 });
    assert.equal(iso(buildMadridDate(2026, 2, 30, 9, 0)), "2026-03-02T08:00:00.000Z");
    // Lo mismo con los meses de 30 días: el 31 de abril son las 9:00 del 1 de mayo.
    assert.deepEqual(parseISODate("2026-04-31"), { year: 2026, month: 4, day: 31 });
    assert.equal(iso(buildMadridDate(2026, 4, 31, 9, 0)), "2026-05-01T07:00:00.000Z");
  });
});

/* ── pickAvailabilitiesForEventType ──────────────────────────────────────── */

describe("pickAvailabilitiesForEventType: las del tipo mandan; si no hay, las globales de ese día", () => {
  const disponibilidades = [
    { id: "g-lun", eventTypeId: null, dayOfWeek: 1, startTime: "09:00", endTime: "14:00" },
    { id: "g-mar", eventTypeId: null, dayOfWeek: 2, startTime: "09:00", endTime: "14:00" },
    { id: "et1-lun", eventTypeId: "et-1", dayOfWeek: 1, startTime: "16:00", endTime: "18:00" },
    { id: "et2-lun", eventTypeId: "et-2", dayOfWeek: 1, startTime: "10:00", endTime: "12:00" },
    {
      id: "sin-clave-mie",
      eventTypeId: undefined,
      dayOfWeek: 3,
      startTime: "10:00",
      endTime: "12:00",
    },
  ];
  const ids = (lista) => lista.map((a) => a.id);

  it("si el tipo tiene disponibilidad propia ese día, solo esa (la global se ignora)", () => {
    assert.deepEqual(ids(pickAvailabilitiesForEventType(disponibilidades, "et-1", 1)), ["et1-lun"]);
  });

  it("si el tipo no tiene nada ese día, las globales del día (no las propias de otro día)", () => {
    assert.deepEqual(ids(pickAvailabilitiesForEventType(disponibilidades, "et-1", 2)), ["g-mar"]);
  });

  it("un tipo sin disponibilidad propia usa las globales; las propias de OTRO tipo no cuentan", () => {
    assert.deepEqual(ids(pickAvailabilitiesForEventType(disponibilidades, "et-9", 1)), ["g-lun"]);
  });

  it("un día sin nada, lista vacía; con lista vacía, lista vacía", () => {
    assert.deepEqual(pickAvailabilitiesForEventType(disponibilidades, "et-9", 0), []);
    assert.deepEqual(pickAvailabilitiesForEventType([], "et-1", 1), []);
  });

  it("global es eventTypeId === null: una fila sin la clave (undefined) no cuenta como global", () => {
    assert.deepEqual(pickAvailabilitiesForEventType(disponibilidades, "et-9", 3), []);
  });
});

/* ── desfaseDeInicio / duracionDeContacto ────────────────────────────────── */

describe("desfaseDeInicio / duracionDeContacto: los descansos se RESTAN de la cita (Rodrigo, 07/08/2026)", () => {
  it("60 con 10 antes: la cita empieza 10 más tarde y dura 50", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: 10 })), 10);
    assert.equal(duracionDeContacto(tipo({ bufferBefore: 10 })), 50);
  });

  it("60 con 10 después: empieza en punto y dura 50", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferAfter: 10 })), 0);
    assert.equal(duracionDeContacto(tipo({ bufferAfter: 10 })), 50);
  });

  it("60 con 10 y 10: empieza a y 10 y dura 40", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: 10, bufferAfter: 10 })), 10);
    assert.equal(duracionDeContacto(tipo({ bufferBefore: 10, bufferAfter: 10 })), 40);
  });

  it("si los descansos se comen el bloque (suman lo mismo o más que la duración) se ignoran: desfase 0 y la cita entera", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: 40, bufferAfter: 40 })), 0);
    assert.equal(duracionDeContacto(tipo({ bufferBefore: 40, bufferAfter: 40 })), 60);
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: 60 })), 0);
    assert.equal(duracionDeContacto(tipo({ bufferBefore: 60 })), 60);
  });

  it("59 de 60 todavía vale: desfase 59 y un minuto de cita (el límite es «igual o más»)", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: 59 })), 59);
    assert.equal(duracionDeContacto(tipo({ bufferBefore: 59 })), 1);
  });

  it("negativos cuentan como cero", () => {
    assert.equal(desfaseDeInicio(tipo({ bufferBefore: -10 })), 0);
    assert.equal(duracionDeContacto(tipo({ bufferAfter: -5 })), 60);
  });

  it("tipos viejos sin los campos: sin desfase y la duración entera", () => {
    assert.equal(desfaseDeInicio({ duration: 45 }), 0);
    assert.equal(duracionDeContacto({ duration: 45 }), 45);
  });

  it("los valores en texto («60», «10») se leen como números; lo que no es número vale cero", () => {
    assert.equal(desfaseDeInicio({ duration: "60", bufferBefore: "10" }), 10);
    assert.equal(duracionDeContacto({ duration: "60", bufferBefore: "10", bufferAfter: "5" }), 45);
    assert.equal(desfaseDeInicio({ duration: 60, bufferBefore: "abc" }), 0);
  });

  it("sin tipo (null / undefined) no revienta: 0 y 0", () => {
    assert.equal(desfaseDeInicio(null), 0);
    assert.equal(duracionDeContacto(null), 0);
    assert.equal(desfaseDeInicio(undefined), 0);
    assert.equal(duracionDeContacto({ bufferBefore: 10 }), 0);
  });
});

/* ── generateSlotsForDay ─────────────────────────────────────────────────── */

describe("generateSlotsForDay: el bloque avanza de `duration` en `duration` dentro del horario", () => {
  it("60 minutos de 9:00 a 13:00 en verano: cuatro huecos, y el datetime es el instante UTC (+02:00)", () => {
    assert.deepEqual(huecos(), [
      { time: "09:00", datetime: "2027-07-14T07:00:00.000Z" },
      { time: "10:00", datetime: "2027-07-14T08:00:00.000Z" },
      { time: "11:00", datetime: "2027-07-14T09:00:00.000Z" },
      { time: "12:00", datetime: "2027-07-14T10:00:00.000Z" },
    ]);
  });

  it("el mismo horario en invierno: mismas horas, datetime una hora más tarde en UTC (+01:00)", () => {
    assert.deepEqual(huecos({ availabilities: [tramo("09:00", "11:00")], date: INVIERNO }), [
      { time: "09:00", datetime: "2027-01-14T08:00:00.000Z" },
      { time: "10:00", datetime: "2027-01-14T09:00:00.000Z" },
    ]);
  });

  it("una cita de 30 minutos de 9:00 a 10:00 da 9:00 y 9:30; una de 45, solo 9:00", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ duration: 30 }), availabilities: [tramo("09:00", "10:00")] }),
      ["09:00", "09:30"]
    );
    assert.deepEqual(
      horas({ eventType: tipo({ duration: 45 }), availabilities: [tramo("09:00", "10:00")] }),
      ["09:00"]
    );
  });

  it("el bloque que acaba JUSTO al cierre cabe; un minuto menos de horario y no cabe", () => {
    assert.deepEqual(horas({ availabilities: [tramo("09:00", "10:00")] }), ["09:00"]);
    assert.deepEqual(horas({ availabilities: [tramo("09:00", "09:59")] }), []);
  });

  it("acepta «HH:MM:SS», que es como llega el TIME de la base", () => {
    assert.deepEqual(horas({ availabilities: [tramo("09:00:00", "11:00:00")] }), [
      "09:00",
      "10:00",
    ]);
  });

  it("dos tramos en desorden salen ordenados por hora", () => {
    assert.deepEqual(
      horas({ availabilities: [tramo("16:00", "18:00"), tramo("09:00", "11:00")] }),
      ["09:00", "10:00", "16:00", "17:00"]
    );
  });

  it("dos tramos que se pisan no repiten el hueco del límite", () => {
    assert.deepEqual(
      horas({ availabilities: [tramo("09:00", "11:00"), tramo("10:00", "12:00")] }),
      ["09:00", "10:00", "11:00"]
    );
  });

  it("un tramo con hora nula se salta; uno que acaba antes de empezar no da huecos; sin tramos, nada", () => {
    assert.deepEqual(horas({ availabilities: [tramo(null, "11:00"), tramo("09:00", "10:00")] }), [
      "09:00",
    ]);
    assert.deepEqual(horas({ availabilities: [tramo("13:00", "09:00")] }), []);
    assert.deepEqual(horas({ availabilities: [] }), []);
  });

  it("una duración que no es un entero ≥ 1 (0, null, negativa, decimal, texto, undefined) no da huecos y no se cuelga", () => {
    // Hasta el 19/08/2026 con duration 0, null o negativa el bucle `m += duration`
    // no avanzaba y la función no terminaba nunca (bloqueaba el proceso entero de
    // Node); lo frenaban solo el modelo EventType (min 1) y los endpoints de
    // tipos. Ahora la lib se defiende sola: lista vacía antes de entrar al bucle.
    // Si alguien quita esa defensa, esta prueba no falla: se CUELGA. Es la señal.
    for (const duration of [0, null, -30, 1.5, NaN, "abc", undefined]) {
      assert.deepEqual(
        horas({ eventType: tipo({ duration }), availabilities: [tramo("09:00", "10:00")] }),
        [],
        `duration ${String(duration)}`
      );
    }
  });

  // SOSPECHOSO: `desfaseDeInicio` y `duracionDeContacto` leen «60» como 60
  // (Number), pero el bucle del generador usa `eventType.duration` tal cual:
  // con texto, `m + "60"` concatena («54060»), la condición falla y no sale ni
  // un hueco, en silencio. Del modelo (INTEGER) nunca llega texto; se fija por
  // si algún día alguien monta el tipo a mano desde un JSON.
  it("SOSPECHOSO: una duración en texto («60») no da huecos aunque los helpers de descansos sí la leen", () => {
    assert.deepEqual(horas({ eventType: tipo({ duration: "60" }) }), []);
    assert.equal(duracionDeContacto(tipo({ duration: "60" })), 60);
  });

  it("sin la lista de tramos o sin la de citas revienta con TypeError: los llamadores pasan SIEMPRE arrays", () => {
    assert.throws(
      () =>
        generateSlotsForDay({ eventType: tipo(), date: VERANO, existingBookings: [], now: ANTES }),
      TypeError
    );
    assert.throws(
      () =>
        generateSlotsForDay({
          eventType: tipo(),
          availabilities: [tramo("09:00", "10:00")],
          date: VERANO,
          now: ANTES,
        }),
      TypeError
    );
  });
});

describe("generateSlotsForDay: los descansos se restan POR DENTRO del bloque (Rodrigo, 07/08/2026)", () => {
  const centro = [tramo("17:00", "21:00")];

  it("sin descansos, de 17 a 21 salen 17, 18, 19 y 20", () => {
    assert.deepEqual(horas({ availabilities: centro }), ["17:00", "18:00", "19:00", "20:00"]);
  });

  it("10 minutos ANTES: empiezan a y 10 y siguen cayendo cada 60 (17:10, 18:10, 19:10, 20:10)", () => {
    assert.deepEqual(horas({ eventType: tipo({ bufferBefore: 10 }), availabilities: centro }), [
      "17:10",
      "18:10",
      "19:10",
      "20:10",
    ]);
  });

  it("10 minutos DESPUÉS: siguen empezando en punto (la cita acaba a y 50)", () => {
    assert.deepEqual(horas({ eventType: tipo({ bufferAfter: 10 }), availabilities: centro }), [
      "17:00",
      "18:00",
      "19:00",
      "20:00",
    ]);
  });

  it("el bloque sigue siendo de 60: en una hora de centro cabe UN hueco aunque la cita dure 50, y en 55 minutos ninguno", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ bufferBefore: 10 }), availabilities: [tramo("17:00", "18:00")] }),
      ["17:10"]
    );
    assert.deepEqual(
      horas({ eventType: tipo({ bufferBefore: 10 }), availabilities: [tramo("17:00", "17:55")] }),
      []
    );
  });

  it("descansos que se comen el bloque se ignoran y los huecos salen en punto", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ bufferBefore: 40, bufferAfter: 40 }), availabilities: centro }),
      ["17:00", "18:00", "19:00", "20:00"]
    );
  });

  it("el datetime del hueco es el de la CITA (con el desfase), no el del bloque", () => {
    const [primero] = huecos({ eventType: tipo({ bufferBefore: 10 }), availabilities: centro });
    assert.deepEqual(primero, { time: "17:10", datetime: "2027-07-14T15:10:00.000Z" });
  });
});

describe("generateSlotsForDay: la antelación mínima (minNoticeHours) se mide desde `now`", () => {
  const hoy = VERANO; // el día que se pide es «hoy»

  it("con 2 h de antelación y siendo las 8:30 de Madrid, las 9 y las 10 se caen; quedan 11 y 12", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ minNoticeHours: 2 }), now: en("2027-07-14T06:30:00Z"), date: hoy }),
      ["11:00", "12:00"]
    );
  });

  it("el hueco que cae EXACTAMENTE en el límite se ofrece (1 h a las 9:00 → las 10:00 sí)", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ minNoticeHours: 1 }), now: en("2027-07-14T07:00:00Z"), date: hoy }),
      ["10:00", "11:00", "12:00"]
    );
  });

  it("sin antelación, un segundo después de las 9:00 las 9:00 ya no se ofrecen", () => {
    assert.deepEqual(
      horas({ eventType: tipo({ minNoticeHours: 0 }), now: en("2027-07-14T07:00:01Z"), date: hoy }),
      ["10:00", "11:00", "12:00"]
    );
  });

  it("sin el campo (undefined o null) cuenta como 0 horas", () => {
    assert.deepEqual(
      horas({
        eventType: tipo({ minNoticeHours: undefined }),
        now: en("2027-07-14T08:30:00Z"),
        date: hoy,
      }),
      ["11:00", "12:00"]
    );
    assert.deepEqual(
      horas({
        eventType: tipo({ minNoticeHours: null }),
        now: en("2027-07-14T08:30:00Z"),
        date: hoy,
      }),
      ["11:00", "12:00"]
    );
  });

  it("un día ya pasado no da ningún hueco; 48 h de antelación pedidas 27 h antes, tampoco", () => {
    assert.deepEqual(horas({ now: en("2027-07-15T00:00:00Z"), date: hoy }), []);
    assert.deepEqual(
      horas({
        eventType: tipo({ minNoticeHours: 48 }),
        now: en("2027-07-13T06:00:00Z"),
        date: hoy,
      }),
      []
    );
  });

  it("sin `now` usa el reloj de verdad: un día de 2099 da huecos y uno de 2000 ninguno", () => {
    const sinAhora = (date) =>
      generateSlotsForDay({
        eventType: tipo(),
        availabilities: [tramo("09:00", "11:00")],
        date,
        existingBookings: [],
      });
    assert.equal(sinAhora({ year: 2099, month: 6, day: 10 }).length, 2);
    assert.equal(sinAhora({ year: 2000, month: 6, day: 10 }).length, 0);
  });
});

describe("generateSlotsForDay: una cita existente tapa los huecos que pisa, medio-abierto [inicio, fin)", () => {
  const cita = (scheduledAt, duration) => ({ scheduledAt, duration });

  it("una cita de 9:00 a 10:00 tapa las 9:00 y deja las 10:00 (acabar justo cuando empieza la otra no pisa)", () => {
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T07:00:00.000Z", 60)] }), [
      "10:00",
      "11:00",
      "12:00",
    ]);
  });

  it("da igual que scheduledAt venga como texto ISO, como Date o con offset «+02:00»", () => {
    assert.deepEqual(horas({ existingBookings: [cita(en("2027-07-14T07:00:00.000Z"), 60)] }), [
      "10:00",
      "11:00",
      "12:00",
    ]);
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T09:00:00+02:00", 60)] }), [
      "10:00",
      "11:00",
      "12:00",
    ]);
  });

  it("una cita de 9:30 a 10:30 tapa las 9:00 Y las 10:00", () => {
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T07:30:00.000Z", 60)] }), [
      "11:00",
      "12:00",
    ]);
  });

  it("una cita de 8:00 a 9:00 no toca nada; una que empieza a las 12:59 tapa las 12:00", () => {
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T06:00:00.000Z", 60)] }), [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T10:59:00.000Z", 60)] }), [
      "09:00",
      "10:00",
      "11:00",
    ]);
  });

  it("una cita de 8:00 a 13:00 tapa el día entero; sin citas, quedan todos", () => {
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T06:00:00.000Z", 300)] }), []);
    assert.deepEqual(horas({ existingBookings: [] }), ["09:00", "10:00", "11:00", "12:00"]);
  });

  it("una cita cuyo scheduledAt no es una fecha no tapa nada (Invalid Date no compara con nadie)", () => {
    assert.deepEqual(horas({ existingBookings: [cita("no-es-fecha", 60)] }), [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
  });

  it("una cita de duración 0 no pisa nada si empieza en el límite del hueco, y sí si cae dentro", () => {
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T07:00:00.000Z", 0)] }), [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
    assert.deepEqual(horas({ existingBookings: [cita("2027-07-14T07:30:00.000Z", 0)] }), [
      "10:00",
      "11:00",
      "12:00",
    ]);
  });

  it("con descansos, la cita OCUPA solo su tiempo de consulta: una de 17:50–18:00 no tapa el hueco de las 17:00 (que acaba a las 17:50)", () => {
    assert.deepEqual(
      horas({
        eventType: tipo({ bufferAfter: 10 }),
        availabilities: [tramo("17:00", "19:00")],
        existingBookings: [cita("2027-07-14T15:50:00Z", 10)],
      }),
      ["17:00", "18:00"]
    );
  });

  it("con 10 antes, una cita de 17:00–17:10 no tapa el hueco de las 17:10; y la cita de las 17:10 (50') tapa solo el suyo", () => {
    assert.deepEqual(
      horas({
        eventType: tipo({ bufferBefore: 10 }),
        availabilities: [tramo("17:00", "19:00")],
        existingBookings: [cita("2027-07-14T15:00:00Z", 10)],
      }),
      ["17:10", "18:10"]
    );
    assert.deepEqual(
      horas({
        eventType: tipo({ bufferBefore: 10 }),
        availabilities: [tramo("17:00", "21:00")],
        existingBookings: [cita("2027-07-14T15:10:00Z", 50)],
      }),
      ["18:10", "19:10", "20:10"]
    );
  });
});

describe("generateSlotsForDay: un día bloqueado del centro no da huecos, se mire el tipo que se mire", () => {
  it("si el día está en el Set de festivos, lista vacía", () => {
    assert.deepEqual(huecos({ blockedDates: new Set(["2027-07-14"]) }), []);
  });

  it("si el festivo es otro día, el Set está vacío o es null, los huecos salen", () => {
    assert.deepEqual(horas({ blockedDates: new Set(["2027-07-15"]) }), [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
    assert.deepEqual(horas({ blockedDates: new Set() }), ["09:00", "10:00", "11:00", "12:00"]);
    assert.deepEqual(horas({ blockedDates: null }), ["09:00", "10:00", "11:00", "12:00"]);
  });
});

describe("generateSlotsForDay: los días del cambio de hora", () => {
  const madrugada = en("2026-01-01T00:00:00Z");

  it("el 29/03/2026 (a verano) las 8, 9 y 10 ya son +02:00", () => {
    assert.deepEqual(
      huecos({
        availabilities: [tramo("08:00", "11:00")],
        date: { year: 2026, month: 3, day: 29 },
        now: madrugada,
      }),
      [
        { time: "08:00", datetime: "2026-03-29T06:00:00.000Z" },
        { time: "09:00", datetime: "2026-03-29T07:00:00.000Z" },
        { time: "10:00", datetime: "2026-03-29T08:00:00.000Z" },
      ]
    );
  });

  it("el 25/10/2026 (a invierno) las 8, 9 y 10 ya son +01:00", () => {
    assert.deepEqual(
      huecos({
        availabilities: [tramo("08:00", "11:00")],
        date: { year: 2026, month: 10, day: 25 },
        now: madrugada,
      }),
      [
        { time: "08:00", datetime: "2026-10-25T07:00:00.000Z" },
        { time: "09:00", datetime: "2026-10-25T08:00:00.000Z" },
        { time: "10:00", datetime: "2026-10-25T09:00:00.000Z" },
      ]
    );
  });

  // SOSPECHOSO: consecuencia de la pasada única de buildMadridDate (ver arriba).
  // Un horario de madrugada el 29/03 da dos huecos con DISTINTA hora y el MISMO
  // instante: «00:00» y «01:00» los dos a las 23:00 UTC. El deduplicado mira
  // `time`, así que los dos se ofrecen. Ningún centro abre a esa hora.
  it("SOSPECHOSO: un horario de 0 a 4 el 29/03 ofrece «00:00» y «01:00» con el mismo datetime", () => {
    assert.deepEqual(
      huecos({
        availabilities: [tramo("00:00", "04:00")],
        date: { year: 2026, month: 3, day: 29 },
        now: madrugada,
      }),
      [
        { time: "00:00", datetime: "2026-03-28T23:00:00.000Z" },
        { time: "01:00", datetime: "2026-03-28T23:00:00.000Z" },
        { time: "02:00", datetime: "2026-03-29T00:00:00.000Z" },
        { time: "03:00", datetime: "2026-03-29T01:00:00.000Z" },
      ]
    );
  });

  // SOSPECHOSO: la otra cara, el 25/10. Aquí no se repite ningún instante, pero
  // el hueco «01:00» sale a las 00:00 UTC, que en Madrid son las 02:00 CEST (la
  // 01:00 CEST es 23:00 UTC de la víspera). El «02:00» es la segunda de las dos
  // 02:00 del día (CET, +01:00): la convención de buildMadridDate para la hora
  // ambigua.
  it("SOSPECHOSO: un horario de 0 a 4 el 25/10 ofrece «01:00» con el instante de las 02:00 CEST", () => {
    assert.deepEqual(
      huecos({
        availabilities: [tramo("00:00", "04:00")],
        date: { year: 2026, month: 10, day: 25 },
        now: madrugada,
      }),
      [
        { time: "00:00", datetime: "2026-10-24T22:00:00.000Z" },
        { time: "01:00", datetime: "2026-10-25T00:00:00.000Z" },
        { time: "02:00", datetime: "2026-10-25T01:00:00.000Z" },
        { time: "03:00", datetime: "2026-10-25T02:00:00.000Z" },
      ]
    );
    assert.equal(formatMadridTime(en("2026-10-25T00:00:00.000Z")), "02:00");
  });
});

/* ── dayHasAnySlot ───────────────────────────────────────────────────────── */

describe("dayHasAnySlot: dice lo mismo que el generador, sin generar los huecos", () => {
  const hay = (opts = {}) =>
    dayHasAnySlot({
      eventType: tipo(),
      availabilities: [tramo("09:00", "10:00")],
      date: VERANO,
      existingBookings: [],
      now: ANTES,
      ...opts,
    });

  it("con un hueco libre, true", () => {
    assert.equal(hay(), true);
  });

  it("con el único hueco tapado por una cita, false", () => {
    assert.equal(
      hay({ existingBookings: [{ scheduledAt: "2027-07-14T07:00:00Z", duration: 60 }] }),
      false
    );
  });

  it("día bloqueado, false; sin disponibilidad, false; sin antelación suficiente, false", () => {
    assert.equal(hay({ blockedDates: new Set(["2027-07-14"]) }), false);
    assert.equal(hay({ availabilities: [] }), false);
    assert.equal(
      hay({ eventType: tipo({ minNoticeHours: 24 }), now: en("2027-07-14T00:00:00Z") }),
      false
    );
  });

  it("resta los descansos igual que el generador: 55 minutos de centro con cita de 60 y 10 antes, false", () => {
    assert.equal(
      hay({ eventType: tipo({ bufferBefore: 10 }), availabilities: [tramo("09:00", "09:55")] }),
      false
    );
  });

  it("con duración 0, null, negativa o en texto dice false, igual que el generador, aunque haya un hueco libre", () => {
    // Hasta el 19/08/2026 con duration 0 y el primer hueco libre decía `true` al
    // instante (sin recorrer nada) mientras el generador no terminaba nunca: el
    // mes pintaba en verde un día cuyo detalle colgaba el proceso. Y si ese
    // primer hueco estaba tapado, esta función tampoco terminaba. Ahora las dos
    // se paran ANTES del bucle y dicen lo mismo.
    for (const duration of [0, null, -30, 1.5, "abc", undefined]) {
      assert.equal(hay({ eventType: tipo({ duration }) }), false, `duration ${String(duration)}`);
    }
  });

  it("en una tabla de casos, true exactamente cuando generateSlotsForDay devuelve algo", () => {
    const casos = [
      {},
      { eventType: tipo({ duration: 0 }) },
      { eventType: tipo({ duration: null }) },
      { availabilities: [tramo("09:00", "09:59")] },
      { eventType: tipo({ bufferBefore: 10 }), availabilities: [tramo("17:00", "18:00")] },
      { eventType: tipo({ bufferBefore: 10 }), availabilities: [tramo("17:00", "17:55")] },
      { existingBookings: [{ scheduledAt: "2027-07-14T06:30:00Z", duration: 60 }] },
      { existingBookings: [{ scheduledAt: "2027-07-14T06:00:00Z", duration: 60 }] },
      { eventType: tipo({ minNoticeHours: 2 }), now: en("2027-07-14T06:30:00Z") },
      { eventType: tipo({ minNoticeHours: 2 }), now: en("2027-07-14T07:30:00Z") },
      { blockedDates: new Set(["2027-07-14"]) },
      { date: INVIERNO },
    ];
    for (const c of casos) {
      const base = {
        eventType: tipo(),
        availabilities: [tramo("09:00", "10:00")],
        date: VERANO,
        existingBookings: [],
        now: ANTES,
        blockedDates: null,
        ...c,
      };
      assert.equal(dayHasAnySlot(base), generateSlotsForDay(base).length > 0, JSON.stringify(c));
    }
  });
});

/* ── La prueba de fuego: otra zona horaria, la misma huella ──────────────── */

/**
 * Todo lo que devuelve la lib para un puñado de instantes y de días, en un solo
 * objeto. Se ejecuta en ESTE proceso y, serializada como texto, en procesos
 * hijos arrancados con otra TZ. Solo puede usar lo que recibe por parámetro:
 * viaja como `String(huella)` al hijo.
 */
function huella(m) {
  const instantes = [
    "2026-08-19T10:00:00Z",
    "2026-01-15T10:00:00Z",
    "2026-08-19T22:00:00Z",
    "2026-08-16T22:30:00Z",
    "2026-03-29T00:59:59Z",
    "2026-03-29T01:00:00Z",
    "2026-10-25T00:59:59Z",
    "2026-10-25T01:00:00Z",
  ].map((s) => new Date(s));
  const locales = [
    [2026, 8, 19, 9, 0],
    [2026, 1, 15, 9, 0],
    [2026, 8, 19, 0, 0],
    [2026, 3, 29, 9, 0],
    [2026, 10, 25, 9, 0],
    [2026, 12, 31, 23, 30],
  ];
  const tipoCita = { duration: 60, bufferBefore: 10, bufferAfter: 0, minNoticeHours: 24 };
  const horario = [
    { startTime: "09:00", endTime: "13:00" },
    { startTime: "16:00", endTime: "18:00" },
  ];
  const dia = (date, scheduledAt) => ({
    eventType: tipoCita,
    availabilities: horario,
    date,
    existingBookings: [{ scheduledAt, duration: 50 }],
    now: new Date("2026-01-01T00:00:00Z"),
    blockedDates: new Set(["2026-12-25"]),
  });
  return {
    partes: instantes.map((d) => m.getMadridParts(d)),
    diaSemana: instantes.map((d) => m.getMadridDayOfWeek(d)),
    offset: instantes.map((d) => m.madridOffsetString(d)),
    hora: instantes.map((d) => m.formatMadridTime(d)),
    isoMadrid: instantes.map((d) => m.toMadridISOString(d)),
    medianoche: instantes.map((d) => m.getMadridTodayMidnight(d).toISOString()),
    construidos: locales.map((c) => m.buildMadridDate(...c).toISOString()),
    verano: m.generateSlotsForDay(dia({ year: 2026, month: 8, day: 19 }, "2026-08-19T08:10:00Z")),
    invierno: m.generateSlotsForDay(dia({ year: 2026, month: 1, day: 15 }, "2026-01-15T09:10:00Z")),
    festivo: m.generateSlotsForDay(dia({ year: 2026, month: 12, day: 25 }, "2026-12-25T09:10:00Z")),
    hayHueco: [
      m.dayHasAnySlot(dia({ year: 2026, month: 8, day: 19 }, "2026-08-19T08:10:00Z")),
      m.dayHasAnySlot(dia({ year: 2026, month: 12, day: 25 }, "2026-12-25T09:10:00Z")),
    ],
  };
}

describe("la misma huella con TZ=UTC, Tokio, Los Ángeles y Kiritimati: nada depende de la zona del proceso", () => {
  const esperada = huella(slots);
  const libUrl = pathToFileURL(join(RAIZ, "lib", "citas", "slots.js")).href;
  const codigoHijo = [
    `import * as m from ${JSON.stringify(libUrl)};`,
    `const huella = ${String(huella)};`,
    `const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;`,
    `process.stdout.write(JSON.stringify({ zona, huella: huella(m) }));`,
  ].join("\n");

  it("la huella del propio proceso no está vacía y los huecos de verano salen en +02:00", () => {
    assert.equal(esperada.verano[0].time, "09:10");
    assert.equal(esperada.verano[0].datetime, "2026-08-19T07:10:00.000Z");
    assert.deepEqual(esperada.festivo, []);
    assert.deepEqual(esperada.hayHueco, [true, false]);
  });

  for (const zona of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    it(`un proceso hijo con TZ=${zona} devuelve exactamente lo mismo`, () => {
      // Entorno mínimo a propósito: solo TZ. Así el hijo no hereda nada del padre
      // y la zona que ve es la que se le pide, no la de la máquina.
      const hijo = spawnSync(process.execPath, ["--input-type=module", "-e", codigoHijo], {
        env: { TZ: zona },
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(hijo.status, 0, `el hijo falló: ${hijo.stderr || hijo.error}`);
      const { zona: vista, huella: obtenida } = JSON.parse(hijo.stdout);
      assert.equal(vista, zona, "el hijo no corre en la zona pedida: la prueba no probaría nada");
      assert.deepEqual(obtenida, JSON.parse(JSON.stringify(esperada)));
    });
  }
});

/* ── La constante ────────────────────────────────────────────────────────── */

describe("MADRID_TIMEZONE: toda la lib resuelve una sola zona, la del contenedor", () => {
  it("es «Europe/Madrid», la misma que lleva el servicio app en docker-compose.yml desde 8d89d70", () => {
    assert.equal(MADRID_TIMEZONE, "Europe/Madrid");
  });
});
