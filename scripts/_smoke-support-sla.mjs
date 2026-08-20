// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-support-sla.mjs — los plazos del helpdesk se calculan en un sitio y
 * se cumplen o no según el reloj, no según quien mire (19/08/2026).
 *
 *   node scripts/_smoke-support-sla.mjs
 *   node --test-name-pattern="slaState" scripts/_smoke-support-sla.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El módulo `support` (helpdesk del tenant hacia SUS clientes) promete dos
 * plazos por ticket según su prioridad: la PRIMERA RESPUESTA y la RESOLUCIÓN.
 * `lib/support/sla.js` es el único que sabe cuánto vale cada plazo (de fábrica
 * o ajustado por el tenant en `support_settings.sla_config`), cuándo vence
 * (desde el ALTA del ticket, también al cambiar de prioridad) y en qué estado
 * está cada hito para pintar el chip de la bandeja y disparar la campana.
 *
 * Lo llaman cinco endpoints (alta manual, alta por el portal, alta por correo,
 * cambio de prioridad, ajustes) y `serialize.js` en cada ticket que sale por la
 * API. No tenía ninguna prueba: `docs/modules/support.md` dice «ninguna
 * ligera». Un plazo mal calculado es un ticket que se da por incumplido sin
 * serlo —o al revés—, y eso acaba en un informe que miente al cliente.
 *
 * Esta prueba fija lo que DEVUELVEN las funciones con fechas fijas (nunca el
 * reloj de la máquina): los defaults de fábrica, que los ajustes del tenant se
 * respetan sin tocar los defaults, que las fechas objetivo caen exactamente
 * donde tienen que caer, y que `slaState` pasa por sus cinco estados
 * (`pending`, `breached`, `met`, `missed`, `none`) según la hora que sea.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SLA_PRIORITIES,
  DEFAULT_SLA,
  effectiveSla,
  computeDueDates,
  slaState,
  isSlaBreached,
} from "../lib/support/sla.js";

// ── Las horas de fábrica, escritas aquí a mano ──────────────────────────────
// Son las que dice docs/modules/support.md. Si alguien las cambia en sla.js,
// tiene que cambiarlas también aquí y en el doc, a sabiendas.
const DE_FABRICA = {
  critical: { firstResponseHours: 2, resolutionHours: 8 },
  high: { firstResponseHours: 4, resolutionHours: 24 },
  medium: { firstResponseHours: 8, resolutionHours: 72 },
  low: { firstResponseHours: 24, resolutionHours: 120 },
};

/** Fechas fijas: el alta de un ticket y los instantes que importan a su alrededor. */
const ALTA = new Date("2026-08-19T10:00:00.000Z");
const en = (iso) => new Date(iso).getTime();

/** Un ticket abierto tal y como lo devuelve la base: fechas objetivo ya puestas. */
function ticketAbierto(extra = {}) {
  return {
    status: "open",
    firstResponseDueAt: "2026-08-19T12:00:00.000Z",
    resolutionDueAt: "2026-08-19T18:00:00.000Z",
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    ...extra,
  };
}

describe("SLA_PRIORITIES y DEFAULT_SLA: las cuatro prioridades y sus horas de fábrica", () => {
  it("cuatro prioridades, de más a menos urgente: critical, high, medium, low", () => {
    assert.deepEqual(SLA_PRIORITIES, ["critical", "high", "medium", "low"]);
  });
  it("de fábrica: critical 2/8 · high 4/24 · medium 8/72 · low 24/120 (lo que dice support.md)", () => {
    assert.deepEqual(DEFAULT_SLA, DE_FABRICA);
  });
  it("DEFAULT_SLA está congelado: no se le puede añadir ni quitar una prioridad", () => {
    assert.equal(Object.isFrozen(DEFAULT_SLA), true);
    assert.throws(() => {
      DEFAULT_SLA.urgent = { firstResponseHours: 1, resolutionHours: 1 };
    });
    assert.equal("urgent" in DEFAULT_SLA, false);
  });
  it("y congelado por DENTRO: tampoco se puede cambiar el plazo de una prioridad ya existente", () => {
    for (const p of SLA_PRIORITIES) {
      assert.equal(Object.isFrozen(DEFAULT_SLA[p]), true, p);
      assert.throws(() => {
        DEFAULT_SLA[p].resolutionHours = 999;
      }, `${p} tendría que estar congelada`);
    }
    assert.deepEqual(DEFAULT_SLA, DE_FABRICA);
  });
});

