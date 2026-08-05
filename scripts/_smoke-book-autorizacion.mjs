/**
 * _smoke-book-autorizacion.mjs — reserva pública de una cita DE PAGO, por HTTP
 * contra el servidor de desarrollo.
 *
 * Comprueba el contrato nuevo de POST /api/public/c/[slug]/book: ya no devuelve
 * una URL de Stripe a la que mandar al paciente, sino el `clientSecret` con el
 * que el widget pinta el formulario de tarjeta dentro del iframe.
 *
 * Y comprueba lo que más duele si se rompe: que al hacer DOBLE CLIC no se creen
 * dos retenciones. Una persona con 90 € bloqueados por una cita de 45 € es el
 * peor fallo de este flujo.
 *
 * Le pone precio a un tipo de cita, prueba, y lo deja como estaba.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-book-autorizacion.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500; // 45,00 €
/** IP propia: el limite de /book es POR IP y la tanda entera desde una sola se agotaria el cupo. */
// IP distinta en cada ejecución dentro del rango de documentación (RFC 5737):
// con una fija, lanzar la prueba dos veces seguidas agotaba el cupo por IP de
// /book y todo salía 429 — fallos que parecían del producto.
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

/** Saca la hora de un hueco sin dar por hecho el nombre del campo. */
function horaDelHueco(h) {
  const v = h?.datetime ?? h?.start ?? h?.scheduledAt ?? h?.time;
  if (!v) throw new Error(`No sé leer la hora de este hueco: ${JSON.stringify(h)}`);
  return v;
}

async function json(url, opts) {
  const r = await fetch(url, opts);
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* respuesta sin JSON */ }
  return { status: r.status, body: cuerpo };
}

