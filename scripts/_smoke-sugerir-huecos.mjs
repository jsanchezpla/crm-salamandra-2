// @prueba ligera — funciones puras de /lib y lectura de texto; sin base, sin servidor, sin .env.
/**
 * _smoke-sugerir-huecos.mjs — «Proponer 3 horarios» no ofrece horas bloqueadas,
 * y busca hueco con lo que dura LA CITA sin correr la rejilla (13/09/2026).
 *
 *   node scripts/_smoke-sugerir-huecos.mjs
 *   TZ=UTC node scripts/_smoke-sugerir-huecos.mjs     (tiene que dar lo mismo)
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * `POST /api/citas/bookings/[id]/suggest-slots` descontaba las citas y los
 * festivos, pero no leía `team_blocks`: en nutri_laura 7 de 143 candidatos
 * caían dentro de un bloqueo de la profesional, y 1 de las 3 tarjetas. Además
 * medía el hueco con la duración del TIPO, no con la de la cita (en Aumenta,
 * 152 citas futuras no duran lo que su tipo: un diagnóstico de 180 con un tipo
 * de 60 recibía horas en las que no cabía).
 *
 * ── LO QUE VIGILA ──────────────────────────────────────────────────────────
 *
 *   · ningún candidato pisa un bloqueo de su persona ni del centro (comprobado
 *     con una cuenta escrita AQUÍ, no con la lib que se prueba);
 *   · el bloqueo de otra persona no tapa nada;
 *   · un bloqueo corto no corre la rejilla (se trata como una cita, no se resta);
 *   · la rejilla es la del tipo y la longitud, la de la cita;
 *   · sin los parámetros nuevos, todo sale exactamente igual que antes (el
 *     widget público no los pasa).
 *
 * Instantes con offset explícito: da lo mismo con `TZ=UTC` que en Madrid.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Op } from "sequelize";
import { buildCandidates } from "../lib/citas/suggestSlots.js";
import { generateSlotsForDay } from "../lib/citas/slots.js";
import { cargarAusencias } from "../lib/citas/ausencias.js";
import {
  bloqueosQueAplican,
  bloqueosQueChocan,
  bloqueosComoOcupacion,
} from "../lib/citas/choqueConBloqueos.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

// ── Escenario ───────────────────────────────────────────────────────────────
// Domingo 13/09/2026, 10:00 en Madrid. El lunes 14 es el primer día que se mira.
const AHORA = new Date("2026-09-13T08:00:00Z");
const LUNES = { year: 2026, month: 9, day: 14 };
const TIPO = { id: 1, name: "Sesión", duration: 60 };

/** Ana trabaja el lunes de 9 a 14; Bea, de 15 a 19. */
const miembros = (bookingsA = []) => [
  { id: "A", name: "Ana", hours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "14:00" }], bookings: bookingsA },
  { id: "B", name: "Bea", hours: [{ dayOfWeek: 1, startTime: "15:00", endTime: "19:00" }], bookings: [] },
];

/** Un instante del lunes 14 en hora de Madrid (CEST, +02:00). */
const lunes = (hhmm) => `2026-09-14T${hhmm}:00+02:00`;
const bloqueo = (id, teamMemberId, desde, hasta, label = null) => ({ id, teamMemberId, startAt: desde, endAt: hasta, label });

const _hora = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hhmm = (iso) => _hora.format(new Date(iso));
const horasDe = (cands, id) => cands.filter((c) => c.teamMemberId === id).map((c) => hhmm(c.datetime));

const candidatos = (extra = {}) =>
  buildCandidates({ eventType: TIPO, members: miembros(), horizonDays: 1, now: AHORA, ...extra });

/**
 * ¿El candidato pisa el bloqueo? Cuenta escrita a mano, a propósito SIN la lib:
 * si `choqueConBloqueos.js` se equivocara, esta prueba no puede equivocarse con él.
 */
function pisaAMano(c, b, minutos) {
  if (b.teamMemberId != null && b.teamMemberId !== c.teamMemberId) return false;
  const a = Date.parse(c.datetime);
  const z = a + minutos * 60 * 1000;
  return Date.parse(b.startAt) < z && Date.parse(b.endAt) > a;
}