describe("effectiveSla: lo de fábrica más lo que el tenant haya ajustado", () => {
  it("sin ajustes (null, undefined, {}, slaConfig null) devuelve los de fábrica tal cual", () => {
    assert.deepEqual(effectiveSla(null), DE_FABRICA);
    assert.deepEqual(effectiveSla(undefined), DE_FABRICA);
    assert.deepEqual(effectiveSla({}), DE_FABRICA);
    assert.deepEqual(effectiveSla({ slaConfig: null }), DE_FABRICA);
  });
  it("un ajuste parcial solo toca lo que dice: critical a 1 h de respuesta y el resto de fábrica", () => {
    const cfg = effectiveSla({ slaConfig: { critical: { firstResponseHours: 1 } } });
    assert.deepEqual(cfg, {
      ...DE_FABRICA,
      critical: { firstResponseHours: 1, resolutionHours: 8 },
    });
  });
  it("acepta las horas que vienen como texto o con decimales: «3» → 3, «12.5» → 12.5", () => {
    const cfg = effectiveSla({
      slaConfig: { high: { firstResponseHours: "3", resolutionHours: "12.5" } },
    });
    assert.deepEqual(cfg.high, { firstResponseHours: 3, resolutionHours: 12.5 });
  });
  it("un valor que no sirve cae al de fábrica: 0, negativo, texto, null, NaN, Infinity, «»", () => {
    for (const malo of [0, -5, "abc", null, NaN, Infinity, ""]) {
      const cfg = effectiveSla({
        slaConfig: { low: { firstResponseHours: malo, resolutionHours: malo } },
      });
      assert.deepEqual(cfg.low, DE_FABRICA.low, `con ${String(malo)} tendría que caer a fábrica`);
    }
  });
  it("tope de 90 días (2160 h): 2160 vale, 2161 cae al de fábrica", () => {
    const cfg = effectiveSla({
      slaConfig: { low: { firstResponseHours: 2160, resolutionHours: 2161 } },
    });
    assert.deepEqual(cfg.low, { firstResponseHours: 2160, resolutionHours: 120 });
  });
  it("una prioridad que no existe en el ajuste se ignora y no aparece en la salida", () => {
    const cfg = effectiveSla({
      slaConfig: { urgent: { firstResponseHours: 1, resolutionHours: 1 } },
    });
    assert.deepEqual(Object.keys(cfg), SLA_PRIORITIES);
    assert.equal("urgent" in cfg, false);
  });
  it("un slaConfig que no es objeto (texto, lista) o una prioridad que no es objeto → fábrica", () => {
    assert.deepEqual(effectiveSla({ slaConfig: "rápido" }), DE_FABRICA);
    assert.deepEqual(effectiveSla({ slaConfig: [1, 2] }), DE_FABRICA);
    assert.deepEqual(effectiveSla({ slaConfig: { critical: 5 } }), DE_FABRICA);
  });
  it("siempre devuelve las cuatro prioridades con sus dos horas, aunque el tenant solo ajuste una", () => {
    const cfg = effectiveSla({ slaConfig: { medium: { resolutionHours: 48 } } });
    for (const p of SLA_PRIORITIES) {
      assert.equal(typeof cfg[p].firstResponseHours, "number", p);
      assert.equal(typeof cfg[p].resolutionHours, "number", p);
    }
    assert.equal(cfg.medium.resolutionHours, 48);
  });
  it("no toca DEFAULT_SLA ni devuelve sus objetos: cambiar lo efectivo no cambia la fábrica", () => {
    const cfg = effectiveSla({ slaConfig: { critical: { firstResponseHours: 1 } } });
    assert.notEqual(cfg.critical, DEFAULT_SLA.critical);
    assert.notEqual(cfg.high, DEFAULT_SLA.high);
    cfg.high.firstResponseHours = 99;
    assert.equal(DEFAULT_SLA.high.firstResponseHours, 4);
    assert.deepEqual(DEFAULT_SLA, DE_FABRICA);
  });
  it("dos llamadas con ajustes distintos no se contaminan entre sí", () => {
    const a = effectiveSla({ slaConfig: { critical: { firstResponseHours: 1 } } });
    const b = effectiveSla(null);
    assert.equal(a.critical.firstResponseHours, 1);
    assert.equal(b.critical.firstResponseHours, 2);
  });
});

