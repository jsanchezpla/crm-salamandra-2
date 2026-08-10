/**
 * _smoke-fraccionado-reloj.mjs — ¿el tope de cuotas PARA el cobro de verdad?
 *
 * ⚠️ SOLO CON CLAVES DE PRUEBA. Se planta si la cuenta del tenant está en modo
 * real: usa relojes de prueba de Stripe, que no existen en producción, y lo
 * último que quiero es que esto toque una cuenta con pacientes.
 *
 * ── LO QUE NINGUNA OTRA PRUEBA PUEDE COMPROBAR ──────────────────────────────
 * `_smoke-fraccionado.mjs` comprueba aritmética y formas de datos, y una compra
 * real comprueba que el tope SE PONE. Pero que el tope FRENE hay que esperarlo
 * meses: la cuota 2 llega al mes, la 3 a los dos, y la que no debe llegar, a los
 * tres. Nadie va a esperar tres meses para saber si un cobro se detiene, así que
 * nunca se comprobó — y en el fallo del 07/08/2026 eso fue exactamente lo que
 * nadie vio: dos suscripciones sin freno durante tres días.
 *
 * Un reloj de prueba congela el tiempo de Stripe y lo hace saltar a voluntad.
 * Aquí se recorre un plan de 3 cuotas entero, mes a mes, en un par de minutos, y
 * se mira lo único que importa: que en la 4ª NO se cobre nada.
 *
 * ── QUÉ MONTA Y QUÉ LIMPIA ──────────────────────────────────────────────────
 * Producto, precio, cliente con tarjeta de prueba y suscripción, todo colgando
 * del reloj. Al terminar borra el reloj, y con él se va todo lo demás. Si se
 * corta a la mitad, el reloj queda huérfano y se borra desde el panel de Stripe
 * de pruebas (Developers → Test clocks).
 *
 * USO
 *   node --env-file=.env.local scripts/_smoke-fraccionado-reloj.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getStripe } from "../lib/payments/stripeConfig.js";
import { ponerTopeDeCuotas, topePuesto } from "../lib/payments/fraccionado.js";

const SLUG = process.argv[2] ?? "nutri_laura";
const CUOTAS = 3;
const IMPORTE = 100; // 1,00 € — da igual, es de mentira

const w = (s) => process.stdout.write(s);
const eur = (c) => (c / 100).toFixed(2) + " €";
const dia = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "—");
let fallos = 0;
const check = (etiqueta, ok, detalle = "") => {
  if (!ok) fallos++;
  w(`${ok ? "  ✓" : "  ✗"} ${etiqueta}${detalle ? ` — ${detalle}` : ""}\n`);
};

getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug: SLUG } });
if (!tenant) {
  w(`\n✗ No existe el cliente "${SLUG}".\n\n`);
  process.exit(1);
}
const ctx = { tenant, slug: SLUG };
const stripe = await getStripe(ctx);

// El cerrojo: en una cuenta real esto no se ejecuta. `livemode` lo dice Stripe,
// no nosotros, así que no depende de leer bien una clave.
const cuenta = await stripe.accounts.retrieve();
const prueba = await stripe.balance.retrieve();
if (prueba.livemode) {
  w(`\n✗ La cuenta de ${SLUG} (${cuenta.id}) está en MODO REAL. Esto no se ejecuta ahí.\n`);
  w("  Lánzalo en local, donde el tenant tiene claves de prueba.\n\n");
  process.exit(1);
}

w("\n══════════════════════════════════════════════════════════════\n");
w(` El tope de cuotas, con el reloj acelerado · ${SLUG}\n`);
w(` cuenta ${cuenta.id} · MODO PRUEBAS\n`);
w("══════════════════════════════════════════════════════════════\n\n");

/** Espera a que el reloj termine de saltar: avanzar es asíncrono. */
async function esperarReloj(id) {
  for (let i = 0; i < 60; i++) {
    const r = await stripe.testHelpers.testClocks.retrieve(id);
    if (r.status === "ready") return r;
    if (r.status === "internal_failure") throw new Error("el reloj de prueba falló por dentro");
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("el reloj no terminó de avanzar en 2 minutos");
}

const cobradas = async (subId) =>
  (await stripe.invoices.list({ subscription: subId, status: "paid", limit: 100 })).data.length;

let reloj = null;
try {
  const ahora = Math.floor(Date.now() / 1000);
  reloj = await stripe.testHelpers.testClocks.create({ frozen_time: ahora, name: "smoke fraccionado" });
  w(`▶ Reloj creado, congelado en ${dia(reloj.frozen_time)}\n\n`);

  const producto = await stripe.products.create({ name: "Programa de prueba (smoke)" });
  const precio = await stripe.prices.create({
    product: producto.id,
    unit_amount: IMPORTE,
    currency: "eur",
    recurring: { interval: "month" },
  });
  const cliente = await stripe.customers.create({
    name: "Paciente de prueba",
    test_clock: reloj.id,
  });
  const tarjeta = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
  await stripe.paymentMethods.attach(tarjeta.id, { customer: cliente.id });
  await stripe.customers.update(cliente.id, {
    invoice_settings: { default_payment_method: tarjeta.id },
  });

  const sub = await stripe.subscriptions.create({
    customer: cliente.id,
    items: [{ price: precio.id }],
    metadata: { cuotas: String(CUOTAS) },
  });
  w(`▶ Suscripción ${sub.id} · ${eur(IMPORTE)}/mes · pactadas ${CUOTAS}\n\n`);

  w("▶ 1ª cuota (la del checkout)\n");
  check(`se ha cobrado 1`, (await cobradas(sub.id)) === 1, `${await cobradas(sub.id)}`);

  // Aquí es donde el 07/08 se rompía todo.
  w("\n▶ Poner el tope (la llamada que fallaba)\n");
  const calId = await ponerTopeDeCuotas(ctx, { subscriptionId: sub.id, cuotas: CUOTAS });
  const cal = await stripe.subscriptionSchedules.retrieve(calId);
  check("el calendario cancela al terminar", cal.end_behavior === "cancel", cal.end_behavior);
  check("tiene la fase de las cuotas que faltan", (cal.phases ?? []).length >= 2, `${cal.phases?.length} fase(s)`);
  check("y `topePuesto` lo reconoce", topePuesto(cal, CUOTAS - 1) === true);

  // Idempotencia: repetir no puede duplicar ni romper nada.
  const otraVez = await ponerTopeDeCuotas(ctx, { subscriptionId: sub.id, cuotas: CUOTAS });
  check("repetirlo no cambia nada", otraVez === calId);

  // Mes a mes hasta pasarnos una cuota del final.
  let frozen = reloj.frozen_time;
  for (let mes = 2; mes <= CUOTAS + 1; mes++) {
    const destino = new Date(frozen * 1000);
    destino.setUTCMonth(destino.getUTCMonth() + 1);
    destino.setUTCDate(destino.getUTCDate() + 1); // un día de margen: la factura se emite al empezar el ciclo
    frozen = Math.floor(destino.getTime() / 1000);

    w(`\n▶ Salto al mes ${mes} (${dia(frozen)})\n`);
    await stripe.testHelpers.testClocks.advance(reloj.id, { frozen_time: frozen });
    await esperarReloj(reloj.id);

    const n = await cobradas(sub.id);
    const estado = (await stripe.subscriptions.retrieve(sub.id)).status;

    if (mes <= CUOTAS) {
      check(`cobra la cuota ${mes}`, n === mes, `van ${n}`);
      check("la suscripción sigue viva", estado !== "canceled", estado);
    } else {
      // LO QUE IMPORTA DE TODO ESTE FICHERO.
      check(`NO cobra una ${mes}ª cuota`, n === CUOTAS, `van ${n} y se pactaron ${CUOTAS}`);
      check("la suscripción se ha cancelado sola", estado === "canceled", estado);
    }
  }
} catch (e) {
  fallos++;
  w(`\n✗ Se ha roto: ${e.message}\n`);
} finally {
  if (reloj) {
    // Borrar el reloj se lleva por delante cliente, suscripción y facturas.
    await stripe.testHelpers.testClocks.del(reloj.id).catch(() => {});
    w("\n· Reloj de prueba borrado (con él, todo lo que colgaba).\n");
  }
}

w(fallos === 0 ? "\n✓ El tope frena: se cobran las cuotas pactadas y ni una más\n\n" : `\n✗ ${fallos} fallo(s)\n\n`);
process.exit(fallos === 0 ? 0 : 1);