// ── El generador ────────────────────────────────────────────────────────────

describe("buildCandidates con bloqueos", () => {
  it("un bloqueo de Ana de 10 a 12 le quita esas horas, y ningún candidato lo pisa", () => {
    const b = bloqueo("b1", "A", lunes("10:00"), lunes("12:00"), "Vacaciones");
    const cands = candidatos({ bloqueos: [b] });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "12:00", "13:00"]);
    assert.deepEqual(horasDe(cands, "B"), ["15:00", "16:00", "17:00", "18:00"]);
    assert.equal(cands.filter((c) => pisaAMano(c, b, 60)).length, 0);
  });

  it("el bloqueo es semiabierto: de 10 a 11 quita solo las 10:00", () => {
    const cands = candidatos({ bloqueos: [bloqueo("b1", "A", lunes("10:00"), lunes("11:00"))] });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "11:00", "12:00", "13:00"]);
  });

  it("un bloqueo del centro tapa a las dos; el de otra persona, a ninguna", () => {
    const centro = bloqueo("c1", null, lunes("12:00"), lunes("16:00"), "Formación");
    const cands = candidatos({ bloqueos: [centro] });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "10:00", "11:00"]);
    assert.deepEqual(horasDe(cands, "B"), ["16:00", "17:00", "18:00"]);
    assert.equal(cands.filter((c) => pisaAMano(c, centro, 60)).length, 0);

    const deOtra = bloqueo("o1", "C", lunes("00:00"), lunes("23:59"));
    const todas = candidatos({ bloqueos: [deOtra] });
    assert.deepEqual(horasDe(todas, "A"), ["09:00", "10:00", "11:00", "12:00", "13:00"]);
    assert.deepEqual(horasDe(todas, "B"), ["15:00", "16:00", "17:00", "18:00"]);
  });

  it("la rejilla no se corre: un bloqueo de 15:30 a 15:45 solo quita las 15:00", () => {
    const cands = candidatos({ bloqueos: [bloqueo("b1", "B", lunes("15:30"), lunes("15:45"))] });
    assert.deepEqual(horasDe(cands, "B"), ["16:00", "17:00", "18:00"]);
    assert.ok(!horasDe(cands, "B").includes("15:45"));
  });

  it("un bloqueo de tres semanas que empezó el mes anterior deja a Ana sin nada", () => {
    const largo = bloqueo("v1", "A", "2026-08-30T00:00:00+02:00", "2026-09-20T00:00:00+02:00", "Vacaciones");
    const cands = buildCandidates({ eventType: TIPO, members: miembros(), horizonDays: 7, now: AHORA, bloqueos: [largo] });
    assert.equal(horasDe(cands, "A").length, 0);
    assert.deepEqual(horasDe(cands, "B"), ["15:00", "16:00", "17:00", "18:00"]);
  });

  it("citas y bloqueos se suman: cita de Ana a las 9 y bloqueo de 12 a 13", () => {
    const cita = { scheduledAt: new Date(lunes("09:00")), duration: 60 };
    const cands = buildCandidates({
      eventType: TIPO, members: miembros([cita]), horizonDays: 1, now: AHORA,
      bloqueos: [bloqueo("b1", "A", lunes("12:00"), lunes("13:00"))],
    });
    assert.deepEqual(horasDe(cands, "A"), ["10:00", "11:00", "13:00"]);
  });

  it("los bloqueos ilegibles o con el fin antes del inicio no tapan nada", () => {
    const cands = candidatos({
      bloqueos: [
        bloqueo("x1", "A", lunes("12:00"), lunes("10:00")),
        bloqueo("x2", "A", "no es fecha", lunes("11:00")),
        bloqueo("x3", "A", lunes("10:00"), null),
      ],
    });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "10:00", "11:00", "12:00", "13:00"]);
  });
});