describe("computeDueDates: las fechas objetivo de un ticket, contadas desde el alta", () => {
  it("critical dado de alta a las 10:00 → respuesta a las 12:00 y resolución a las 18:00 del mismo día", () => {
    assert.deepEqual(computeDueDates("critical", null, ALTA), {
      firstResponseDueAt: new Date("2026-08-19T12:00:00.000Z"),
      resolutionDueAt: new Date("2026-08-19T18:00:00.000Z"),
    });
  });
  it("high → 4 h y 24 h: las 14:00 de hoy y las 10:00 de mañana", () => {
    assert.deepEqual(computeDueDates("high", {}, ALTA), {
      firstResponseDueAt: new Date("2026-08-19T14:00:00.000Z"),
      resolutionDueAt: new Date("2026-08-20T10:00:00.000Z"),
    });
  });
  it("medium → 8 h y 72 h: las 18:00 de hoy y las 10:00 del 22/08", () => {
    assert.deepEqual(computeDueDates("medium", {}, ALTA), {
      firstResponseDueAt: new Date("2026-08-19T18:00:00.000Z"),
      resolutionDueAt: new Date("2026-08-22T10:00:00.000Z"),
    });
  });
  it("low → 24 h y 120 h: mañana a la misma hora y cinco días después", () => {
    assert.deepEqual(computeDueDates("low", {}, ALTA), {
      firstResponseDueAt: new Date("2026-08-20T10:00:00.000Z"),
      resolutionDueAt: new Date("2026-08-24T10:00:00.000Z"),
    });
  });
  it("una prioridad desconocida o ausente se trata como medium (así nacen los tickets del portal y del correo)", () => {
    const comoMedium = computeDueDates("medium", {}, ALTA);
    assert.deepEqual(computeDueDates("urgente", {}, ALTA), comoMedium);
    assert.deepEqual(computeDueDates(undefined, {}, ALTA), comoMedium);
    assert.deepEqual(computeDueDates(null, {}, ALTA), comoMedium);
  });
  it("con el SLA apagado (slaEnabled === false) los dos objetivos son null", () => {
    assert.deepEqual(computeDueDates("critical", { slaEnabled: false }, ALTA), {
      firstResponseDueAt: null,
      resolutionDueAt: null,
    });
  });
  it("slaEnabled ausente, null o true = encendido: solo el false estricto apaga", () => {
    const encendido = computeDueDates("critical", null, ALTA);
    assert.deepEqual(computeDueDates("critical", { slaEnabled: true }, ALTA), encendido);
    assert.deepEqual(computeDueDates("critical", { slaEnabled: null }, ALTA), encendido);
    assert.deepEqual(computeDueDates("critical", { slaEnabled: undefined }, ALTA), encendido);
    assert.deepEqual(computeDueDates("critical", {}, ALTA), encendido);
  });
  it("respeta los ajustes del tenant: high con 1,5 h de respuesta → 11:30", () => {
    const ajustes = { slaConfig: { high: { firstResponseHours: 1.5 } } };
    assert.deepEqual(computeDueDates("high", ajustes, ALTA), {
      firstResponseDueAt: new Date("2026-08-19T11:30:00.000Z"),
      resolutionDueAt: new Date("2026-08-20T10:00:00.000Z"),
    });
  });
  it("`from` puede llegar como Date o como texto ISO (createdAt serializado): mismo resultado", () => {
    assert.deepEqual(
      computeDueDates("low", {}, "2026-08-19T10:00:00.000Z"),
      computeDueDates("low", {}, ALTA)
    );
  });
  it("un `from` que no se puede leer cuenta desde AHORA: nunca dos Invalid Date", () => {
    for (const roto of ["no es fecha", "", NaN, {}, null]) {
      const antes = Date.now();
      const dues = computeDueDates("low", {}, roto);
      const despues = Date.now();
      const cual = JSON.stringify(String(roto));
      assert.ok(dues.firstResponseDueAt instanceof Date, cual);
      assert.equal(Number.isNaN(dues.firstResponseDueAt.getTime()), false, cual);
      assert.ok(dues.firstResponseDueAt.getTime() >= antes + 24 * 3600_000, cual);
      assert.ok(dues.firstResponseDueAt.getTime() <= despues + 24 * 3600_000, cual);
      assert.equal((dues.resolutionDueAt - dues.firstResponseDueAt) / 3600_000, 96, cual);
    }
  });
  it("con el `from` roto, `null` sigue queriendo decir una sola cosa: el tenant tiene el SLA apagado", () => {
    assert.deepEqual(computeDueDates("low", { slaEnabled: false }, "no es fecha"), {
      firstResponseDueAt: null,
      resolutionDueAt: null,
    });
    assert.notEqual(computeDueDates("low", {}, "no es fecha").firstResponseDueAt, null);
  });
  it("devuelve instancias de Date (se guardan tal cual en el ticket)", () => {
    const dues = computeDueDates("medium", {}, ALTA);
    assert.ok(dues.firstResponseDueAt instanceof Date);
    assert.ok(dues.resolutionDueAt instanceof Date);
  });
  it("no altera el `from` que le dan", () => {
    const alta = new Date("2026-08-19T10:00:00.000Z");
    computeDueDates("critical", {}, alta);
    assert.equal(alta.getTime(), en("2026-08-19T10:00:00.000Z"));
  });
  it("al cambiar de prioridad se recalcula desde el ALTA, no desde ahora: el mismo `from` da el mismo objetivo días después", () => {
    // El endpoint pasa `ticket.createdAt`; el resultado no depende de cuándo se llame.
    const deMediumACritical = computeDueDates("critical", {}, ALTA);
    assert.deepEqual(deMediumACritical.firstResponseDueAt, new Date("2026-08-19T12:00:00.000Z"));
  });
});

