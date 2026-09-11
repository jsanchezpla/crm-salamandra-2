/**
 * _smoke-registro-de-la-tarde.mjs — el registro de una tarde de taller se
 * encuentra por el grupo y el día de Madrid cuando no cuelga de esta cita
 * (lib/clinica/citaDeTaller.js, 11/09/2026, AV-0108 de Aumenta).
 *
 * @prueba ligera
 */
import test from "node:test";
import assert from "node:assert/strict";
import { limitesDelDiaMadrid, registroDeLaTarde, citasDeTallerQueImparte } from "../lib/clinica/citaDeTaller.js";

test("limitesDelDiaMadrid: el día de Madrid, en verano y en invierno", () => {
  // Martes 22/09/2026 a las 18:15 de Madrid = 16:15Z (CEST).
  const v = limitesDelDiaMadrid("2026-09-22T16:15:00.000Z");
  assert.equal(v.desde.toISOString(), "2026-09-21T22:00:00.000Z");
  assert.equal(v.hasta.toISOString(), "2026-09-22T22:00:00.000Z");
  // Martes 24/11/2026 a las 18:15 de Madrid = 17:15Z (CET).
  const i = limitesDelDiaMadrid("2026-11-24T17:15:00.000Z");
  assert.equal(i.desde.toISOString(), "2026-11-23T23:00:00.000Z");
  assert.equal(i.hasta.toISOString(), "2026-11-24T23:00:00.000Z");
  // A las 00:30 de Madrid en UTC todavía es el día anterior: el día es el de Madrid.
  const m = limitesDelDiaMadrid("2026-09-22T22:30:00.000Z");
  assert.equal(m.desde.toISOString(), "2026-09-22T22:00:00.000Z");
  assert.equal(limitesDelDiaMadrid("no es fecha"), null);
});

/** Un TallerSesion de mentira: `filas` es lo que hay en la tabla. */
function modeloConFilas(filas) {
  return {
    async findOne({ where }) {
      if (where.bookingId) return filas.find((f) => f.bookingId === where.bookingId) ?? null;
      const rango = where.sessionDate;
      const [gte] = Object.getOwnPropertySymbols(rango).map((s) => rango[s]);
      const lt = Object.getOwnPropertySymbols(rango).map((s) => rango[s])[1];
      return (
        filas
          .filter((f) => f.grupoId === where.grupoId && f.sessionDate >= gte && f.sessionDate < lt)
          .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
      );
    },
  };
}

test("registroDeLaTarde: por la cita primero; si no, por el grupo en el mismo día", async () => {
  const deDaniela = { id: "s1", bookingId: "cita-daniela", grupoId: "g", sessionDate: new Date("2026-09-22T16:15:00.000Z"), createdAt: 1 };
  const tenantModels = { TallerSesion: modeloConFilas([deDaniela]) };
  // Desde la propia cita: lo de siempre.
  const a = await registroDeLaTarde({ tenantModels, booking: { id: "cita-daniela", tallerGrupoId: "g", scheduledAt: "2026-09-22T16:15:00.000Z" } });
  assert.equal(a.sesion.id, "s1");
  assert.equal(a.deOtraCita, false);
  // Desde otra cita del mismo grupo y la misma tarde (la de Laura): se encuentra y se dice.
  const b = await registroDeLaTarde({ tenantModels, booking: { id: "cita-laura", tallerGrupoId: "g", scheduledAt: "2026-09-22T16:15:00.000Z" } });
  assert.equal(b.sesion.id, "s1");
  assert.equal(b.deOtraCita, true);
  // Otro día: nada.
  const c = await registroDeLaTarde({ tenantModels, booking: { id: "cita-laura", tallerGrupoId: "g", scheduledAt: "2026-09-29T16:15:00.000Z" } });
  assert.equal(c.sesion, null);
  // Otro grupo: nada.
  const d = await registroDeLaTarde({ tenantModels, booking: { id: "x", tallerGrupoId: "otro", scheduledAt: "2026-09-22T16:15:00.000Z" } });
  assert.equal(d.sesion, null);
  // Una cita que no es de taller no busca por grupo.
  const e = await registroDeLaTarde({ tenantModels, booking: { id: "x", tallerGrupoId: null, scheduledAt: "2026-09-22T16:15:00.000Z" } });
  assert.equal(e.sesion, null);
  // Sin la tabla, tampoco revienta.
  const f = await registroDeLaTarde({ tenantModels: {}, booking: { id: "x", tallerGrupoId: "g", scheduledAt: "2026-09-22T16:15:00.000Z" } });
  assert.deepEqual(f, { sesion: null, deOtraCita: false });
});

test("citasDeTallerQueImparte admite varias personas y devuelve [] sin ninguna", async () => {
  const vistos = [];
  const tenantModels = {
    Booking: {},
    TallerCitaTerapeuta: {
      async findAll({ where }) {
        vistos.push(where.teamMemberId);
        return [{ bookingId: "b1" }, { bookingId: "b1" }, { bookingId: "b2" }];
      },
    },
  };
  assert.deepEqual(await citasDeTallerQueImparte({ tenantModels, teamMemberId: [] }), []);
  assert.deepEqual(await citasDeTallerQueImparte({ tenantModels, teamMemberId: null }), []);
  assert.deepEqual(await citasDeTallerQueImparte({ tenantModels, teamMemberId: "tm1" }), ["b1", "b2"]);
  assert.equal(vistos[0], "tm1");
  await citasDeTallerQueImparte({ tenantModels, teamMemberId: ["tm1", "tm2"] });
  const simbolos = Object.getOwnPropertySymbols(vistos[1]);
  assert.deepEqual(vistos[1][simbolos[0]], ["tm1", "tm2"]);
});
