// @prueba ligera — la parte PURA de lib/clinica/diagnosticoDb.js y sus consultas con modelos de pega; sin base, sin servidor, sin .env.
/**
 * _smoke-diagnostico-db.mjs — lo que el servidor del expediente de
 * diagnóstico decide sobre lo que trae la base (12/09/2026, segunda entrega:
 * «Empezar desde lo que ya hay» y el cobro de la entrevista atado por id).
 *
 *   node --test scripts/_smoke-diagnostico-db.mjs
 *
 * Fija `lib/clinica/diagnosticoDb.js`:
 *   · la ventana de meses (12 por defecto, 36 como mucho) y la fecha desde la
 *     que se mira;
 *   · qué cobro es el de la entrevista: el de la columna
 *     `entrevistaPaymentId` y, sin columna, la fila sin bono;
 *   · `cobrosDeExpedientes` busca primero por `entrevista_payment_id` y por
 *     nota + fecha SOLO para los parados sin columna;
 *   · `adopcionDe`: la entrevista, las horas, el registro y el cobro que
 *     entran en un expediente; con la casilla de citas desmarcada solo la
 *     entrevista; una cita señalada que no es adoptable se rechaza; un cobro
 *     que ya es de otro expediente no se adopta dos veces;
 *   · `filaDeCandidato`: la forma EXACTA de la fila del buscador, y null
 *     cuando el paciente tiene un expediente abierto o nada que meter;
 *   · `filasDe` saca `cobroAlSeguir` con la entrevista descontada y
 *     `dinero.entrevista`, y mezcla `extras`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import {
  MESES_POR_DEFECTO,
  MESES_TOPE,
  mesesDeAdopcion,
  desdeHace,
  cobroDeEntrevistaEntre,
  cobrosDeExpedientes,
  adopcionDe,
  resumenDeCobro,
  filaDeCandidato,
  filasDe,
} from "../lib/clinica/diagnosticoDb.js";

const AHORA = new Date("2026-09-12T10:00:00Z");
const enHoras = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

const PACIENTE = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const EXPEDIENTE = "3f2b9c1e-9d4a-4b1e-8c7d-1a2b3c4d5e6f";
const ISA = "6c1f3a12-9d84-4b77-8e21-0a5f2c7d4b90";

const DIAG = { id: "t-diag", name: "DIAGNÓSTICO", informeTipo: "diagnostico" };
const INFORME = { id: "t-inf", name: "INFORME PARA DIAGNOSTICO", informeTipo: "diagnostico" };
const ENTREVISTA = { id: "t-ent", name: "ENTREVISTA INICIAL", isInitialAssessment: true };
const TIPOS = new Map([DIAG, INFORME, ENTREVISTA].map((t) => [t.id, t]));

const cita = (extra = {}) => ({ id: "c", patientId: PACIENTE, eventTypeId: "t-diag", status: "completed", scheduledAt: enHoras(-48), duration: 60, teamMemberId: ISA, ...extra });

const CITAS = [
  cita({ id: "c1", eventTypeId: "t-ent", scheduledAt: enHoras(-240) }),
  cita({ id: "c2", scheduledAt: enHoras(-168) }),
  cita({ id: "c3", eventTypeId: "t-inf", scheduledAt: enHoras(-96), duration: 45, teamMemberId: "otro" }),
  cita({ id: "c4", scheduledAt: enHoras(48), status: "confirmed", duration: 90 }),
];
const SESIONES = [
  { id: "s-otra", patientId: PACIENTE, bookingId: null, sessionDate: enHoras(-500), diagnosticoId: null },
  { id: "s-ent", patientId: PACIENTE, bookingId: "c1", sessionDate: enHoras(-239), diagnosticoId: null },
];
const COBROS = [
  { id: "p-viejo", patientId: PACIENTE, amount: "50.00", status: "completed", paidAt: enHoras(-900), createdAt: enHoras(-900) },
  { id: "p-nuevo", patientId: PACIENTE, amount: "50.00", status: "completed", paidAt: enHoras(-238), createdAt: enHoras(-238) },
];

describe("la ventana de meses", () => {
  it("12 por defecto, entre 1 y 36, entero", () => {
    assert.equal(MESES_POR_DEFECTO, 12);
    assert.equal(MESES_TOPE, 36);
    assert.equal(mesesDeAdopcion(null), 12);
    assert.equal(mesesDeAdopcion(""), 12);
    assert.equal(mesesDeAdopcion("abc"), 12);
    assert.equal(mesesDeAdopcion("6"), 6);
    assert.equal(mesesDeAdopcion(0), 1);
    assert.equal(mesesDeAdopcion(-3), 1);
    assert.equal(mesesDeAdopcion(100), 36);
    assert.equal(mesesDeAdopcion(2.7), 2);
  });

  it("desdeHace resta meses al ahora", () => {
    const d = desdeHace(12, AHORA);
    assert.equal(d.toISOString(), "2025-09-12T10:00:00.000Z");
    assert.equal(desdeHace("nada", AHORA).toISOString(), "2025-09-12T10:00:00.000Z");
    assert.equal(desdeHace(1, AHORA).toISOString(), "2026-08-12T10:00:00.000Z");
  });
});

describe("cobroDeEntrevistaEntre", () => {
  const cobros = [
    { id: "p-bono", packId: "pk", amount: "600.00", status: "pending" },
    { id: "p-ent", packId: null, amount: "50.00", status: "completed" },
  ];
  it("con columna, el de la columna (aunque tenga bono); sin columna, la fila sin bono; nada, null", () => {
    assert.equal(cobroDeEntrevistaEntre({ entrevistaPaymentId: "p-bono" }, cobros)?.id, "p-bono");
    assert.equal(cobroDeEntrevistaEntre({ entrevistaPaymentId: "no-esta" }, cobros), null, "una columna que apunta a nada no cae a la nota");
    assert.equal(cobroDeEntrevistaEntre({}, cobros)?.id, "p-ent");
    assert.equal(cobroDeEntrevistaEntre({}, [cobros[0]]), null);
    assert.equal(cobroDeEntrevistaEntre(null, null), null);
  });
});

describe("cobrosDeExpedientes: por id primero, por nota solo los parados sin columna", () => {
  const conColumna = { id: "e-col", status: "no_continua", patientId: "pac-1", packId: null, entrevistaPaymentId: "p-col", createdAt: enHoras(-100) };
  const sinColumna = { id: "e-sin", status: "no_continua", patientId: "pac-2", packId: null, entrevistaPaymentId: null, createdAt: enHoras(-100) };
  const enCurso = { id: "e-cur", status: "en_curso", patientId: "pac-3", packId: "pk-3", entrevistaPaymentId: "p-cur", createdAt: enHoras(-100) };
  const filas = [
    { id: "p-col", packId: null, patientId: "pac-1", amount: "50.00", status: "completed", createdAt: enHoras(-90) },
    { id: "p-nota", packId: null, patientId: "pac-2", amount: "50.00", status: "pending", notes: "Entrevista Inicial", createdAt: enHoras(-90) },
    { id: "p-bono", packId: "pk-3", patientId: "pac-3", amount: "600.00", status: "pending", createdAt: enHoras(-80) },
    { id: "p-cur", packId: "pk-viejo", patientId: "pac-3", amount: "50.00", status: "completed", createdAt: enHoras(-95) },
  ];

  it("la consulta pide los ids de la columna, los bonos y la nota solo de los parados sin columna; y reparte cada fila a su expediente", async () => {
    let where = null;
    const Payment = { findAll: async (opts) => { where = opts.where; return filas; } };
    const mapa = await cobrosDeExpedientes({ Payment }, [conColumna, sinColumna, enCurso], { textoEntrevista: "Entrevista Inicial" });

    const condiciones = where[Op.or];
    assert.equal(condiciones.length, 3);
    assert.deepEqual(condiciones[0].id[Op.in].sort(), ["p-col", "p-cur"]);
    assert.deepEqual(condiciones[1].packId[Op.in], ["pk-3"]);
    assert.deepEqual(condiciones[2].patientId[Op.in], ["pac-2"], "el parado CON columna no busca por nota");
    assert.equal(condiciones[2].notes, "Entrevista Inicial");

    assert.deepEqual(mapa.get("e-col").map((f) => f.id), ["p-col"]);
    assert.deepEqual(mapa.get("e-sin").map((f) => f.id), ["p-nota"]);
    assert.deepEqual(mapa.get("e-cur").map((f) => f.id).sort(), ["p-bono", "p-cur"], "el de la columna va al expediente aunque lleve un bono ajeno");
    assert.equal(cobroDeEntrevistaEntre(enCurso, mapa.get("e-cur"))?.id, "p-cur");
  });

  it("sin cobros que buscar no consulta; sin tabla de cobros, mapa vacío", async () => {
    let llamado = false;
    const Payment = { findAll: async () => { llamado = true; return []; } };
    const vacio = await cobrosDeExpedientes({ Payment }, [{ id: "e", status: "entrevista", patientId: "p" }], { textoEntrevista: "x" });
    assert.equal(vacio.size, 0);
    assert.equal(llamado, false);
    const roto = { findAll: async () => { throw { parent: { code: "42P01" } }; } };
    assert.equal((await cobrosDeExpedientes({ Payment: roto }, [conColumna], {})).size, 0);
  });
});

describe("adopcionDe", () => {
  it("la entrevista, las horas, su resumen, el registro de la entrevista por su cita y el cobro más reciente", () => {
    const a = adopcionDe({ citas: CITAS, sesiones: SESIONES, cobros: COBROS, tipos: TIPOS, ahora: AHORA });
    assert.equal(a.entrevista?.id, "c1");
    assert.deepEqual(a.horas.map((c) => c.id), ["c2", "c3", "c4"]);
    assert.deepEqual(a.resumen, { citas: 3, hechas: 2, horasHechas: 1.75, futuras: 1, horasReservadas: 1.5 });
    assert.equal(a.sesionEntrevista?.id, "s-ent");
    assert.equal(a.cobroEntrevista?.id, "p-nuevo");
    assert.equal(a.entrevistaPedidaValida, true);
    assert.equal(a.hayAlgo, true);
  });

  it("sin registro de la cita, el último de entrevista inicial del paciente; un cobro usado por otro expediente no se adopta", () => {
    const a = adopcionDe({ citas: CITAS, sesiones: [SESIONES[0]], cobros: COBROS, tipos: TIPOS, cobrosUsados: ["p-nuevo"], ahora: AHORA });
    assert.equal(a.sesionEntrevista?.id, "s-otra");
    assert.equal(a.cobroEntrevista?.id, "p-viejo");
    assert.equal(adopcionDe({ citas: CITAS, cobros: COBROS, tipos: TIPOS, cobrosUsados: ["p-nuevo", "p-viejo"], ahora: AHORA }).cobroEntrevista, null);
  });

  it("con la casilla de citas desmarcada solo entra la entrevista", () => {
    const a = adopcionDe({ citas: CITAS, sesiones: SESIONES, cobros: COBROS, tipos: TIPOS, conHoras: false, ahora: AHORA });
    assert.equal(a.entrevista?.id, "c1");
    assert.deepEqual(a.horas, []);
    assert.deepEqual(a.resumen, { citas: 0, hechas: 0, horasHechas: 0, futuras: 0, horasReservadas: 0 });
    assert.equal(a.hayAlgo, true);
  });

  it("una cita señalada que no es adoptable se rechaza; una de tipo diagnóstico puede ser la entrevista", () => {
    assert.equal(adopcionDe({ citas: CITAS, tipos: TIPOS, entrevistaBookingId: "no-existe", ahora: AHORA }).entrevistaPedidaValida, false);
    assert.equal(adopcionDe({ citas: CITAS, tipos: TIPOS, entrevistaBookingId: "c2", ahora: AHORA }).entrevista?.id, "c2");
    assert.equal(adopcionDe({ citas: CITAS, tipos: TIPOS, entrevistaBookingId: "c2", ahora: AHORA }).entrevistaPedidaValida, true);
  });

  it("sin entrevista (ni cita ni registro) no hay cobro que descontar; sin nada, hayAlgo es false", () => {
    const soloHoras = adopcionDe({ citas: [CITAS[1]], cobros: COBROS, tipos: TIPOS, ahora: AHORA });
    assert.equal(soloHoras.entrevista, null);
    assert.equal(soloHoras.cobroEntrevista, null);
    assert.equal(soloHoras.hayAlgo, true);
    const soloRegistro = adopcionDe({ sesiones: [SESIONES[0]], cobros: COBROS, tipos: TIPOS, ahora: AHORA });
    assert.equal(soloRegistro.sesionEntrevista?.id, "s-otra");
    assert.equal(soloRegistro.cobroEntrevista?.id, "p-nuevo");
    assert.equal(adopcionDe({ tipos: TIPOS, ahora: AHORA }).hayAlgo, false);
    // Un registro que ya es de un expediente no cuenta.
    assert.equal(adopcionDe({ sesiones: [{ ...SESIONES[0], diagnosticoId: "x" }], tipos: TIPOS, ahora: AHORA }).hayAlgo, false);
  });

  it("resumenDeCobro: { id, importe, status } o null", () => {
    assert.deepEqual(resumenDeCobro({ id: "p", amount: "47.50", status: "pending" }), { id: "p", importe: 47.5, status: "pending" });
    assert.equal(resumenDeCobro(null), null);
    assert.equal(resumenDeCobro({ amount: 1 }), null);
  });
});

describe("filaDeCandidato", () => {
  const paciente = { id: PACIENTE, firstName: "Lea", lastName: "García", clientId: "cli-1" };

  it("la forma exacta de la fila", () => {
    const fila = filaDeCandidato({
      paciente,
      citas: CITAS,
      sesiones: SESIONES,
      cobros: COBROS,
      expedientes: [{ id: "e-viejo", status: "cerrado", entrevistaPaymentId: null }],
      tipos: TIPOS,
      terapeutas: new Map([[ISA, { id: ISA, displayName: "Isa" }]]),
      ahora: AHORA,
      meses: 12,
    });
    assert.deepEqual(fila, {
      paciente: { id: PACIENTE, nombre: "Lea García" },
      clientId: "cli-1",
      terapeutaSugerido: { id: ISA, nombre: "Isa" },
      citasDiagnostico: { total: 3, hechas: 2, horasHechas: 1.75, futuras: 1, horasReservadas: 1.5, primera: enHoras(-168), ultima: enHoras(48) },
      entrevista: { bookingId: "c1", fecha: enHoras(-240), status: "completed", sessionId: "s-ent", cobro: { id: "p-nuevo", importe: 50, status: "completed" } },
      expedientesCerrados: 1,
      resumen: "2 citas ya dadas (1,75 h), 1 futura (1,5 h) y la entrevista del 02/09/2026 (cobrada, 50 €)",
      adoptar: { citas: true, entrevistaBookingId: "c1", meses: 12 },
    });
  });

  it("sin equipo el nombre del sugerido queda null (se rellena después); sin citas con terapeuta, null", () => {
    assert.deepEqual(filaDeCandidato({ paciente, citas: CITAS, tipos: TIPOS, ahora: AHORA }).terapeutaSugerido, { id: ISA, nombre: null });
    assert.equal(filaDeCandidato({ paciente, sesiones: SESIONES, tipos: TIPOS, ahora: AHORA }).terapeutaSugerido, null);
  });

  it("solo un registro de entrevista: entrevista sin cita, sin citas de diagnóstico, y la frase lo dice", () => {
    const fila = filaDeCandidato({ paciente, sesiones: [SESIONES[0]], cobros: [COBROS[0]], tipos: TIPOS, ahora: AHORA });
    assert.equal(fila.citasDiagnostico, null);
    assert.deepEqual(fila.entrevista, { bookingId: null, fecha: enHoras(-500), status: null, sessionId: "s-otra", cobro: { id: "p-viejo", importe: 50, status: "completed" } });
    assert.equal(fila.resumen, "la entrevista del 22/08/2026 (cobrada, 50 €)");
    assert.deepEqual(fila.adoptar, { citas: true, entrevistaBookingId: null, meses: 12 });
  });

  it("null con un expediente abierto, sin paciente o sin nada que meter", () => {
    assert.equal(filaDeCandidato({ paciente, citas: CITAS, expedientes: [{ status: "en_curso" }], tipos: TIPOS, ahora: AHORA }), null);
    assert.equal(filaDeCandidato({ paciente, citas: CITAS, expedientes: [{ status: "entrevista" }], tipos: TIPOS, ahora: AHORA }), null);
    assert.equal(filaDeCandidato({ paciente: null, citas: CITAS, tipos: TIPOS, ahora: AHORA }), null);
    assert.equal(filaDeCandidato({ paciente, tipos: TIPOS, ahora: AHORA }), null);
    // Un cobro ya usado por un expediente cerrado del paciente no vuelve a salir.
    const fila = filaDeCandidato({ paciente, citas: CITAS, cobros: [COBROS[1]], expedientes: [{ status: "no_continua", entrevistaPaymentId: "p-nuevo" }], tipos: TIPOS, ahora: AHORA });
    assert.equal(fila.entrevista.cobro, null);
    assert.equal(fila.expedientesCerrados, 1);
  });
});

describe("filasDe: cobroAlSeguir con la entrevista descontada, dinero.entrevista y extras", () => {
  const expediente = {
    id: EXPEDIENTE,
    patientId: PACIENTE,
    clientId: "cli-1",
    therapistId: ISA,
    productoKey: "simple",
    productoNombre: "Diagnóstico simple",
    horasMax: 10,
    status: "entrevista",
    entrevistaPaymentId: "p-ent",
    conceptId: "c-simple",
  };
  const catalogo = {
    tipos: [],
    tipoDiagnostico: null,
    tipoEntrevista: null,
    conceptoEntrevista: null,
    conceptos: [{ id: "c-simple", name: "Diagnóstico Simple", unitPrice: "350.00", active: true }],
  };
  const tenantModels = {
    Booking: { findAll: async () => [] },
    Payment: { findAll: async () => [{ id: "p-ent", packId: null, patientId: PACIENTE, amount: "50.00", status: "completed", refundedAt: null, createdAt: enHoras(-10) }] },
    Patient: { findAll: async () => [{ id: PACIENTE, firstName: "Lea", lastName: "García" }] },
    TeamMember: { findAll: async () => [{ id: ISA, displayName: "Isa" }] },
  };

  it("350 − 50 = 300 con la coletilla; el dinero de la entrevista sale aparte y en cobrado; extras se mezclan", async () => {
    const [fila] = await filasDe({
      tenantModels,
      expedientes: [expediente],
      catalogo,
      ahora: AHORA,
      extras: new Map([[EXPEDIENTE, { registros: [{ id: "s1", sessionDate: enHoras(-5), status: "registered" }] }]]),
    });
    assert.deepEqual(fila.cobroAlSeguir, { importe: 300, descuento: 50, texto: "Diagnóstico Simple (descontada la entrevista inicial de 50 €)" });
    assert.deepEqual(fila.dinero, { pendiente: 0, cobrado: 50, devuelto: 0, entrevista: { id: "p-ent", importe: 50, status: "completed" } });
    assert.equal(fila.entrevistaPaymentId, "p-ent");
    assert.equal(fila.paciente.nombre, "Lea García");
    assert.equal(fila.terapeuta.nombre, "Isa");
    assert.equal(fila.registros.length, 1);
    assert.equal(fila.registros[0].url, `/pacientes/${PACIENTE}/sesiones/s1`);
  });

  it("sin cobro de entrevista, el precio entero y sin descuento; extras como función", async () => {
    const [fila] = await filasDe({
      tenantModels: { ...tenantModels, Payment: { findAll: async () => [] } },
      expedientes: [{ ...expediente, entrevistaPaymentId: null }],
      catalogo,
      ahora: AHORA,
      extras: (e) => ({ siguienteTitulo: `Sesión de diagnóstico 9 (${e.id.slice(0, 4)})` }),
    });
    assert.deepEqual(fila.cobroAlSeguir, { importe: 350, descuento: 0, texto: "Diagnóstico Simple" });
    assert.equal(fila.dinero.entrevista, null);
    assert.equal(fila.siguienteTitulo, "Sesión de diagnóstico 9 (3f2b)");
  });
});
