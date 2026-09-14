// @prueba ligera — funciones puras de lib/citas; sin base, sin servidor, sin .env.
/**
 * _smoke-auditoria-citas-limpieza.mjs — una fila VIEJA de auditoría de una cita
 * queda igual que la que escribe hoy la app (14/09/2026).
 *
 *   node scripts/_smoke-auditoria-citas-limpieza.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Hasta el 13/09/2026 las citas volcaban la fila entera en master.audit_logs
 * (1.550 filas) y la huella de un borrado guardaba el nombre (129). Jorge
 * decidió reescribirlas en sitio con `scripts/limpiar-auditoria-citas.js`, que
 * llama a `limpiarFilaDeCita` (`lib/citas/limpiarAuditoriaDeCita.js`).
 * Ver docs/decisions/2026-09-13-la-auditoria-de-una-cita-no-lleva-al-paciente.md
 *
 * Qué fija, con filas de las formas medidas en producción el 14/09:
 *   1. alta (panel, reserva pública, desde un bloqueo), edición (con y sin
 *      reembolso), cancelación y huella de borrado: el resultado es EXACTAMENTE
 *      lo que escribe hoy la ruta con las funciones de `resumenDeCita.js`;
 *   2. ningún valor privado sobrevive;
 *   3. idempotencia: lo limpiado, y lo escrito ya con el arreglo, devuelve null
 *      (no se toca).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resumenDeCita,
  fijosDeCita,
  cambiosDeCita,
  huellaDeCita,
  ladosParaAuditar,
} from "../lib/citas/resumenDeCita.js";
import {
  limpiarFilaDeCita,
  ladoConDatosPrivados,
  identidadDeCita,
} from "../lib/citas/limpiarAuditoriaDeCita.js";

const CENTINELAS = [
  "Nombre Centinela",
  "centinela@example.com",
  "600111222",
  "adicional-centinela",
  "nota-centinela",
  "falta-centinela",
  "respuesta-centinela",
  "cobro-centinela",
  "tok-centinela",
];

/** Así queda en jsonb lo que se guardó: fechas en texto, sin Date. */
const comoEnBase = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));

/** La fila entera de `bookings` tal y como la volcaba `row.toJSON()`. */
function citaVolcada(cambios = {}) {
  return comoEnBase({
    id: "b-1",
    eventTypeId: "et-1",
    clientName: "Nombre Centinela",
    clientEmail: "centinela@example.com",
    clientPhone: "600111222",
    additionalData: "adicional-centinela",
    scheduledAt: new Date("2026-10-05T08:30:00.000Z"),
    duration: 50,
    modality: "presencial",
    meetUrl: null,
    status: "confirmed",
    reminderSentAt: null,
    cancellationToken: "tok-centinela",
    cancelledAt: null,
    cancellationReason: null,
    noShowJustified: false,
    noShowReason: "falta-centinela",
    recoveredByBookingId: null,
    teamMemberId: "tm-1",
    patientId: "pa-1",
    clientId: "cl-1",
    paymentStatus: "none",
    amount: "45.00",
    holdExpiresAt: null,
    authorizationExpiresAt: null,
    paymentSessionId: null,
    packId: null,
    sessionNumber: 3,
    formAnswers: { p1: "respuesta-centinela" },
    tallerGrupoId: null,
    cobroModo: "concepto",
    cobroConceptId: "cc-1",
    cobroTexto: "cobro-centinela",
    cobroImporte: 0,
    notes: "nota-centinela",
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
    ...cambios,
  });
}

/** Lo que escribe hoy `logCitasAudit`, ya guardado. */
const loQueEscribeHoy = (before, after) =>
  comoEnBase(ladosParaAuditar({ entity: "Booking", before, after }));

function sinPrivados(valor, donde) {
  const json = JSON.stringify(valor);
  for (const c of CENTINELAS) assert.ok(!json.includes(c), `${donde}: se ha colado «${c}» → ${json}`);
  assert.ok(!ladoConDatosPrivados(valor.before) && !ladoConDatosPrivados(valor.after), `${donde}: quedan claves privadas`);
}

function limpiar(fila, opciones) {
  const r = limpiarFilaDeCita(comoEnBase(fila), opciones);
  assert.ok(r, "una fila con datos privados tiene que limpiarse");
  const guardada = { tipo: r.tipo, ...comoEnBase({ before: r.before, after: r.after }) };
  sinPrivados(guardada, fila.action);
  // Idempotencia: lanzarlo otra vez no la toca.
  assert.equal(limpiarFilaDeCita({ action: fila.action, ...guardada }), null, "limpiada dos veces cambiaría");
  return guardada;
}

