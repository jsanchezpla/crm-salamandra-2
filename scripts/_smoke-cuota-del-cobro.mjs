// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-del-cobro.mjs — qué le pasa a la cuota al borrar un cobro
 * (18/09/2026, AV-0190 de Aumenta, «MOROSIDAD - Eliminar cobros futuros»).
 *
 *   node scripts/_smoke-cuota-del-cobro.mjs
 *   node --test-name-pattern="vigente" scripts/_smoke-cuota-del-cobro.mjs
 *
 * ── DE QUÉ PREGUNTA REAL NACE ──────────────────────────────────────────────
 *
 *   «No sabemos si eliminando los cobros uno a uno (que es un peñazo), se
 *    elimina la cuota, o para vosotros es lo mismo cobro que cuota??»
 *
 * No era un fallo: la pantalla nunca dijo que cobro y cuota son dos cosas. En
 * producción, a 18/09/2026, 304 de los 352 cobros de Aumenta salen de una cuota
 * y 291 de sus 295 cuotas siguen activas, así que borrar un cobro es casi
 * siempre borrar el de una cuota viva, que lo vuelve a generar. Y hay cuotas con
 * DIEZ cobros pendientes por delante, hasta junio de 2027: eso es lo que se
 * estaba borrando a mano, uno por mes.
 *
 * Lo que fija esta prueba es lo que DEVUELVE `loQuePasaConLaCuota`: los cuatro
 * casos (sin cuota, cuota ya borrada, cuota viva, cuota de baja), que solo el de
 * la cuota viva promete que el cobro vuelve, que la diferencia entre cobro y
 * cuota se dice SIEMPRE que hay cuota detrás —es la pregunta literal del
 * cliente— y que el desglose de borrar la cuota separa lo que se va (pendiente,
 * y cuánto de eso es de meses futuros) de lo que se queda (dinero o papel).
 * Porque eso es lo que se le enseña a alguien justo antes de borrar dinero, y
 * ahí una frase de más o de menos cambia la decisión.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loQuePasaConLaCuota, mesDelCobro } from "../lib/billing/cuotaDelCobro.js";

const HOY = "2026-09-18";
const cobro = { cuotaId: "c-1", periodMonth: "2026-09-01" };
const viva = { active: true, startDate: "2026-09-01", endDate: null };

describe("mesDelCobro", () => {
  it("saca 'AAAA-MM' de la fecha del periodo, venga como cadena o como Date", () => {
    assert.equal(mesDelCobro({ periodMonth: "2026-09-01" }), "2026-09");
    assert.equal(mesDelCobro({ periodMonth: new Date("2026-09-01T00:00:00Z") }), "2026-09");
  });

  it("sin periodo no se inventa un mes", () => {
    assert.equal(mesDelCobro({ periodMonth: null }), null);
    assert.equal(mesDelCobro(null), null);
  });
});

