// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tipos-de-cuota.mjs — el catálogo visto desde los pacientes y el curso
 * escolar como unidad de tiempo (09/09/2026).
 *
 *   node scripts/_smoke-tipos-de-cuota.mjs
 *   node --test-name-pattern="curso" scripts/_smoke-tipos-de-cuota.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 *
 * Aumenta, en papel: «diferentes tipos de cuotas; dentro de cada cuota, una
 * pestaña con los pacientes asignados donde se pueda agregar o quitar, otra
 * con el paciente a nivel facturación (cuota, precio y concepto de factura) y
 * otra donde se puedan crear, modificar o eliminar cuotas de todos los meses
 * del curso escolar (SEP-JUN)».
 *
 * Lo que aquí se fija, por lo que DEVUELVE:
 *
 *  - EL CURSO NO ES EL AÑO: va de septiembre a junio y cruza el 31 de
 *    diciembre. Julio y agosto no son de ningún curso (el centro cierra).
 *  - «AL MES» NO SUMA CUOTAS COMPARTIDAS: una cuota de logopedia + psicología
 *    no es de este tipo, es de los dos. Se suman solo las que llevan este
 *    concepto y nada más, y las otras se cuentan aparte.
 *  - QUITAR UN PACIENTE DE UN TIPO NO ES DARLE DE BAJA: si paga más cosas, se
 *    le quita esa y sigue. Solo cuando es lo único que paga hay baja.
 *  - NADIE SE CUENTA DOS VECES: dos cuotas de la misma familia son un paciente
 *    (o los pacientes de la familia), no dos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cursoDeMes,
  mesesDelCurso,
  esDelCurso,
  rotuloCurso,
  mesCorto,
  cursosParaElegir,
  tramoDelCurso,
} from "../lib/billing/cursoEscolar.js";
import {
  resumenPorTipo,
  comoQuitarElTipo,
  contarPacientes,
  filaDeCuota,
  ordenarFilas,
  cuotaLlevaTipo,
} from "../lib/billing/tiposDeCuota.js";

/* ── El curso escolar ─────────────────────────────────────────────────────── */

describe("el curso escolar va de septiembre a junio", () => {
  it("tiene diez meses y cruza el año", () => {
    const meses = mesesDelCurso(2026);
    assert.equal(meses.length, 10);
    assert.equal(meses[0], "2026-09");
    assert.equal(meses[3], "2026-12");
    assert.equal(meses[4], "2027-01");
    assert.equal(meses.at(-1), "2027-06");
  });

  it("julio y agosto no son de ningún curso", () => {
    assert.equal(esDelCurso("2027-07", 2026), false);
    assert.equal(esDelCurso("2027-08", 2026), false);
    assert.equal(esDelCurso("2027-06", 2026), true);
  });

  it("un mes sabe a qué curso pertenece", () => {
    assert.equal(cursoDeMes("2026-10"), 2026);
    assert.equal(cursoDeMes("2027-03"), 2026); // el mismo curso, otro año
    assert.equal(cursoDeMes("2027-09"), 2027);
    // Verano: cuenta como el curso que acaba de terminar (en julio se cierra
    // la facturación de junio, no se mira ya el curso que viene).
    assert.equal(cursoDeMes("2027-07"), 2026);
    assert.equal(cursoDeMes("no es un mes"), null);
  });

  it("se llama como lo escribe el centro", () => {
    assert.equal(rotuloCurso(2026), "2026/27");
    assert.equal(rotuloCurso(2029), "2029/30");
    assert.equal(rotuloCurso(1999), "1999/00");
    assert.equal(mesCorto("2026-09"), "sep");
    assert.equal(mesCorto("2027-01"), "ene");
  });

  it("el desplegable ofrece el curso que viene y los de atrás, del más nuevo al más viejo", () => {
    assert.deepEqual(cursosParaElegir(2026, { atras: 2, adelante: 1 }), [2027, 2026, 2025, 2024]);
  });

  it("el tramo del curso acota la consulta", () => {
    assert.deepEqual(tramoDelCurso(2026), { desde: "2026-09-01", hasta: "2027-06-30" });
    assert.equal(tramoDelCurso("mal"), null);
  });
});

