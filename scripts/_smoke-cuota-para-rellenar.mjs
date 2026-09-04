// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-para-rellenar.mjs — al elegir la familia, ¿qué cuota se pone y
 * cuándo se puede pisar lo que ya hay escrito? (01/09/2026)
 *
 *   node scripts/_smoke-cuota-para-rellenar.mjs
 *   node --test-name-pattern="hermano" scripts/_smoke-cuota-para-rellenar.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, 01/09/2026: «si estoy en Cobros y selecciono a un paciente se pone
 * su cuota; lo que no está bien es que cuando cambio de paciente se queda fija
 * la cuota del paciente anterior». Y detrás, la duda: «¿cuando tiene más de una
 * cuota salen todas?».
 *
 * Eran dos fallos, y los dos cuestan dinero:
 *
 *  - SE QUEDABA LA DE ANTES. La pantalla rellenaba al elegir familia, pero si
 *    la siguiente no tenía cuota conocida se salía sin borrar: quedaban los
 *    conceptos Y EL IMPORTE de la otra familia. En Aumenta, 827 de las 1.087
 *    fichas no tienen cuota conocida, así que tocaba a cada paso.
 *  - SOLO SALÍA UNA. Una familia puede tener varias filas en `billing_cuotas`
 *    (una por hijo) y las paga todas; Facturas cogía `cuotas[0]` y facturaba al
 *    primer hermano en silencio.
 *
 * Se prueba por lo que DEVUELVE `lib/billing/cuotaParaRellenar.js`, que es la
 * decisión entera sin base de datos ni pantalla.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cuotasQueEntran,
  conceptosDeCuotas,
  importePactado,
  huellaLineas,
  sePuedeRellenar,
} from "../lib/billing/cuotaParaRellenar.js";

const LOGO = "11111111-1111-4111-8111-111111111111";
const PSICO = "22222222-2222-4222-8222-222222222222";
const DTO = "33333333-3333-4333-8333-333333333333";

const cuota = (extra) => ({ conceptIds: [LOGO], amount: null, patientId: null, ...extra });

describe("qué cuotas entran", () => {
  it("sin paciente elegido, TODAS las de la familia (la familia paga las dos)", () => {
    const cuotas = [cuota({ patientId: "nino-a" }), cuota({ conceptIds: [PSICO], patientId: "nino-b" })];
    assert.equal(cuotasQueEntran(cuotas, null).length, 2);
  });

  it("con paciente elegido, solo la suya: dos hermanos pagan cosas distintas", () => {
    const cuotas = [cuota({ patientId: "nino-a" }), cuota({ conceptIds: [PSICO], patientId: "nino-b" })];
    const entran = cuotasQueEntran(cuotas, "nino-b");
    assert.equal(entran.length, 1);
    assert.deepEqual(entran[0].conceptIds, [PSICO]);
  });

  it("un paciente con DOS cuotas suyas se lleva las dos, no la primera", () => {
    const cuotas = [
      cuota({ patientId: "nino-a" }),
      cuota({ conceptIds: [PSICO], patientId: "nino-a" }),
      cuota({ conceptIds: [DTO], patientId: "nino-b" }),
    ];
    assert.equal(cuotasQueEntran(cuotas, "nino-a").length, 2);
  });

  it("si NINGUNA cuota es del paciente, entran las de la familia (las de Aumenta no llevan paciente)", () => {
    const cuotas = [cuota({ patientId: null }), cuota({ conceptIds: [PSICO], patientId: null })];
    assert.equal(cuotasQueEntran(cuotas, "nino-a").length, 2);
  });

  /*
   * 04/09/2026, Rodrigo con una captura: «me saltan todas las cuotas sin
   * dividirlas por hijo aunque yo solo ponga que voy a cobrar a uno de los
   * pacientes». El respaldo «si no hay ninguna suya, todas» colaba la del
   * hermano, y ese importe se cobra sin que nadie sospeche.
   */
  it("la cuota de un HERMANO no entra nunca, aunque el elegido no tenga la suya", () => {
    const cuotas = [cuota({ conceptIds: [PSICO], patientId: "nino-b" })];
    assert.deepEqual(cuotasQueEntran(cuotas, "nino-a"), []);
  });

  it("lo suyo y lo de la familia entran juntos; lo del hermano se queda fuera", () => {
    const cuotas = [
      cuota({ conceptIds: [LOGO], patientId: "nino-a" }),
      cuota({ conceptIds: [DTO], patientId: null }),
      cuota({ conceptIds: [PSICO], patientId: "nino-b" }),
    ];
    assert.deepEqual(conceptosDeCuotas(cuotasQueEntran(cuotas, "nino-a")), [LOGO, DTO]);
  });

  it("sin paciente elegido siguen entrando todas: el cobro es de la familia", () => {
    const cuotas = [cuota({ patientId: "nino-a" }), cuota({ conceptIds: [PSICO], patientId: "nino-b" })];
    assert.equal(cuotasQueEntran(cuotas, null).length, 2);
  });

  it("familia sin cuotas: ni una, sin reventar", () => {
    assert.deepEqual(cuotasQueEntran([], "nino-a"), []);
    assert.deepEqual(cuotasQueEntran(null, null), []);
  });
});

