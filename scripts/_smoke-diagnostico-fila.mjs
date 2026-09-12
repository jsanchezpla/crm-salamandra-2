// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-diagnostico-fila.mjs — la FILA que devuelve la API de diagnósticos y
 * el cobro con nombre propio del bono de un diagnóstico (12/09/2026).
 *
 *   node --test scripts/_smoke-diagnostico-fila.mjs
 *
 * Fija `lib/clinica/diagnosticoFila.js`:
 *   · qué estados pide cada filtro de la lista (en_curso = abiertos, cerrado =
 *     los demás, todos = sin filtro);
 *   · qué botones tiene cada estado y que parar/seguir/desbloquear solo salen
 *     a quien decide;
 *   · el dinero: pendiente, cobrado y devuelto se suman por separado y
 *     `cobroPendiente` apunta a la primera fila pendiente con el TOTAL que
 *     falta (un pendiente partido en dos sigue siendo una deuda);
 *   · la forma exacta de la fila: paciente, producto, terapeuta, barra,
 *     rótulo, urls de alta en Citas, del expediente, del nuevo registro y del
 *     informe (solo si existe), permisos y acciones;
 *   · la entrevista se deduce de las citas si Citas no escribió la columna;
 *   · segunda entrega (12/09/2026): el dinero de ESTE expediente
 *     (`dinero.entrevista`, `cobroAlSeguir`), los registros por fecha con su
 *     enlace, el `siguienteTitulo`, y cada cita con `sessionId` y
 *     `urls.registro` (seguir el que hay o estrenar uno con `cita=`).
 *
 * Y `lib/billing/cobroDelBono.js`: con `texto`, `conceptId` e `invoiceText` el
 * pendiente del bono se llama como el producto; sin ellos, exactamente como
 * hasta hoy (los bonos de siempre no cambian de nombre).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filtroDeEstado,
  accionesDe,
  dineroDe,
  filaDeExpediente,
  entrevistaEntre,
  textoEnFacturaDe,
  centimosDe,
  nombreDe,
  agrupaPor,
  MOTIVO_SIN_PERMISO_DIAGNOSTICO,
} from "../lib/clinica/diagnosticoFila.js";
import { cobroPendienteDeBono } from "../lib/billing/cobroDelBono.js";

const ID = "3f2b9c1e-9d4a-4b1e-8c7d-1a2b3c4d5e6f";
const PACIENTE = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const AHORA = new Date("2026-09-12T10:00:00Z");
const enHoras = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();
// Dos profesionales con id de verdad: la cola de la URL solo cuelga `prof` si es un uuid.
const ISA = "6c1f3a12-9d84-4b77-8e21-0a5f2c7d4b90";
const SILVIA = "7d2e4b23-ae95-4c88-9f32-1b6a3d8e5ca1";

const EXPEDIENTE = {
  id: ID,
  patientId: PACIENTE,
  clientId: "cli-1",
  therapistId: "tm-1",
  productoKey: "simple",
  productoNombre: "Diagnóstico simple",
  horasMax: "10.0", // como lo entrega el driver: texto
  status: "en_curso",
  packId: "pk-1",
  createdAt: "2026-09-01T09:00:00.000Z",
};

describe("filtroDeEstado", () => {
  it("por defecto (y con en_curso) pide los abiertos", () => {
    assert.deepEqual(filtroDeEstado(undefined), ["entrevista", "en_curso"]);
    assert.deepEqual(filtroDeEstado("en_curso"), ["entrevista", "en_curso"]);
  });
  it("cerrado pide los que ya no están abiertos", () => {
    assert.deepEqual(filtroDeEstado("cerrado"), ["no_continua", "cerrado"]);
    assert.deepEqual(filtroDeEstado("cerrados"), ["no_continua", "cerrado"]);
  });
  it("todos es sin filtro", () => {
    assert.equal(filtroDeEstado("todos"), null);
  });
});

