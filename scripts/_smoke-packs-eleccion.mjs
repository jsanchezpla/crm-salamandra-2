// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-packs-eleccion.mjs — el bono que se ELIGE para una cita y la sesión
 * que ya está pagada (07/09/2026, AV-0055 de Aumenta: «no existe ninguna
 * opción para enlazar esas citas con los bonos y que vaya restando»).
 *
 *   node scripts/_smoke-packs-eleccion.mjs
 *
 * Lo que se fija:
 *   · `elegirPack` acepta el bono de esa familia (por ficha O por correo), de
 *     ese tipo y con sesiones libres, y numera la siguiente sesión;
 *   · rechaza el de otra familia, el de otro tipo, el anulado y el agotado,
 *     con una frase que se le puede enseñar a quien apunta la cita;
 *   · `packActivoDe`/`asignarSesion` encuentran el bono por ficha aunque no
 *     haya correo (antes solo por correo: familia sin correo, cita suelta);
 *   · `cobroDeBono` es el cuarto modo de cobro: 0 € y el texto dice de qué
 *     bono y qué sesión; el navegador NO puede pedirlo como modo
 *     (`normalizarCobro` lo rechaza), y `resumenCobro`/`seCobra` lo leen bien.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { elegirPack, packEsDe, asignarSesion, cobroDeBono } from "../lib/citas/packs.js";
import { normalizarCobro, resumenCobro, seCobra, MODOS_COBRO, loQueSeCobraDe } from "../lib/citas/dineroDeLaCita.js";
import { puedeDarBonos } from "../lib/citas/quienDaBonos.js";

const AHORA = new Date("2026-09-07T10:00:00Z");
const futura = (n) => ({ status: "confirmed", scheduledAt: new Date(AHORA.getTime() + n * 86_400_000).toISOString(), sessionNumber: n });
const hecha = (n) => ({ status: "completed", scheduledAt: new Date(AHORA.getTime() - n * 86_400_000).toISOString(), sessionNumber: n });

/** Un tenant de mentira con sus bonos y las citas de cada uno. */
function tenant({ packs = [], citas = {} } = {}) {
  const filas = packs.map((p) => ({ ...p, toJSON() { return { ...p }; } }));
  return {
    SessionPack: {
      findByPk: async (id) => filas.find((p) => p.id === id) ?? null,
      findAll: async ({ where }) => {
        const or = where[Object.getOwnPropertySymbols(where).find((s) => String(s).includes("or"))] ?? [];
        return filas.filter((p) => {
          if (p.status !== where.status || p.eventTypeId !== where.eventTypeId) return false;
          return or.some((c) => (c.clientId && c.clientId === p.clientId)
            || (c.clientEmail && p.clientEmail && String(p.clientEmail).toLowerCase() === String(Object.values(c.clientEmail)[0]).toLowerCase()));
        });
      },
    },
    Booking: { findAll: async ({ where }) => citas[where.packId] ?? [] },
    EventType: { findByPk: async (id) => ({ id, name: id === "et-psico" ? "PSICOLOGIA 45" : "LOGOPEDIA 45" }) },
  };
}

const BONO = { id: "pk-1", clientId: "cli-1", clientEmail: null, eventTypeId: "et-psico", totalSessions: 5, status: "active", purchasedAt: "2026-09-01" };

describe("packEsDe", () => {
  it("por ficha, por correo (sin distinguir mayúsculas), y no por nada", () => {
    assert.equal(packEsDe(BONO, { clientId: "cli-1" }), true);
    assert.equal(packEsDe({ ...BONO, clientEmail: "Ana@x.com" }, { email: "ana@X.com" }), true);
    assert.equal(packEsDe(BONO, { clientId: "cli-2", email: "otra@x.com" }), false);
    assert.equal(packEsDe(BONO, {}), false);
  });
});

