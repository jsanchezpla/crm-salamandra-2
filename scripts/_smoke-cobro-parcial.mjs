// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cobro-parcial.mjs — cobrar un mes a medias sin perder lo que falta
 * (07/09/2026).
 *
 *   node scripts/_smoke-cobro-parcial.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * El POST de cobros pasaba el cobro pendiente a cobrado CON EL IMPORTE
 * TECLEADO, sin mirar si ese importe cubría lo que se debía. La fila de 160 €
 * se convertía en una de 100 € cobrada y los 60 € que faltaban desaparecían:
 * no quedaban ni como pendiente ni como deuda, así que la familia salía al día
 * debiendo dinero.
 *
 * No era un caso raro: en `aumenta`, 266 de las 273 familias con cuota viva y
 * cobro generado en septiembre de 2026 tenían UNA sola fila en el mes, así que
 * cualquier pago parcial suyo pasaba por ahí.
 *
 * Lo que aquí se fija, por lo que DEVUELVE: lo que traen se cobra, lo que falta
 * SIGUE PENDIENTE, y las dos cifras suman siempre lo que pedía la fila.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decidirCobroDelPendiente, pendienteQueCasa } from "../lib/billing/cobroParcial.js";

describe("cobrar menos de lo que pide la fila", () => {
  it("EL CASO DEL FALLO: 100 € de un pendiente de 160 € deja 60 € pendientes", () => {
    const r = decidirCobroDelPendiente({ pendiente: 160, importe: 100 });
    assert.equal(r.accion, "partir");
    assert.equal(r.cobrado, 100);
    assert.equal(r.restoPendiente, 60);
  });

  it("LA CUENTA QUE MANDA: lo cobrado más lo que queda es lo que pedía la fila", () => {
    for (const [debe, trae] of [[160, 100], [190, 30], [120, 119.99], [100, 0.01], [116.67, 58.33]]) {
      const r = decidirCobroDelPendiente({ pendiente: debe, importe: trae });
      const suma = Math.round((r.cobrado + r.restoPendiente) * 100) / 100;
      assert.equal(suma, debe, `con ${trae} de ${debe}`);
    }
  });

  it("los DECIMAL que llegan como texto se tratan como números", () => {
    const r = decidirCobroDelPendiente({ pendiente: "160.00", importe: "100.50" });
    assert.equal(r.accion, "partir");
    assert.equal(r.restoPendiente, 59.5);
  });
});

describe("cobrar lo mismo o de más", () => {
  it("el importe exacto cobra la fila entera y no parte nada", () => {
    const r = decidirCobroDelPendiente({ pendiente: 160, importe: 160 });
    assert.equal(r.accion, "cobrar-entero");
    assert.equal(r.cobrado, 160);
    assert.equal(r.restoPendiente, 0);
  });

  it("un céntimo de diferencia por redondeo no parte la fila", () => {
    const r = decidirCobroDelPendiente({ pendiente: 160, importe: 159.996 });
    assert.equal(r.accion, "cobrar-entero");
  });

  it("pagar de MÁS se absorbe en la fila, como hasta hoy: partir por arriba no significa nada", () => {
    const r = decidirCobroDelPendiente({ pendiente: 160, importe: 200 });
    assert.equal(r.accion, "cobrar-entero");
    assert.equal(r.cobrado, 200);
    assert.equal(r.restoPendiente, 0);
  });
});

describe("lo que no se puede decidir no se parte", () => {
  it("sin pendiente que comparar se comporta como siempre", () => {
    for (const pendiente of [0, null, undefined, "hola"]) {
      const r = decidirCobroDelPendiente({ pendiente, importe: 100 });
      assert.equal(r.accion, "cobrar-entero", `con pendiente ${pendiente}`);
      assert.equal(r.cobrado, 100);
      assert.equal(r.restoPendiente, 0);
    }
  });

  it("sin importe no se cobra ni se parte nada", () => {
    for (const importe of [0, -50, null, undefined]) {
      const r = decidirCobroDelPendiente({ pendiente: 160, importe });
      assert.equal(r.accion, "cobrar-entero", `con importe ${importe}`);
      assert.equal(r.restoPendiente, 0);
    }
  });

  it("sin nada no revienta", () => {
    const r = decidirCobroDelPendiente();
    assert.equal(r.accion, "cobrar-entero");
    assert.equal(r.restoPendiente, 0);
  });
});

/*
 * ── CUÁL DE LOS PENDIENTES SE ESTÁ PAGANDO (09/09/2026, AV-0085 de Aumenta) ─
 *
 * Con dos pendientes del mes —260 € de logopedia y 115 € de terapia
 * ocupacional— Rosa cobró 260 y el CRM apuntó un cobro NUEVO en vez de saldar
 * el de 260: la familia quedó con 260 € cobrados y 375 € pendientes a la vez,
 * contada como pagada y como morosa. Si el importe casa con uno, es ese.
 */
describe("cuál de los pendientes se está pagando", () => {
  const pendientes = [
    { id: "logo", amount: "260.00" },
    { id: "to", amount: "115.00" },
  ];

  it("el importe dice cuál es, sin adivinar nada", () => {
    assert.equal(pendienteQueCasa(pendientes, 260)?.id, "logo");
    assert.equal(pendienteQueCasa(pendientes, 115)?.id, "to");
  });

  it("los DECIMAL llegan como texto y siguen casando", () => {
    assert.equal(pendienteQueCasa([{ id: "x", amount: "47.50" }], "47.5")?.id, "x");
  });

  it("una cifra que no es la de ninguno no elige por su cuenta", () => {
    assert.equal(pendienteQueCasa(pendientes, 100), null);
    assert.equal(pendienteQueCasa(pendientes, 375), null); // la suma la cobra el camino de arriba
  });

  it("con dos iguales manda el orden en que llegan (el más antiguo)", () => {
    const iguales = [{ id: "primero", amount: 145 }, { id: "segundo", amount: 145 }];
    assert.equal(pendienteQueCasa(iguales, 145).id, "primero");
  });

  it("sin importe, sin pendientes o con basura no elige nada", () => {
    assert.equal(pendienteQueCasa(pendientes, 0), null);
    assert.equal(pendienteQueCasa(pendientes, null), null);
    assert.equal(pendienteQueCasa([], 260), null);
    assert.equal(pendienteQueCasa(null, 260), null);
  });

  it("un céntimo de diferencia no es el mismo cobro", () => {
    assert.equal(pendienteQueCasa(pendientes, 260.02), null);
    assert.equal(pendienteQueCasa(pendientes, 259.999)?.id, "logo");
  });
});
