// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-organizaciones.mjs — empresas y universidades con ficha propia y el
 * reparto de lo que pagan (15/09/2026, AV-0153 de Aumenta).
 *
 *   node scripts/_smoke-organizaciones.mjs
 *
 * Fija lo que DEVUELVE `lib/clients/organizaciones.js`: qué filtra cada opción
 * del desplegable, qué organización paga una ficha y, sobre todo, que partir un
 * cobro entre la universidad y el alumno nunca pierde ni inventa un céntimo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarTipoFicha,
  filtroPorTipoFicha,
  normalizarPctOrganizacion,
  organizacionQuePaga,
  repartirConOrganizacion,
  filasDelCobroRepartido,
} from "../lib/clients/organizaciones.js";

const UNI = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const YO = "33333333-3333-4333-8333-333333333333";

test("tipo de ficha: solo empresa y universidad se guardan; lo demás es particular (NULL)", () => {
  assert.equal(normalizarTipoFicha("universidad"), "universidad");
  assert.equal(normalizarTipoFicha(" Empresa "), "empresa");
  assert.equal(normalizarTipoFicha("particular"), null);
  assert.equal(normalizarTipoFicha("festival"), null);
  assert.equal(normalizarTipoFicha(undefined), null);
});

test("filtro del listado: «Clientes» son las fichas SIN tipo; valor raro no filtra", () => {
  assert.deepEqual(filtroPorTipoFicha("particular"), { tipoFicha: null });
  assert.deepEqual(filtroPorTipoFicha("universidad"), { tipoFicha: "universidad" });
  assert.deepEqual(filtroPorTipoFicha("empresa"), { tipoFicha: "empresa" });
  assert.equal(filtroPorTipoFicha("all"), null);
  assert.equal(filtroPorTipoFicha("'; drop table"), null);
});

test("porcentaje: vacío es sin decir, fuera de 0-100 es inválido, admite coma", () => {
  assert.equal(normalizarPctOrganizacion(""), null);
  assert.equal(normalizarPctOrganizacion(null), null);
  assert.equal(normalizarPctOrganizacion("60"), 60);
  assert.equal(normalizarPctOrganizacion("33,333"), 33.33);
  assert.equal(normalizarPctOrganizacion(101), undefined);
  assert.equal(normalizarPctOrganizacion(-1), undefined);
  assert.equal(normalizarPctOrganizacion("mucho"), undefined);
});

test("quién paga: la universidad solo si es alumno en prácticas; si no, la empresa", () => {
  assert.deepEqual(organizacionQuePaga({ esAlumnoPracticas: true, universidadId: UNI, pagoOrganizacionPct: "100.00" }), { id: UNI, tipo: "universidad", pct: 100 });
  // Universidad puesta pero la casilla desmarcada: esa universidad ya no paga.
  assert.equal(organizacionQuePaga({ esAlumnoPracticas: false, universidadId: UNI }), null);
  assert.deepEqual(organizacionQuePaga({ empresaId: EMP, pagoOrganizacionPct: null }), { id: EMP, tipo: "empresa", pct: null });
  assert.equal(organizacionQuePaga({}), null);
  assert.equal(organizacionQuePaga(null), null);
});

test("repartir: la suma de las dos partes es SIEMPRE el importe", () => {
  for (const [importe, pct] of [[214.2, 60], [100, 33.33], [0.01, 50], [1200, 100], [99.99, 0], [10, 12.5]]) {
    const r = repartirConOrganizacion(importe, pct);
    assert.equal(Math.round((r.organizacion + r.persona) * 100), Math.round(importe * 100), `${importe} al ${pct} %`);
  }
  assert.deepEqual(repartirConOrganizacion(214.2, 60), { organizacion: 128.52, persona: 85.68 });
  assert.deepEqual(repartirConOrganizacion(100, 33.33), { organizacion: 33.33, persona: 66.67 });
});

test("filas del cobro: entera si no hay reparto; una por parte y nunca de 0 €", () => {
  assert.deepEqual(filasDelCobroRepartido({ clientId: YO, importe: 50, organizacion: null }), [{ clientId: YO, importe: 50, parte: null }]);
  assert.deepEqual(filasDelCobroRepartido({ clientId: YO, importe: 50, organizacion: { id: UNI, pct: null } }), [{ clientId: YO, importe: 50, parte: null }]);
  assert.deepEqual(filasDelCobroRepartido({ clientId: YO, importe: 50, organizacion: { id: UNI, pct: 0 } }), [{ clientId: YO, importe: 50, parte: null }]);
  assert.deepEqual(filasDelCobroRepartido({ clientId: YO, importe: 50, organizacion: { id: UNI, pct: 100 } }), [{ clientId: UNI, importe: 50, parte: "organizacion" }]);
  assert.deepEqual(filasDelCobroRepartido({ clientId: YO, importe: 50, organizacion: { id: EMP, pct: 40 } }), [
    { clientId: EMP, importe: 20, parte: "organizacion" },
    { clientId: YO, importe: 30, parte: "persona" },
  ]);
});
