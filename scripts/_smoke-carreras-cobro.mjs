/**
 * _smoke-carreras-cobro.mjs — qué pasa cuando dos cosas ocurren a la vez.
 *
 * El cobro NO puede hacerse dentro de la transacción que bloquea la agenda: es
 * una llamada de red a Stripe y mantendría las filas bloqueadas mientras dura.
 * Así que hay una ventana de uno o dos segundos en la que la cita está marcada
 * 'capturing' y cualquier otra cosa puede pasar: otra confirmación, una
 * cancelación del paciente, o que el proceso se muera.
 *
 * Esta ventana es donde viven los fallos caros, y son justo los que no se ven
 * probando a mano. Aquí se fuerzan a propósito:
 *
 *   1. Dos confirmaciones simultáneas -> UN solo cobro, nunca dos.
 *   2. El paciente cancela MIENTRAS se le está cobrando -> su dinero queda
 *      resuelto (la retención suelta, o el cobro devuelto: es la única
 *      excepción a «no se devuelve nunca», porque se le cobró una cita que ya
 *      estaba cancelada) y la cita NO resucita como confirmada.
 *   3. Una cita que se queda pegada en 'capturing' (proceso muerto a mitad) ->
 *      el vigilante le pregunta a Stripe y la desatasca.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-carreras-cobro.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig } from "../lib/payments/stripeConfig.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { vigilarRetencionesDeTenant } from "../lib/citas/caducidadRetencion.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PRECIO = 4500;
const MARCA = "smoke-carreras@example.com";
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
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.stdout.write(`\n═══ Smoke: carreras alrededor del cobro (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  const { models, sequelize } = getTenantDb(SLUG);
  const { Booking, EventType, PaymentSession } = models;
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const stripe = await getStripe(ctx);
  const secreto = getTenantStripeConfig(ctx).webhookSecret;

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const authHeaders = { "Content-Type": "application/json", Cookie: `access_token=${token}` };

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  const precioOriginal = eventType.price;
  await eventType.update({ price: PRECIO });
  const intents = [];
  const usados = new Set();

  async function retenida(desdeDia) {
    let hora = null;
    for (let d = desdeDia; d <= desdeDia + 20 && !hora; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const huecos = (await r.json())?.data?.slots ?? [];
      const libre = huecos.map((h) => h.datetime).find((x) => !usados.has(x));
      if (libre) hora = libre;
    }
    if (!hora) return null;
    usados.add(hora);

    const rb = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id, scheduledAt: hora,
        clientName: "Smoke Carreras", clientEmail: MARCA, clientPhone: "+34600888999",
        aceptaRetencion: true,
      }),
    });
    const id = (await rb.json())?.data?.booking?.id;
    if (!id) return null;

    const cita = await Booking.findByPk(id);
    const ps = await PaymentSession.findByPk(cita.paymentSessionId);
    intents.push(ps.stripePaymentIntentId);
    const pi = await stripe.paymentIntents.confirm(ps.stripePaymentIntentId, { payment_method: "pm_card_visa" });

    const ev = JSON.stringify({
      id: `evt_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "event", api_version: stripe.getApiField("version"),
      created: Math.floor(Date.now() / 1000),
      type: "payment_intent.amount_capturable_updated", data: { object: pi },
    });
    await fetch(`${BASE}/api/webhooks/stripe/${SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: ev, secret: secreto }),
      },
      body: ev,
    });
    await cita.reload();
    return { cita, ps };
  }

  /**
   * Lo que Stripe dice que se ha cobrado de verdad, en céntimos, y lo que se ha
   * devuelto. `amount_received` NO baja al devolver —el cobro ocurrió—, así que
   * para saber si el dinero ha vuelto hay que mirar el cargo.
   */
  async function cobradoEnStripe(piId) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    const cargoId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    const devuelto = cargoId ? (await stripe.charges.retrieve(cargoId)).amount_refunded ?? 0 : 0;
    return { estado: pi.status, recibido: pi.amount_received ?? 0, devuelto };
  }

  try {
    // ── 1. Dos confirmaciones a la vez ──────────────────────────────────────
    paso("1. Dos confirmaciones simultáneas");
    const a = await retenida(3);
    if (!a) throw new Error("no se pudo preparar");
    esperar(a.cita.paymentStatus === "authorized", `parte de 'authorized' (es '${a.cita.paymentStatus}')`);

    const dos = await Promise.all([
      fetch(`${BASE}/api/citas/bookings/${a.cita.id}/confirm`, { method: "PATCH", headers: authHeaders, body: "{}" }),
      fetch(`${BASE}/api/citas/bookings/${a.cita.id}/confirm`, { method: "PATCH", headers: authHeaders, body: "{}" }),
    ]);
    const oks = dos.filter((r) => r.status === 200).length;
    ok(`respuestas: ${dos.map((r) => r.status).join(" y ")} (${oks} con 200)`);

    const cA = await cobradoEnStripe(a.ps.stripePaymentIntentId);
    esperar(cA.recibido === PRECIO, `SE HA COBRADO UNA SOLA VEZ: ${cA.recibido} céntimos (esperado ${PRECIO})`);
    await a.cita.reload();
    esperar(a.cita.status === "confirmed", `la cita queda confirmada (es '${a.cita.status}')`);
    esperar(a.cita.paymentStatus === "paid",
      `y cobrada, no 'failed' por la segunda petición (es '${a.cita.paymentStatus}')`);

    // ── 2. El paciente cancela mientras se le cobra ─────────────────────────
    paso("2. El paciente cancela MIENTRAS se le está cobrando");
    const b = await retenida(6);
    if (b) {
      // Se lanza la confirmación y, sin esperarla, se cancela desde el enlace
      // del correo del paciente. La captura tarda ~1s: la cancelación cae
      // dentro de esa ventana.
      const confirmando = fetch(`${BASE}/api/citas/bookings/${b.cita.id}/confirm`, {
        method: "PATCH", headers: authHeaders, body: "{}",
      });
      await dormir(350);
      const rc = await fetch(`${BASE}/api/public/c/${SLUG}/cancel/${b.cita.cancellationToken}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
        body: JSON.stringify({ reason: "Me ha surgido algo" }),
      });
      const rConf = await confirmando;
      const cuerpoConf = await rConf.json().catch(() => null);
      ok(`confirmar respondió ${rConf.status} («${cuerpoConf?.error ?? "sin mensaje"}»), ` +
        `cancelar respondió ${rc.status}`);

      await b.cita.reload();
      const cB = await cobradoEnStripe(b.ps.stripePaymentIntentId);

      // Gane quien gane la carrera, el dinero no puede quedarse en el aire:
      // 'authorized' o 'capturing' es dinero comprometido en la tarjeta de
      // alguien con la cita ya resuelta y sin nadie que vaya a liquidarlo.
      const enElAire = ["authorized", "capturing"].includes(b.cita.paymentStatus);
      esperar(!enElAire,
        `el dinero queda resuelto, no en el aire (cita '${b.cita.status}'/'${b.cita.paymentStatus}', ` +
        `Stripe: ${cB.estado}, cobrado ${cB.recibido})`);

      // Si acabó confirmada, tiene que estar cobrada. Si acabó cancelada caben
      // TRES finales, y uno devuelve el dinero (`lib/citas/politicaReembolso.js`,
      // la excepción del 20/08/2026):
      //   'void'     — dio tiempo a soltar la retención: no se cobró nada.
      //   'refunded' — ganó la captura, y como se cobró una cita ya cancelada
      //                el CRM la devuelve entera. Es el final que se busca.
      //   'paid'     — ganó la captura y la devolución falló (Stripe no
      //                contestó). Queda para hacerla a mano, y el 409 lo dice.
      if (b.cita.status === "confirmed") {
        esperar(b.cita.paymentStatus === "paid", `confirmada Y cobrada (es '${b.cita.paymentStatus}')`);
      } else {
        esperar(["void", "refunded", "paid"].includes(b.cita.paymentStatus),
          `cancelada, con la retención suelta, el cobro devuelto o pendiente de devolver a mano ` +
          `(es '${b.cita.paymentStatus}')`);
        const cobradoEsperado = b.cita.paymentStatus === "void" ? 0 : PRECIO;
        const devueltoEsperado = b.cita.paymentStatus === "refunded" ? PRECIO : 0;
        esperar(cB.recibido === cobradoEsperado && cB.devuelto === devueltoEsperado,
          `y Stripe cuadra con eso (${cB.estado}, cobrado ${cB.recibido}, devuelto ${cB.devuelto})`);
      }
    }

    // ── 3. Pegada en 'capturing' ────────────────────────────────────────────
    paso("3. Una cita que se queda pegada en 'capturing'");
    const c = await retenida(9);
    if (c) {
      // Se simula el proceso muerto a mitad: marcada 'capturing', sin caducidad
      // (que es lo que la hacía invisible) y con fecha vieja.
      await c.cita.update({ paymentStatus: "capturing", authorizationExpiresAt: null });
      // Envejecer la fila con SQL directo: `Model.update({updatedAt}, {silent:true})`
      // NO cambia la marca de tiempo (silent existe justamente para no tocarla),
      // así que la primera versión de esta prueba dejaba la cita con updated_at
      // = ahora y el vigilante la ignoraba con razón. El fallo estaba en la
      // prueba, no en el vigilante.
      await sequelize.query(
        `UPDATE "crm_${SLUG}"."bookings" SET updated_at = now() - interval '1 hour' WHERE id = :id`,
        { replacements: { id: c.cita.id } }
      );

      const res = await vigilarRetencionesDeTenant(ctx);
      esperar(res.reconciliadas >= 1, `el vigilante la desatasca (reconcilió ${res.reconciliadas})`);
      await c.cita.reload();
      esperar(c.cita.paymentStatus !== "capturing",
        `ya no está pegada (es '${c.cita.paymentStatus}')`);
      esperar(c.cita.paymentStatus === "authorized",
        `y vuelve a 'authorized' porque Stripe dice que el dinero sigue retenido (es '${c.cita.paymentStatus}')`);
    }
  } finally {
    paso("Limpieza");
    for (const id of intents) {
      try {
        const p = await stripe.paymentIntents.retrieve(id);
        if (!["canceled", "succeeded"].includes(p.status)) await stripe.paymentIntents.cancel(id);
      } catch { /* ya no está */ }
    }
    const citas = await Booking.findAll({ where: { clientEmail: MARCA }, attributes: ["id"] });
    const ids = citas.map((x) => x.id);
    await PaymentSession.destroy({ where: { entityType: "booking", entityId: ids } });
    const n = await Booking.destroy({ where: { id: ids } });
    await eventType.update({ price: precioOriginal });
    process.stdout.write(`  · ${n} cita(s) borradas; precio devuelto a ${precioOriginal ?? "sin precio"}\n`);
  }

  process.stdout.write(
    fallos === 0 ? "\n✓ TODO CORRECTO — la ventana del cobro no deja dinero suelto\n\n"
                 : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
