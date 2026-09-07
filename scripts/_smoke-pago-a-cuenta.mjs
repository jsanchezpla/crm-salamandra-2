// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-pago-a-cuenta.mjs — la familia que paga varios meses de golpe
 * (07/09/2026, tarea del Registro del 06/09).
 *
 *   node scripts/_smoke-pago-a-cuenta.mjs
 *   node --test-name-pattern="cuadra" scripts/_smoke-pago-a-cuenta.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * «+ Registrar cobro» pedía UN mes, así que quien pagaba septiembre y octubre
 * juntos tenía que apuntar dos cobros a mano y el de octubre quedaba como
 * cobrado de un mes sin generar: nadie lo veía venir.
 *
 * Lo que aquí se fija, por lo que DEVUELVE:
 *
 *  - LA CUENTA QUE MANDA: lo repartido más lo que sobra es EXACTAMENTE lo que
 *    trajeron. Si esto se rompe, el CRM se inventa o se come dinero.
 *  - MESES ENTEROS: lo que no completa un mes no se reparte. Un mes futuro
 *    medio pagado no crearía su pendiente al generarse, y la familia debería
 *    un dinero que no saldría en ninguna pantalla.
 *  - EL MES EN CURSO A MEDIAS SE TERMINA PRIMERO, que es como se cobra de
 *    verdad: dejaron 50 € la semana pasada y hoy traen el resto y un mes más.
 *  - UN MES YA PAGADO NO PARA EL REPARTO: se salta y se sigue al siguiente.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HORIZONTE_MESES,
  faltaDelMes,
  mesSiguiente,
  mesesDesde,
  porQueNoCuadra,
  repartirACuenta,
} from "../lib/billing/pagoACuenta.js";

/** Tres meses de 120 € sin nada cobrado, que es el caso del encargo. */
const tresMeses = [
  { mes: "2026-09", coste: 120, yaCobrado: 0 },
  { mes: "2026-10", coste: 120, yaCobrado: 0 },
  { mes: "2026-11", coste: 120, yaCobrado: 0 },
];

describe("los meses que vienen", () => {
  it("el mes siguiente cruza el año", () => {
    assert.equal(mesSiguiente("2026-09"), "2026-10");
    assert.equal(mesSiguiente("2026-12"), "2027-01");
  });

  it("un mes ilegible no inventa el siguiente", () => {
    assert.equal(mesSiguiente("2026-13"), null);
    assert.equal(mesSiguiente(""), null);
    assert.equal(mesSiguiente(undefined), null);
  });

  it("mesesDesde da la lista seguida y del tamaño pedido", () => {
    assert.deepEqual(mesesDesde("2026-11", 3), ["2026-11", "2026-12", "2027-01"]);
    assert.equal(mesesDesde("2026-01").length, HORIZONTE_MESES);
    assert.deepEqual(mesesDesde("mal", 3), []);
  });
});

describe("lo que falta de un mes", () => {
  it("es el coste menos lo cobrado", () => {
    assert.equal(faltaDelMes({ coste: 120, yaCobrado: 50 }), 70);
    assert.equal(faltaDelMes({ coste: 120 }), 120);
  });

  it("pagar de más NO deja saldo negativo", () => {
    assert.equal(faltaDelMes({ coste: 120, yaCobrado: 200 }), 0);
  });

  it("un mes sin coste no pide nada (cuota en pausa, importe 0)", () => {
    assert.equal(faltaDelMes({ coste: 0, yaCobrado: 0 }), 0);
    assert.equal(faltaDelMes({ coste: null }), 0);
    assert.equal(faltaDelMes({}), 0);
  });

  it("los DECIMAL que llegan como texto se tratan como números", () => {
    assert.equal(faltaDelMes({ coste: "120.00", yaCobrado: "50.50" }), 69.5);
  });
});