/* ── El catálogo visto desde los pacientes ────────────────────────────────── */

const LOGO = { id: "11111111-1111-4111-8111-111111111111", name: "Cuota Logopedia 60x2", unitPrice: 190, vatRate: 0, active: true };
const PSICO = { id: "22222222-2222-4222-8222-222222222222", name: "Cuota Psicología 60x1", unitPrice: 95, vatRate: 0, active: true };
const EI = { id: "33333333-3333-4333-8333-333333333333", name: "Entrevista inicial", description: "Entrevista inicial", unitPrice: 50, vatRate: 0, active: true };

const cuota = (over = {}) => ({
  id: "c1",
  clientId: "f1",
  patientId: null,
  conceptIds: [LOGO.id],
  amount: null,
  active: true,
  startDate: "2026-09-01",
  endDate: null,
  familiaPacientes: [{ id: "p1", firstName: "Hugo", lastName: "Castro" }],
  client: { name: "Familia Castro" },
  ...over,
});

describe("cuánto lleva cada tipo de cuota", () => {
  const conceptos = [LOGO, PSICO, EI];
  const hoy = "2026-09-09";

  it("cuenta las cuotas vivas y las de baja por separado", () => {
    const { tipos } = resumenPorTipo({
      conceptos,
      hoy,
      cuotas: [
        cuota({ id: "a" }),
        cuota({ id: "b", clientId: "f2", familiaPacientes: [{ id: "p2", firstName: "Ana", lastName: "Ruiz" }] }),
        cuota({ id: "c", clientId: "f3", active: false, familiaPacientes: [{ id: "p3", firstName: "Iker", lastName: "Sanz" }] }),
      ],
    });
    const logo = tipos.find((t) => t.id === LOGO.id);
    assert.equal(logo.cuotas, 2);
    assert.equal(logo.bajas, 1);
    assert.equal(logo.pacientes, 2); // el de baja no cuenta
    assert.equal(logo.alMes, 380);
  });

  it("una cuota con dos conceptos no suma en «al mes» de ninguno, y se dice", () => {
    const { tipos } = resumenPorTipo({
      conceptos,
      hoy,
      cuotas: [cuota({ id: "a", conceptIds: [LOGO.id, PSICO.id] }), cuota({ id: "b", clientId: "f2" })],
    });
    const logo = tipos.find((t) => t.id === LOGO.id);
    const psico = tipos.find((t) => t.id === PSICO.id);
    assert.equal(logo.cuotas, 2);
    assert.equal(logo.soloSuyas, 1);
    assert.equal(logo.compartidas, 1);
    assert.equal(logo.alMes, 190); // solo la que lleva este tipo y nada más
    assert.equal(psico.compartidas, 1);
    assert.equal(psico.alMes, 0);
  });

  it("el importe pactado manda sobre el precio del catálogo", () => {
    const { tipos } = resumenPorTipo({ conceptos, hoy, cuotas: [cuota({ amount: 150 })] });
    assert.equal(tipos.find((t) => t.id === LOGO.id).alMes, 150);
  });

  it("un tipo que no tiene a nadie sigue en la lista, a cero", () => {
    const { tipos } = resumenPorTipo({ conceptos, hoy, cuotas: [] });
    const ei = tipos.find((t) => t.id === EI.id);
    assert.equal(ei.cuotas, 0);
    assert.equal(ei.pacientes, 0);
    assert.equal(ei.alMes, 0);
  });

  it("una cuota sin conceptos no se reparte por ahí: se cuenta aparte", () => {
    const { tipos, sinTipo } = resumenPorTipo({ conceptos, hoy, cuotas: [cuota({ conceptIds: [], amount: 120 })] });
    assert.equal(sinTipo.cuotas, 1);
    assert.equal(tipos.every((t) => t.cuotas === 0), true);
  });

  it("un concepto borrado del catálogo no desaparece: sale diciendo que ya no está", () => {
    const { tipos } = resumenPorTipo({ conceptos: [PSICO], hoy, cuotas: [cuota()] });
    const huerfano = tipos.find((t) => t.id === LOGO.id);
    assert.equal(huerfano.enElCatalogo, false);
    assert.equal(huerfano.cuotas, 1);
  });
});

