// @vivo — Nació para las dos suscripciones del 07/08/2026 y la cabecera dice que «el código ya está arreglado… esto es solo para las que quedaron mal», pero… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * arreglar-suscripciones-sin-tope.js — repara suscripciones de pago fraccionado
 * a las que nunca se les llegó a poner el tope de cuotas.
 *
 * ⚠️ ENSAYA POR DEFECTO. Sin `--aplicar` no escribe nada en Stripe.
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * Poner el tope son DOS llamadas a Stripe: crear el calendario y configurarlo.
 * `subscriptionSchedules.create({ from_subscription })` nace en `release` —«al
 * acabar, suéltala y que siga cobrando»— y es el `update` de después el que lo
 * pone en `cancel` con la fase de las cuotas que faltan.
 *
 * Si la segunda llamada no llega, queda un calendario que NO frena nada. Y
 * hasta el 10/08/2026 `ponerTopeDeCuotas` salía antes de tiempo al ver que «ya
 * hay calendario», así que ningún reintento lo arreglaba: un fallo de un
 * momento se volvía permanente. Le pasó a las dos suscripciones que
 * tunutrilaura vendió el 07/08/2026.
 *
 * El código ya está arreglado, así que las suscripciones NUEVAS nacen bien.
 * Esto es solo para las que quedaron mal.
 *
 * ── POR QUÉ NO ADIVINA A CUÁL TOCAR ─────────────────────────────────────────
 * Sin argumentos solo MIRA: lista las suscripciones y dice cuáles no tienen
 * tope. Actuar exige nombrar la suscripción por su id, una por una. Aquí se
 * mueve el dinero de un paciente: que un `WHERE` de más pille una suscripción
 * que no tocaba no puede pasar, y la única forma de garantizarlo es que no haya
 * ningún `WHERE`.
 *
 * ── QUÉ HACE CADA ACCIÓN ────────────────────────────────────────────────────
 *   --tope sub_XXX      le pone el tope que le faltaba, usando la MISMA función
 *                       del CRM (`ponerTopeDeCuotas`). Las cuotas salen de la
 *                       PaymentSession, no de un número escrito a mano: es lo
 *                       que la paciente aceptó al pagar. Sigue cobrando lo
 *                       pactado y se cancela sola al llegar al final.
 *   --cancelar sub_XXX  la corta ya. Para las de prueba: no hay nadie
 *                       esperando nada a cambio. NO devuelve lo ya cobrado.
 *
 * Las dos se pueden repetir. Nada de esto borra filas del CRM.
 *
 * USO
 *   node --env-file=.env.local scripts/arreglar-suscripciones-sin-tope.js <slug>
 *   … <slug> --tope sub_A --cancelar sub_B
 *   … <slug> --tope sub_A --cancelar sub_B --aplicar
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/arreglar-suscripciones-sin-tope.js nutri_laura
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getStripe } from "../lib/payments/stripeConfig.js";
import { ponerTopeDeCuotas, topePuesto } from "../lib/payments/fraccionado.js";

const argv = process.argv.slice(2);
const SLUG = argv[0];
const APLICAR = argv.includes("--aplicar");

/** Todos los valores de una bandera repetible (`--tope a --tope b`). */
const valoresDe = (bandera) =>
  argv.reduce((acc, v, i) => (argv[i - 1] === bandera ? [...acc, v] : acc), []);

const A_TOPAR = valoresDe("--tope");
const A_CANCELAR = valoresDe("--cancelar");

const w = (s) => process.stdout.write(s);
const eur = (c) => (c == null ? "—" : (c / 100).toFixed(2) + " €");
const dia = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "—");

if (!SLUG || !/^[a-z0-9_]+$/.test(SLUG)) {
  w("\nUso: arreglar-suscripciones-sin-tope.js <slug> [--tope sub_X] [--cancelar sub_Y] [--aplicar]\n\n");
  process.exit(1);
}

const solapadas = A_TOPAR.filter((s) => A_CANCELAR.includes(s));
if (solapadas.length) {
  w(`\n✗ ${solapadas.join(", ")} está a la vez en --tope y en --cancelar. Decide una.\n\n`);
  process.exit(1);
}

getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug: SLUG } });
if (!tenant) {
  w(`\n✗ No existe el cliente "${SLUG}" en master.tenants.\n\n`);
  process.exit(1);
}

const ctx = { tenant, slug: SLUG };
const stripe = await getStripe(ctx);

w("\n══════════════════════════════════════════════════════════════\n");
w(` Suscripciones a plazos · ${tenant.name} (${SLUG})\n`);
w(`${APLICAR ? " ⚠️  MODO REAL: va a escribir en Stripe" : " · ENSAYO: no se escribe nada"}\n`);
w("══════════════════════════════════════════════════════════════\n\n");

/*
 * Las cuotas pactadas se leen de NUESTRA PaymentSession, que es donde quedó
 * registrado lo que la paciente aceptó al pagar. La metadata de Stripe lleva el
 * mismo número, pero la nuestra es la que se puede defender si alguien pregunta.
 */
let PaymentSession = null;
try {
  const tdb = await getTenantDb(SLUG);
  PaymentSession = tdb?.models?.PaymentSession ?? null;
} catch {
  /* sin tabla de pagos se sigue con lo que diga Stripe */
}

async function cuotasPactadas(sub) {
  const psId = sub.metadata?.paymentSessionId ?? null;
  if (psId && PaymentSession) {
    const ps = await PaymentSession.findByPk(psId).catch(() => null);
    const n = Number(ps?.metadata?.instalmentMonths);
    if (Number.isInteger(n) && n > 0) return { cuotas: n, fuente: "PaymentSession del CRM" };
  }
  const n = Number(sub.metadata?.cuotas);
  if (Number.isInteger(n) && n > 0) return { cuotas: n, fuente: "metadata de Stripe" };
  return { cuotas: null, fuente: null };
}

async function retrato(sub) {
  const { cuotas, fuente } = await cuotasPactadas(sub);
  let calendario = null;
  if (sub.schedule) {
    const id = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    calendario = await stripe.subscriptionSchedules.retrieve(id).catch(() => null);
  }
  const cobradas = await stripe.invoices
    .list({ subscription: sub.id, status: "paid", limit: 100 })
    .then((r) => r.data.length)
    .catch(() => null);
  const puesto = cuotas ? topePuesto(calendario, cuotas - 1) : false;
  return { cuotas, fuente, calendario, cobradas, puesto };
}

const subs = await stripe.subscriptions.list({ limit: 100, status: "all" });
const vivas = subs.data.filter((s) => s.status !== "canceled");

w(`▶ ESTADO ACTUAL (${subs.data.length} en total, ${vivas.length} viva(s))\n\n`);
const retratos = new Map();
for (const s of subs.data) {
  const r = await retrato(s);
  retratos.set(s.id, r);
  const cuota = s.items?.data?.[0]?.price?.unit_amount ?? null;
  w(`  ${s.id}\n`);
  w(`     ${eur(cuota)}/mes · ${s.status} · creada ${dia(s.created)}\n`);
  w(`     pactadas ${r.cuotas ?? "?"} (${r.fuente ?? "no consta"}) · cobradas ${r.cobradas ?? "?"}\n`);
  if (s.status === "canceled") {
    w(`     TOPE  — ya cancelada, nada que hacer\n\n`);
    continue;
  }
  w(
    r.puesto
      ? `     TOPE  ✓ puesto (${r.calendario?.end_behavior}, se cancela sola)\n\n`
      : `     TOPE  ✗ SIN TOPE (${r.calendario ? `calendario en «${r.calendario.end_behavior}»` : "sin calendario"}) — seguiría cobrando\n\n`
  );
}

