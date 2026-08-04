/**
 * _smoke-packs-reserva.mjs — una reserva se engancha al bono y se numera.
 *
 * Lo de `_smoke-packs-sesiones.mjs` son funciones puras; esto comprueba lo que
 * pasa contra la base de datos, que es donde el enganche puede fallar: buscar
 * el bono de alguien por su correo, saber si le quedan sesiones y qué número
 * toca.
 *
 * Lo que se fija aquí:
 *   · sin bono comprado NO se engancha nada (y por tanto la cita se cobra);
 *   · con bono, la primera reserva es la 1 y la siguiente la 2;
 *   · el correo se cruza sin distinguir mayúsculas — nadie lo escribe dos
 *     veces igual;
 *   · un bono AGOTADO deja de enganchar, así que la siguiente cita vuelve a
 *     cobrarse en vez de regalar sesiones;
 *   · con dos bonos comprados, se gasta primero el MÁS ANTIGUO;
 *   · y un bono anulado no engancha aunque le queden sesiones.
 *
 * No toca datos reales: crea su tipo de cita y sus bonos, y los borra.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-packs-reserva.mjs [slug]
 */

import { getTenantDb } from "../lib/db/tenantDb.js";
import { asignarSesion } from "../lib/citas/packs.js";

const SLUG = process.argv[2] || "demo";
const EMAIL = "smoke-bono@example.com";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const { models } = getTenantDb(SLUG);
const { EventType, SessionPack, Booking } = models;

let tipo;
let creados = [];

async function main() {
  process.stdout.write(`\n═══ Smoke: la reserva se engancha al bono (${SLUG}) ═══\n`);
  if (!SessionPack) throw new Error("falta el modelo SessionPack — ¿migración sin correr?");

  tipo = await EventType.create({
    name: "Smoke bono 3 sesiones",
    slug: `smoke-bono-${Date.now()}`,
    duration: 60,
    modalities: ["online"],
    price: 36000,
    instalmentPrice: 13000,
    instalmentMonths: 3,
    sessionsCount: 3,
    active: false, // que no aparezca en la agenda pública mientras dura la prueba
  });

  const reservar = async (numero) => {
    const b = await Booking.create({
      eventTypeId: tipo.id,
      clientName: "Paciente Bono",
      clientEmail: EMAIL,
      clientPhone: "600000000",
      scheduledAt: new Date(Date.now() + numero * 86_400_000),
      duration: 60,
      modality: "online",
      status: "confirmed",
      packId: numero.packId ?? null,
      sessionNumber: null,
    });
    creados.push(b);
    return b;
  };

  // ── Sin bono ────────────────────────────────────────────────────────────
  paso("Sin bono comprado");
  const sinBono = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(sinBono === null, "no se engancha nada, así que la cita se cobra como siempre");

  // ── Con bono ────────────────────────────────────────────────────────────
  paso("Con el bono comprado");
  const pack = await SessionPack.create({
    clientEmail: EMAIL,
    eventTypeId: tipo.id,
    totalSessions: 3,
    pricingMode: "upfront",
    amount: 36000,
  });

  const s1 = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(s1?.packId === pack.id, "la reserva se engancha a su bono");
  esperar(s1?.sessionNumber === 1, `y es la sesión 1: ${s1?.sessionNumber}`);
  esperar(s1?.restantesAntes === 3, "con 3 libres antes de reservar");

  const b1 = await reservar(1);
  await b1.update({ packId: s1.packId, sessionNumber: s1.sessionNumber });

  const s2 = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(s2?.sessionNumber === 2, `la siguiente es la 2: ${s2?.sessionNumber}`);
  esperar(s2?.restantesAntes === 2, "y quedan 2 libres");

  const mayus = await asignarSesion(models, { email: EMAIL.toUpperCase(), eventTypeId: tipo.id });
  esperar(mayus?.packId === pack.id, "el correo se cruza sin distinguir mayúsculas");

  // ── Agotado ─────────────────────────────────────────────────────────────
  paso("Cuando se acaba");
  const b2 = await reservar(2);
  await b2.update({ packId: pack.id, sessionNumber: 2 });
  const b3 = await reservar(3);
  await b3.update({ packId: pack.id, sessionNumber: 3 });

  const agotado = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(agotado === null, "con las 3 usadas ya no engancha: la siguiente cita se cobra");

  // ── Dos bonos ───────────────────────────────────────────────────────────
  paso("Con un segundo bono");
  const pack2 = await SessionPack.create({
    clientEmail: EMAIL,
    eventTypeId: tipo.id,
    totalSessions: 5,
    pricingMode: "instalment",
    amount: 39000,
    instalmentAmount: 13000,
    instalmentMonths: 3,
  });
  const s4 = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(s4?.packId === pack2.id, "las citas nuevas entran en el bono nuevo");
  esperar(s4?.sessionNumber === 1, `y vuelve a numerar desde 1: ${s4?.sessionNumber}`);

  paso("Un bono anulado no cuenta");
  await pack2.update({ status: "anulado" });
  const anulado = await asignarSesion(models, { email: EMAIL, eventTypeId: tipo.id });
  esperar(anulado === null, "aunque le quedaran sesiones, no engancha");
}

main()
  .catch((err) => { mal(err.message); })
  .finally(async () => {
    for (const b of creados) await b.destroy().catch(() => {});
    if (tipo) {
      await SessionPack.destroy({ where: { eventTypeId: tipo.id } }).catch(() => {});
      await tipo.destroy().catch(() => {});
    }
    process.stdout.write("\n  · datos de prueba borrados\n");
    process.stdout.write(fallos === 0 ? "\n═══ ✓ Todo en orden ═══\n\n" : `\n═══ ✗ ${fallos} fallo(s) ═══\n\n`);
    process.exit(fallos === 0 ? 0 : 1);
  });