describe("a cuántos pacientes cubre un tipo", () => {
  it("dos cuotas de la misma familia no son dos pacientes", () => {
    const r = contarPacientes([cuota({ id: "a" }), cuota({ id: "b" })]);
    assert.equal(r.pacientes, 1);
    assert.equal(r.familias, 1);
  });

  it("con paciente asignado cuenta ese, no todos los hermanos", () => {
    const r = contarPacientes([
      cuota({
        patientId: "p1",
        familiaPacientes: [{ id: "p1", firstName: "Hugo" }, { id: "p9", firstName: "Marta" }],
      }),
    ]);
    assert.equal(r.pacientes, 1);
  });

  it("sin módulo asistencial se cuentan las familias y se dice cuántas van sin paciente", () => {
    const r = contarPacientes([cuota({ familiaPacientes: [] })]);
    assert.equal(r.pacientes, 0);
    assert.equal(r.familias, 1);
    assert.equal(r.cuotasSinPaciente, 1);
  });
});

describe("quitarle un paciente a un tipo de cuota", () => {
  it("si paga más cosas, se le quita solo esa", () => {
    const r = comoQuitarElTipo(cuota({ conceptIds: [LOGO.id, PSICO.id] }), LOGO.id);
    assert.equal(r.accion, "quitar-concepto");
    assert.deepEqual(r.conceptIds, [PSICO.id]);
  });

  it("si es lo único que paga, es una baja (nunca un borrado)", () => {
    assert.equal(comoQuitarElTipo(cuota(), LOGO.id).accion, "dar-de-baja");
  });

  it("si esa cuota no lleva ese tipo, no se toca nada", () => {
    assert.equal(comoQuitarElTipo(cuota(), PSICO.id).accion, "nada");
  });

  it("cuotaLlevaTipo no se equivoca con los ids que llegan como número", () => {
    assert.equal(cuotaLlevaTipo({ conceptIds: [7] }, "7"), true);
    assert.equal(cuotaLlevaTipo({ conceptIds: null }, "7"), false);
  });
});

describe("la fila de la ficha del tipo", () => {
  const porId = new Map([[LOGO.id, LOGO], [EI.id, EI]]);

  it("lleva el paciente, el precio y el texto que sale en la factura", () => {
    const f = filaDeCuota(cuota({ conceptIds: [EI.id] }), { conceptosPorId: porId, hoy: "2026-09-09" });
    assert.equal(f.paciente, "Hugo Castro");
    assert.equal(f.pacienteEsDeLaFamilia, true);
    assert.equal(f.familia, "Familia Castro");
    assert.equal(f.importe, 50);
    assert.equal(f.importeDe, "conceptos");
    assert.equal(f.conceptos[0].textoFactura, "Entrevista inicial");
    assert.equal(f.deBaja, false);
  });

  it("dice cuándo el precio es el pactado con esa familia y no el del catálogo", () => {
    const f = filaDeCuota(cuota({ amount: 160 }), { conceptosPorId: porId });
    assert.equal(f.importe, 160);
    assert.equal(f.importePactado, 160);
    assert.equal(f.importeDe, "pactado");
  });

  it("las bajas caen al final y el resto va por paciente", () => {
    const filas = ordenarFilas([
      { paciente: "Zoe", deBaja: false },
      { paciente: "Ana", deBaja: true },
      { paciente: "Iker", deBaja: false },
    ]);
    assert.deepEqual(filas.map((f) => f.paciente), ["Iker", "Zoe", "Ana"]);
  });
});