describe("loQuePasaConLaCuota", () => {
  it("un cobro suelto no tiene nada que contar ni nada que ofrecer", () => {
    const r = loQuePasaConLaCuota({ cobro: { cuotaId: null }, hoy: HOY });
    assert.equal(r.estado, "sin-cuota");
    assert.equal(r.deCuota, false);
    assert.equal(r.aviso, null);
    assert.equal(r.sePuedeBorrarLaCuota, false);
  });

  it("con la cuota VIVA avisa de que el cobro volverá, y dice de qué mes", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, hoy: HOY });
    assert.equal(r.estado, "vigente");
    assert.equal(r.vigente, true);
    assert.equal(r.volvera, true);
    assert.equal(r.sePuedeBorrarLaCuota, true);
    assert.equal(r.mes, "2026-09");
    // El mes se nombra en el aviso: «volverá a generar el de septiembre 2026».
    assert.match(r.aviso, /septiembre 2026/);
    assert.match(r.aviso, /SIGUE ACTIVA/);
  });

  // La pregunta literal del cliente. Si alguien recorta estas frases, que se
  // entere por la prueba y no por el siguiente aviso del buzón.
  it("SIEMPRE que hay cuota detrás explica que cobro y cuota no son lo mismo", () => {
    for (const cuota of [viva, { active: false, startDate: "2026-01-01", endDate: null }]) {
      const r = loQuePasaConLaCuota({ cobro, cuota, hoy: HOY });
      assert.match(r.aviso, /El cobro es lo que se paga un mes/);
      assert.match(r.aviso, /la cuota es la orden que lo genera todos los meses/);
      assert.match(r.aviso, /No son lo mismo/);
    }
  });

  it("con la cuota DE BAJA no promete que vuelva — ni apagada ni caducada", () => {
    for (const cuota of [
      { active: false, startDate: "2026-01-01", endDate: null },       // apagada a mano
      { active: true, startDate: "2026-01-01", endDate: "2026-06-30" }, // caducó sola
    ]) {
      const r = loQuePasaConLaCuota({ cobro, cuota, hoy: HOY });
      assert.equal(r.estado, "de-baja");
      assert.equal(r.volvera, false);
      // Sigue pudiéndose borrar: de baja es una fila que puede sobrar igual.
      assert.equal(r.sePuedeBorrarLaCuota, true);
      assert.match(r.aviso, /DE BAJA/);
    }
  });

  it("si la cuota ya no existe, no se ofrece borrar lo que no está", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: null, hoy: HOY });
    assert.equal(r.estado, "cuota-borrada");
    assert.equal(r.deCuota, true);
    assert.equal(r.sePuedeBorrarLaCuota, false);
    assert.equal(r.avisoAlBorrarLaCuota, null);
    assert.match(r.aviso, /ya no existe/);
  });

  it("borrar la cuota separa lo que se lleva de lo que se queda", () => {
    // 5 cobros más: 2 pendientes (se van con ella) y 3 ya cobrados o facturados.
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, otrosCobros: 5, otrosBorrables: 2, otrosFuturos: 1, hoy: HOY });
    assert.equal(r.seQuedan, 3);
    assert.match(r.avisoAlBorrarLaCuota, /Se lleva 2 cobros más que siguen pendientes, 1 de meses que aún no han llegado/);
    assert.match(r.avisoAlBorrarLaCuota, /3 cobros ya cobrados o facturados se quedan/);
  });

  /*
   * El caso de producción que motivó el aviso: una cuota firmada hasta junio de
   * 2027, con diez pendientes por delante y ninguno cobrado. Son diez borrados a
   * mano, y la frase tiene que decir «todos» para que se vea que este gesto los
   * sustituye.
   */
  it("con todo lo pendiente por delante lo dice en una frase, sin números sueltos", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, otrosCobros: 10, otrosBorrables: 10, otrosFuturos: 10, hoy: HOY });
    assert.equal(r.seQuedan, 0);
    assert.match(r.avisoAlBorrarLaCuota, /Se lleva 10 cobros más que siguen pendientes, todos de meses que aún no han llegado/);
    assert.doesNotMatch(r.avisoAlBorrarLaCuota, /se quedan/);
  });

  it("y habla en singular cuando es uno solo", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, otrosCobros: 2, otrosBorrables: 1, hoy: HOY });
    assert.equal(r.seQuedan, 1);
    assert.match(r.avisoAlBorrarLaCuota, /Se lleva 1 cobro más que sigue[n]? pendiente|Se lleva 1 cobro más/);
    assert.match(r.avisoAlBorrarLaCuota, /1 cobro ya cobrados? o facturados? se queda/);
  });

  it("sin más cobros detrás, el aviso no nombra a ninguno", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, otrosCobros: 0, otrosBorrables: 0, hoy: HOY });
    assert.equal(r.seQuedan, 0);
    assert.equal(r.avisoAlBorrarLaCuota, "Se borrará también la cuota mensual de esta familia: dejará de generar cobros.");
  });

  it("nunca cuenta cobros en negativo ni más futuros que pendientes", () => {
    const r = loQuePasaConLaCuota({ cobro, cuota: viva, otrosCobros: 1, otrosBorrables: 4, otrosFuturos: 9, hoy: HOY });
    assert.equal(r.seQuedan, 0);
    assert.doesNotMatch(r.avisoAlBorrarLaCuota, /se quedan/);
    // 9 futuros de 4 que se van sería una frase imposible: se recorta a «todos».
    assert.match(r.avisoAlBorrarLaCuota, /todos de meses que aún no han llegado/);
  });
});
