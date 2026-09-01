// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-pacientes.mjs — filtrar las cuotas POR PACIENTE cuando la cuota
 * es de la familia (01/09/2026, Rodrigo: «en cuotas, que el filtro salga
 * también por paciente, no solo por cliente»).
 *
 * ── EL NÚMERO QUE LO EXPLICA ────────────────────────────────────────────────
 * En producción, el 01/09/2026: **274 cuotas activas en Aumenta, 15 con
 * paciente**. Las otras 259 vienen del volcado del Organízate, donde la cuota
 * es de la familia. Buscar por el nombre del niño no encontraba nada en el 95%
 * de las filas, y la columna «Paciente» era una raya.
 *
 * La regla que arregla eso —una cuota sin paciente cubre a los pacientes de su
 * familia— es la que se fija aquí. Lo que NO puede pasar es que la pantalla
 * afirme un reparto que nadie ha hecho: por eso el rótulo dice «toda la
 * familia» y `pacientesDeCuota` devuelve de dónde salen los nombres.
 *
 *   node scripts/_smoke-cuota-pacientes.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  cuotaCasaCon,
  pacientesDeCuota,
  rotuloPacienteDeCuota,
  textoBuscableDeCuota,
} from "../lib/billing/cuotaPacientes.js";

const HUGO = { id: "p1", firstName: "Hugo", lastName: "Castro" };
const MARTA = { id: "p2", firstName: "Marta", lastName: "Castro" };
const FAMILIA = { id: "c1", name: "Vanesa Muñoz", fiscalName: "Vanesa Muñoz Álvarez" };

const deLaFamilia = { id: "q1", client: FAMILIA, patient: null, familiaPacientes: [HUGO, MARTA] };
const deHugo = { id: "q2", client: FAMILIA, patient: HUGO, familiaPacientes: [HUGO, MARTA] };

test("con paciente asignado, es de ese paciente y se dice tal cual", () => {
  assert.deepEqual(pacientesDeCuota(deHugo), { nombres: ["Hugo Castro"], deLaFamilia: false });
  assert.equal(rotuloPacienteDeCuota(deHugo), "Hugo Castro");
});

test("sin paciente, cubre a los de su familia — y se dice que es de la familia", () => {
  assert.deepEqual(pacientesDeCuota(deLaFamilia), {
    nombres: ["Hugo Castro", "Marta Castro"],
    deLaFamilia: true,
  });
  assert.equal(rotuloPacienteDeCuota(deLaFamilia), "Hugo Castro, Marta Castro (toda la familia)");
});

test("buscar por el nombre del niño encuentra la cuota de su familia", () => {
  assert.equal(cuotaCasaCon(deLaFamilia, "hugo"), true);
  assert.equal(cuotaCasaCon(deLaFamilia, "Marta"), true);
  assert.equal(cuotaCasaCon(deLaFamilia, "castro"), true);
  assert.equal(cuotaCasaCon(deLaFamilia, "lucía"), false);
});

test("y por la familia, que es como se buscaba hasta hoy", () => {
  assert.equal(cuotaCasaCon(deLaFamilia, "vanesa"), true);
  assert.equal(cuotaCasaCon(deLaFamilia, "Álvarez"), true); // la razón fiscal también
  assert.equal(cuotaCasaCon(deLaFamilia, ""), true); // sin texto, casan todas
  assert.equal(cuotaCasaCon(deLaFamilia, "   "), true);
});

test("una cuota sin nada no revienta ni inventa", () => {
  assert.deepEqual(pacientesDeCuota(null), { nombres: [], deLaFamilia: true });
  assert.equal(rotuloPacienteDeCuota({ client: FAMILIA }), "—");
  assert.equal(rotuloPacienteDeCuota(null), "—");
  assert.equal(textoBuscableDeCuota(null), "");
  assert.equal(cuotaCasaCon({ client: FAMILIA }, "hugo"), false);
});

test("con muchos hermanos se corta, pero se dice cuántos faltan", () => {
  const muchos = {
    client: FAMILIA,
    patient: null,
    familiaPacientes: [HUGO, MARTA, { firstName: "Ana" }, { firstName: "Leo" }, { firstName: "Iván" }],
  };
  assert.equal(rotuloPacienteDeCuota(muchos), "Hugo Castro, Marta Castro, Ana +2 (toda la familia)");
  // Cortar la etiqueta no puede cortar la BÚSQUEDA: los de más también casan.
  assert.equal(cuotaCasaCon(muchos, "iván"), true);
});