describe("accionesDe", () => {
  it("en entrevista: abrir la entrevista para todos; parar y seguir solo para quien decide", () => {
    assert.deepEqual(accionesDe({ status: "entrevista", puedeDecidir: false }), {
      abrirEntrevista: true, parar: false, seguir: false, anadirHoras: false, desbloquear: false, cerrar: true,
    });
    assert.deepEqual(accionesDe({ status: "entrevista", puedeDecidir: true }), {
      abrirEntrevista: true, parar: true, seguir: true, anadirHoras: false, desbloquear: true, cerrar: true,
    });
  });
  it("en curso: añadir horas; desbloquear solo quien decide", () => {
    const a = accionesDe({ status: "en_curso", puedeDecidir: true });
    assert.equal(a.anadirHoras, true);
    assert.equal(a.desbloquear, true);
    assert.equal(a.parar, false);
    assert.equal(a.seguir, false);
    assert.equal(accionesDe({ status: "en_curso", puedeDecidir: false }).desbloquear, false);
  });
  it("cerrado: nada; no continúa: solo cerrar", () => {
    assert.deepEqual(Object.values(accionesDe({ status: "cerrado", puedeDecidir: true })), [false, false, false, false, false, false]);
    const nc = accionesDe({ status: "no_continua", puedeDecidir: true });
    assert.equal(nc.cerrar, true);
    assert.equal(nc.desbloquear, false);
  });
  it("la frase del 403 nombra a quien sí puede", () => {
    assert.match(MOTIVO_SIN_PERMISO_DIAGNOSTICO, /dirección/);
    assert.match(MOTIVO_SIN_PERMISO_DIAGNOSTICO, /Facturación/);
  });
});

describe("dineroDe", () => {
  it("sin cobros, todo a cero y sin pendiente", () => {
    assert.deepEqual(dineroDe([]), { pendiente: 0, cobrado: 0, devuelto: 0, cobroPendiente: null });
    assert.deepEqual(dineroDe(null).cobroPendiente, null);
  });
  it("un pendiente partido en dos sigue siendo UNA deuda, apuntando a la primera fila", () => {
    const d = dineroDe([
      { id: "p1", amount: "150.00", status: "pending" },
      { id: "p2", amount: "200.00", status: "pending" },
      { id: "p3", amount: "300.00", status: "completed" },
    ]);
    assert.equal(d.pendiente, 350);
    assert.equal(d.cobrado, 300);
    assert.deepEqual(d.cobroPendiente, { id: "p1", importe: 350, status: "pending" });
  });
  it("devuelto es dinero que entró y salió: ni cobrado ni deuda", () => {
    const d = dineroDe([{ id: "p1", amount: 50, status: "completed", refundedAt: "2026-09-10" }]);
    assert.equal(d.devuelto, 50);
    assert.equal(d.cobrado, 0);
    assert.equal(d.cobroPendiente, null);
  });
});

