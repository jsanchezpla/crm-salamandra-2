// @prueba ligera — funciones puras; sin base, sin servidor, sin .env.
/**
 * _smoke-cita-con-dinero.mjs — toda cita nace atada a un dinero, y una cuota
 * mensual no se multiplica por las citas del mes (04/09/2026, Aumenta).
 *
 *   node scripts/_smoke-cita-con-dinero.mjs
 *
 * ── DE QUÉ ENCARGO NACE ────────────────────────────────────────────────────
 * Rodrigo, 04/09/2026: «para crear una cita tiene que estar asociada a una
 * cuota o a un cobro de texto libre, así cuando se crea una cita siempre está
 * aparejada a un dinero y se puede cobrar con comodidad y nunca se crean citas
 * gratuitas sin quererlo».
 *
 * Lo que esta prueba defiende son las dos mitades, y la segunda es la que
 * cuesta dinero de verdad si se rompe:
 *
 *   1. **El freno.** Con el interruptor puesto, una cita sin cuota, sin cobro
 *      libre y sin un «sin coste» razonado no se puede crear. Y con él
 *      apagado no cambia nada para nadie, que es lo que deja encenderlo cliente
 *      a cliente.
 *
 *   2. **La aritmética del mes.** Un concepto de Aumenta es la cuota MENSUAL
 *      («Logopedia 60x2 · 190 €» son dos sesiones por semana durante un mes),
 *      así que las ocho citas de octubre cubiertas por esa cuota son 190 € y
 *      no 1.520. Sumarlas sería cobrarle a una familia ocho veces su cuota. Un
 *      cobro de texto libre es de ESA cita y sí se suma.
 *
 * Y una tercera que no se ve: `cobroImporte` es dinero, así que tiene que
 * caerse del JSON de quien no es dirección igual que `amount` (la regla de
 * Laura, 07/08/2026, en `lib/citas/dinero.js`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MODOS_COBRO,
  cobroObligatorio,
  centimosDeEuros,
  cobroDelTipo,
  normalizarCobro,
  seCobra,
  resumenCobro,
  loQueSeCobraDe,
} from "../lib/citas/dineroDeLaCita.js";
import { citaSinDinero } from "../lib/citas/dinero.js";

const CONCEPTO = { id: "c-logo", name: "Logopedia 60x2", unitPrice: "190.00" };

describe("el interruptor del centro", () => {
  it("nace apagado y solo lo enciende un true de verdad", () => {
    assert.equal(cobroObligatorio(null), false);
    assert.equal(cobroObligatorio({}), false);
    assert.equal(cobroObligatorio({ settings: {} }), false);
    assert.equal(cobroObligatorio({ settings: { citas: {} } }), false);
    // Un "true" de texto no vale: los ajustes vienen de un JSONB.
    assert.equal(cobroObligatorio({ settings: { citas: { cobroObligatorio: "true" } } }), false);
    assert.equal(cobroObligatorio({ settings: { citas: { cobroObligatorio: true } } }), true);
  });
});

describe("la cuota del tipo baja sola a la cita", () => {
  it("copia nombre y precio, en céntimos", () => {
    assert.deepEqual(cobroDelTipo(CONCEPTO), {
      modo: "cuota",
      conceptId: "c-logo",
      texto: "Logopedia 60x2",
      importe: 19000,
    });
  });

  it("un tipo sin concepto no trae nada (y no revienta)", () => {
    assert.equal(cobroDelTipo(null), null);
    assert.equal(cobroDelTipo(undefined), null);
    assert.equal(cobroDelTipo({}), null);
  });

  it("los euros del catálogo llegan enteros a céntimos", () => {
    assert.equal(centimosDeEuros("190.00"), 19000);
    assert.equal(centimosDeEuros("50.5"), 5050);
    assert.equal(centimosDeEuros(0), 0);
    assert.equal(centimosDeEuros(null), null);
    assert.equal(centimosDeEuros("lo que sea"), null);
    // El clásico de los flotantes: 19.99 * 100 = 1998.9999…
    assert.equal(centimosDeEuros("19.99"), 1999);
  });
});

describe("el freno al crear la cita", () => {
  it("sin decir nada y sin exigirlo, la cita nace sin cobro — como siempre", () => {
    assert.deepEqual(normalizarCobro({}, {}), { cobro: null });
  });

  it("sin decir nada, hereda la cuota del tipo", () => {
    const { cobro } = normalizarCobro({}, { porDefecto: cobroDelTipo(CONCEPTO), exigido: true });
    assert.equal(cobro.conceptId, "c-logo");
    assert.equal(cobro.importe, 19000);
  });

  it("exigido y sin nada de dónde tirar: no se crea, y lo dice en cristiano", () => {
    const { error, cobro } = normalizarCobro({}, { exigido: true });
    assert.equal(cobro, undefined);
    assert.match(error, /cuota/i);
    assert.match(error, /sin coste/i);
  });

  it("un modo inventado no cuela", () => {
    assert.equal(MODOS_COBRO.length, 3);
    assert.match(normalizarCobro({ modo: "gratis" }, {}).error, /desconocido/i);
  });

  it("cuota: hace falta el concepto, y de él salen nombre e importe", () => {
    assert.match(normalizarCobro({ modo: "cuota" }, {}).error, /cuota/i);
    const { cobro } = normalizarCobro({ modo: "cuota", conceptId: "c-logo" }, { concepto: CONCEPTO });
    assert.deepEqual(cobro, { modo: "cuota", conceptId: "c-logo", texto: "Logopedia 60x2", importe: 19000 });
  });

  it("cuota: un importe pactado con la familia pisa al del catálogo", () => {
    const { cobro } = normalizarCobro({ modo: "cuota", importe: 15000 }, { concepto: CONCEPTO });
    assert.equal(cobro.importe, 15000);
    assert.equal(cobro.texto, "Logopedia 60x2");
  });

  it("libre: sin texto o sin importe no se guarda", () => {
    assert.match(normalizarCobro({ modo: "libre", importe: 4000 }, {}).error, /qué se cobra/i);
    assert.match(normalizarCobro({ modo: "libre", texto: "Informe" }, {}).error, /cuánto/i);
    assert.match(normalizarCobro({ modo: "libre", texto: "Informe", importe: 0 }, {}).error, /cuánto/i);
    const { cobro } = normalizarCobro({ modo: "libre", texto: "  Informe para el colegio  ", importe: 4000 }, {});
    assert.deepEqual(cobro, { modo: "libre", conceptId: null, texto: "Informe para el colegio", importe: 4000 });
  });

  it("sin coste: el motivo es obligatorio — es lo que lo separa de un olvido", () => {
    assert.match(normalizarCobro({ modo: "sin_coste" }, {}).error, /por qué/i);
    assert.match(normalizarCobro({ modo: "sin_coste", texto: " " }, {}).error, /por qué/i);
    const { cobro } = normalizarCobro({ modo: "sin_coste", texto: "Recuperación de falta" }, {});
    assert.deepEqual(cobro, { modo: "sin_coste", conceptId: null, texto: "Recuperación de falta", importe: 0 });
  });
});

describe("qué se le cobra a una familia ese mes", () => {
  const cita = (extra) => ({ id: Math.random().toString(36), ...extra });
  const conCuota = (n) =>
    Array.from({ length: n }, () =>
      cita({ cobroModo: "cuota", cobroConceptId: "c-logo", cobroTexto: "Logopedia 60x2", cobroImporte: 19000 })
    );

  it("OCHO citas de la misma cuota son 190 €, no 1.520", () => {
    const { cuotas, sueltos, total } = loQueSeCobraDe(conCuota(8));
    assert.equal(cuotas.length, 1);
    assert.equal(cuotas[0].importe, 19000);
    assert.equal(cuotas[0].citas, 8);
    assert.equal(sueltos.length, 0);
    assert.equal(total, 19000);
  });

  it("dos cuotas distintas suman una vez cada una", () => {
    const citas = [
      ...conCuota(4),
      ...Array.from({ length: 2 }, () =>
        cita({ cobroModo: "cuota", cobroConceptId: "c-psico", cobroTexto: "Psicología 45x1", cobroImporte: 12000 })
      ),
    ];
    const { cuotas, total } = loQueSeCobraDe(citas);
    assert.deepEqual(cuotas.map((c) => [c.conceptId, c.importe, c.citas]), [
      ["c-logo", 19000, 4],
      ["c-psico", 12000, 2],
    ]);
    assert.equal(total, 31000);
  });

  it("un cobro suelto SÍ se suma por cada cita: es de esa cita", () => {
    const citas = [
      cita({ cobroModo: "libre", cobroTexto: "Informe", cobroImporte: 4000 }),
      cita({ cobroModo: "libre", cobroTexto: "Informe", cobroImporte: 4000 }),
    ];
    const { sueltos, total } = loQueSeCobraDe(citas);
    assert.equal(sueltos.length, 1);
    assert.equal(sueltos[0].importe, 8000);
    assert.equal(sueltos[0].citas, 2);
    assert.equal(total, 8000);
  });

  it("las de sin coste no aparecen ni suman", () => {
    const citas = [
      ...conCuota(2),
      cita({ cobroModo: "sin_coste", cobroTexto: "Recuperación", cobroImporte: 0 }),
      cita({ cobroModo: null }),
    ];
    const { cuotas, sueltos, total } = loQueSeCobraDe(citas);
    assert.equal(cuotas.length, 1);
    assert.equal(cuotas[0].citas, 2);
    assert.equal(sueltos.length, 0);
    assert.equal(total, 19000);
  });

  it("si a una familia se le pactó otro precio, manda el mayor y no se duplica", () => {
    const citas = [
      cita({ cobroModo: "cuota", cobroConceptId: "c-logo", cobroTexto: "Logopedia 60x2", cobroImporte: 19000 }),
      cita({ cobroModo: "cuota", cobroConceptId: "c-logo", cobroTexto: "Logopedia 60x2", cobroImporte: 20000 }),
    ];
    const { cuotas, total } = loQueSeCobraDe(citas);
    assert.equal(cuotas.length, 1);
    assert.equal(cuotas[0].importe, 20000);
    assert.equal(total, 20000);
  });

  it("una lista vacía, nula o con basura da cero sin romperse", () => {
    assert.deepEqual(loQueSeCobraDe([]), { cuotas: [], sueltos: [], total: 0 });
    assert.deepEqual(loQueSeCobraDe(null), { cuotas: [], sueltos: [], total: 0 });
    assert.deepEqual(loQueSeCobraDe(["no soy una cita", null]), { cuotas: [], sueltos: [], total: 0 });
  });
});

describe("cómo se lee y quién lo lee", () => {
  it("seCobra distingue lo que hay que cobrar de lo que no", () => {
    assert.equal(seCobra({ cobroModo: "cuota", cobroImporte: 19000 }), true);
    assert.equal(seCobra({ cobroModo: "libre", cobroImporte: 4000 }), true);
    assert.equal(seCobra({ cobroModo: "sin_coste", cobroImporte: 0 }), false);
    assert.equal(seCobra({ cobroModo: "cuota", cobroImporte: 0 }), false);
    assert.equal(seCobra({}), false);
  });

  it("el resumen dice de qué va, y las citas de antes de esto no dicen nada", () => {
    assert.equal(resumenCobro({ cobroModo: "cuota", cobroTexto: "Logopedia 60x2", cobroImporte: 19000 }), "Logopedia 60x2 · 190,00 €");
    assert.equal(resumenCobro({ cobroModo: "sin_coste", cobroTexto: "Recuperación" }), "Sin coste · Recuperación");
    assert.equal(resumenCobro({ cobroModo: null }), null);
  });

  it("el IMPORTE no sale del CRM para quien no es dirección; el concepto sí", () => {
    // La regla de Laura (07/08/2026): su equipo no ve las tarifas del centro.
    // El nombre del concepto se queda —quien apunta la cita tiene que ver de
    // qué se cobra— y la cifra no.
    const limpia = citaSinDinero({
      id: "b1",
      cobroModo: "cuota",
      cobroTexto: "Logopedia 60x2",
      cobroImporte: 19000,
      amount: 5000,
    });
    assert.equal("cobroImporte" in limpia, false, "cobroImporte es dinero: tiene que caerse");
    assert.equal("amount" in limpia, false);
    assert.equal(limpia.cobroTexto, "Logopedia 60x2");
    assert.equal(limpia.cobroModo, "cuota");
  });
});