describe("alta", () => {
  it("desde el panel: resumen + source, como bookings/route.js", () => {
    const cita = citaVolcada();
    const r = limpiar({ action: "citas.booking_created", before: null, after: { ...cita, source: "manual" } });
    assert.equal(r.tipo, "alta");
    assert.deepEqual(r, { tipo: "alta", ...loQueEscribeHoy(null, { ...resumenDeCita(cita), source: "manual" }) });
  });

  it("desde un bloqueo: conserva el bloqueo de `before` y los recuentos de asistentes", () => {
    const cita = citaVolcada({ tallerGrupoId: "tg-1" });
    const bloqueo = { bloqueo: { id: "bl-1", label: "Taller", startAt: "2026-10-05T08:30:00.000Z", teamMemberId: "tm-1" } };
    const montado = { asistentes: 4, impartidores: 2 };
    const r = limpiar({
      action: "citas.booking_created",
      before: bloqueo,
      after: { ...cita, source: "convertir-bloqueos-en-citas-de-taller", ...montado },
    });
    assert.deepEqual(
      r,
      { tipo: "alta", ...loQueEscribeHoy(bloqueo, { ...resumenDeCita(cita), source: "convertir-bloqueos-en-citas-de-taller", ...montado }) }
    );
  });

  it("de las primeras (sin clientId ni equipo, fila sin tenant)", () => {
    const vieja = citaVolcada();
    for (const k of ["clientId", "patientId", "teamMemberId", "amount", "cobroModo", "cobroConceptId", "cobroTexto", "cobroImporte", "formAnswers"]) delete vieja[k];
    const r = limpiar({ action: "citas.booking_created", before: null, after: { ...vieja, source: "landing" } });
    assert.deepEqual(r.after, comoEnBase({ ...resumenDeCita(vieja), source: "landing" }));
  });
});

describe("edición", () => {
  it("guarda fijos + qué cambió, lo privado solo por nombre, y el reembolso", () => {
    const antes = citaVolcada();
    const despues = citaVolcada({
      scheduledAt: "2026-10-06T09:00:00.000Z",
      clientPhone: "600999999",
      notes: "nota-centinela otra",
      status: "no_show",
      updatedAt: "2026-09-03T10:00:00.000Z",
    });
    const reembolso = { importe: 45, estado: "hecho" };
    const r = limpiar({ action: "citas.booking_updated", before: antes, after: { ...despues, reembolso } });

    // Lo mismo que el PATCH de app/api/citas/bookings/[id]/route.js.
    const cambios = cambiosDeCita(antes, despues);
    const hoy = loQueEscribeHoy(
      { ...fijosDeCita(antes), ...cambios.antes },
      { ...fijosDeCita(despues), ...cambios.despues, cambiadosSinValor: cambios.cambiadosSinValor, reembolso }
    );
    assert.deepEqual(r, { tipo: "edicion", ...hoy });
    assert.deepEqual(r.after.cambiadosSinValor, ["clientPhone", "notes"]);
    assert.equal(r.before.scheduledAt, "2026-10-05T08:30:00.000Z");
    assert.equal(r.after.status, "no_show");
  });

  it("sin cambios privados no pone `cambiadosSinValor`", () => {
    const antes = citaVolcada();
    const despues = citaVolcada({ duration: 60 });
    const r = limpiar({ action: "citas.booking_updated", before: antes, after: despues });
    assert.ok(!("cambiadosSinValor" in r.after));
    assert.deepEqual(r.before, { ...fijosDeCita(antes), duration: 50 });
  });
});

describe("cancelación", () => {
  it("`before` pasa a resumen; `after` (estado, motivo, dinero) no se toca", () => {
    const cita = citaVolcada();
    const after = { status: "cancelled", cancellationReason: "motivo", dinero: { devuelto: false } };
    const r = limpiar({ action: "citas.booking_cancelled", before: cita, after });
    assert.deepEqual(r, { tipo: "cancelacion", ...loQueEscribeHoy(resumenDeCita(cita), after) });
  });
});

describe("huella de borrado", () => {
  const vieja = {
    cliente: "Nombre Centinela",
    scheduledAt: "2026-10-05T08:30:00.000Z",
    estado: "confirmed",
    eventTypeId: "et-1",
    teamMemberId: "tm-1",
    sessionNumber: 3,
  };
  const after = { borrada: true, cobros: 0, cambios: 0, avisos: 1 };

  it("sin el nombre, con clientId/patientId si otra fila de la cita los sabía", () => {
    const identidad = identidadDeCita(citaVolcada());
    assert.deepEqual(identidad, { clientId: "cl-1", patientId: "pa-1" });
    const r = limpiar({ action: "citas.booking_deleted", before: vieja, after }, { identidad });
    const hoy = huellaDeCita(citaVolcada({ status: "confirmed" }));
    assert.deepEqual(r, { tipo: "huella", before: comoEnBase(hoy), after });
  });

  it("sin identidad conocida: clientId y patientId a null", () => {
    const r = limpiar({ action: "citas.booking_deleted", before: vieja, after });
    assert.equal(r.before.clientId, null);
    assert.equal(r.before.patientId, null);
    assert.equal(r.before.teamMemberId, "tm-1");
  });
});

describe("lo que no hay que tocar", () => {
  it("las filas escritas ya con el arreglo devuelven null", () => {
    const cita = citaVolcada();
    const nuevas = [
      { action: "citas.booking_created", ...loQueEscribeHoy(null, { ...resumenDeCita(cita), source: "manual" }) },
      { action: "citas.booking_updated", ...loQueEscribeHoy(fijosDeCita({}), fijosDeCita(cita)) },
      { action: "citas.booking_deleted", ...loQueEscribeHoy(huellaDeCita(cita), { borrada: true }) },
      { action: "citas.booking_status_changed", before: { status: "pending" }, after: { status: "cancelled", cancellationReason: "x" } },
      { action: "citas.booking_deleted", before: { duration: 50, motivo: "taller", scheduledAt: "2026-10-05T08:30:00.000Z", tallerGrupoId: "tg-1" }, after: null },
      { action: "appointment.meet_link_set", before: { meetUrl: null }, after: { meetUrl: "https://meet.example/x" } },
    ];
    for (const f of nuevas) assert.equal(limpiarFilaDeCita(f), null, f.action);
  });
});
