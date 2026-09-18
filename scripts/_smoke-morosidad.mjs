// @prueba ligera
/**
 * Cómo se lee la lista de morosos (`lib/billing/morosidad.js`, 09/09/2026).
 *
 * Lo que se prueba es lo que Rosa no podía hacer: separar quién debe de verdad
 * de quién no tiene cuota escrita, ver el importe, y que el buscador de la
 * pantalla mueva también esta lista.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  entraEnMorosidad,
  cobroDelPaciente,
  cuotasDelPaciente,
  pagadoresDelPaciente,
  etiquetaDeMoroso,
  filtrarMorosos,
  repartirMorosos,
  resumenDeMorosidad,
  textoDeMeses,
  totalDeMorosidad,
} from "../lib/billing/morosidad.js";
import { mesesSeguidosSinPagar, mesesSinPagarSeguidos } from "../lib/billing/mesesSinPagar.js";

const CON_CUOTA = { clientId: "1", name: "Familia Álvarez", tieneCuota: true, debe: 60, conceptos: ["Logopedia"] };
const CON_CUOTA_MESES = { clientId: "2", name: "Familia Bueno", tieneCuota: true, mesesSeguidos: 3, conceptos: ["Psicología"] };
const SIN_CUOTA = { clientId: "3", name: "Familia Cuesta", tieneCuota: false, mesesSeguidos: 2, conceptos: [] };

test("de Baja o En pausa no se sale en Morosidad (15/09/2026)", () => {
  assert.equal(entraEnMorosidad({ status: "active" }, { status: "active" }), true);
  assert.equal(entraEnMorosidad({ status: "active" }, null), true);
  assert.equal(entraEnMorosidad({ status: "discharged" }, { status: "active" }), false);
  assert.equal(entraEnMorosidad({ status: "paused" }, { status: "active" }), false);
  assert.equal(entraEnMorosidad({ status: "active" }, { status: "inactive" }), false);
  assert.equal(entraEnMorosidad({ status: "active" }, { status: "paused" }), false);
  // «No vino» con un paciente activo sigue saliendo: esa ficha no la toca la regla.
  assert.equal(entraEnMorosidad({ status: "active" }, { status: "prospect" }), true);
});

test("reparte por si la familia tiene cuota escrita", () => {
  const { conCuota, sinCuota } = repartirMorosos([CON_CUOTA, SIN_CUOTA, CON_CUOTA_MESES]);
  assert.deepEqual(conCuota.map((m) => m.clientId), ["1", "2"]);
  assert.deepEqual(sinCuota.map((m) => m.clientId), ["3"]);
});

test("sin `tieneCuota` la familia cae del lado de las que no la tienen", () => {
  // Un cliente viejo de la caché del navegador no trae el campo: mejor que
  // salga bajo el rótulo honesto que disfrazado de deuda.
  const { conCuota, sinCuota } = repartirMorosos([{ clientId: "9", name: "X" }]);
  assert.equal(conCuota.length, 0);
  assert.equal(sinCuota.length, 1);
});

test("el importe manda sobre el número de meses", () => {
  assert.equal(etiquetaDeMoroso(CON_CUOTA).texto, "debe 60,00 €");
  assert.equal(etiquetaDeMoroso(CON_CUOTA).tono, "importe");
});

test("con cuota y sin importe, se cuentan los meses y suben de tono", () => {
  assert.equal(etiquetaDeMoroso(CON_CUOTA_MESES).texto, "3 meses");
  assert.equal(etiquetaDeMoroso(CON_CUOTA_MESES).tono, "grave");
  assert.equal(etiquetaDeMoroso({ tieneCuota: true, mesesSeguidos: 1 }).texto, "1 mes");
  assert.equal(etiquetaDeMoroso({ tieneCuota: true, mesesSeguidos: 2 }).tono, "medio");
});

test("sin cuota escrita no se cuentan meses: se dice que no hay cuota", () => {
  // Es el caso de 683 de las 959 familias de Aumenta. Contarle meses a quien
  // nadie le ha escrito una cuota es acusarle de una deuda inventada.
  assert.equal(etiquetaDeMoroso(SIN_CUOTA).texto, "sin cuota escrita");
});

test("un importe se enseña aunque la familia no tenga cuota escrita", () => {
  // Puede pasar: un cobro suelto pendiente sin cuota detrás. Si hay un importe
  // de verdad, gana.
  assert.equal(etiquetaDeMoroso({ tieneCuota: false, debe: 12.5 }).texto, "debe 12,50 €");
});

test("el buscador filtra por nombre, contacto y concepto", () => {
  const lista = [CON_CUOTA, CON_CUOTA_MESES, SIN_CUOTA];
  assert.deepEqual(filtrarMorosos(lista, "bueno").map((m) => m.clientId), ["2"]);
  assert.deepEqual(filtrarMorosos(lista, "logopedia").map((m) => m.clientId), ["1"]);
  assert.deepEqual(filtrarMorosos(lista, "cuesta").map((m) => m.clientId), ["3"]);
});

test("el buscador ignora acentos y mayúsculas", () => {
  // «Álvarez» escrito sin tilde tiene que encontrarla: es como se teclea.
  assert.equal(filtrarMorosos([CON_CUOTA], "ALVAREZ").length, 1);
  assert.equal(filtrarMorosos([CON_CUOTA], "álvarez").length, 1);
});

test("sin texto no se filtra nada", () => {
  const lista = [CON_CUOTA, SIN_CUOTA];
  assert.equal(filtrarMorosos(lista, "").length, 2);
  assert.equal(filtrarMorosos(lista, "   ").length, 2);
});

test("el resumen cuenta pacientes, en singular y en plural", () => {
  const r = resumenDeMorosidad({ conCuota: [CON_CUOTA], sinCuota: [SIN_CUOTA, CON_CUOTA_MESES], alDia: 274, pacientes: 1049 });
  assert.equal(r.conCuota, "1 paciente debe este mes");
  assert.equal(r.sinCuota, "2 pacientes activos sin cuota escrita");
  assert.equal(r.alDia, "274 al día · 1049 pacientes activos");
});

test("el buscador encuentra al paciente por el nombre de su familia", () => {
  const nino = { patientId: "p1", name: "Lucas Pérez", familia: "Marta Gómez", tieneCuota: true };
  assert.equal(filtrarMorosos([nino], "gomez").length, 1);
  assert.equal(filtrarMorosos([nino], "lucas").length, 1);
});

// ── Por paciente (15/09/2026, Rodrigo) ──────────────────────────────────────
const LUCAS = { id: "p1", clientId: "f1" };
const ANA = { id: "p2", clientId: "f1" };

test("la cuota con paciente es solo suya; la de la familia, de todos sus hijos", () => {
  const cuotas = [
    { id: "c1", clientId: "f1", patientId: "p1" },
    { id: "c2", clientId: "f1", patientId: null },
    { id: "c3", clientId: "f2", patientId: null },
  ];
  assert.deepEqual(cuotasDelPaciente(LUCAS, cuotas).map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(cuotasDelPaciente(ANA, cuotas).map((c) => c.id), ["c2"]);
});

test("pagar la de un hermano no deja al otro al día", () => {
  // El fallo que se pidió arreglar: la familia salía al día con un solo cobro.
  const pagadores = pagadoresDelPaciente(ANA, []);
  const cobroDeLucas = { clientId: "f1", patientId: "p1" };
  assert.equal(cobroDelPaciente(LUCAS, cobroDeLucas, pagadoresDelPaciente(LUCAS, [])), true);
  assert.equal(cobroDelPaciente(ANA, cobroDeLucas, pagadores), false);
});

test("un cobro de la familia sin paciente cuenta para los dos hermanos", () => {
  const cobro = { clientId: "f1", patientId: null };
  assert.equal(cobroDelPaciente(LUCAS, cobro, pagadoresDelPaciente(LUCAS, [])), true);
  assert.equal(cobroDelPaciente(ANA, cobro, pagadoresDelPaciente(ANA, [])), true);
  assert.equal(cobroDelPaciente(LUCAS, { clientId: "f9", patientId: null }, pagadoresDelPaciente(LUCAS, [])), false);
});

test("quien paga la cuota del niño cuenta como pagador suyo", () => {
  // La fundación que paga la cuota de Lucas: su cobro sin paciente es de Lucas.
  const cuotas = [{ clientId: "f1", payerClientId: "fundacion", patientId: "p1" }];
  const pagadores = pagadoresDelPaciente(LUCAS, cuotas);
  assert.deepEqual([...pagadores].sort(), ["f1", "fundacion"]);
  assert.equal(cobroDelPaciente(LUCAS, { clientId: "fundacion", patientId: null }, pagadores), true);
  assert.equal(cobroDelPaciente(ANA, { clientId: "fundacion", patientId: null }, pagadoresDelPaciente(ANA, [])), false);
});

// ── Importe y mes (18/09/2026, Rosa) ────────────────────────────────────────

test("los meses que debe se dicen por su nombre", () => {
  assert.equal(textoDeMeses([{ mes: "2026-09" }]), "septiembre");
  assert.equal(textoDeMeses([{ mes: "2026-09" }, { mes: "2026-08" }]), "septiembre, agosto");
  assert.equal(textoDeMeses(["2026-09", "2026-08"]), "septiembre, agosto");
});

test("el año solo sale cuando hay más de uno", () => {
  // En diciembre→enero hace falta; dentro del mismo año estorba.
  assert.equal(textoDeMeses([{ mes: "2027-01" }, { mes: "2026-12" }]), "enero 2027, diciembre 2026");
});

test("la etiqueta lleva el importe y los meses a la vez", () => {
  const m = { tieneCuota: true, debe: 120, mesesDebe: [{ mes: "2026-09", importe: 60 }, { mes: "2026-08", importe: 60 }] };
  const e = etiquetaDeMoroso(m);
  assert.equal(e.texto, "debe 120,00 €");
  assert.equal(e.meses, "septiembre, agosto");
});

test("un mes sin importe se nombra igual, y la pastilla vuelve a contar meses", () => {
  // Es la mitad honesta: el CRM sabe QUÉ mes no se pagó aunque no sepa cuánto.
  const e = etiquetaDeMoroso({ tieneCuota: true, mesesSeguidos: 2, mesesDebe: [{ mes: "2026-09", importe: null }, { mes: "2026-08", importe: null }] });
  assert.equal(e.texto, "2 meses");
  assert.equal(e.meses, "septiembre, agosto");
});

test("los miles se separan con punto", () => {
  // «22256,97 €» hay que contarlo con el dedo; el total de la cabecera son miles.
  assert.equal(etiquetaDeMoroso({ debe: 22256.97 }).texto, "debe 22.256,97 €");
});

test("el total suma solo a quien trae importe, y dice de cuántos", () => {
  const lista = [{ debe: 60 }, { debe: 120.5 }, { debe: null }, {}];
  assert.deepEqual(totalDeMorosidad(lista), { total: 180.5, conImporte: 2, sinImporte: 2 });
  assert.deepEqual(totalDeMorosidad([]), { total: 0, conImporte: 0, sinImporte: 0 });
});

test("el resumen enseña el total arriba, y calla si no sabe ninguno", () => {
  const r = resumenDeMorosidad({ conCuota: [{ debe: 60 }, { debe: null }], sinCuota: [{ debe: null }] });
  assert.equal(r.totalConCuota, "60,00 € en 1 de 2");
  assert.equal(r.totalSinCuota, null);
  const todos = resumenDeMorosidad({ conCuota: [{ debe: 60 }, { debe: 40 }] });
  assert.equal(todos.totalConCuota, "100,00 € en total");
});

test("contar meses y nombrarlos no pueden discrepar", () => {
  // El contador es la longitud de la lista, literalmente: si un día dejan de
  // cuadrar, la pantalla diría «3 meses» y nombraría dos.
  const caso = { meses: ["2026-09", "2026-08", "2026-07", "2026-06"], pagados: new Set(["2026-07"]), primerMes: "2026-01" };
  assert.deepEqual(mesesSinPagarSeguidos(caso), ["2026-09", "2026-08"]);
  assert.equal(mesesSeguidosSinPagar(caso), 2);
  // Y no se acusa de antes de que el centro cobrara por el CRM.
  assert.deepEqual(mesesSinPagarSeguidos({ ...caso, pagados: new Set(), primerMes: "2026-08" }), ["2026-09", "2026-08"]);
});

test("aguanta que no le pasen nada", () => {
  assert.deepEqual(repartirMorosos(), { conCuota: [], sinCuota: [] });
  assert.deepEqual(filtrarMorosos(), []);
  assert.equal(typeof etiquetaDeMoroso().texto, "string");
  assert.equal(etiquetaDeMoroso().meses, "");
  assert.equal(textoDeMeses(), "");
  assert.equal(textoDeMeses([{ mes: "no-es-un-mes" }, null]), "");
});