describe("filaDeExpediente", () => {
  const citas = [
    { id: "c1", diagnosticoTramo: "entrevista", status: "completed", scheduledAt: enHoras(-72), duration: 60 },
    { id: "c2", diagnosticoTramo: "horas", status: "completed", scheduledAt: enHoras(-48), duration: 90 },
    { id: "c3", diagnosticoTramo: "horas", status: "confirmed", scheduledAt: enHoras(24), duration: 60 },
  ];
  const fila = filaDeExpediente({
    expediente: EXPEDIENTE,
    citas,
    paciente: { id: PACIENTE, firstName: "Ana", lastName: "Pérez" },
    terapeuta: { id: "tm-1", displayName: "Isa" },
    cobros: [{ id: "p1", amount: "350.00", status: "pending" }],
    puedeDecidir: true,
    ahora: AHORA,
  });

  it("paciente, producto y terapeuta con nombre", () => {
    assert.deepEqual(fila.paciente, { id: PACIENTE, nombre: "Ana Pérez" });
    assert.deepEqual(fila.producto, { key: "simple", nombre: "Diagnóstico simple" });
    assert.deepEqual(fila.terapeuta, { id: "tm-1", nombre: "Isa" });
    assert.equal(fila.status, "en_curso");
    assert.equal(fila.rotuloEstado, "En curso");
    assert.equal(fila.abierto, true);
  });

  it("la barra se cuenta desde las citas: entrevista 1 + 1,5 hechas + 1 reservada de 10", () => {
    assert.equal(fila.horas.max, 10);
    assert.equal(fila.horas.entrevista, 1);
    assert.equal(fila.horas.hechas, 1.5);
    assert.equal(fila.horas.reservadas, 1);
    assert.equal(fila.horas.libres, 6.5);
    assert.equal(fila.rotuloHoras, "2,5 de 10 h · 1 reservada");
    assert.deepEqual(fila.tramos.map((t) => t.clave), ["entrevista", "hechas", "reservadas", "libres"]);
    assert.equal(fila.horasMax, 10);
  });

  it("el dinero y el cobro pendiente", () => {
    assert.deepEqual(fila.cobroPendiente, { id: "p1", importe: 350, status: "pending" });
    assert.deepEqual(fila.dinero, { pendiente: 350, cobrado: 0, devuelto: 0, entrevista: null });
    assert.equal(fila.packId, "pk-1");
  });

  it("las urls: alta en Citas (entrevista y horas), el expediente y el nuevo registro; el informe solo si existe", () => {
    assert.equal(fila.urls.entrevista, `/citas?nueva=1&diagnostico=${ID}&tramo=entrevista&paciente=${PACIENTE}&duracion=60`);
    assert.equal(fila.urls.horas, `/citas?nueva=1&diagnostico=${ID}&tramo=horas&paciente=${PACIENTE}`);
    assert.equal(fila.urls.expediente, `/clinica/diagnosticos/${ID}`);
    // Segunda entrega: el informe nace desde el expediente; sin él, sin enlace
    // (antes llevaba a la ficha con `?informe=diagnostico`).
    assert.equal(fila.urls.informe, null);
    assert.equal(fila.informe, null);
    // «Nuevo registro»: sin cita, tramo horas, firmado por el asignado, con el
    // título que toca y la plantilla de la sesión de diagnóstico.
    const q = new URL(fila.urls.nuevoRegistro, "http://x");
    assert.equal(q.pathname, `/pacientes/${PACIENTE}/sesiones/nueva`);
    assert.equal(q.searchParams.get("preparar"), "1");
    assert.equal(q.searchParams.get("plantilla"), "sesion_diagnostico");
    // «tm-1» no es un uuid y la cola lo acota (como `profesionalDePreparacion`): con uno de verdad, firma el asignado.
    assert.equal(q.searchParams.has("prof"), false);
    const conUuid = filaDeExpediente({ expediente: { ...EXPEDIENTE, therapistId: ISA }, ahora: AHORA });
    assert.equal(new URL(conUuid.urls.nuevoRegistro, "http://x").searchParams.get("prof"), ISA);
    assert.equal(q.searchParams.get("diagnostico"), ID);
    assert.equal(q.searchParams.get("titulo"), "Sesión de diagnóstico 1");
    assert.equal(q.searchParams.has("cita"), false);
    assert.equal(fila.siguienteTitulo, "Sesión de diagnóstico 1");
  });

  it("con informe, el enlace va al informe y la fila lo resume", () => {
    const con = filaDeExpediente({
      expediente: { ...EXPEDIENTE, informeId: "inf-1" },
      informe: { id: "inf-1", status: "draft", statusLabel: "Borrador", reportDate: "2026-09-12" },
      ahora: AHORA,
    });
    assert.deepEqual(con.informe, { id: "inf-1", status: "draft", statusLabel: "Borrador", reportDate: "2026-09-12", url: "/clinica/informes/inf-1" });
    assert.equal(con.urls.informe, "/clinica/informes/inf-1");
    assert.equal(con.informeId, "inf-1");
    // Solo la columna, sin la fila del informe: el enlace sale igual (la API
    // limpia la columna si el informe se borró).
    assert.equal(filaDeExpediente({ expediente: { ...EXPEDIENTE, informeId: "inf-2" }, ahora: AHORA }).urls.informe, "/clinica/informes/inf-2");
  });

  it("el dinero de ESTE expediente: la entrevista cobrada y lo que costará seguir (12/09/2026)", () => {
    const con = filaDeExpediente({
      expediente: { ...EXPEDIENTE, status: "entrevista" },
      cobroEntrevista: { id: "pe-1", amount: "50.00", status: "completed" },
      cobroAlSeguir: { importe: 300, descuento: 50, texto: "Diagnóstico Simple (descontada la entrevista inicial de 50 €)" },
      ahora: AHORA,
    });
    assert.deepEqual(con.dinero.entrevista, { id: "pe-1", importe: 50, status: "completed" });
    assert.equal(con.entrevistaPaymentId, "pe-1");
    assert.deepEqual(con.cobroAlSeguir, { importe: 300, descuento: 50, texto: "Diagnóstico Simple (descontada la entrevista inicial de 50 €)" });
    // La columna manda sobre la fila encontrada por nota+fecha.
    assert.equal(filaDeExpediente({ expediente: { ...EXPEDIENTE, entrevistaPaymentId: "pe-col" }, cobroEntrevista: { id: "pe-1", amount: 50, status: "completed" }, ahora: AHORA }).entrevistaPaymentId, "pe-col");
    // Sin nada: null en los dos, y la forma de `dinero` con su clave.
    assert.equal(fila.dinero.entrevista, null);
    assert.equal(fila.cobroAlSeguir, null);
    assert.equal(fila.entrevistaPaymentId, null);
    // `cobroAlSeguir` también acepta la salida de `cobroDelProducto` tal cual.
    assert.deepEqual(
      filaDeExpediente({ expediente: EXPEDIENTE, cobroAlSeguir: { conceptId: "c", texto: "X", importeEuros: 600, descuentoEuros: 50 }, ahora: AHORA }).cobroAlSeguir,
      { importe: 600, descuento: 50, texto: "X" }
    );
  });

  it("los registros van por fecha, numerados, con quien firma y su enlace", () => {
    const registros = [
      { id: "s2", sessionDate: "2026-09-05T10:00:00Z", therapistId: "tm-2", status: "registered", bookingId: "c2", contentSections: { plantilla: "sesion_diagnostico" } },
      { id: "s1", sessionDate: "2026-09-01T10:00:00Z", therapistId: "tm-1", status: "published", bookingId: "c1", contentSections: { plantilla: "entrevista_inicial" } },
      { id: "s3", sessionDate: "2026-09-08T10:00:00Z", therapistId: null, status: "draft", titulo: "Pruebas WISC-V" },
    ];
    const terapeutas = new Map([["tm-1", { id: "tm-1", displayName: "Isa" }], ["tm-2", { id: "tm-2", displayName: "Silvia" }]]);
    const con = filaDeExpediente({ expediente: EXPEDIENTE, registros, terapeutas, ahora: AHORA });
    assert.deepEqual(
      con.registros.map((r) => [r.id, r.titulo, r.esEntrevista, r.terapeuta?.nombre ?? null, r.url]),
      [
        ["s1", "Entrevista inicial", true, "Isa", `/pacientes/${PACIENTE}/sesiones/s1`],
        ["s2", "Sesión de diagnóstico 1", false, "Silvia", `/pacientes/${PACIENTE}/sesiones/s2`],
        ["s3", "Pruebas WISC-V", false, null, `/pacientes/${PACIENTE}/sesiones/s3`],
      ]
    );
    assert.equal(con.siguienteTitulo, "Sesión de diagnóstico 3");
    // Y el que viene ya calculado manda.
    assert.equal(filaDeExpediente({ expediente: EXPEDIENTE, registros, siguienteTitulo: "Lo que sea", ahora: AHORA }).siguienteTitulo, "Lo que sea");
    assert.deepEqual(fila.registros, []);
  });

  it("permisos y acciones van con la fila", () => {
    assert.deepEqual(fila.permisos, { puedeDecidir: true });
    assert.equal(fila.acciones.anadirHoras, true);
    assert.equal(fila.acciones.seguir, false);
  });

  it("la entrevista se deduce de las citas cuando la columna está vacía", () => {
    assert.equal(fila.entrevistaBookingId, "c1");
    assert.deepEqual(fila.entrevista, { id: "c1", scheduledAt: enHoras(-72), status: "completed" });
    // Y la columna manda si Citas la escribió.
    const conColumna = filaDeExpediente({ expediente: { ...EXPEDIENTE, entrevistaBookingId: "otra" }, citas, ahora: AHORA });
    assert.equal(conColumna.entrevistaBookingId, "otra");
  });

  it("sin citas la fila no lleva la lista; con conCitas sí, resumida", () => {
    assert.equal("citas" in fila, false);
    const conCitas = filaDeExpediente({ expediente: EXPEDIENTE, citas, ahora: AHORA, conCitas: true });
    assert.equal(conCitas.citas.length, 3);
    assert.deepEqual(Object.keys(conCitas.citas[0]), ["id", "scheduledAt", "duration", "status", "tramo", "teamMemberId", "packId", "sessionNumber", "sessionId", "urls"]);
    assert.equal(conCitas.citas[0].tramo, "entrevista");
  });

  it("cada cita dice si ya tiene registro y a dónde ir: seguirlo o estrenarlo con la cita (12/09/2026)", () => {
    const conCitas = filaDeExpediente({
      expediente: { ...EXPEDIENTE, therapistId: ISA },
      citas: citas.map((c) => ({ ...c, teamMemberId: c.id === "c2" ? SILVIA : null })),
      sesionesPorCita: new Map([["c1", "s1"]]),
      registros: [{ id: "s1", bookingId: "c1", sessionDate: enHoras(-72), contentSections: { plantilla: "entrevista_inicial" } }],
      ahora: AHORA,
      conCitas: true,
    });
    const [c1, c2, c3] = conCitas.citas;
    // La entrevista ya tiene registro: se sigue.
    assert.equal(c1.sessionId, "s1");
    assert.equal(c1.urls.registro, `/pacientes/${PACIENTE}/sesiones/s1`);
    // Una hora sin registro: se estrena con la cita, su fecha, SU profesional y la plantilla de sesión.
    assert.equal(c2.sessionId, null);
    const q2 = new URL(c2.urls.registro, "http://x");
    assert.equal(q2.pathname, `/pacientes/${PACIENTE}/sesiones/nueva`);
    assert.equal(q2.searchParams.get("cita"), "c2");
    assert.equal(q2.searchParams.get("fecha"), enHoras(-48));
    assert.equal(q2.searchParams.get("prof"), SILVIA);
    assert.equal(q2.searchParams.get("plantilla"), "sesion_diagnostico");
    assert.equal(q2.searchParams.get("diagnostico"), ID);
    assert.equal(q2.searchParams.get("titulo"), "Sesión de diagnóstico 1");
    // Sin profesional en la cita, firma el asignado del expediente.
    assert.equal(new URL(c3.urls.registro, "http://x").searchParams.get("prof"), ISA);
    // Y una entrevista sin registro se estrena con SU plantilla y su título.
    const sinRegistro = filaDeExpediente({ expediente: EXPEDIENTE, citas, ahora: AHORA, conCitas: true }).citas[0];
    const q1 = new URL(sinRegistro.urls.registro, "http://x");
    assert.equal(q1.searchParams.get("plantilla"), "entrevista_inicial");
    assert.equal(q1.searchParams.get("titulo"), "Entrevista inicial");
    // También vale un objeto plano como mapa.
    assert.equal(filaDeExpediente({ expediente: EXPEDIENTE, citas, sesionesPorCita: { c3: "s9" }, ahora: AHORA, conCitas: true }).citas[2].sessionId, "s9");
  });

  it("un paciente borrado no tumba la fila", () => {
    const sin = filaDeExpediente({ expediente: EXPEDIENTE, citas: [], paciente: null, ahora: AHORA });
    assert.deepEqual(sin.paciente, { id: PACIENTE, nombre: "(paciente borrado)" });
    assert.equal(sin.terapeuta, null);
    assert.equal(sin.rotuloHoras, "0 de 10 h");
    assert.equal(sin.cobroPendiente, null);
  });

  it("acepta una instancia con toJSON", () => {
    const instancia = { toJSON: () => ({ ...EXPEDIENTE }) };
    assert.equal(filaDeExpediente({ expediente: instancia, ahora: AHORA }).id, ID);
  });
});