describe("el reparto de un pago a cuenta", () => {
  it("EL CASO DEL ENCARGO: 240 € con cuota de 120 € cubren los dos meses siguientes", () => {
    const r = repartirACuenta({ importe: 240, meses: tresMeses });
    assert.deepEqual(r.aplicaciones.map((a) => a.mes), ["2026-09", "2026-10"]);
    assert.deepEqual(r.aplicaciones.map((a) => a.importe), [120, 120]);
    assert.equal(r.cubiertos, 2);
    assert.equal(r.sobra, 0);
  });

  it("LA CUENTA QUE MANDA: lo repartido más lo que sobra es lo que trajeron", () => {
    for (const importe of [1, 50, 119.99, 120, 240, 245.5, 360, 1000]) {
      const r = repartirACuenta({ importe, meses: tresMeses });
      const suma = r.aplicaciones.reduce((s, a) => s + a.importe, 0);
      assert.equal(Math.round((suma + r.sobra) * 100) / 100, importe, `con ${importe} €`);
      assert.equal(r.repartido, Math.round(suma * 100) / 100, `repartido con ${importe} €`);
    }
  });

  it("MESES ENTEROS: lo que no completa el mes siguiente no se reparte, sobra", () => {
    const r = repartirACuenta({ importe: 250, meses: tresMeses });
    assert.equal(r.cubiertos, 2);
    assert.equal(r.repartido, 240);
    assert.equal(r.sobra, 10);
    // Y ninguna aplicación por debajo de lo que vale su mes.
    for (const a of r.aplicaciones) assert.equal(a.importe, a.coste);
  });

  it("el mes en curso a medias se TERMINA primero, y luego van meses enteros", () => {
    const r = repartirACuenta({
      importe: 190,
      meses: [{ mes: "2026-09", coste: 120, yaCobrado: 50 }, ...tresMeses.slice(1)],
    });
    assert.deepEqual(r.aplicaciones.map((a) => [a.mes, a.importe]), [["2026-09", 70], ["2026-10", 120]]);
    assert.equal(r.sobra, 0);
  });

  it("un mes YA pagado se salta y el dinero va al siguiente", () => {
    const r = repartirACuenta({
      importe: 120,
      meses: [{ mes: "2026-09", coste: 120, yaCobrado: 120 }, ...tresMeses.slice(1)],
    });
    assert.deepEqual(r.aplicaciones.map((a) => a.mes), ["2026-10"]);
    assert.deepEqual(r.saltados, ["2026-09"]);
    assert.equal(r.sobra, 0);
  });

  it("un mes sin coste (cuota en pausa) no para el reparto ni se lleva nada", () => {
    const r = repartirACuenta({
      importe: 120,
      meses: [{ mes: "2026-09", coste: 0, yaCobrado: 0 }, { mes: "2026-10", coste: 120, yaCobrado: 0 }],
    });
    assert.deepEqual(r.aplicaciones.map((a) => a.mes), ["2026-10"]);
    assert.equal(r.sobra, 0);
  });

  it("sin meses que cobrar no se reparte nada y el dinero entero sobra", () => {
    const r = repartirACuenta({ importe: 240, meses: [] });
    assert.deepEqual(r.aplicaciones, []);
    assert.equal(r.sobra, 240);
  });

  it("un importe de cero o ilegible no reparte ni revienta", () => {
    for (const importe of [0, -50, null, undefined, "hola"]) {
      const r = repartirACuenta({ importe, meses: tresMeses });
      assert.deepEqual(r.aplicaciones, [], `con ${importe}`);
      assert.equal(r.sobra, 0, `con ${importe}`);
    }
  });

  it("los céntimos cuadran con cuotas que no son redondas", () => {
    const r = repartirACuenta({
      importe: 233.34,
      meses: [
        { mes: "2026-09", coste: 116.67, yaCobrado: 0 },
        { mes: "2026-10", coste: 116.67, yaCobrado: 0 },
      ],
    });
    assert.equal(r.cubiertos, 2);
    assert.equal(r.sobra, 0);
  });

  it("no se pasa del horizonte que le den: 12 meses son 12 cobros, no más", () => {
    const meses = mesesDesde("2026-09", HORIZONTE_MESES).map((mes) => ({ mes, coste: 100, yaCobrado: 0 }));
    const r = repartirACuenta({ importe: 5000, meses });
    assert.equal(r.cubiertos, HORIZONTE_MESES);
    assert.equal(r.repartido, 1200);
    assert.equal(r.sobra, 3800);
  });
});

describe("por qué no cuadra", () => {
  it("cuando cuadra, no dice nada", () => {
    assert.equal(porQueNoCuadra(repartirACuenta({ importe: 240, meses: tresMeses })), null);
  });

  it("dice lo que sobra y cuál es el importe de al lado que sí entra", () => {
    const frase = porQueNoCuadra(repartirACuenta({ importe: 250, meses: tresMeses }));
    assert.match(frase, /240,00 €/);
    assert.match(frase, /sobran 10,00 €/);
    assert.match(frase, /360,00 €/);
  });

  it("si no llega ni al primer mes, dice cuánto es ese primer mes", () => {
    const frase = porQueNoCuadra(repartirACuenta({ importe: 50, meses: tresMeses }));
    assert.match(frase, /120,00 €/);
  });

  it("sin meses que cobrar lo dice en cristiano, sin números que no existen", () => {
    const frase = porQueNoCuadra(repartirACuenta({ importe: 240, meses: [] }));
    assert.match(frase, /no tiene ningún mes/i);
  });
});