describe("los conceptos que salen", () => {
  it("se juntan los de TODAS las cuotas que entran", () => {
    const cuotas = [cuota({ conceptIds: [LOGO] }), cuota({ conceptIds: [PSICO, DTO] })];
    assert.deepEqual(conceptosDeCuotas(cuotas), [LOGO, PSICO, DTO]);
  });

  it("el mismo concepto en dos cuotas sale DOS veces: son dos hermanos", () => {
    const cuotas = [cuota({ conceptIds: [LOGO] }), cuota({ conceptIds: [LOGO] })];
    assert.deepEqual(conceptosDeCuotas(cuotas), [LOGO, LOGO]);
  });

  it("una cuota con importe pero sin conceptos no aporta líneas", () => {
    assert.deepEqual(conceptosDeCuotas([cuota({ conceptIds: null, amount: 250 })]), []);
  });
});

describe("el importe pactado manda sobre la tarifa", () => {
  it("con todas pactadas, se suman: 150 + 100 = 250", () => {
    assert.equal(importePactado([cuota({ amount: 150 }), cuota({ amount: 100 })]), 250);
  });

  it("acepta el decimal en texto, como llega de Postgres", () => {
    assert.equal(importePactado([cuota({ amount: "250.50" })]), 250.5);
  });

  it("si UNA va a lo que digan sus conceptos, no hay pactado: manda el catálogo", () => {
    assert.equal(importePactado([cuota({ amount: 150 }), cuota({ amount: null })]), null);
  });

  it("sin cuotas, no hay pactado", () => {
    assert.equal(importePactado([]), null);
  });

  it("un pactado de 0 € sigue siendo un pactado, no un «no hay»", () => {
    assert.equal(importePactado([cuota({ amount: 0 })]), 0);
  });
});

describe("cuándo se puede pisar lo que hay escrito", () => {
  const linea = (description, unitPrice) => ({ description, unitPrice, quantity: 1, discountPct: 0, vatRate: 0 });
  const puestas = [linea("Logopedia", 190), linea("Psicología", 150)];

  it("en blanco: siempre", () => {
    assert.equal(sePuedeRellenar({ lineas: [], enBlanco: true, huellaPuesta: null }), true);
  });

  it("lo que puso la cuota anterior SÍ se reemplaza (es el fallo de cambiar de paciente)", () => {
    assert.equal(
      sePuedeRellenar({ lineas: puestas, enBlanco: false, huellaPuesta: huellaLineas(puestas) }),
      true
    );
  });

  it("lo escrito a mano NO se pisa", () => {
    const aMano = [...puestas, linea("Material", 12)];
    assert.equal(
      sePuedeRellenar({ lineas: aMano, enBlanco: false, huellaPuesta: huellaLineas(puestas) }),
      false
    );
  });

  it("cambiarle el precio a una línea ya cuenta como tocada", () => {
    const retocada = [linea("Logopedia", 175), puestas[1]];
    assert.equal(
      sePuedeRellenar({ lineas: retocada, enBlanco: false, huellaPuesta: huellaLineas(puestas) }),
      false
    );
  });

  it("sin nada puesto por la cuota, lo que haya escrito no se toca", () => {
    assert.equal(sePuedeRellenar({ lineas: puestas, enBlanco: false, huellaPuesta: null }), false);
  });

  it("la huella ignora lo que el usuario no edita (ids internos, campos de pantalla)", () => {
    const conRuido = puestas.map((l) => ({ ...l, productId: "", kind: "", precioCompleto: null }));
    assert.equal(huellaLineas(conRuido), huellaLineas(puestas));
  });

  it("los espacios de más en el texto no cuentan como haberlo tocado", () => {
    const conEspacios = [linea("  Logopedia  ", 190), puestas[1]];
    assert.equal(huellaLineas(conEspacios), huellaLineas(puestas));
  });
});