async function main() {
  process.stdout.write(`\n═══ Smoke: reserva de pago por HTTP (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };

  // ── Preparar: ponerle precio a un tipo de cita ───────────────────────────
  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  if (!eventType) { process.stderr.write("✗ sin tipos de cita\n"); process.exit(1); }
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  process.stdout.write(`  · "${eventType.name}" con precio ${PRECIO / 100} € (temporal)\n`);

  const creados = [];
  const intents = [];

  try {
    // ── Buscar un hueco libre ──────────────────────────────────────────────
    paso("1. Buscar hueco libre");
    let hora = null;
    for (let d = 2; d <= 20 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const { body } = await json(
        `${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`
      );
      const huecos = body?.data?.slots ?? body?.data ?? [];
      if (Array.isArray(huecos) && huecos.length) hora = horaDelHueco(huecos[huecos.length - 1]);
    }
    if (!hora) { mal("no se encontró ningún hueco libre en 20 días"); throw new Error("sin huecos"); }
    ok(`hueco encontrado: ${hora}`);

    const cuerpo = {
      eventTypeId: eventType.id,
      scheduledAt: hora,
      clientName: "Smoke Reserva",
      clientEmail: "smoke-book@example.com",
      clientPhone: "+34600111222",
      // El servidor lo exige cuando la cita tiene precio.
      aceptaRetencion: true,
    };
    const cabeceras = { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA };

    // ── Reservar ───────────────────────────────────────────────────────────
    paso("2. POST /book de una cita con precio");
    const r1 = await json(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: cabeceras, body: JSON.stringify(cuerpo),
    });
    esperar(r1.status === 201, `responde 201 (es ${r1.status})`);
    const d1 = r1.body?.data ?? {};
    esperar(d1.paymentRequired === true, "dice que hace falta pagar");
    esperar(typeof d1.clientSecret === "string" && d1.clientSecret.startsWith("pi_"),
      `devuelve clientSecret (${String(d1.clientSecret).slice(0, 12)}…)`);
    esperar(typeof d1.publishableKey === "string" && d1.publishableKey.startsWith("pk_"),
      "devuelve la clave publicable para pintar el formulario");
    esperar(d1.checkoutUrl === undefined, "YA NO devuelve checkoutUrl (no se saca al paciente del iframe)");
    esperar(d1.amount === PRECIO, `importe correcto (${d1.amount})`);

    if (d1.booking?.id) creados.push(d1.booking.id);

    const row = await Booking.findByPk(d1.booking?.id);
    esperar(!!row, "la cita existe en la base de datos");
    esperar(row?.status === "pending", `nace 'pending' (es '${row?.status}')`);
    esperar(row?.paymentStatus === "authorizing", `nace 'authorizing' (es '${row?.paymentStatus}')`);
    esperar(row?.amount === PRECIO, `guarda el importe (${row?.amount})`);
    const minutos = row?.holdExpiresAt ? (new Date(row.holdExpiresAt) - Date.now()) / 60000 : null;
    esperar(minutos !== null && minutos > 5 && minutos < 40,
      `la hora se le guarda una ventana corta (${minutos?.toFixed(0)} min), no días`);
    esperar(row?.authorizationExpiresAt == null,
      "todavía NO hay caducidad de dinero (aún no hay dinero retenido)");

    const ps = row?.paymentSessionId ? await PaymentSession.findByPk(row.paymentSessionId) : null;
    esperar(ps?.status === "authorizing", `PaymentSession enlazada y 'authorizing' (es '${ps?.status}')`);
    if (ps?.stripePaymentIntentId) intents.push(ps.stripePaymentIntentId);

    // ── Consentimiento ─────────────────────────────────────────────────────
    paso("2b. Queda archivado QUÉ aceptó, cuándo y por cuánto");
    const prueba = ps?.metadata?.consentimiento;
    esperar(!!prueba, "la sesión de pago guarda la prueba del consentimiento");
    if (prueba) {
      esperar(typeof prueba.version === "string" && prueba.version.length > 0,
        `con versión del texto (${prueba.version})`);
      esperar(prueba.importe === PRECIO, `y el importe que se le enseñó (${prueba.importe})`);
      esperar(Array.isArray(prueba.texto) && prueba.texto.length > 0,
        "y el texto literal que leyó, no una referencia a él");
      esperar(!!prueba.aceptadoEn, "y cuándo lo aceptó");
    }

    paso("2c. Sin aceptar las condiciones NO se puede reservar");
    const rSin = await json(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: cabeceras,
      body: JSON.stringify({
        ...cuerpo,
        clientEmail: "smoke-book-sin@example.com",
        scheduledAt: hora,
        aceptaRetencion: false,
      }),
    });
    esperar(rSin.status === 422, `se rechaza con 422 (es ${rSin.status})`);

    // ── Doble clic ─────────────────────────────────────────────────────────
    paso("3. Doble clic: NO puede crear una segunda retención");
    const r2 = await json(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: cabeceras, body: JSON.stringify(cuerpo),
    });
    const d2 = r2.body?.data ?? {};
    if (r2.status === 201 && d2.clientSecret) {
      esperar(d2.clientSecret === d1.clientSecret,
        "le devuelve EL MISMO formulario de tarjeta, no uno nuevo");
      esperar(d2.booking?.id === d1.booking?.id, "y la misma cita");
    } else {
      esperar(r2.status === 409, `o bien le dice que espere (es ${r2.status})`);
    }
    const cuantas = await Booking.count({ where: { clientEmail: cuerpo.clientEmail } });
    esperar(cuantas === 1, `sigue habiendo UNA sola cita (hay ${cuantas})`);
    const cuantasPs = await PaymentSession.count({ where: { entityType: "booking", entityId: row.id } });
    esperar(cuantasPs === 1, `y UNA sola retención (hay ${cuantasPs}) — dos serían el doble de dinero bloqueado`);

    // ── El paciente mete la tarjeta ────────────────────────────────────────
    paso("4. El paciente confirma la tarjeta");
    const stripe = await getStripe(ctx);
    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, {
      payment_method: "pm_card_visa",
    });
    esperar(pi.status === "requires_capture", `Stripe retiene el dinero (es '${pi.status}')`);
    esperar(pi.amount_received === 0, "sin cobrar nada todavía");
    ok("(el paso a 'authorized' lo hará el webhook — se prueba aparte)");
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    paso("Limpieza");
    const stripe = await getStripe(ctx);
    for (const id of intents) {
      try {
        const pi = await stripe.paymentIntents.retrieve(id);
        if (pi.status !== "canceled" && pi.status !== "succeeded") await stripe.paymentIntents.cancel(id);
      } catch { /* ya no existe */ }
    }
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: creados } });
    const n = await Booking.destroy({
      where: { clientEmail: ["smoke-book@example.com", "smoke-book-sin@example.com"] },
    });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s) y sus retenciones borradas; precio devuelto a ${precioOriginal ?? "sin precio"}\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — la reserva prepara la tarjeta sin cobrar\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
