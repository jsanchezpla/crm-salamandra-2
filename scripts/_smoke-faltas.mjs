// @prueba ligera
/**
 * _smoke-faltas.mjs — la falta dentro de la incidencia (03/09/2026, AV-0038).
 *
 *   node --test scripts/_smoke-faltas.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  faltaDesdeBooking,
  faltaDesdeTitulo,
  fundirFalta,
  cierrePorRespuesta,
  resumenFalta,
  RESPUESTAS_FALTA,
} from "../lib/clinica/faltas.js";

const ID = "6dd41253-4036-4b88-b9b0-660ed50ec442";

describe("faltaDesdeBooking: con lo que nace la incidencia automática", () => {
  it("copia si fue justificada y la cita, y nace sin respuesta", () => {
    const f = faltaDesdeBooking({ id: ID, noShowJustified: true });
    assert.deepEqual(f, { justificada: true, bookingId: ID, huecosOfrecidos: "", respuesta: "pendiente", fechaRecuperacion: null, nota: "" });
    assert.equal(faltaDesdeBooking({ id: "x", noShowJustified: false }).bookingId, null);
    assert.equal(faltaDesdeBooking(null).justificada, false);
  });
});

describe("fundirFalta: lo que edita administración", () => {
  const base = faltaDesdeBooking({ id: ID, noShowJustified: false });
  it("solo toca lo que viene y recorta el texto", () => {
    const r = fundirFalta(base, { huecosOfrecidos: "  lunes 17:00, martes 18:00  " });
    assert.equal(r.ok, true);
    assert.equal(r.falta.huecosOfrecidos, "lunes 17:00, martes 18:00");
    assert.equal(r.falta.respuesta, "pendiente");
    assert.equal(r.falta.bookingId, ID);
  });
  it("aceptar exige fecha de recuperación; rechazar no", () => {
    assert.equal(fundirFalta(base, { respuesta: "aceptada" }).ok, false);
    assert.equal(fundirFalta(base, { respuesta: "aceptada", fechaRecuperacion: "2026-09-10" }).ok, true);
    assert.equal(fundirFalta(base, { respuesta: "rechazada" }).ok, true);
  });
  it("rechaza respuestas y fechas que no existen, y no funde sobre lo que no es falta", () => {
    assert.equal(fundirFalta(base, { respuesta: "tal vez" }).ok, false);
    assert.equal(fundirFalta(base, { fechaRecuperacion: "10/09/2026" }).ok, false);
    assert.equal(fundirFalta(null, { nota: "x" }).ok, false);
  });
  it("no deja cambiar justificada ni la cita desde la pantalla", () => {
    const r = fundirFalta(base, { justificada: true, bookingId: "otra" });
    assert.equal(r.falta.justificada, false);
    assert.equal(r.falta.bookingId, ID);
  });
});

describe("cierrePorRespuesta: contestada = cerrada", () => {
  it("aceptada o rechazada cierran; pendiente no toca el estado", () => {
    assert.deepEqual(cierrePorRespuesta({ respuesta: "aceptada" }), { status: "resolved", verification: "resuelta" });
    assert.deepEqual(cierrePorRespuesta({ respuesta: "rechazada" }), { status: "resolved", verification: "resuelta" });
    assert.equal(cierrePorRespuesta({ respuesta: "pendiente" }), null);
    assert.equal(cierrePorRespuesta(null), null);
  });
});

describe("resumenFalta y faltaDesdeTitulo", () => {
  it("el resumen del listado dice tipo, respuesta y fecha", () => {
    assert.equal(resumenFalta({ justificada: true, respuesta: "aceptada", fechaRecuperacion: "2026-09-12" }), "Justificada · Acepta, recupera el 12/09");
    assert.equal(resumenFalta({ justificada: false, respuesta: "pendiente" }), "Sin justificar · Sin respuesta");
    assert.equal(resumenFalta(null), "");
    assert.equal(Object.keys(RESPUESTAS_FALTA).length, 3);
  });
  it("reconoce las automáticas de antes por su título y nada más", () => {
    assert.equal(faltaDesdeTitulo("Falta injustificada · Ana · 03 de septiembre, 17:00").justificada, false);
    assert.equal(faltaDesdeTitulo("Falta justificada · Ana · 03 de septiembre, 17:00").justificada, true);
    assert.equal(faltaDesdeTitulo("Faltan materiales en la sala 2"), null);
    assert.equal(faltaDesdeTitulo(""), null);
  });
});
