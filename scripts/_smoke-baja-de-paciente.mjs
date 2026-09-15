// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-baja-de-paciente.mjs — dar de baja a UN paciente de la cuota de la
 * familia sin dar de baja a los demás (15/09/2026, AV-0145 de Aumenta: la
 * madre dejó de venir en junio y el hijo sigue).
 *
 *   node scripts/_smoke-baja-de-paciente.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { admiteBajaDePaciente, planBajaDePaciente } from "../lib/billing/bajaDePaciente.js";

const PSICO = "c-psico";
const LOGO = "c-logo";
const MADRE = "p-madre";
const HIJO = "p-hijo";
const FAMILIA = [MADRE, HIJO];

const cuota = (extra = {}) => ({
  id: "q1",
  clientId: "f1",
  patientId: null,
  payerClientId: null,
  conceptIds: [PSICO, PSICO],
  amount: null,
  method: "transfer",
  dayOfMonth: 5,
  startDate: "2026-01-01",
  endDate: null,
  familiaPacientes: [{ id: MADRE }, { id: HIJO }],
  ...extra,
});

test("solo se ofrece en cuotas de familia con varios pacientes y varias líneas", () => {
  assert.equal(admiteBajaDePaciente(cuota()), true);
  assert.equal(admiteBajaDePaciente(cuota({ patientId: HIJO })), false);
  assert.equal(admiteBajaDePaciente(cuota({ conceptIds: [PSICO] })), false);
  assert.equal(admiteBajaDePaciente(cuota({ familiaPacientes: [{ id: HIJO }] })), false);
});

test("baja en un mes pasado: se quita SU línea, lo que queda es del hijo y no nace otra cuota", () => {
  const plan = planBajaDePaciente(
    cuota(),
    { patientId: MADRE, quitar: [1], quedaPatientId: HIJO, fecha: "2026-06-30" },
    { familia: FAMILIA, hoy: "2026-09-15" }
  );
  assert.equal(plan.problema, undefined);
  // La terapia repetida de dos personas no se pierde entera: queda UNA.
  assert.deepEqual(plan.restante, { conceptIds: [PSICO], patientId: HIJO });
  assert.equal(plan.separada, null);
});

test("baja a mitad del mes en curso: su parte sale a una cuota a su nombre desde el día 1", () => {
  const plan = planBajaDePaciente(
    cuota({ conceptIds: [PSICO, LOGO] }),
    { patientId: MADRE, quitar: [0], quedaPatientId: HIJO, fecha: "2026-09-20" },
    { familia: FAMILIA, hoy: "2026-09-15" }
  );
  assert.deepEqual(plan.restante.conceptIds, [LOGO]);
  assert.equal(plan.separada.patientId, MADRE);
  assert.deepEqual(plan.separada.conceptIds, [PSICO]);
  assert.equal(plan.separada.startDate, "2026-09-01");
  assert.equal(plan.separada.endDate, "2026-09-20");
  assert.equal(plan.separada.active, true); // aún no ha llegado el día
  assert.equal(plan.separada.method, "transfer");
});

test("si la familia ya pagó el mes entero, a quien se va no se le vuelve a cobrar ese mes", () => {
  const plan = planBajaDePaciente(
    cuota(),
    { patientId: MADRE, quitar: [0], fecha: "2026-09-20" },
    { familia: FAMILIA, hoy: "2026-09-15", mesesPagados: ["2026-09-01"] }
  );
  assert.equal(plan.separada, null);
  assert.equal(plan.restante.patientId, null); // sin decir de quién: sigue de la familia
});

test("baja futura con el mes pagado: la cuota aparte empieza el mes siguiente", () => {
  const plan = planBajaDePaciente(
    cuota(),
    { patientId: MADRE, quitar: [0], fecha: "2026-11-15" },
    { familia: FAMILIA, hoy: "2026-09-15", mesesPagados: ["2026-09-01"] }
  );
  assert.equal(plan.separada.startDate, "2026-10-01");
  assert.equal(plan.separada.active, true);
});

test("con importe pactado se pregunta cuánto paga lo que queda, y el resto sale con quien se va", () => {
  const sin = planBajaDePaciente(
    cuota({ amount: "300.00" }),
    { patientId: MADRE, quitar: [0], fecha: "2026-09-30" },
    { familia: FAMILIA, hoy: "2026-09-15" }
  );
  assert.match(sin.problema, /importe pactado/);
  const con = planBajaDePaciente(
    cuota({ amount: "300.00" }),
    { patientId: MADRE, quitar: [0], fecha: "2026-09-30", importeQueda: "180" },
    { familia: FAMILIA, hoy: "2026-09-15" }
  );
  assert.equal(con.restante.amount, 180);
  assert.equal(con.separada.amount, 120);
});

test("lo que no vale se dice, no se adivina", () => {
  const base = { patientId: MADRE, quitar: [0], fecha: "2026-06-30" };
  const ctx = { familia: FAMILIA, hoy: "2026-09-15" };
  assert.ok(planBajaDePaciente(cuota({ patientId: HIJO }), base, ctx).problema);
  assert.ok(planBajaDePaciente(cuota(), { ...base, patientId: "de-otra-familia" }, ctx).problema);
  assert.ok(planBajaDePaciente(cuota(), { ...base, quitar: [] }, ctx).problema);
  assert.ok(planBajaDePaciente(cuota(), { ...base, quitar: [0, 1] }, ctx).problema);
  assert.ok(planBajaDePaciente(cuota(), { ...base, quedaPatientId: MADRE }, ctx).problema);
  assert.ok(planBajaDePaciente(cuota(), { ...base, fecha: "ayer" }, ctx).problema);
  // dd/mm/aaaa también vale
  assert.equal(planBajaDePaciente(cuota(), { ...base, fecha: "30/06/2026" }, ctx).problema, undefined);
});