describe("elegirPack", () => {
  it("el bono de la familia, del tipo, con sesiones: numera la siguiente", async () => {
    const M = tenant({ packs: [BONO], citas: { "pk-1": [hecha(1), futura(2)] } });
    const r = await elegirPack(M, { packId: "pk-1", clientId: "cli-1", eventTypeId: "et-psico" }, AHORA);
    assert.equal(r.error, undefined);
    assert.equal(r.packId, "pk-1");
    assert.equal(r.sessionNumber, 3);
    assert.equal(r.restantesAntes, 3); // 5 − 1 gastada − 1 reservada
  });
  it("una familia SIN correo lo encuentra por la ficha", async () => {
    const M = tenant({ packs: [BONO] });
    const r = await elegirPack(M, { packId: "pk-1", email: null, clientId: "cli-1", eventTypeId: "et-psico" }, AHORA);
    assert.equal(r.error, undefined);
  });
  it("el de otra familia, no", async () => {
    const M = tenant({ packs: [BONO] });
    const r = await elegirPack(M, { packId: "pk-1", clientId: "cli-2", eventTypeId: "et-psico" }, AHORA);
    assert.match(r.error, /no es de esta familia/);
  });
  it("el de otro tipo de cita, no, y dice cuál es", async () => {
    const M = tenant({ packs: [BONO] });
    const r = await elegirPack(M, { packId: "pk-1", clientId: "cli-1", eventTypeId: "et-logo" }, AHORA);
    assert.match(r.error, /otro tipo de cita.*PSICOLOGIA 45/);
  });
  it("anulado o agotado, no", async () => {
    const M = tenant({ packs: [{ ...BONO, id: "pk-2", status: "anulado" }, BONO], citas: { "pk-1": [hecha(1), hecha(2), hecha(3), futura(4), futura(5)] } });
    assert.match((await elegirPack(M, { packId: "pk-2", clientId: "cli-1", eventTypeId: "et-psico" }, AHORA)).error, /anulado o agotado/);
    assert.match((await elegirPack(M, { packId: "pk-1", clientId: "cli-1", eventTypeId: "et-psico" }, AHORA)).error, /no tiene sesiones libres/);
  });
  it("un bono que no existe, o un centro sin bonos", async () => {
    assert.match((await elegirPack(tenant(), { packId: "nada", clientId: "cli-1", eventTypeId: "et-psico" })).error, /no existe/);
    assert.match((await elegirPack({}, { packId: "pk-1", clientId: "cli-1", eventTypeId: "et-psico" })).error, /no tiene bonos/);
  });
});

describe("asignarSesion por ficha", () => {
  it("sin correo, encuentra el bono de la ficha", async () => {
    const M = tenant({ packs: [BONO], citas: { "pk-1": [hecha(1)] } });
    const r = await asignarSesion(M, { email: null, clientId: "cli-1", eventTypeId: "et-psico" }, AHORA);
    assert.equal(r?.packId, "pk-1");
    assert.equal(r?.sessionNumber, 2);
  });
  it("sin correo ni ficha, nada", async () => {
    assert.equal(await asignarSesion(tenant({ packs: [BONO] }), { eventTypeId: "et-psico" }, AHORA), null);
  });
});

describe("el cobro de una sesión de bono", () => {
  it("cobroDeBono: modo bono, 0 € y el texto dice cuál y qué sesión", () => {
    const c = cobroDeBono({ nombre: "PSICOLOGIA 45", sessionNumber: 3, total: 5 });
    assert.deepEqual(c, { modo: "bono", conceptId: null, texto: "Bono «PSICOLOGIA 45» · sesión 3 de 5", importe: 0 });
    assert.ok(MODOS_COBRO.includes("bono"));
  });
  it("el navegador no puede pedir «bono» como modo", () => {
    assert.match(normalizarCobro({ modo: "bono" }).error, /elige el bono/);
  });
  it("no se cobra, se lee bien y no entra en lo que se cobra del mes", () => {
    const cita = { cobroModo: "bono", cobroTexto: "Bono «PSICOLOGIA 45» · sesión 3 de 5", cobroImporte: 0 };
    assert.equal(seCobra(cita), false);
    assert.equal(resumenCobro(cita), "Bono «PSICOLOGIA 45» · sesión 3 de 5");
    assert.equal(loQueSeCobraDe([cita, { cobroModo: "libre", cobroTexto: "Informe", cobroImporte: 4000 }]).total, 4000);
  });
});

describe("quién da bonos", () => {
  it("dirección siempre; quien lleve Facturación también; el resto, no", () => {
    assert.equal(puedeDarBonos({ role: "admin", hasModule: () => false }), true);
    assert.equal(puedeDarBonos({ role: "superadmin" }), true);
    assert.equal(puedeDarBonos({ role: "user", hasModule: (k) => k === "billing" }), true);
    assert.equal(puedeDarBonos({ role: "user", hasModule: (k) => k === "citas" }), false);
    assert.equal(puedeDarBonos({ role: "user" }), false);
  });
});
