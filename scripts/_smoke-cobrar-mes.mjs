// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cobrar-mes.mjs — el botón «Cobrar mes» de la ficha de una cita:
 * cuándo sale, a dónde lleva y qué cobro lo apaga (03/09/2026).
 *
 *   node scripts/_smoke-cobrar-mes.mjs
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 *
 * Aumenta, por Rodrigo (03/09/2026): un botón COBRAR MES en el modal de la
 * cita, solo para quien tenga el módulo de Facturación, que lleve a Cobros con
 * el «Registrar cobro» rellenado, y que en cuanto esa familia tenga cobrado el
 * mes no vuelva a salir hasta la primera cita del mes siguiente — tanto si se
 * cobró desde la cita como a mano desde Cobros. «Lo cobrado no depende de lo
 * facturado.»
 *
 * Lo que aquí se fija es lo que se puede decidir sin base de datos
 * (`lib/citas/cobrarMes.js`); la ruta solo trae los cobros del mes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  botonCobrarMes,
  esMes,
  mesCobradoPara,
  mesDeLaCita,
  rotuloDeMes,
  urlCobrarMes,
} from "../lib/citas/cobrarMes.js";

const FAMILIA = "11111111-1111-4111-8111-111111111111";
const HUGO = "22222222-2222-4222-8222-222222222222";
const VERA = "33333333-3333-4333-8333-333333333333";

const cita = (extra = {}) => ({
  id: "b1",
  clientId: FAMILIA,
  patientId: HUGO,
  scheduledAt: "2026-09-15T09:00:00.000Z",
  ...extra,
});

describe("de qué mes es la cita", () => {
  it("una cita de septiembre es de septiembre", () => {
    assert.equal(mesDeLaCita("2026-09-15T09:00:00.000Z"), "2026-09");
  });
  it("la madrugada del día 1 en Madrid ya es del mes nuevo aunque en UTC no", () => {
    // 00:30 del 1 de octubre en Madrid (CEST) = 22:30 del 30/09 en UTC
    assert.equal(mesDeLaCita("2026-09-30T22:30:00.000Z"), "2026-10");
  });
  it("una fecha rota no es de ningún mes", () => {
    assert.equal(mesDeLaCita("ayer"), null);
  });
  it("esMes solo acepta AAAA-MM", () => {
    assert.equal(esMes("2026-09"), true);
    assert.equal(esMes("2026-13"), false);
    assert.equal(esMes("2026-09-01"), false);
    assert.equal(esMes(null), false);
  });
});

describe("a dónde lleva el botón", () => {
  it("abre Cobros en modo cuota con familia, paciente y mes", () => {
    assert.equal(
      urlCobrarMes({ clientId: FAMILIA, patientId: HUGO, mes: "2026-09" }),
      `/facturacion/cobros?abrir=cuota&cliente=${FAMILIA}&paciente=${HUGO}&mes=2026-09`
    );
  });
  it("sin paciente va la familia entera; sin mes válido no se manda mes", () => {
    assert.equal(
      urlCobrarMes({ clientId: FAMILIA, mes: "2026-9" }),
      `/facturacion/cobros?abrir=cuota&cliente=${FAMILIA}`
    );
  });
  it("sin familia no hay a quién cobrar", () => {
    assert.equal(urlCobrarMes({ patientId: HUGO, mes: "2026-09" }), null);
  });
});

describe("qué cobro apaga el botón", () => {
  it("sin cobros el mes está por cobrar", () => {
    assert.equal(mesCobradoPara({ cobros: [], patientId: HUGO }), false);
    assert.equal(mesCobradoPara({ cobros: null, patientId: null }), false);
  });
  it("un cobro de toda la familia lo apaga para cualquier hijo", () => {
    assert.equal(mesCobradoPara({ cobros: [{ patientId: null }], patientId: HUGO }), true);
    assert.equal(mesCobradoPara({ cobros: [{ patientId: null }], patientId: VERA }), true);
  });
  it("un cobro de Hugo NO apaga el botón en las citas de su hermana", () => {
    assert.equal(mesCobradoPara({ cobros: [{ patientId: HUGO }], patientId: HUGO }), true);
    assert.equal(mesCobradoPara({ cobros: [{ patientId: HUGO }], patientId: VERA }), false);
  });
  it("una cita sin paciente se da por cobrada con cualquier cobro de la familia", () => {
    assert.equal(mesCobradoPara({ cobros: [{ patientId: HUGO }], patientId: null }), true);
  });
});

describe("el botón entero", () => {
  it("sale con módulo de Facturación, familia enlazada y mes sin cobrar", () => {
    const b = botonCobrarMes({ booking: cita(), conFacturacion: true, cobros: [] });
    assert.ok(b);
    assert.equal(b.rotulo, "Cobrar mes");
    assert.equal(b.mes, "2026-09");
    assert.equal(b.href, `/facturacion/cobros?abrir=cuota&cliente=${FAMILIA}&paciente=${HUGO}&mes=2026-09`);
    assert.match(b.titulo, /septiembre de 2026/);
  });
  it("sin módulo de Facturación no sale, aunque el mes esté sin cobrar", () => {
    assert.equal(botonCobrarMes({ booking: cita(), conFacturacion: false, cobros: [] }), null);
  });
  it("sin familia enlazada no sale", () => {
    assert.equal(botonCobrarMes({ booking: cita({ clientId: null }), conFacturacion: true, cobros: [] }), null);
  });
  it("mientras no se sabe si está cobrado, no sale (mejor tarde que quitado)", () => {
    assert.equal(botonCobrarMes({ booking: cita(), conFacturacion: true, cobros: null }), null);
    assert.equal(botonCobrarMes({ booking: cita(), conFacturacion: true }), null);
  });
  it("con el mes cobrado desaparece, y vuelve en la primera cita del mes siguiente", () => {
    const cobros = [{ patientId: null }]; // cobro de septiembre de la familia
    assert.equal(botonCobrarMes({ booking: cita(), conFacturacion: true, cobros }), null);
    // La cita del 1 de octubre pregunta por OCTUBRE: la ruta devolverá []
    const octubre = cita({ scheduledAt: "2026-10-01T08:00:00.000Z" });
    const b = botonCobrarMes({ booking: octubre, conFacturacion: true, cobros: [] });
    assert.equal(b?.mes, "2026-10");
  });
  it("el rótulo del mes va en castellano", () => {
    assert.equal(rotuloDeMes("2026-01"), "enero de 2026");
    assert.equal(rotuloDeMes("mal"), "mal");
  });
});