describe("buildCandidates con la duración de la cita", () => {
  it("sin bloqueos ni duración sale lo mismo que generateSlotsForDay sin duracionCita", () => {
    const cands = candidatos();
    for (const m of miembros()) {
      const directas = generateSlotsForDay({ eventType: TIPO, availabilities: m.hours, date: LUNES, existingBookings: [], now: AHORA })
        .map((s) => s.datetime);
      assert.deepEqual(cands.filter((c) => c.teamMemberId === m.id).map((c) => c.datetime), directas);
    }
  });

  it("con la duración igual a la del tipo (y bloqueos vacíos) sale idéntico", () => {
    assert.deepEqual(candidatos({ duracion: 60, bloqueos: [] }), candidatos());
  });

  it("una cita de 180 con un tipo de 60: 9, 10 y 11 (paso de 60, nada pasa de las 14)", () => {
    const cands = candidatos({ duracion: 180 });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "10:00", "11:00"]);
    assert.deepEqual(horasDe(cands, "B"), ["15:00", "16:00"]);
  });

  it("una cita de 45 con un tipo de 60 sigue en la rejilla de 60 (nada a las 9:45)", () => {
    const cands = candidatos({ duracion: 45 });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "10:00", "11:00", "12:00", "13:00"]);
  });

  it("tipo de 60 con 10 de previo y cita de 90: 09:10, 10:10, 11:10 y 12:10", () => {
    const tipo = { ...TIPO, bufferBefore: 10 };
    const cands = buildCandidates({ eventType: tipo, duracion: 90, members: miembros(), horizonDays: 1, now: AHORA });
    assert.deepEqual(horasDe(cands, "A"), ["09:10", "10:10", "11:10", "12:10"]);
  });

  it("tipo de 60 con 10 de posterior y cita de 90: el descanso tiene que caber antes del cierre", () => {
    const tipo = { ...TIPO, bufferAfter: 10 };
    const cands = buildCandidates({ eventType: tipo, duracion: 90, members: miembros(), horizonDays: 1, now: AHORA });
    assert.deepEqual(horasDe(cands, "A"), ["09:00", "10:00", "11:00", "12:00"]);
  });

  it("la cita larga no se mete en un bloqueo que empieza antes de que ella acabe", () => {
    const b = bloqueo("b1", "A", lunes("10:15"), lunes("10:30"));
    assert.deepEqual(horasDe(candidatos({ bloqueos: [b] }), "A"), ["09:00", "11:00", "12:00", "13:00"]);
    const cands = candidatos({ bloqueos: [b], duracion: 90 });
    assert.deepEqual(horasDe(cands, "A"), ["11:00", "12:00"]);
    assert.equal(cands.filter((c) => pisaAMano(c, b, 90)).length, 0);
  });
});

describe("generateSlotsForDay: duracionCita inválida = como si no viniera", () => {
  const base = generateSlotsForDay({
    eventType: TIPO, availabilities: miembros()[0].hours, date: LUNES, existingBookings: [], now: AHORA,
  });
  for (const raro of [null, undefined, 0, -30, 1.5, "90", NaN]) {
    it(`duracionCita = ${String(raro)}`, () => {
      const con = generateSlotsForDay({
        eventType: TIPO, availabilities: miembros()[0].hours, date: LUNES, existingBookings: [], now: AHORA, duracionCita: raro,
      });
      assert.deepEqual(con, base);
    });
  }
});

// ── La lógica pura de choque ────────────────────────────────────────────────

