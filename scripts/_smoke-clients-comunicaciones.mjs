// @prueba ligera — funciones puras de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-comunicaciones.mjs — a quién le puede escribir el centro
 * (19/08/2026).
 *
 *   node scripts/_smoke-clients-comunicaciones.mjs
 *   node --test-name-pattern="Rodrigo" scripts/_smoke-clients-comunicaciones.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/clients/comunicaciones.js` (01/08/2026) es la ÚNICA regla de «¿le puedo
 * escribir por aquí?»: la consultan el portal de la familia, los correos y
 * WhatsApp de las citas (confirmar, recordar, cambiar de hora, videollamada,
 * avisos), y la ficha del cliente. Tiene cuatro decisiones escritas en su
 * cabecera y ninguna prueba que las sujetara:
 *
 *   1. vive en el CLIENTE (la familia), no en el paciente;
 *   2. publicidad («novedades») separada de los avisos de cita;
 *   3. si desmarcan los dos canales, NO se les escribe. Punto (Rodrigo);
 *   4. solo un NO explícito bloquea: mientras no contesten, correo sí y
 *      WhatsApp no —si no, activar esto habría dejado a todas las familias sin
 *      confirmación de cita de un día para otro.
 *
 * Esta prueba convierte esas cuatro frases en rojo/verde, y además fija lo que
 * hace la fusión de respuestas (`normalizarPreferencias`): sella fecha/IP solo
 * en lo que cambia, no re-sella lo que ya estaba contestado igual, y una
 * respuesta de verdad sustituye al valor por defecto aunque coincida con él.
 *
 * `citaPuedeAvisar` recibe los modelos por parámetro, así que se prueba con un
 * `Client` de mentira (findByPk/findOne) sin tocar la base: lo que importa es el
 * orden en que busca a la familia (por `clientId`, luego por el correo de la
 * reserva) y qué contesta cuando no la encuentra o cuando la lectura falla.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANALES,
  CANAL_LABEL,
  CANAL_AYUDA,
  POR_DEFECTO,
  preferenciasDe,
  yaRespondio,
  normalizarPreferencias,
  puedeAvisar,
  citaPuedeAvisar,
} from "../lib/clients/comunicaciones.js";

const AHORA = "2026-08-19T10:00:00.000Z";
const ANTES = "2026-08-01T09:00:00.000Z";

/** Una respuesta ya guardada (la forma persistida en clients.communication_prefs). */
const sello = (granted, extra = {}) => ({
  granted,
  at: ANTES,
  ip: "1.2.3.4",
  userAgent: "Safari",
  by: "portal",
  ...extra,
});

describe("las tres casillas, ni una más", () => {
  it("son avisos por correo, avisos por WhatsApp y novedades", () => {
    assert.deepEqual(CANALES, ["citasEmail", "citasWhatsapp", "novedades"]);
  });
  it("cada una tiene rótulo y ayuda para la pantalla del portal", () => {
    for (const c of CANALES) {
      assert.equal(typeof CANAL_LABEL[c], "string");
      assert.equal(typeof CANAL_AYUDA[c], "string");
    }
  });
  it("por defecto: correo sí (es como se opera hoy), WhatsApp y publicidad no", () => {
    assert.deepEqual(POR_DEFECTO, { citasEmail: true, citasWhatsapp: false, novedades: false });
  });
});

describe("preferenciasDe: lo guardado, rellenando lo que falte", () => {
  it("sin ficha, los valores por defecto y sin traza (by: null = nadie ha contestado)", () => {
    const p = preferenciasDe(null);
    assert.deepEqual(p.citasEmail, {
      granted: true,
      at: null,
      ip: null,
      userAgent: null,
      by: null,
    });
    assert.deepEqual(p.citasWhatsapp, {
      granted: false,
      at: null,
      ip: null,
      userAgent: null,
      by: null,
    });
    assert.deepEqual(p.novedades, {
      granted: false,
      at: null,
      ip: null,
      userAgent: null,
      by: null,
    });
  });
  it("con una respuesta completa, la devuelve tal cual", () => {
    const p = preferenciasDe({ communicationPrefs: { citasEmail: sello(false) } });
    assert.deepEqual(p.citasEmail, sello(false));
  });
  it("rellena los canales que no estén guardados con su valor por defecto", () => {
    const p = preferenciasDe({ communicationPrefs: { novedades: sello(true) } });
    assert.equal(p.citasEmail.granted, true);
    assert.equal(p.citasEmail.by, null);
    assert.equal(p.citasWhatsapp.granted, false);
    assert.equal(p.novedades.granted, true);
  });
  it("entiende la forma vieja (un booleano suelto) como respuesta sin traza", () => {
    const p = preferenciasDe({ communicationPrefs: { citasEmail: false } });
    assert.deepEqual(p.citasEmail, {
      granted: false,
      at: null,
      ip: null,
      userAgent: null,
      by: null,
    });
  });
  it("si lo guardado no es un objeto, se comporta como si no hubiera nada", () => {
    assert.equal(preferenciasDe({ communicationPrefs: "basura" }).citasEmail.granted, true);
    assert.equal(preferenciasDe({ communicationPrefs: 42 }).citasWhatsapp.granted, false);
  });
  it("solo devuelve las tres casillas: una clave desconocida guardada no sale", () => {
    const p = preferenciasDe({ communicationPrefs: { sms: sello(true) } });
    assert.deepEqual(Object.keys(p), CANALES);
  });
  it("el granted guardado se lee como booleano aunque llegue raro", () => {
    const p = preferenciasDe({ communicationPrefs: { citasEmail: { granted: 0, by: "portal" } } });
    assert.equal(p.citasEmail.granted, false);
  });
});

describe("yaRespondio: ¿ha contestado la familia o son los valores por defecto?", () => {
  it("sin nada guardado, no", () => {
    assert.equal(yaRespondio(null), false);
    assert.equal(yaRespondio({}), false);
    assert.equal(yaRespondio({ communicationPrefs: {} }), false);
  });
  it("la forma vieja (booleanos) no cuenta como respuesta: no tiene quién ni cuándo", () => {
    assert.equal(
      yaRespondio({ communicationPrefs: { citasEmail: true, novedades: false } }),
      false
    );
  });
  it("basta con que UN canal lleve quién lo marcó", () => {
    assert.equal(yaRespondio({ communicationPrefs: { novedades: sello(false) } }), true);
    assert.equal(
      yaRespondio({ communicationPrefs: { citasEmail: { granted: true, by: "equipo" } } }),
      true
    );
  });
  it("un objeto sin `by` es un valor por defecto, no una respuesta", () => {
    assert.equal(
      yaRespondio({ communicationPrefs: { citasEmail: { granted: true, by: null } } }),
      false
    );
  });
});

describe("normalizarPreferencias: fusionar la respuesta con lo que había", () => {
  it("la primera respuesta sella fecha, IP, navegador y quién, en cada canal que venga", () => {
    const r = normalizarPreferencias(
      { citasEmail: true, citasWhatsapp: true, novedades: false },
      { ip: "10.0.0.1", userAgent: "Firefox", now: AHORA }
    );
    assert.deepEqual(r.citasEmail, {
      granted: true,
      at: AHORA,
      ip: "10.0.0.1",
      userAgent: "Firefox",
      by: "portal",
    });
    assert.deepEqual(r.citasWhatsapp, {
      granted: true,
      at: AHORA,
      ip: "10.0.0.1",
      userAgent: "Firefox",
      by: "portal",
    });
    assert.deepEqual(r.novedades, {
      granted: false,
      at: AHORA,
      ip: "10.0.0.1",
      userAgent: "Firefox",
      by: "portal",
    });
  });
  it("quien marca por defecto es la familia (portal); el centro se declara", () => {
    assert.equal(
      normalizarPreferencias({ citasEmail: true }, { now: AHORA }).citasEmail.by,
      "portal"
    );
    assert.equal(
      normalizarPreferencias({ citasEmail: true }, { now: AHORA, by: "equipo" }).citasEmail.by,
      "equipo"
    );
  });
  it("los canales que no vienen en la respuesta conservan su traza anterior", () => {
    const previas = { novedades: sello(true) };
    const r = normalizarPreferencias({ citasEmail: false }, { previas, now: AHORA });
    assert.deepEqual(r.novedades, sello(true));
    assert.equal(r.citasEmail.granted, false);
    assert.equal(r.citasEmail.at, AHORA);
  });
  it("los canales que no vienen y no tenían nada, no se inventan (siguen siendo «por defecto»)", () => {
    const r = normalizarPreferencias({ citasEmail: false }, { now: AHORA });
    assert.deepEqual(Object.keys(r), ["citasEmail"]);
  });
  it("la misma respuesta que ya había, con traza, NO se re-sella", () => {
    const previas = { citasEmail: sello(false) };
    const r = normalizarPreferencias({ citasEmail: false }, { previas, now: AHORA, ip: "9.9.9.9" });
    assert.deepEqual(r.citasEmail, sello(false));
  });
  it("cambiar de opinión sí se sella de nuevo, con la fecha y la IP nuevas", () => {
    const previas = { citasEmail: sello(false) };
    const r = normalizarPreferencias(
      { citasEmail: true },
      { previas, now: AHORA, ip: "9.9.9.9", userAgent: "Chrome" }
    );
    assert.deepEqual(r.citasEmail, {
      granted: true,
      at: AHORA,
      ip: "9.9.9.9",
      userAgent: "Chrome",
      by: "portal",
    });
  });
  it("una respuesta de verdad sustituye al valor por defecto aunque coincida con él", () => {
    // Lo guardado era la forma vieja (sin `by`): coincide en valor, pero no es
    // una respuesta. Contestar lo mismo SÍ deja traza: ahora sabemos que lo dijo.
    const previas = { citasEmail: true };
    const r = normalizarPreferencias({ citasEmail: true }, { previas, now: AHORA, ip: "1.1.1.1" });
    assert.equal(r.citasEmail.by, "portal");
    assert.equal(r.citasEmail.at, AHORA);
  });
  it("acepta la respuesta como booleano o como {granted}", () => {
    assert.equal(
      normalizarPreferencias({ citasEmail: { granted: true } }, { now: AHORA }).citasEmail.granted,
      true
    );
    assert.equal(
      normalizarPreferencias({ citasEmail: "sí" }, { now: AHORA }).citasEmail.granted,
      true
    );
    assert.equal(
      normalizarPreferencias({ citasEmail: 0 }, { now: AHORA }).citasEmail.granted,
      false
    );
  });
  it("recorta la IP a 64 y el navegador a 255: la columna no es un cajón", () => {
    const r = normalizarPreferencias(
      { citasEmail: true },
      { now: AHORA, ip: "x".repeat(100), userAgent: "y".repeat(400) }
    );
    assert.equal(r.citasEmail.ip.length, 64);
    assert.equal(r.citasEmail.userAgent.length, 255);
  });
  it("sin IP ni navegador (lo registra el centro), null y null", () => {
    const r = normalizarPreferencias({ citasEmail: true }, { now: AHORA, by: "equipo" });
    assert.equal(r.citasEmail.ip, null);
    assert.equal(r.citasEmail.userAgent, null);
  });
  it("con previas que no son un objeto, parte de cero", () => {
    assert.equal(
      normalizarPreferencias({ citasEmail: true }, { previas: "basura", now: AHORA }).citasEmail
        .granted,
      true
    );
    assert.equal(
      normalizarPreferencias({ citasEmail: true }, { previas: null, now: AHORA }).citasEmail
        .granted,
      true
    );
  });
  it("sin respuesta (null), devuelve lo que había y nada más", () => {
    const previas = { novedades: sello(true) };
    assert.deepEqual(normalizarPreferencias(null, { previas, now: AHORA }), {
      novedades: sello(true),
    });
    assert.deepEqual(normalizarPreferencias(undefined, { now: AHORA }), {});
  });
  it("no toca el objeto de previas", () => {
    const previas = { citasEmail: sello(false) };
    normalizarPreferencias({ citasEmail: true }, { previas, now: AHORA });
    assert.equal(previas.citasEmail.granted, false);
  });
});

describe("puedeAvisar: ¿se le puede escribir por este canal?", () => {
  it("sin respuesta: correo sí, WhatsApp no, publicidad no (decisión 4: solo un NO explícito bloquea)", () => {
    assert.equal(puedeAvisar({ communicationPrefs: null }, "citasEmail"), true);
    assert.equal(puedeAvisar({ communicationPrefs: null }, "citasWhatsapp"), false);
    assert.equal(puedeAvisar({ communicationPrefs: null }, "novedades"), false);
  });
  it("un NO explícito por correo bloquea el correo", () => {
    assert.equal(
      puedeAvisar({ communicationPrefs: { citasEmail: sello(false) } }, "citasEmail"),
      false
    );
  });
  it("Rodrigo, 01/08/2026: si desmarcan los dos canales, NO se les escribe. Punto", () => {
    const familia = {
      communicationPrefs: { citasEmail: sello(false), citasWhatsapp: sello(false) },
    };
    assert.equal(puedeAvisar(familia, "citasEmail"), false);
    assert.equal(puedeAvisar(familia, "citasWhatsapp"), false);
  });
  it("la publicidad va aparte: aceptar novedades no abre los avisos, ni al revés", () => {
    const soloNovedades = {
      communicationPrefs: { citasEmail: sello(false), novedades: sello(true) },
    };
    assert.equal(puedeAvisar(soloNovedades, "citasEmail"), false);
    assert.equal(puedeAvisar(soloNovedades, "novedades"), true);
    const soloAvisos = { communicationPrefs: { citasEmail: sello(true) } };
    assert.equal(puedeAvisar(soloAvisos, "novedades"), false);
  });
  it("WhatsApp solo con un SÍ explícito", () => {
    assert.equal(
      puedeAvisar({ communicationPrefs: { citasWhatsapp: sello(true) } }, "citasWhatsapp"),
      true
    );
    assert.equal(
      puedeAvisar({ communicationPrefs: { citasWhatsapp: true } }, "citasWhatsapp"),
      true
    );
  });
  it("un canal que no existe, nunca", () => {
    assert.equal(puedeAvisar({ communicationPrefs: { sms: sello(true) } }, "sms"), false);
  });
});

// ── citaPuedeAvisar: partiendo de una cita, con un Client de mentira ────────

/** Un modelo Client de mentira: fichas por id y por correo, y opcionalmente que reviente. */
function clientFalso({ porId = {}, porEmail = {}, revienta = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    Client: {
      async findByPk(id) {
        llamadas.push(["findByPk", id]);
        if (revienta) throw new Error("la base no contesta");
        return porId[id] ?? null;
      },
      async findOne({ where }) {
        llamadas.push(["findOne", where.email]);
        if (revienta) throw new Error("la base no contesta");
        return porEmail[where.email] ?? null;
      },
    },
  };
}

describe("citaPuedeAvisar: la misma regla, partiendo de una cita", () => {
  it("busca a la familia por clientId y aplica su respuesta", async () => {
    const { Client, llamadas } = clientFalso({
      porId: { "c-1": { communicationPrefs: { citasEmail: sello(false) } } },
    });
    assert.equal(
      await citaPuedeAvisar(
        { Client },
        { clientId: "c-1", clientEmail: "f@example.com" },
        "citasEmail"
      ),
      false
    );
    assert.deepEqual(llamadas, [["findByPk", "c-1"]]);
  });
  it("sin clientId (reserva vieja o pública), busca por el correo con el que reservó", async () => {
    const { Client, llamadas } = clientFalso({
      porEmail: { "f@example.com": { communicationPrefs: { citasEmail: sello(false) } } },
    });
    assert.equal(
      await citaPuedeAvisar({ Client }, { clientEmail: "f@example.com" }, "citasEmail"),
      false
    );
    assert.deepEqual(llamadas, [["findOne", "f@example.com"]]);
  });
  it("si el clientId no encuentra ficha, cae al correo antes de rendirse", async () => {
    const { Client, llamadas } = clientFalso({
      porEmail: { "f@example.com": { communicationPrefs: { citasWhatsapp: sello(true) } } },
    });
    assert.equal(
      await citaPuedeAvisar(
        { Client },
        { clientId: "c-borrada", clientEmail: "f@example.com" },
        "citasWhatsapp"
      ),
      true
    );
    assert.deepEqual(llamadas, [
      ["findByPk", "c-borrada"],
      ["findOne", "f@example.com"],
    ]);
  });
  it("sin ficha de cliente, el valor por defecto del canal: la reserva pública recibe su confirmación", async () => {
    const { Client } = clientFalso();
    assert.equal(
      await citaPuedeAvisar({ Client }, { clientEmail: "nadie@example.com" }, "citasEmail"),
      true
    );
    assert.equal(
      await citaPuedeAvisar({ Client }, { clientEmail: "nadie@example.com" }, "citasWhatsapp"),
      false
    );
  });
  it("sin modelos, también el valor por defecto (y un canal desconocido, no)", async () => {
    assert.equal(await citaPuedeAvisar(null, { clientEmail: "x@example.com" }, "citasEmail"), true);
    assert.equal(
      await citaPuedeAvisar({}, { clientEmail: "x@example.com" }, "citasWhatsapp"),
      false
    );
    assert.equal(await citaPuedeAvisar(null, {}, "sms"), false);
  });
  it("si la lectura falla, el valor por defecto: el correo sigue saliendo, WhatsApp se calla", async () => {
    const { Client } = clientFalso({ revienta: true });
    assert.equal(await citaPuedeAvisar({ Client }, { clientId: "c-1" }, "citasEmail"), true);
    assert.equal(await citaPuedeAvisar({ Client }, { clientId: "c-1" }, "citasWhatsapp"), false);
  });
  it("sin clientId ni correo en la cita, no busca nada y contesta el valor por defecto", async () => {
    const { Client, llamadas } = clientFalso();
    assert.equal(await citaPuedeAvisar({ Client }, {}, "citasEmail"), true);
    assert.deepEqual(llamadas, []);
  });
});
