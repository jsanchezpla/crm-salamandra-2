/**
 * comprobar-stripe.js — ¿está la cuenta de Stripe de este cliente lista para cobrar?
 *
 * SOLO LECTURA. No crea cobros, no mueve dinero, no toca nada.
 *
 * EL PROBLEMA QUE RESUELVE
 * `comprobar-citas.js` mira si las claves ESTÁN. Esto mira si además SIRVEN,
 * preguntándole a Stripe. Son cosas distintas: una clave bien pegada de una
 * cuenta sin verificar no cobra, y un webhook dado de alta con la URL mal o sin
 * el evento clave deja al paciente pagando sin que su cita aparezca en la lista
 * de espera de nadie.
 *
 * Comprueba cuatro cosas que fallan cada una a su manera:
 *   1. la clave funciona y la cuenta puede cobrar y recibir transferencias;
 *   2. hay un webhook apuntando a NOSOTROS, y está activo;
 *   3. ese webhook escucha los eventos que necesitamos —sobre todo
 *      `payment_intent.amount_capturable_updated`, que es el que avisa de que
 *      el dinero ha quedado retenido—;
 *   4. su versión de API es la misma que usa nuestro SDK: si divergen, los
 *      eventos llegan con otra forma y las pruebas NO lo detectan, porque
 *      construyen los eventos con la versión del SDK.
 *
 * USO
 *   node --env-file=.env.local scripts/comprobar-stripe.js <slug>
 *   docker exec crm-salamandra-app-1 node scripts/comprobar-stripe.js <slug>
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe, getTenantStripeConfig, STRIPE_API_VERSION } from "../lib/payments/stripeConfig.js";

const SLUG = process.argv[2];

/** Los que el CRM necesita de verdad, con por qué duele que falten. */
const EVENTOS = [
  ["payment_intent.amount_capturable_updated", "el dinero ha quedado retenido: SIN ESTE la cita no entra en la lista de espera"],
  ["payment_intent.succeeded", "el cobro se ha hecho efectivo"],
  ["payment_intent.canceled", "la retención se ha soltado"],
  ["payment_intent.payment_failed", "el banco ha rechazado"],
  ["charge.refunded", "se ha devuelto el dinero"],
  ["checkout.session.completed", "flujo antiguo de Checkout"],
  ["checkout.session.async_payment_succeeded", "flujo antiguo de Checkout"],
  ["checkout.session.async_payment_failed", "flujo antiguo de Checkout"],
  ["checkout.session.expired", "flujo antiguo de Checkout"],
];

const w = (s) => process.stdout.write(s);
let problemas = 0;
const bien = (q, d) => w(`  ✓ ${q.padEnd(28)} ${d}\n`);
const mal = (q, d) => { problemas++; w(`  ✗ ${q.padEnd(28)} ${d}\n`); };
const ojo = (q, d) => w(`  ! ${q.padEnd(28)} ${d}\n`);
const nota = (q, d) => w(`  · ${q.padEnd(28)} ${d}\n`);

