// @prueba ligera
// Fija lib/fichaje/puntualidad.js: llegó tarde / salió pronto contra la agenda.
import test from "node:test";
import assert from "node:assert/strict";
import { avisosDePuntualidad, TOLERANCIA_MIN } from "../lib/fichaje/puntualidad.js";

const NOMBRES = new Map([["ana", "Ana"]]);
const dia = (entradaAt, salidaAt) => [{ teamMemberId: "ana", fecha: "2026-08-31", entradaAt, salidaAt, tipo: "trabajo" }];
const agenda = (inicio, fin) => [{ teamMemberId: "ana", fecha: "2026-08-31", inicio, fin }];

test("entrar después de la primera cita (fuera de tolerancia) avisa, con las dos horas", () => {
  const avisos = avisosDePuntualidad(dia("09:25:00", "17:00:00"), agenda("09:00", "17:00"), { nombres: NOMBRES });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "llego_tarde");
  assert.equal(avisos[0].gravedad, "revisar");
  assert.equal(avisos[0].nombre, "Ana");
  assert.match(avisos[0].texto, /09:25/);
  assert.match(avisos[0].texto, /09:00/);
});

test("salir antes de la última cita avisa; dentro de la tolerancia, no", () => {
  const pronto = avisosDePuntualidad(dia("08:55", "16:30"), agenda("09:00", "17:00"), { nombres: NOMBRES });
  assert.deepEqual(pronto.map((a) => a.tipo), ["salio_pronto"]);
  const alPelo = avisosDePuntualidad(dia("09:05", "16:55"), agenda("09:00", "17:00"), { nombres: NOMBRES });
  assert.equal(alPelo.length, 0);
  assert.equal(TOLERANCIA_MIN, 10);
});

test("la primera y la última se miran entre TODAS las citas del día", () => {
  const variasCitas = [
    { teamMemberId: "ana", fecha: "2026-08-31", inicio: "12:00", fin: "13:00" },
    { teamMemberId: "ana", fecha: "2026-08-31", inicio: "09:00", fin: "10:00" },
    { teamMemberId: "ana", fecha: "2026-08-31", inicio: "16:00", fin: "17:00" },
  ];
  const avisos = avisosDePuntualidad(dia("09:30", "15:30"), variasCitas, { nombres: NOMBRES });
  assert.deepEqual(avisos.map((a) => a.tipo).sort(), ["llego_tarde", "salio_pronto"]);
});

test("sin agenda, sin horas de reloj o con el tramo borrado: nada que decir", () => {
  assert.equal(avisosDePuntualidad(dia("09:30", "15:30"), [], { nombres: NOMBRES }).length, 0);
  const soloTotal = [{ teamMemberId: "ana", fecha: "2026-08-31", entradaAt: null, salidaAt: null, tipo: "trabajo" }];
  assert.equal(avisosDePuntualidad(soloTotal, agenda("09:00", "17:00"), { nombres: NOMBRES }).length, 0);
  const borrado = [{ ...dia("09:30", "15:30")[0], deletedAt: "2026-08-31" }];
  assert.equal(avisosDePuntualidad(borrado, agenda("09:00", "17:00"), { nombres: NOMBRES }).length, 0);
});

test("una pausa no cuenta como entrada; un tramo extra sí", () => {
  const tramos = [
    { teamMemberId: "ana", fecha: "2026-08-31", entradaAt: "07:00", salidaAt: "07:30", tipo: "pausa" },
    { teamMemberId: "ana", fecha: "2026-08-31", entradaAt: "09:30", salidaAt: "17:00", tipo: "extra" },
  ];
  const avisos = avisosDePuntualidad(tramos, agenda("09:00", "17:00"), { nombres: NOMBRES });
  assert.deepEqual(avisos.map((a) => a.tipo), ["llego_tarde"]);
});
