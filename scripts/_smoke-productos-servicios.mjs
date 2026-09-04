// @prueba ligera — función pura; sin base, sin servidor, sin .env.
/**
 * _smoke-productos-servicios.mjs — la pestaña «Servicios» de Productos mide lo
 * que hay, y no inventa (04/09/2026, Aumenta por Rodrigo).
 *
 *   node scripts/_smoke-productos-servicios.mjs
 *
 * El encargo: «ahí saldrán todas las citas y las cuotas asignadas a cada cita
 * para medir de forma tanto terapéutica como económica a qué están apuntados
 * los pacientes y qué deben pagar».
 *
 * Lo que se fija aquí es lo que puede mentir sin que se note:
 *
 *   · **Los pacientes se cuentan una vez.** Un niño con dos cuotas del mismo
 *     servicio es UN paciente apuntado, aunque pague dos. Contar cuotas y
 *     llamarlas pacientes infla la mitad terapéutica de la tabla.
 *   · **El dinero se cuenta por cuota.** Ese mismo niño paga dos veces, así que
 *     «al mes» son dos. Son dos preguntas distintas y por eso son dos columnas.
 *   · **Una cuota a nombre de la familia no es un paciente**: se aparta en
 *     `sinPaciente`, que es justo la lista de lo que hay que repasar.
 *   · **Un concepto borrado del catálogo no crea fila.** Si una cuota apunta a
 *     algo que ya no existe, se ignora en vez de pintar un servicio fantasma
 *     sin nombre ni precio.
 *   · **Los tipos de cita sin cuota se listan**, porque sus citas nacen sin
 *     decir de qué se cobran: es la mitad del encargo que queda por hacer.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { componerServicios } from "../lib/productos/servicios.js";

const LOGO = { id: "c-logo", name: "Cuota Logopedia 45x1", unitPrice: "145.00" };
const PSICO = { id: "c-psico", name: "Cuota Psicología 45x1", unitPrice: "145.00" };
const HHSS = { id: "c-hhss", name: "Cuota HHSS", unitPrice: "80.00" };
const CONCEPTOS = [LOGO, PSICO, HHSS];

const cuota = (conceptIds, patientId = null) => ({ id: `q${Math.random()}`, clientId: "f1", patientId, conceptIds });

describe("lo terapéutico: quién está apuntado", () => {
  it("cuenta pacientes DISTINTOS, no cuotas", () => {
    const { servicios } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-logo"], "nino-a"), cuota(["c-logo"], "nino-b"), cuota(["c-logo"], "nino-a")],
    });
    const logo = servicios.find((s) => s.id === "c-logo");
    assert.equal(logo.pacientes, 2, "dos niños, aunque uno tenga dos cuotas");
    assert.equal(logo.cuotas, 3);
  });

  it("una cuota a nombre de la familia no cuenta como paciente, pero se dice", () => {
    const { servicios } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-psico"], null), cuota(["c-psico"], "nino-a")],
    });
    const psico = servicios.find((s) => s.id === "c-psico");
    assert.equal(psico.pacientes, 1);
    assert.equal(psico.sinPaciente, 1);
  });

  it("los tipos de cita que cubren el servicio salen en su fila", () => {
    const { servicios, sinCuota } = componerServicios({
      conceptos: CONCEPTOS,
      tipos: [
        { id: "t1", name: "Logopedia 45", conceptId: "c-logo" },
        { id: "t2", name: "Logopedia 45 (tarde)", conceptId: "c-logo" },
        { id: "t3", name: "Sesión (importada)", conceptId: null },
      ],
    });
    assert.deepEqual(servicios.find((s) => s.id === "c-logo").tipos.map((t) => t.nombre), [
      "Logopedia 45",
      "Logopedia 45 (tarde)",
    ]);
    assert.deepEqual(sinCuota.map((t) => t.nombre), ["Sesión (importada)"]);
  });
});

describe("lo económico: cuánto suma", () => {
  it("«al mes» son las cuotas vivas por su precio, no los pacientes", () => {
    const { servicios, totales } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-logo"], "nino-a"), cuota(["c-logo"], "nino-a"), cuota(["c-hhss"], "nino-b")],
    });
    assert.equal(servicios.find((s) => s.id === "c-logo").alMes, 290);
    assert.equal(servicios.find((s) => s.id === "c-hhss").alMes, 80);
    assert.equal(totales.alMes, 370);
  });

  it("una cuota con varios conceptos suma en todos", () => {
    const { servicios } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-logo", "c-psico"], "nino-a")],
    });
    assert.equal(servicios.find((s) => s.id === "c-logo").cuotas, 1);
    assert.equal(servicios.find((s) => s.id === "c-psico").cuotas, 1);
  });

  it("las citas del mes se cuelgan de su servicio", () => {
    const { servicios, totales } = componerServicios({
      conceptos: CONCEPTOS,
      citasPorConcepto: { "c-logo": 8, "c-hhss": 4 },
    });
    assert.equal(servicios.find((s) => s.id === "c-logo").citas, 8);
    assert.equal(servicios.find((s) => s.id === "c-psico").citas, 0);
    assert.equal(totales.citas, 12);
  });

  it("los servicios salen de más dinero a menos", () => {
    const { servicios } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-hhss"], "a"), cuota(["c-logo"], "b"), cuota(["c-logo"], "c")],
    });
    assert.deepEqual(servicios.map((s) => s.id), ["c-logo", "c-hhss", "c-psico"]);
  });
});

describe("lo que no se inventa", () => {
  it("un concepto que ya no está en el catálogo no crea servicio fantasma", () => {
    const { servicios } = componerServicios({
      conceptos: [LOGO],
      cuotas: [cuota(["c-logo"], "a"), cuota(["c-borrado"], "b")],
    });
    assert.equal(servicios.length, 1);
    assert.equal(servicios[0].cuotas, 1);
  });

  it("los totales cuentan cada paciente una vez aunque tenga dos servicios", () => {
    const { totales } = componerServicios({
      conceptos: CONCEPTOS,
      cuotas: [cuota(["c-logo"], "nino-a"), cuota(["c-psico"], "nino-a"), cuota(["c-hhss"], "nino-b")],
    });
    assert.equal(totales.pacientes, 2);
    assert.equal(totales.conCuotaViva, 3);
  });

  it("sin nada que leer, ceros y ninguna fila rara", () => {
    const vacio = componerServicios();
    assert.deepEqual(vacio.servicios, []);
    assert.deepEqual(vacio.sinCuota, []);
    assert.equal(vacio.totales.alMes, 0);
    assert.equal(vacio.totales.pacientes, 0);
    assert.equal(componerServicios({ conceptos: [{ name: "sin id" }] }).servicios.length, 0);
  });
});