describe("choqueConBloqueos", () => {
  const cita = { inicio: lunes("10:00"), duracion: 60, profesionalId: "A" };

  it("bloqueosQueChocan: solape, borde semiabierto, persona y centro", () => {
    assert.equal(bloqueosQueChocan([bloqueo("1", "A", lunes("10:30"), lunes("12:00"))], cita).length, 1);
    assert.equal(bloqueosQueChocan([bloqueo("2", "A", lunes("11:00"), lunes("12:00"))], cita).length, 0);
    assert.equal(bloqueosQueChocan([bloqueo("3", "A", lunes("09:00"), lunes("10:00"))], cita).length, 0);
    assert.equal(bloqueosQueChocan([bloqueo("4", "B", lunes("10:00"), lunes("11:00"))], cita).length, 0);
    assert.equal(bloqueosQueChocan([bloqueo("5", null, lunes("10:00"), lunes("11:00"))], cita).length, 1);
  });

  it("bloqueosQueChocan: sin profesional solo cuentan los del centro", () => {
    const bs = [bloqueo("1", "A", lunes("10:00"), lunes("11:00")), bloqueo("2", null, lunes("10:00"), lunes("11:00"))];
    assert.deepEqual(bloqueosQueChocan(bs, { ...cita, profesionalId: null }).map((b) => b.id), ["2"]);
  });

  it("bloqueosQueChocan: una cita que cruza la medianoche choca con el bloqueo del día siguiente", () => {
    const b = bloqueo("1", "A", "2026-09-15T00:00:00+02:00", "2026-09-15T01:00:00+02:00");
    assert.equal(bloqueosQueChocan([b], { inicio: lunes("23:30"), duracion: 60, profesionalId: "A" }).length, 1);
  });

  it("bloqueosQueChocan: un bloqueo de tres semanas que empezó el mes anterior", () => {
    const b = bloqueo("1", "A", "2026-08-30T00:00:00+02:00", "2026-09-20T00:00:00+02:00");
    assert.equal(bloqueosQueChocan([b], cita).length, 1);
  });

  it("bloqueosQueChocan: cita ilegible o sin duración → []", () => {
    const b = [bloqueo("1", null, lunes("00:00"), lunes("23:00"))];
    assert.deepEqual(bloqueosQueChocan(b, { ...cita, inicio: "mañana" }), []);
    assert.deepEqual(bloqueosQueChocan(b, { ...cita, duracion: 0 }), []);
    assert.deepEqual(bloqueosQueChocan(b, { ...cita, duracion: "abc" }), []);
    assert.deepEqual(bloqueosQueChocan(null, cita), []);
    assert.deepEqual(bloqueosQueChocan(b), []);
  });

  it("bloqueosQueAplican: los del centro siempre, los suyos si es la suya", () => {
    const bs = [bloqueo("1", "A", 0, 1), bloqueo("2", "B", 0, 1), bloqueo("3", null, 0, 1)];
    assert.deepEqual(bloqueosQueAplican(bs, "A").map((b) => b.id), ["1", "3"]);
    assert.deepEqual(bloqueosQueAplican(bs, null).map((b) => b.id), ["3"]);
    assert.deepEqual(bloqueosQueAplican(undefined, "A"), []);
  });

  it("bloqueosComoOcupacion: { scheduledAt, duration en minutos }, sin los de otra ni los inválidos", () => {
    const bs = [
      bloqueo("1", "A", lunes("10:00"), lunes("12:00")),
      bloqueo("2", null, lunes("13:00"), lunes("13:15")),
      bloqueo("3", "B", lunes("09:00"), lunes("10:00")),
      bloqueo("4", "A", lunes("12:00"), lunes("11:00")),
    ];
    const oc = bloqueosComoOcupacion(bs, "A");
    assert.deepEqual(
      oc.map((o) => ({ desde: o.scheduledAt.toISOString(), minutos: o.duration })),
      [
        { desde: "2026-09-14T08:00:00.000Z", minutos: 120 },
        { desde: "2026-09-14T11:00:00.000Z", minutos: 15 },
      ],
    );
  });
});

// ── cargarAusencias con varias personas ─────────────────────────────────────