async function main() {
  if (!SLUG) {
    w("\nUso: comprobar-stripe.js <slug>\n\n");
    process.exit(1);
  }

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    w(`\nNo existe el tenant "${SLUG}".\n\n`);
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG);
  const ctx = { slug: SLUG, tenant, tenantModels: models };
  const cfg = getTenantStripeConfig(ctx);

  w(`\n${"═".repeat(72)}\n  Stripe · ${tenant.name} (${SLUG})\n${"═".repeat(72)}\n`);

  if (!cfg.secretKey) {
    mal("Clave secreta", "no hay ninguna puesta: no se puede preguntar nada a Stripe");
    w("\n");
    process.exit(1);
  }

  const stripe = await getStripe(ctx);
  // La que usamos DE VERDAD: está clavada en stripeConfig, no es la del SDK.
  const versionSdk = STRIPE_API_VERSION;

  // ── 1. La cuenta ────────────────────────────────────────────────────────
  let cuenta;
  try {
    cuenta = await stripe.accounts.retrieve();
  } catch (err) {
    mal("Clave secreta", `Stripe la rechaza: ${err.message}`);
    w("\n");
    process.exit(1);
  }

  bien("Clave secreta", `funciona · cuenta ${cuenta.id}`);
  nota("Modo", cfg.liveMode ? "REAL: se cobra dinero de verdad" : "PRUEBAS: no se cobra nada real");

  if (cuenta.charges_enabled) bien("Puede cobrar", "la cuenta está verificada");
  else mal("Puede cobrar", "NO: Stripe aún no ha verificado la cuenta, los cobros fallarán");

  if (cuenta.payouts_enabled) bien("Puede recibir el dinero", "hay cuenta bancaria y está verificada");
  else mal("Puede recibir el dinero", "NO: falta el IBAN o la verificación. Cobraría, pero el dinero se quedaría retenido en Stripe");

  const pendiente = cuenta.requirements?.currently_due ?? [];
  if (pendiente.length) {
    ojo("Stripe pide papeles", `${pendiente.length} dato(s) pendiente(s): ${pendiente.slice(0, 4).join(", ")}`);
  }

  nota("País y moneda", `${(cuenta.country ?? "?")} · ${(cuenta.default_currency ?? "?").toUpperCase()}`);
  if (cuenta.default_currency && cuenta.default_currency.toLowerCase() !== "eur") {
    ojo("Moneda", "la cuenta NO está en euros y los precios del CRM sí: revisar antes de cobrar");
  }

  // ── 2 y 3. El webhook ───────────────────────────────────────────────────
  let endpoints = [];
  try {
    endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data ?? [];
  } catch (err) {
    ojo("Webhooks", `no se han podido listar (${err.message}). Si la clave es restringida, dale permiso de lectura de webhooks`);
  }

  const nuestro = endpoints.filter((e) => (e.url ?? "").includes(`/api/webhooks/stripe/${SLUG}`));

  if (!nuestro.length) {
    mal(
      "Webhook",
      `ninguno apunta a /api/webhooks/stripe/${SLUG}. El paciente pagaría y su cita no se confirmaría nunca`
    );
    if (endpoints.length) {
      nota("Los que sí hay", endpoints.map((e) => e.url).join(", ").slice(0, 120));
    }
  }

  for (const ep of nuestro) {
    w(`\n  ── ${ep.url}\n`);
    if (ep.status === "enabled") bien("Estado", "activo");
    else mal("Estado", `'${ep.status}': no le llegará nada`);

    const suyos = new Set(ep.enabled_events ?? []);
    const todos = suyos.has("*");
    const faltan = EVENTOS.filter(([e]) => !todos && !suyos.has(e));
    if (!faltan.length) {
      bien("Eventos", todos ? "escucha TODOS (*)" : `los ${EVENTOS.length} que hacen falta`);
    } else {
      for (const [e, porque] of faltan) mal(`Falta ${e.split(".").pop()}`, `${e} — ${porque}`);
    }

    if (ep.api_version === versionSdk) {
      bien("Versión de API", `${ep.api_version} · coincide con el SDK`);
    } else {
      mal(
        "Versión de API",
        `el webhook manda ${ep.api_version ?? "(la de la cuenta)"} y nosotros usamos ${versionSdk}: los eventos llegarían con otra forma. ` +
        `Se arregla igualando STRIPE_API_VERSION en lib/payments/stripeConfig.js, o rehaciendo el webhook con esa versión`
      );
    }
  }

  // ── 4. La clave publicable, que es la que ve el paciente ────────────────
  if (!cfg.publishableKey) {
    mal("Clave publicable", "sin ella el formulario de tarjeta no se pinta");
  } else {
    const pubEsReal = cfg.publishableKey.startsWith("pk_live_");
    if (pubEsReal !== cfg.liveMode) {
      mal("Claves mezcladas", `la secreta es ${cfg.liveMode ? "REAL" : "de PRUEBA"} y la publicable ${pubEsReal ? "REAL" : "de PRUEBA"}`);
    } else {
      // Las dos claves tienen que ser ADEMÁS de la misma cuenta: mezclar dos
      // cuentas da un formulario que no carga y ningún mensaje util.
      const suCuenta = cfg.publishableKey.match(/^pk_(?:test|live)_5(1[A-Za-z0-9]{15})/)?.[1];
      if (suCuenta && cuenta.id !== `acct_${suCuenta}`) {
        mal("Claves de cuentas distintas", `la secreta es de ${cuenta.id} y la publicable de acct_${suCuenta}`);
      } else {
        bien("Clave publicable", "del mismo entorno y la misma cuenta que la secreta");
      }
    }
  }

  // ── Lo que ya ha pasado por aquí ────────────────────────────────────────
  try {
    const recibidos = await models.StripeWebhookEvent?.count?.();
    if (typeof recibidos === "number") {
      if (recibidos > 0) bien("Eventos recibidos", `${recibidos}: el webhook ha llegado alguna vez`);
      else ojo("Eventos recibidos", "ninguno todavía: el webhook está SIN PROBAR de extremo a extremo");
    }
  } catch { /* la tabla puede no existir */ }

  w("  " + "─".repeat(70) + "\n");
  w(problemas ? `  ✗ ${problemas} problema(s) que impiden cobrar bien.\n\n` : `  ✓ Stripe está listo.\n\n`);
  process.exit(problemas ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