describe("slaState: el estado de cada hito según la hora que es", () => {
  it("antes del plazo y sin cumplir: pending en los dos hitos, con la forma {dueAt, doneAt, state}", () => {
    assert.deepEqual(slaState(ticketAbierto(), en("2026-08-19T11:00:00.000Z")), {
      firstResponse: { dueAt: "2026-08-19T12:00:00.000Z", doneAt: null, state: "pending" },
      resolution: { dueAt: "2026-08-19T18:00:00.000Z", doneAt: null, state: "pending" },
    });
  });
  it("en el instante exacto del plazo sigue en plazo: pending (vencido es DESPUÉS, no EN)", () => {
    const s = slaState(ticketAbierto(), en("2026-08-19T12:00:00.000Z"));
    assert.equal(s.firstResponse.state, "pending");
  });
  it("un milisegundo después del plazo y sin respuesta: breached en primera respuesta; resolución sigue pending", () => {
    const s = slaState(ticketAbierto(), en("2026-08-19T12:00:00.001Z"));
    assert.equal(s.firstResponse.state, "breached");
    assert.equal(s.resolution.state, "pending");
  });
  it("pasados los dos plazos sin hacer nada: breached en los dos", () => {
    const s = slaState(ticketAbierto(), en("2026-08-20T00:00:00.000Z"));
    assert.equal(s.firstResponse.state, "breached");
    assert.equal(s.resolution.state, "breached");
  });
  it("respondido dentro de plazo: met, y se queda met aunque pase el tiempo", () => {
    const t = ticketAbierto({ firstResponseAt: "2026-08-19T11:30:00.000Z" });
    assert.equal(slaState(t, en("2026-08-19T11:45:00.000Z")).firstResponse.state, "met");
    assert.equal(slaState(t, en("2026-08-25T00:00:00.000Z")).firstResponse.state, "met");
  });
  it("respondido justo en el plazo: met (el límite cuenta como dentro)", () => {
    const t = ticketAbierto({ firstResponseAt: "2026-08-19T12:00:00.000Z" });
    assert.equal(slaState(t, en("2026-08-19T13:00:00.000Z")).firstResponse.state, "met");
  });
  it("respondido tarde: missed, y no se convierte en breached por muy tarde que se mire", () => {
    const t = ticketAbierto({ firstResponseAt: "2026-08-19T12:00:00.001Z" });
    const s = slaState(t, en("2026-08-19T13:00:00.000Z"));
    assert.equal(s.firstResponse.state, "missed");
    assert.equal(s.firstResponse.doneAt, "2026-08-19T12:00:00.001Z");
    assert.equal(slaState(t, en("2026-09-01T00:00:00.000Z")).firstResponse.state, "missed");
  });
  it("resuelto a tiempo: met en resolución, con resolvedAt como hito", () => {
    const t = ticketAbierto({
      status: "resolved",
      firstResponseAt: "2026-08-19T11:00:00.000Z",
      resolvedAt: "2026-08-19T15:00:00.000Z",
    });
    const s = slaState(t, en("2026-08-20T00:00:00.000Z"));
    assert.deepEqual(s.resolution, {
      dueAt: "2026-08-19T18:00:00.000Z",
      doneAt: "2026-08-19T15:00:00.000Z",
      state: "met",
    });
    assert.equal(s.firstResponse.state, "met");
  });
  it("resuelto tarde: missed", () => {
    const t = ticketAbierto({ status: "resolved", resolvedAt: "2026-08-19T20:00:00.000Z" });
    assert.equal(slaState(t, en("2026-08-21T00:00:00.000Z")).resolution.state, "missed");
  });
  it("cerrado sin resolvedAt: closedAt hace de fecha de resolución", () => {
    const t = ticketAbierto({ status: "closed", closedAt: "2026-08-19T15:00:00.000Z" });
    const s = slaState(t, en("2026-08-20T00:00:00.000Z"));
    assert.equal(s.resolution.state, "met");
    assert.equal(s.resolution.doneAt, "2026-08-19T15:00:00.000Z");
  });
  it("con resolvedAt y closedAt, manda resolvedAt (el cierre viene después y no es el hito)", () => {
    const t = ticketAbierto({
      status: "closed",
      resolvedAt: "2026-08-19T15:00:00.000Z",
      closedAt: "2026-08-20T15:00:00.000Z",
    });
    const s = slaState(t, en("2026-08-21T00:00:00.000Z"));
    assert.equal(s.resolution.doneAt, "2026-08-19T15:00:00.000Z");
    assert.equal(s.resolution.state, "met");
  });
  it("cerrado sin haber respondido nunca: primera respuesta none (cerrado sin cumplir no cuenta ni a favor ni en contra)", () => {
    const t = ticketAbierto({ status: "closed", closedAt: "2026-08-19T15:00:00.000Z" });
    const s = slaState(t, en("2026-08-20T00:00:00.000Z"));
    assert.deepEqual(s.firstResponse, {
      dueAt: "2026-08-19T12:00:00.000Z",
      doneAt: null,
      state: "none",
    });
  });
  it("waiting (esperando al cliente) NO pausa el reloj: sigue activo y vence igual (v1, support.md)", () => {
    const t = ticketAbierto({ status: "waiting" });
    const s = slaState(t, en("2026-08-20T00:00:00.000Z"));
    assert.equal(s.firstResponse.state, "breached");
    assert.equal(s.resolution.state, "breached");
  });
  it("in_progress también es activo: pending antes del plazo, breached después", () => {
    const t = ticketAbierto({ status: "in_progress" });
    assert.equal(slaState(t, en("2026-08-19T11:00:00.000Z")).firstResponse.state, "pending");
    assert.equal(slaState(t, en("2026-08-19T13:00:00.000Z")).firstResponse.state, "breached");
  });
  it("sin fecha objetivo (SLA apagado al crearse): none, aunque haya respuesta y aunque pase el tiempo", () => {
    const t = ticketAbierto({
      firstResponseDueAt: null,
      resolutionDueAt: null,
      firstResponseAt: "2026-08-19T11:00:00.000Z",
    });
    const s = slaState(t, en("2026-09-01T00:00:00.000Z"));
    assert.deepEqual(s, {
      firstResponse: { dueAt: null, doneAt: "2026-08-19T11:00:00.000Z", state: "none" },
      resolution: { dueAt: null, doneAt: null, state: "none" },
    });
  });
  it("cada hito va por su cuenta: respuesta met y resolución breached a la vez", () => {
    const t = ticketAbierto({ firstResponseAt: "2026-08-19T11:00:00.000Z" });
    const s = slaState(t, en("2026-08-20T00:00:00.000Z"));
    assert.equal(s.firstResponse.state, "met");
    assert.equal(s.resolution.state, "breached");
  });
  it("acepta las fechas como Date (recién leídas de la base) y `now` como Date o como número", () => {
    const t = ticketAbierto({
      firstResponseDueAt: new Date("2026-08-19T12:00:00.000Z"),
      resolutionDueAt: new Date("2026-08-19T18:00:00.000Z"),
      firstResponseAt: new Date("2026-08-19T11:00:00.000Z"),
    });
    const conNumero = slaState(t, en("2026-08-20T00:00:00.000Z"));
    const conDate = slaState(t, new Date("2026-08-20T00:00:00.000Z"));
    assert.equal(conNumero.firstResponse.state, "met");
    assert.equal(conNumero.resolution.state, "breached");
    assert.equal(conDate.firstResponse.state, conNumero.firstResponse.state);
    assert.equal(conDate.resolution.state, conNumero.resolution.state);
  });
});