describe("entrevistaEntre", () => {
  it("prefiere la entrevista que no esté cancelada, y la última si todas lo están", () => {
    const cancelada = { id: "e1", diagnosticoTramo: "entrevista", status: "cancelled", scheduledAt: "2026-09-01" };
    const viva = { id: "e2", diagnosticoTramo: "entrevista", status: "confirmed", scheduledAt: "2026-09-08" };
    assert.equal(entrevistaEntre([cancelada, viva]).id, "e2");
    assert.equal(entrevistaEntre([viva, cancelada]).id, "e2");
    assert.equal(entrevistaEntre([cancelada]).id, "e1");
    assert.equal(entrevistaEntre([{ id: "h1", diagnosticoTramo: "horas", status: "completed" }]), null);
    assert.equal(entrevistaEntre([]), null);
  });
});

describe("piezas pequeñas", () => {
  it("textoEnFacturaDe: la descripción del concepto y, vacía, su nombre", () => {
    assert.equal(textoEnFacturaDe({ name: "Diagnóstico Simple", description: "Valoración diagnóstica" }), "Valoración diagnóstica");
    assert.equal(textoEnFacturaDe({ name: "Diagnóstico Simple", description: "  " }), "Diagnóstico Simple");
    assert.equal(textoEnFacturaDe(null), null);
  });
  it("centimosDe: euros → céntimos enteros, o null si no es un importe", () => {
    assert.equal(centimosDe(350), 35000);
    assert.equal(centimosDe(17.55), 1755);
    assert.equal(centimosDe(null), null);
    assert.equal(centimosDe(-1), null);
    assert.equal(centimosDe("abc"), null);
  });
  it("nombreDe: nombre y apellidos, displayName o name; nunca vacío", () => {
    assert.equal(nombreDe({ firstName: "Ana", lastName: "Pérez" }), "Ana Pérez");
    assert.equal(nombreDe({ displayName: "Isa" }), "Isa");
    assert.equal(nombreDe({ name: "Familia López" }), "Familia López");
    assert.equal(nombreDe({}), "(sin nombre)");
    assert.equal(nombreDe(null), null);
  });
  it("agrupaPor reparte por clave y descarta lo que no la tiene", () => {
    const m = agrupaPor([{ diagnosticoId: ID, id: 1 }, { diagnosticoId: ID, id: 2 }, { diagnosticoId: null, id: 3 }], "diagnosticoId");
    assert.equal(m.get(ID).length, 2);
    assert.equal(m.size, 1);
  });
});

