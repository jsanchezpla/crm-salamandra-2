// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-correo-quien-escribe.mjs — quién puede usar Correo, y qué se le tapa
 * del dinero de una ficha (10/09/2026).
 *
 *   node scripts/_smoke-correo-quien-escribe.mjs
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 * Del ticket de Raquel Torralbo (Aumenta): abrirle Clientes a las catorce
 * terapeutas. Correo no tiene módulo propio —se ve con `clients` O con
 * `outreach`—, así que dárselo les habría puesto de propina la pantalla para
 * escribirle a las 1.083 familias de golpe. Rodrigo: eso lo manda oficina.
 *
 * Lo que fija esta prueba es lo que DEVUELVEN las dos reglas nuevas:
 *
 *   · `lib/correo/quienEscribe.js` — de fábrica NO cambia nada (esa es la
 *     mitad importante: en producción hay dos cuentas con Clientes y sin
 *     Facturación que escriben todos los días); con el interruptor puesto,
 *     solo dirección o quien lleve Facturación.
 *   · `lib/clients/quienVeElDinero.js` — el plan de cuotas de un bono es
 *     dinero; las sesiones que le quedan, no.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FLAG_CORREO_SOLO_OFICINA,
  MODULO_CORREO,
  correoSoloOficina,
  esOficina,
  puedeUsarCorreo,
} from "../lib/correo/quienEscribe.js";
import { bonosSinDinero, veElDineroDeLaFicha } from "../lib/clients/quienVeElDinero.js";

/** Un `hasModule` de mentira a partir de la lista de módulos que ve alguien. */
const conModulos = (...claves) => (k) => claves.includes(k);

/** Un `hasFeatureFlag` de mentira con el interruptor puesto. */
const soloOficina = (moduleKey, flagKey) =>
  moduleKey === MODULO_CORREO && flagKey === FLAG_CORREO_SOLO_OFICINA;

/** Y otro con TODO apagado, que es como está cualquier centro de fábrica. */
const sinInterruptores = () => false;

test("de fábrica, Correo lo usa quien tenga a quién escribir", () => {
  const terapeuta = { role: "user", hasModule: conModulos("clients", "citas"), hasFeatureFlag: sinInterruptores };
  assert.equal(puedeUsarCorreo(terapeuta), true);

  // Solo Captación también vale: es la mitad del OR de siempre.
  const comercial = { role: "user", hasModule: conModulos("outreach"), hasFeatureFlag: sinInterruptores };
  assert.equal(puedeUsarCorreo(comercial), true);

  // …pero no para los endpoints que necesitan las fichas.
  assert.equal(puedeUsarCorreo({ ...comercial, exigeFichas: true }), false);
});

test("sin fichas ni captación no se escribe, ni con el interruptor ni sin él", () => {
  const suelto = { role: "admin", hasModule: conModulos("citas", "clinica") };
  assert.equal(puedeUsarCorreo({ ...suelto, hasFeatureFlag: sinInterruptores }), false);
  assert.equal(puedeUsarCorreo({ ...suelto, hasFeatureFlag: soloOficina }), false);
});

test("con el interruptor puesto, Correo es de oficina", () => {
  const base = { hasFeatureFlag: soloOficina };

  // La terapeuta tiene las fichas, pero no el dinero: no escribe.
  assert.equal(
    puedeUsarCorreo({ ...base, role: "user", hasModule: conModulos("clients", "citas", "clinica") }),
    false
  );

  // Administración entra con rol `user` y lleva Facturación: sí escribe. Es el
  // caso de Olga y Rosa, y por eso NO se pregunta por el cargo.
  assert.equal(
    puedeUsarCorreo({ ...base, role: "user", hasModule: conModulos("clients", "billing") }),
    true
  );

  // Dirección, siempre.
  assert.equal(
    puedeUsarCorreo({ ...base, role: "admin", hasModule: conModulos("clients") }),
    true
  );
});

test("el interruptor se lee de la fila `clients`, y solo de ahí", () => {
  assert.equal(correoSoloOficina(soloOficina), true);
  assert.equal(correoSoloOficina(sinInterruptores), false);
  // Como JSONB de la fila (lo que tiene el menú a mano).
  assert.equal(correoSoloOficina({ [FLAG_CORREO_SOLO_OFICINA]: true }), true);
  assert.equal(correoSoloOficina({}), false);
  assert.equal(correoSoloOficina(null), false);
  // Puesto en OTRO módulo no vale: la bandera vive en `clients`.
  assert.equal(correoSoloOficina((m, f) => m === "citas" && f === FLAG_CORREO_SOLO_OFICINA), false);
});

test("«oficina» es dirección o quien lleve Facturación", () => {
  assert.equal(esOficina({ role: "admin", hasModule: conModulos() }), true);
  assert.equal(esOficina({ role: "superadmin", hasModule: conModulos() }), true);
  assert.equal(esOficina({ role: "user", hasModule: conModulos("billing") }), true);
  assert.equal(esOficina({ role: "user", hasModule: conModulos("clients") }), false);
  assert.equal(esOficina({ role: "user" }), false);
});

test("el dinero de la ficha lo ve quien lleva Facturación", () => {
  const centroConFacturacion = (verLoSuyo) => ({
    tenantHasModule: (k) => k === "billing",
    hasModule: (k) => (k === "billing" ? verLoSuyo : true),
  });
  assert.equal(veElDineroDeLaFicha(centroConFacturacion(true)), true);
  assert.equal(veElDineroDeLaFicha(centroConFacturacion(false)), false);

  // Un centro SIN módulo de Facturación no tiene «quien lo lleve»: cerrarlo por
  // ahí dejaría la sección sin dueño y desaparecería para todos.
  const centroSinFacturacion = { tenantHasModule: () => false, hasModule: () => false };
  assert.equal(veElDineroDeLaFicha(centroSinFacturacion), true);

  // Sin contexto, cerrado.
  assert.equal(veElDineroDeLaFicha({ tenantHasModule: (k) => k === "billing" }), false);
});

test("un bono sin dinero conserva las sesiones y pierde las cuotas", () => {
  const bonos = [
    { id: "a", nombre: "Logopedia", restantes: 3, total: 5, modoPago: "instalment", cuotas: { total: 4, pagadas: 2 } },
    { id: "b", nombre: "Psicología", restantes: 1, total: 10, modoPago: "upfront", cuotas: null },
  ];
  const podados = bonosSinDinero(bonos);

  assert.equal(podados[0].cuotas, null);
  assert.equal(podados[0].restantes, 3);
  assert.equal(podados[0].total, 5);
  assert.equal(podados[0].nombre, "Logopedia");
  // El que no tenía plan se devuelve tal cual (misma referencia: nada que podar).
  assert.equal(podados[1], bonos[1]);
  // Y no se toca el original.
  assert.deepEqual(bonos[0].cuotas, { total: 4, pagadas: 2 });

  assert.deepEqual(bonosSinDinero(null), []);
});