describe("isSlaBreached: lo urgente de la bandeja y de la campana", () => {
  it("true si CUALQUIERA de los dos hitos está breached", () => {
    // solo la respuesta, vencida
    assert.equal(isSlaBreached(ticketAbierto(), en("2026-08-19T13:00:00.000Z")), true);
    // respondida a tiempo, pero la resolución vencida
    assert.equal(
      isSlaBreached(
        ticketAbierto({ firstResponseAt: "2026-08-19T11:00:00.000Z" }),
        en("2026-08-20T00:00:00.000Z")
      ),
      true
    );
  });
  it("false mientras los dos están en plazo (incluido el instante exacto del plazo)", () => {
    assert.equal(isSlaBreached(ticketAbierto(), en("2026-08-19T11:00:00.000Z")), false);
    assert.equal(isSlaBreached(ticketAbierto(), en("2026-08-19T12:00:00.000Z")), false);
  });
  it("missed no es breached: un hito cumplido tarde ya no es urgente", () => {
    const t = ticketAbierto({
      status: "resolved",
      firstResponseAt: "2026-08-19T13:00:00.000Z",
      resolvedAt: "2026-08-19T20:00:00.000Z",
    });
    const s = slaState(t, en("2026-08-21T00:00:00.000Z"));
    assert.equal(s.firstResponse.state, "missed");
    assert.equal(s.resolution.state, "missed");
    assert.equal(isSlaBreached(t, en("2026-08-21T00:00:00.000Z")), false);
  });
  it("un ticket cerrado no está breached aunque nadie lo respondiera (el hito pasa a none)", () => {
    const t = ticketAbierto({ status: "closed", closedAt: "2026-08-19T15:00:00.000Z" });
    assert.equal(isSlaBreached(t, en("2026-09-01T00:00:00.000Z")), false);
  });
  it("SLA apagado (sin fechas objetivo): nunca breached", () => {
    const t = ticketAbierto({ firstResponseDueAt: null, resolutionDueAt: null });
    assert.equal(isSlaBreached(t, en("2026-09-01T00:00:00.000Z")), false);
  });
  it("el ciclo entero de un ticket critical con fechas fijas: pending → breached → met/missed", () => {
    // Alta a las 10:00, critical: respuesta a las 12:00, resolución a las 18:00.
    const dues = computeDueDates("critical", null, ALTA);
    const t = {
      status: "open",
      firstResponseDueAt: dues.firstResponseDueAt,
      resolutionDueAt: dues.resolutionDueAt,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
    };
    assert.equal(isSlaBreached(t, en("2026-08-19T11:59:00.000Z")), false);
    assert.equal(isSlaBreached(t, en("2026-08-19T12:01:00.000Z")), true);
    // Responden a las 12:30 (tarde) y resuelven a las 17:00 (a tiempo)
    const atendido = {
      ...t,
      status: "resolved",
      firstResponseAt: "2026-08-19T12:30:00.000Z",
      resolvedAt: "2026-08-19T17:00:00.000Z",
    };
    const s = slaState(atendido, en("2026-08-19T19:00:00.000Z"));
    assert.equal(s.firstResponse.state, "missed");
    assert.equal(s.resolution.state, "met");
    assert.equal(isSlaBreached(atendido, en("2026-08-19T19:00:00.000Z")), false);
  });
});