describe("el cobro del bono de un diagnóstico se llama como su producto", () => {
  const BASE = { amount: 35000, clientId: "cli-1", patientId: PACIENTE, packId: "pk-1", nombre: "DIAGNÓSTICO", sesiones: null };

  it("con texto, concepto y texto de factura", () => {
    const c = cobroPendienteDeBono({ ...BASE, conceptId: "con-1", texto: "Diagnóstico Simple", invoiceText: "Valoración diagnóstica" });
    assert.equal(c.notes, "Diagnóstico Simple");
    assert.equal(c.conceptId, "con-1");
    assert.equal(c.invoiceText, "Valoración diagnóstica");
    assert.equal(c.amount, 350);
    assert.equal(c.status, "pending");
    assert.equal(c.periodMonth, null);
  });

  it("sin ellos, exactamente como hasta hoy: los bonos de siempre no cambian de nombre", () => {
    const c = cobroPendienteDeBono({ ...BASE, sesiones: 5 });
    assert.equal(c.notes, "Bono «DIAGNÓSTICO» · 5 sesiones");
    assert.equal(c.conceptId, null);
    assert.equal(c.invoiceText, null);
    // Un texto en blanco no borra el nombre de siempre.
    assert.equal(cobroPendienteDeBono({ ...BASE, sesiones: 5, texto: "   ", invoiceText: "" }).notes, "Bono «DIAGNÓSTICO» · 5 sesiones");
  });
});
