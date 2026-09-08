// @prueba ligera
/**
 * _smoke-rotulo-sin-nombre.mjs — el nombre del paciente fuera del rótulo del
 * bloqueo (08/09/2026, de los 381 de Aumenta).
 *
 * Lo primero que fija, y lo más importante, es lo que NO hace: con cero
 * candidatos o con varios, el rótulo se queda intacto. Emparejar por nombre es
 * justo lo que falló esta semana con las razones sociales, así que aquí la
 * regla es que ante la duda no se toca.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  palabrasDelNombre,
  pacienteCasaConRotulo,
  pacienteDelRotulo,
  rotuloSinPaciente,
  despiezarRotulo,
} from "../lib/citas/rotuloSinNombre.js";

const ADRIANA = { id: "p-adri", firstName: "Adriana", lastName: "Bustos Manrique" };
const ANDRES = { id: "p-andres", firstName: "Andrés Isaí", lastName: "Quispe Mamani" };
const IZIAR = { id: "p-iziar", firstName: "Iziar", lastName: "Etxebarria Uribe" };
const LUCIA_A = { id: "p-luc1", firstName: "Lucía", lastName: "Bustos Manrique" };
const ANA = { id: "p-ana", firstName: "Ana", lastName: "Gil Roca" };

test("las palabras que sirven para reconocer son las de tres letras o más", () => {
  assert.deepEqual(palabrasDelNombre(ADRIANA), ["ADRIANA", "BUSTOS", "MANRIQUE"]);
  // «de» y «la» no: están en media España y harían casar cualquier cosa.
  assert.deepEqual(palabrasDelNombre({ firstName: "Ana", lastName: "de la Torre" }), ["ANA", "TORRE"]);
});

test("casa por nombre Y primer apellido, no por uno solo", () => {
  assert.equal(pacienteCasaConRotulo(ADRIANA, "RESERVADO PARA ADRIANA BUSTOS, EMPIEZA EL 15/09"), true);
  // Solo el nombre no basta: casaría con todas las Adrianas del centro.
  assert.equal(pacienteCasaConRotulo(ADRIANA, "RESERVADO PARA ADRIANA, EMPIEZA EL 15/09"), false);
  // Solo el apellido tampoco: los hermanos lo comparten.
  assert.equal(pacienteCasaConRotulo(ADRIANA, "RESERVADO BUSTOS"), false);
});

test("las tildes y las mayúsculas no cuentan", () => {
  assert.equal(pacienteCasaConRotulo(ANDRES, "Reservado Andres Quispe, comienza en octubre"), true);
  assert.equal(pacienteCasaConRotulo(IZIAR, "RESERVADO IZIAR ETXEBARRIA"), true);
});

test("con DOS hermanos que casan, no se toca nada", () => {
  // Mismo primer apellido; si el rótulo nombra a los dos, adivinar es peor que
  // no hacer nada: la hora acabaría en la ficha del niño equivocado.
  const rotulo = "RESERVADO ADRIANA Y LUCIA BUSTOS";
  assert.equal(pacienteDelRotulo(rotulo, [ADRIANA, LUCIA_A]), null);
  assert.equal(despiezarRotulo(rotulo, [ADRIANA, LUCIA_A]), null);
});

test("sin ningún candidato tampoco se toca: el niño aún no tiene ficha", () => {
  // Es el caso mayoritario de verdad (298 de 381 en Aumenta): la plaza se
  // guarda ANTES del alta, así que no hay a quién enlazar.
  const rotulo = "RESERVADO PARA MARIO SEPULVEDA, EMPIEZA EL 22/09";
  assert.equal(pacienteDelRotulo(rotulo, [ADRIANA, ANA]), null);
  assert.equal(despiezarRotulo(rotulo, [ADRIANA, ANA]), null);
});

test("el caso real: se va el nombre y se queda la fecha", () => {
  const r = despiezarRotulo("RESERVADO PARA ADRIANA BUSTOS, EMPIEZA EL 15/09", [ADRIANA, ANA]);
  assert.equal(r.patientId, "p-adri");
  assert.equal(r.label, "RESERVADO, EMPIEZA EL 15/09");
});

test("el «Reservado Reservado» que viene de Organízate se colapsa", () => {
  const r = despiezarRotulo("Reservado Reservado Iziar Etxebarria, comienza en octubre", [IZIAR]);
  assert.equal(r.label, "Reservado, comienza en octubre");
});

test("solo el nombre de pila NO basta, aunque sea raro y solo haya uno", () => {
  /*
   * «Reservado Iziar» no se toca. Podría parecer obvio que es ella —es la
   * única Iziar del centro— pero entonces la regla dejaría de ser «nombre y
   * apellido» y pasaría a ser «lo que me parezca». Mañana entra otra Iziar y
   * la hora se le queda a la ficha equivocada. Es el mismo error que las
   * razones sociales, y el precio de evitarlo es dejar sin arreglar unos
   * cuantos rótulos: barato.
   */
  assert.equal(despiezarRotulo("Reservado Reservado Iziar, comienza en octubre", [IZIAR]), null);
});

test("un «para» que se queda sin nombre detrás no se queda colgando", () => {
  const r = despiezarRotulo("Reservado para Ana Gil", [ANA]);
  assert.equal(r.label, "Reservado");
});

test("si al quitar el nombre no queda nada, el rótulo dice «Reservado»", () => {
  const r = despiezarRotulo("Ana Gil", [ANA]);
  assert.equal(r.label, "Reservado");
});

test("lo que no es del nombre se conserva TAL CUAL, con sus mayúsculas", () => {
  const r = despiezarRotulo("RESERVADO PARA ANDRÉS ISAÍ QUISPE, EMPIEZA EL 3 DE OCTUBRE", [ANDRES]);
  assert.match(r.label, /EMPIEZA EL 3 DE OCTUBRE$/);
  assert.equal(/ANDR|ISA|QUISPE/.test(r.label), false, "no puede quedar ni un trozo del nombre");
});

test("un rótulo sin nombre dentro se deja en paz", () => {
  assert.equal(despiezarRotulo("GESTION DOCUMENTAL", [ADRIANA, ANA]), null);
  assert.equal(despiezarRotulo("DESCANSO", [ADRIANA, ANA]), null);
  assert.equal(despiezarRotulo("Reservado T.I.", [ADRIANA, ANA]), null);
});

test("no revienta con basura", () => {
  assert.equal(despiezarRotulo(null, [ADRIANA]), null);
  assert.equal(despiezarRotulo("", [ADRIANA]), null);
  assert.equal(despiezarRotulo("Reservado Ana Gil", null), null);
  assert.equal(rotuloSinPaciente("Reservado", {}), "Reservado");
});

test("el rótulo resultante cabe en la columna", () => {
  const largo = `RESERVADO PARA ANA GIL, ${"X".repeat(300)}`;
  assert.ok(rotuloSinPaciente(largo, ANA).length <= 120);
});
