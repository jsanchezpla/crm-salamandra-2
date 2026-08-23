// @prueba-lanzar --import ./scripts/_fake-stripe-loader.mjs
/**
 * _smoke-retencion-viva-o-muerta.mjs — el trozo que faltaba de «pedirle otra
 * tarjeta».
 *
 * `_smoke-pedir-otra-tarjeta.mjs` fija los seis casos que se deciden sin salir
 * de casa, y dice en su cabecera lo que NO cubre: la distinción final entre una
 * retención VIVA (`requires_capture`) y una MUERTA (`canceled`), porque para eso
 * hay que preguntarle a Stripe y ningún tenant de local tiene claves. Esto lo
 * cubre.
 *
 * ── CÓMO, SIN UNA CUENTA DE STRIPE ──────────────────────────────────────────
 * Se falsea la LIBRERÍA de Stripe, no nuestro código (`_fake-stripe.mjs`, que
 * enchufa `_fake-stripe-loader.mjs`). Todo lo que se ejercita es el de
 * producción: `getStripe` monta el cliente con la clave del tenant,
 * `leerEstadoAutorizacion` interpreta lo que contesta Stripe y
 * `estorbaParaPedirOtraTarjeta` decide. Lo único inventado es la respuesta que
 * da Stripe, que es justo lo que no se podía tener.
 *
 * Los cinco desenlaces posibles de esa pregunta, y qué tiene que pasar:
 *
 *   requires_capture  el paciente TIENE el importe bloqueado  → 409. Crear otra
 *                     retención le dejaría dos importes retenidos a la vez.
 *   canceled          murió                                   → adelante
 *   succeeded         ya se cobró                             → adelante
 *   no existe         de otra cuenta o clave rotada           → adelante (no hay
 *                     nada que duplicar, y bloquear aquí dejaba el botón muerto
 *                     PARA SIEMPRE en esa cita)
 *   no contesta       no lo sabemos                           → 409. «No lo sé»
 *                     nunca puede ser vía libre cuando hay dinero de por medio.
 *
 * Requiere el tenant `sandbox` (scripts/seed-sandbox.js). Le pone unas claves de
 * Stripe FALSAS mientras dura la prueba y se las quita al terminar.
 *
 * Uso:
 *   node --import ./scripts/_fake-stripe-loader.mjs --env-file=.env.local \
 *        scripts/_smoke-retencion-viva-o-muerta.mjs
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { encryptSecret } from "../lib/crypto/secretBox.js";
import { leerEstadoAutorizacion } from "../lib/payments/autorizacion.js";
import { estorbaParaPedirOtraTarjeta } from "../lib/citas/cobroCita.js";

const SLUG = process.argv[2] || "sandbox";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

async function main() {
  // Si el Stripe de mentira no está enchufado, esta prueba llamaría a Stripe de
  // VERDAD con una clave inventada. Se para antes.
  const { default: Stripe } = await import("stripe");
  if (!/mentira/i.test(String(new Stripe("sk_test_x", {}).paymentIntents.retrieve))) {
    // El de verdad no tiene la palabra en su código; el de mentira, tampoco
    // necesariamente. Se comprueba de forma directa:
    const prueba = await new Stripe("sk_test_x", {}).paymentIntents.retrieve("pi_fake_muerta").catch(() => null);
    if (prueba?.status !== "canceled") {
      process.stderr.write(
        "\n✗ El Stripe de mentira no está enchufado. Lánzalo así:\n" +
          "  node --import ./scripts/_fake-stripe-loader.mjs --env-file=.env.local scripts/_smoke-retencion-viva-o-muerta.mjs\n\n"
      );
      process.exit(1);
    }
  }

  process.stdout.write(`\n═══ Smoke: ¿la retención sigue viva? (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant "${SLUG}" (créalo con scripts/seed-sandbox.js)`);

  const settingsOriginales = JSON.parse(JSON.stringify(tenant.settings ?? {}));

  const { models: tenantModels } = getTenantDb(SLUG);
  const { Booking, PaymentSession, EventType } = tenantModels;

  const creados = { bookings: [], sesiones: [], tipos: [] };

  try {
    // ── Claves de mentira, solo mientras dura esto ─────────────────────────
    const settings = JSON.parse(JSON.stringify(settingsOriginales));
    settings.integrations = {
      ...(settings.integrations ?? {}),
      stripeSecretKey: encryptSecret("sk_test_DEL_SMOKE_no_sirve_para_nada_000000"),
      stripeWebhookSecret: encryptSecret("whsec_DEL_SMOKE_no_sirve_para_nada_000000"),
      stripePublishableKey: "pk_test_del_smoke",
    };
    await tenant.update({ settings });
    await tenant.reload();
    const ctx = { slug: SLUG, tenant, tenantModels };

    // ── 1. Leer el estado, uno a uno ───────────────────────────────────────
    paso("Qué entiende el CRM de cada respuesta de Stripe");
    const casos = [
      ["pi_fake_viva", { viva: true, sePudoPreguntar: true }, "requires_capture → VIVA"],
      ["pi_fake_muerta", { viva: false, sePudoPreguntar: true }, "canceled → muerta"],
      ["pi_fake_cobrada", { viva: false, sePudoPreguntar: true }, "succeeded → ya cobrada, no estorba"],
      ["pi_fake_desaparecida", { viva: false, sePudoPreguntar: true }, "no existe → no hay nada que duplicar"],
      ["pi_fake_caida", { viva: false, sePudoPreguntar: false }, "Stripe no contesta → NO SE SABE"],
      [null, { viva: false, sePudoPreguntar: true }, "sin PaymentIntent → nada que mirar"],
    ];
    for (const [pi, esperado, titulo] of casos) {
      const r = await leerEstadoAutorizacion(ctx, { stripePaymentIntentId: pi });
      esperar(
        r.viva === esperado.viva && r.sePudoPreguntar === esperado.sePudoPreguntar,
        titulo,
        JSON.stringify(r)
      );
    }

    // ── 2. Y qué decide el botón ───────────────────────────────────────────
    paso("Y qué hace el botón con cada uno");

    const tipo = await EventType.create({
      name: "Cita del smoke",
      slug: `smoke-retencion-${Date.now()}`,
      duration: 60,
      price: 4500,
      active: false,
    });
    creados.tipos.push(tipo.id);

    // El PaymentIntent va con sufijo porque la fila de cobro lo tiene con índice
    // único: dos citas del mismo caso chocarían. El Stripe de mentira busca su
    // guion por prefijo justo por esto.
    let n = 0;
    async function citaFallida(base) {
      const pi = base ? `${base}_${++n}` : null;
      const cita = await Booking.create({
        eventTypeId: tipo.id,
        clientName: "Paciente del smoke",
        clientEmail: "smoke-retencion@example.com",
        clientPhone: "600000000",
        modality: "presencial",
        scheduledAt: new Date(Date.now() + 3 * 24 * 3600_000),
        duration: 60,
        amount: 4500,
        status: "pending",
        paymentStatus: "failed",
      });
      creados.bookings.push(cita.id);
      const ps = await PaymentSession.create({
        entityType: "booking",
        entityId: cita.id,
        amount: 4500,
        currency: "eur",
        status: "failed",
        stripePaymentIntentId: pi,
      });
      creados.sesiones.push(ps.id);
      await cita.update({ paymentSessionId: ps.id });
      return cita;
    }

    const decisiones = [
      ["pi_fake_viva", true, "con la retención VIVA estorba: no se le bloquea el importe dos veces"],
      ["pi_fake_muerta", false, "con la retención MUERTA deja pasar: es para lo que existe el botón"],
      ["pi_fake_cobrada", false, "ya cobrada, deja pasar"],
      ["pi_fake_desaparecida", false, "el PaymentIntent que ya no existe deja pasar"],
      ["pi_fake_caida", true, "si Stripe no contesta, estorba: «no lo sé» no es vía libre"],
    ];
    for (const [pi, debeEstorbar, titulo] of decisiones) {
      const cita = await citaFallida(pi);
      const r = await estorbaParaPedirOtraTarjeta(ctx, cita);
      if (r.estorba !== debeEstorbar) {
        mal(`${titulo} — esperaba estorba=${debeEstorbar} y salió ${r.estorba} (${r.mensaje ?? "sin mensaje"})`);
        continue;
      }
      if (debeEstorbar && !r.mensaje) {
        mal(`${titulo} — estorba y no dice por qué, y ese mensaje es lo único que ve la profesional`);
        continue;
      }
      ok(`${titulo}${debeEstorbar ? `\n      «${r.mensaje}»` : ""}`);
    }

    // ── 3. Los dos mensajes son DISTINTOS ──────────────────────────────────
    paso("Los dos motivos para decir que no se distinguen");
    {
      const viva = await estorbaParaPedirOtraTarjeta(ctx, await citaFallida("pi_fake_viva"));
      const caida = await estorbaParaPedirOtraTarjeta(ctx, await citaFallida("pi_fake_caida"));
      esperar(
        viva.mensaje !== caida.mensaje,
        "«tiene el importe retenido» no se confunde con «no se ha podido comprobar»"
      );
      esperar(/inténtalo/i.test(caida.mensaje), "y solo el segundo invita a reintentar, que es el único que se arregla esperando", caida.mensaje);
    }
  } finally {
    paso("Limpieza");
    if (creados.bookings.length) await Booking.destroy({ where: { id: creados.bookings } });
    if (creados.sesiones.length) await PaymentSession.destroy({ where: { id: creados.sesiones } });
    if (creados.tipos.length) await EventType.destroy({ where: { id: creados.tipos } });
    const t = await Tenant.findOne({ where: { slug: SLUG } });
    if (t) await t.update({ settings: settingsOriginales });
    ok("citas de prueba borradas y claves de mentira retiradas del tenant");
  }
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await closeAllConnections().catch(() => {});
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await closeAllConnections().catch(() => {});
    process.exit(1);
  });