describe("cargarAusencias con profesionalIds", () => {
  const filas = [
    bloqueo("a", "A", lunes("10:00"), lunes("11:00")),
    bloqueo("b", "B", lunes("10:00"), lunes("11:00")),
    bloqueo("c", "C", lunes("10:00"), lunes("11:00")),
    bloqueo("z", null, lunes("10:00"), lunes("11:00")),
    bloqueo("fuera", "A", "2026-10-01T10:00:00+02:00", "2026-10-01T11:00:00+02:00"),
  ];
  /** TeamBlock falso que aplica de verdad el `where` que le llega. */
  const TeamBlock = {
    async findAll({ where }) {
      const cumple = (f, cond) => {
        const v = cond.teamMemberId;
        if (v === null) return f.teamMemberId == null;
        if (v && typeof v === "object" && Op.in in v) return v[Op.in].includes(f.teamMemberId);
        return f.teamMemberId === v;
      };
      return filas
        .filter((f) => new Date(f.startAt) < where.startAt[Op.lt] && new Date(f.endAt) > where.endAt[Op.gt])
        .filter((f) => where[Op.or].some((cond) => cumple(f, cond)))
        .map((f) => ({ toJSON: () => f }));
    },
  };
  const rango = { desde: new Date(lunes("00:00")), hasta: new Date(lunes("23:59")) };
  const ids = async (opts) => (await cargarAusencias({ TeamBlock }, { ...rango, ...opts })).map((f) => f.id).sort();

  it("con varias personas trae las suyas y las del centro, no las de otra ni fuera de rango", async () => {
    assert.deepEqual(await ids({ profesionalIds: ["A", "B", null] }), ["a", "b", "z"]);
  });

  it("sin profesionalIds (o vacío) se comporta como siempre", async () => {
    assert.deepEqual(await ids({ profesionalId: "C" }), ["c", "z"]);
    assert.deepEqual(await ids({ profesionalId: "C", profesionalIds: [] }), ["c", "z"]);
    assert.deepEqual(await ids({}), ["z"]);
  });

  it("sin la tabla, o si la consulta revienta, []", async () => {
    assert.deepEqual(await cargarAusencias({}, { ...rango, profesionalIds: ["A"] }), []);
    const roto = { async findAll() { throw new Error("relation does not exist"); } };
    assert.deepEqual(await cargarAusencias({ TeamBlock: roto }, { ...rango, profesionalIds: ["A"] }), []);
  });
});

// ── Lo que es texto de verdad: la ruta y el widget ──────────────────────────

describe("texto de las rutas", () => {
  const ruta = leer("app/api/citas/bookings/[id]/suggest-slots/route.js");

  it("suggest-slots lee los bloqueos y las citas con el criterio del guardado", () => {
    assert.match(ruta, /import \{[^}]*\bcargarAusencias\b[^}]*\} from "[^"]*lib\/citas\/ausencias\.js"/);
    assert.match(ruta, /import \{[^}]*\bocupaHuecoWhere\b[^}]*\} from "[^"]*lib\/citas\/booking\.js"/);
    assert.match(ruta, /\.\.\.ocupaHuecoWhere\(now\)/);
  });

  it("pasa bloqueos y duración al generador, y ya no mide con el tipo", () => {
    const llamada = /buildCandidates\(\{([^}]*)\}\)/.exec(ruta);
    assert.ok(llamada, "no encuentro la llamada a buildCandidates");
    assert.match(llamada[1], /\bbloqueos\b/);
    assert.match(llamada[1], /\bduracion\b/);
    assert.ok(!ruta.includes("eventType.duration"), "sigue midiendo con eventType.duration");
  });

  it("pushValid descarta el bloqueo antes de mirar el solape", () => {
    const i = ruta.indexOf("const pushValid");
    assert.ok(i >= 0);
    const cuerpo = ruta.slice(i, ruta.indexOf("};", i));
    const b = cuerpo.indexOf("bloqueosQueChocan(");
    const s = cuerpo.indexOf("findBookingOverlap(");
    assert.ok(b >= 0 && s > b, "pushValid tiene que llamar a bloqueosQueChocan( antes de findBookingOverlap(");
  });

  it("choqueConBloqueos.js no importa nada (lo podrá leer el navegador)", () => {
    assert.doesNotMatch(leer("lib/citas/choqueConBloqueos.js"), /^\s*import\s/m);
  });

  it("el widget público no pasa duracionCita: sus huecos no cambian", () => {
    assert.ok(!leer("app/api/public/c/[tenantSlug]/availability/route.js").includes("duracionCita"));
  });
});