const sinTope = vivas.filter((s) => !retratos.get(s.id)?.puesto).map((s) => s.id);
const nombradas = [...A_TOPAR, ...A_CANCELAR];
if (!nombradas.length) {
  w("──────────────────────────────────────────────────────────────\n");
  w(
    sinTope.length
      ? `  ${sinTope.length} sin tope:\n${sinTope.map((s) => `    ${s}\n`).join("")}\n  Repite nombrándolas: --tope <id> o --cancelar <id>\n\n`
      : "  ✓ Todas las vivas tienen tope. Nada que hacer.\n\n"
  );
  process.exit(0);
}

// Nombrar una que no existe casi siempre es un id mal copiado. Se para: es
// preferible no hacer nada a hacer la mitad.
const desconocidas = nombradas.filter((id) => !subs.data.some((s) => s.id === id));
if (desconocidas.length) {
  w(`✗ Estas no existen en la cuenta de ${SLUG}: ${desconocidas.join(", ")}\n`);
  w("  No se toca nada. Revisa los ids.\n\n");
  process.exit(1);
}

w("▶ LO QUE SE VA A HACER\n\n");
for (const id of A_TOPAR) {
  const r = retratos.get(id);
  w(`  ${id}\n     poner el tope de ${r.cuotas ?? "?"} cuota(s) — sigue cobrando lo pactado y se cancela al final\n`);
  if (!r.cuotas) w("     ⚠️  no se sabe cuántas cuotas se pactaron: se SALTARÁ\n");
  if (r.puesto) w("     · ya lo tiene puesto: no se tocará\n");
}
for (const id of A_CANCELAR) {
  const r = retratos.get(id);
  w(`  ${id}\n     CANCELAR ya (${r.cobradas ?? "?"} cuota(s) cobrada(s), NO se devuelven)\n`);
}
w("\n");

if (!APLICAR) {
  w("· Ensayo: no se ha escrito nada. Si cuadra, repite con --aplicar.\n\n");
  process.exit(0);
}

let hechos = 0;
const fallos = [];

for (const id of A_TOPAR) {
  const r = retratos.get(id);
  if (!r.cuotas) {
    fallos.push(`${id}: sin saber las cuotas pactadas, no se toca`);
    continue;
  }
  try {
    const calId = await ponerTopeDeCuotas(ctx, { subscriptionId: id, cuotas: r.cuotas });
    w(`  ✓ ${id} → tope de ${r.cuotas} cuotas (calendario ${calId})\n`);
    hechos++;
  } catch (e) {
    fallos.push(`${id}: ${e.message}`);
  }
}

for (const id of A_CANCELAR) {
  try {
    const sub = await stripe.subscriptions.retrieve(id);
    // Con calendario hay que cancelar el calendario: cancelar la suscripción
    // por debajo lo deja vivo y Stripe la vuelve a montar.
    if (sub.schedule) {
      await stripe.subscriptionSchedules.cancel(
        typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id
      );
    } else {
      await stripe.subscriptions.cancel(id);
    }
    w(`  ✓ ${id} → cancelada\n`);
    hechos++;
  } catch (e) {
    fallos.push(`${id}: ${e.message}`);
  }
}

// Se vuelve a preguntar a Stripe: no se da por bueno lo que se acaba de mandar.
w("\n▶ CÓMO HA QUEDADO (releído de Stripe)\n\n");
for (const id of nombradas) {
  const sub = await stripe.subscriptions.retrieve(id).catch(() => null);
  if (!sub) {
    w(`  ${id} · no se ha podido releer\n`);
    continue;
  }
  const r = await retrato(sub);
  w(`  ${id} · ${sub.status}\n`);
  if (sub.status === "canceled") {
    w("     ✓ cancelada: no cobrará más\n\n");
    continue;
  }
  w(
    r.puesto
      ? `     ✓ tope puesto (${r.calendario?.end_behavior}, ${r.cuotas} cuotas)\n\n`
      : `     ✗ SIGUE SIN TOPE — revisar a mano en Stripe\n\n`
  );
}

if (fallos.length) {
  w("✗ No se pudo con:\n");
  for (const f of fallos) w(`   ${f}\n`);
  w("\n");
}
w(`${hechos} suscripción(es) tocada(s). Nada del CRM se ha modificado.\n\n`);
process.exit(fallos.length ? 1 : 0);
