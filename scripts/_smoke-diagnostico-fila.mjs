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
 *     rótulo, urls de alta en Citas y de informe, permisos y acciones;
 *   · la entrevista se deduce de las citas si Citas no escribió la columna.
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
    assert.deepEqual(fila.dinero, { pendiente: 350, cobrado: 0, devuelto: 0 });
    assert.equal(fila.packId, "pk-1");
  });

  it("las urls: alta en Citas (entrevista y horas) e informe del paciente", () => {
    assert.equal(fila.urls.entrevista, `/citas?nueva=1&diagnostico=${ID}&tramo=entrevista&paciente=${PACIENTE}&duracion=60`);
    assert.equal(fila.urls.horas, `/citas?nueva=1&diagnostico=${ID}&tramo=horas&paciente=${PACIENTE}`);
    assert.equal(fila.urls.informe, `/pacientes/${PACIENTE}?informe=diagnostico`);
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
    assert.deepEqual(Object.keys(conCitas.citas[0]), ["id", "scheduledAt", "duration", "status", "tramo", "teamMemberId", "packId", "sessionNumber"]);
    assert.equal(conCitas.citas[0].tramo, "entrevista");
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
