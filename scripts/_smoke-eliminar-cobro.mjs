// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-eliminar-cobro.mjs — borrar el cobro, ¿y la cuota? (18/09/2026).
 *
 *   node scripts/_smoke-eliminar-cobro.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 *
 * Aumenta, AV-0190 («MOROSIDAD - Eliminar cobros futuros»): «quieren saber que
 * si al eliminar el cobro se borra la cuota (quieren tener la opción de
 * eliminar también la cuota)». Hasta el
 * 18/09/2026 «Eliminar cobro» no decía una palabra de la cuota, y la cuota es
 * la que manda: sigue activa y vuelve a generar el cobro del mes. En producción
 * había 9 cuotas de Aumenta sin un solo cobro detrás.
 *
 * Esto fija lo que DEVUELVE `lib/billing/eliminarCobro.js`: que la pregunta
 * ofrece las dos salidas con valores estables (los que viajan en el `fetch`) y
 * que el reparto de cobros al borrar la cuota se queda el dinero y el papel.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  preguntaAlEliminarCobroDeCuota,
  repartoAlBorrarLaCuota,
  SOLO_EL_COBRO,
  COBRO_Y_CUOTA,
} from "../lib/billing/eliminarCobro.js";

test("la pregunta ofrece exactamente las dos salidas, y la de la cuota va en rojo", () => {
  const p = preguntaAlEliminarCobroDeCuota({ quien: "Familia Pérez", importe: "190,00 €" });
  assert.deepEqual(p.opciones.map((o) => o.valor), [SOLO_EL_COBRO, COBRO_Y_CUOTA]);
  assert.equal(p.opciones[1].tono, "peligro");
  // Los dos valores son distintos: si alguien los iguala, el `fetch` mandaría
  // `?cuota=1` siempre y borraría cuotas sin que nadie lo haya pedido.
  assert.notEqual(SOLO_EL_COBRO, COBRO_Y_CUOTA);
});

test("la pregunta dice que cobro y cuota no son lo mismo, y que existe la baja", () => {
  const p = preguntaAlEliminarCobroDeCuota({ quien: "Familia Pérez", importe: "190,00 €" });
  const todo = `${p.texto} ${p.opciones.map((o) => `${o.label} ${o.pista}`).join(" ")}`;
  // La pregunta literal del cliente: «¿o para vosotros es lo mismo cobro que
  // cuota?». Si esta frase se cae, la pantalla vuelve a no contestarla.
  assert.match(todo, /no son lo mismo/i);
  assert.match(todo, /volver[áa] a generar/i);
  assert.match(todo, /baja/i);
  // Y con a quién y cuánto: preguntar «¿seguro?» sin decir de quién es el
  // cobro es lo que hace que se borre el de la familia de al lado.
  assert.match(p.texto, /Familia Pérez/);
  assert.match(p.texto, /190,00/);
});

test("con la cuenta del servidor delante, la pregunta dice sus números", () => {
  const p = preguntaAlEliminarCobroDeCuota({
    quien: "Familia Pérez",
    importe: "190,00 €",
    cuota: {
      deCuota: true,
      volvera: true,
      sePuedeBorrarLaCuota: true,
      aviso: "La cuota SIGUE ACTIVA y volverá a generar el de septiembre 2026.",
      avisoAlBorrarLaCuota: "Se lleva 10 cobros más que siguen pendientes, todos de meses que aún no han llegado.",
    },
  });
  assert.match(p.texto, /SIGUE ACTIVA/);
  assert.match(p.opciones[1].pista, /10 cobros más/);
});

test("si la cuota ya no existe, no se ofrece borrarla ni se promete que vuelva", () => {
  const p = preguntaAlEliminarCobroDeCuota({
    cuota: {
      deCuota: true,
      volvera: false,
      sePuedeBorrarLaCuota: false,
      aviso: "Este cobro salió de una cuota mensual que ya no existe.",
      avisoAlBorrarLaCuota: null,
    },
  });
  assert.deepEqual(p.opciones.map((o) => o.valor), [SOLO_EL_COBRO]);
  assert.match(p.opciones[0].pista, /no volver[áa]/i);
});

test("la pregunta sale entera aunque no se sepa de quién es ni cuánto", () => {
  const p = preguntaAlEliminarCobroDeCuota();
  assert.equal(typeof p.titulo, "string");
  assert.equal(p.opciones.length, 2);
  assert.doesNotMatch(p.texto, /undefined|null/);
  assert.doesNotMatch(p.opciones.map((o) => o.pista).join(" "), /undefined|null/);
});

test("con la cuota se van los cobros que no son dinero ni papel; el resto se queda", () => {
  const cobros = [
    { id: "a", status: "pending" },
    { id: "b", status: "completed" },
    { id: "c", status: "pending", invoiceId: "f1" },
    { id: "d", status: "pending", stripePaymentIntentId: "pi_1" },
    { id: "e", status: "pending", bankTransactionId: "mov1" },
    { id: "f", status: "refunded" },
  ];
  const { seBorran, seQuedan, total } = repartoAlBorrarLaCuota(cobros);
  assert.deepEqual(seBorran.map((c) => c.id), ["a"]);
  assert.deepEqual(seQuedan.map((c) => c.id), ["b", "c", "d", "e", "f"]);
  assert.equal(total, 6);
});

test("el cobro que ya se borró aparte no se cuenta dos veces", () => {
  const cobros = [{ id: "a", status: "pending" }, { id: "b", status: "pending" }];
  const { seBorran, total } = repartoAlBorrarLaCuota(cobros, { salvo: "a" });
  assert.deepEqual(seBorran.map((c) => c.id), ["b"]);
  assert.equal(total, 1);
});

test("sin cobros detrás no revienta ni inventa", () => {
  assert.deepEqual(repartoAlBorrarLaCuota(null), { seBorran: [], seQuedan: [], total: 0 });
  assert.deepEqual(repartoAlBorrarLaCuota([]), { seBorran: [], seQuedan: [], total: 0 });
});
