/**
 * _smoke-packs-sesiones.mjs — cuántas sesiones ha gastado alguien de su bono.
 *
 * Es la cuenta que decide si a una paciente le quedan sesiones o tiene que
 * volver a pagar, así que conviene que esté bien: la regla sale del contrato
 * que firma (cancelar con menos de 24 h computa como sesión realizada) y usa la
 * MISMA frontera que decide si se le devuelve el dinero.
 *
 * Lo que se fija aquí:
 *   · qué estados gastan sesión y cuáles no, incluida la frontera exacta de
 *     las 24 h por arriba y por abajo;
 *   · que una falta JUSTIFICADA no gasta, y una sin clasificar sí;
 *   · que las citas futuras no gastan pero sí RESERVAN, para que a nadie se le
 *     enseñen sesiones libres que ya tiene puestas en la agenda;
 *   · que los números de sesión no se reciclan al cancelar;
 *   · y que el precio fraccionado es independiente del de pago único, que es
 *     justo lo que se pidió (360 € de golpe frente a 3 × 130 = 390 €).
 *
 * Funciones puras: no toca la base de datos ni necesita servidor.
 *
 * Uso: node scripts/_smoke-packs-sesiones.mjs
 */

import {
  esPack,
  preciosDe,
  admiteFraccionado,
  gastaSesion,
  reservaSesion,
  estadoPack,
  siguienteNumeroSesion,
  etiquetaSesion,
  precioDeCompra,
} from "../lib/citas/packs.js";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const AHORA = new Date("2026-08-04T10:00:00Z");
const cita = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

process.stdout.write("\n═══ Smoke: bonos de sesiones y precios ═══\n");

// ── Qué es un pack ───────────────────────────────────────────────────────────
paso("Qué es un bono");
esperar(esPack({ sessionsCount: 10 }) === true, "10 sesiones es un bono");
esperar(esPack({ sessionsCount: 1 }) === false, "1 sesión es una cita suelta de siempre");
esperar(esPack({}) === false, "sin el campo, cita suelta (no rompe lo que ya existe)");

// ── Precios ──────────────────────────────────────────────────────────────────
paso("Los dos precios son independientes");
const p = preciosDe({ price: 36000, instalmentPrice: 13000, instalmentMonths: 3 });
esperar(p.upfront === 36000, "pago único: 360 €");
esperar(p.instalment.cuota === 13000 && p.instalment.meses === 3, "fraccionado: 3 meses de 130 €");
esperar(p.instalment.total === 39000, "y el total del fraccionado son 390 €, NO 360: financiar cuesta más");

esperar(
  preciosDe({ price: 36000, instalmentPrice: 13000 }).instalment === null,
  "una cuota sin meses no se puede ofrecer"
);
esperar(
  preciosDe({ price: 36000, instalmentMonths: 3 }).instalment === null,
  "ni unos meses sin cuota"
);
esperar(admiteFraccionado({ price: 36000 }) === false, "sin fraccionado configurado, solo pago único");

// ── Qué se cobra al comprar ──────────────────────────────────────────────────
paso("Qué se cobra según cómo quiera pagar");
const TIPO = { price: 36000, instalmentPrice: 13000, instalmentMonths: 3, sessionsCount: 10 };

const unico = precioDeCompra(TIPO, "upfront");
esperar(unico.amount === 36000, "de una vez se le cobran 360 €");
esperar(unico.metodos === null, "y se le ofrecen todos los métodos que tenga activados");

// ⚠️ CAMBIÓ EL 05/08/2026. Antes el fraccionado se delegaba en Klarna, que
// adelantaba los 390 € de golpe, así que `amount` era el TOTAL. Ahora lo cobra
// Stripe mes a mes, así que `amount` es lo que se cobra HOY: la primera cuota.
// Confundirlos es cobrar 390 € de una vez a quien pidió pagar a plazos.
const plazos = precioDeCompra(TIPO, "instalment");
esperar(plazos.amount === 13000, "a plazos se cobra HOY una cuota de 130 €, no el total");
esperar(plazos.total === 39000, "y el compromiso total sigue siendo 390 €, NO 360: financiar cuesta más");
esperar(plazos.instalmentAmount === 13000 && plazos.instalmentMonths === 3, "en 3 cuotas de 130 €");
esperar(
  Array.isArray(plazos.metodos) && plazos.metodos.length === 1 && plazos.metodos[0] === "card",
  "y SOLO con tarjeta: es lo único domiciliable (ni Bizum ni transferencia admiten cargos recurrentes)"
);
esperar(
  plazos.recurrente?.iterations === 3 && plazos.recurrente?.intervalo === "month",
  "y se pide a Stripe una suscripción de 3 cargos mensuales, no un cobro suelto"
);
esperar(unico.recurrente === null, "el pago único NO crea ninguna suscripción");

esperar(
  precioDeCompra({ price: 36000, sessionsCount: 10 }, "instalment") === null,
  "pedir plazos sin tenerlos configurados no cobra nada: se rechaza"
);
esperar(precioDeCompra({ sessionsCount: 10 }, "upfront") === null, "y un bono sin precio tampoco");

// ── Qué gasta sesión ─────────────────────────────────────────────────────────
paso("Qué gasta sesión (regla del contrato)");
esperar(gastaSesion({ status: "completed", scheduledAt: cita(-48) }, AHORA), "una cita realizada gasta");
esperar(!gastaSesion({ status: "confirmed", scheduledAt: cita(48) }, AHORA), "una futura confirmada no gasta todavía");
esperar(!gastaSesion({ status: "pending", scheduledAt: cita(48) }, AHORA), "ni una pendiente de confirmar");

esperar(
  gastaSesion({ status: "no_show", noShowJustified: false, scheduledAt: cita(-2) }, AHORA),
  "no presentarse sin justificar gasta"
);
esperar(
  !gastaSesion({ status: "no_show", noShowJustified: true, scheduledAt: cita(-2) }, AHORA),
  "justificada, no gasta"
);
esperar(
  gastaSesion({ status: "no_show", noShowJustified: null, scheduledAt: cita(-2) }, AHORA),
  "sin clasificar gasta: es lo que dice el contrato"
);

paso("La frontera de las 24 h, por los dos lados");
esperar(
  !gastaSesion(
    { status: "cancelled", scheduledAt: cita(48), cancelledAt: new Date(AHORA).toISOString() },
    AHORA
  ),
  "cancelar con 48 h de antelación no gasta"
);
esperar(
  !gastaSesion(
    { status: "cancelled", scheduledAt: cita(24), cancelledAt: new Date(AHORA).toISOString() },
    AHORA
  ),
  "justo 24 h tampoco: el contrato dice «al menos 24 horas»"
);
esperar(
  gastaSesion(
    { status: "cancelled", scheduledAt: cita(23), cancelledAt: new Date(AHORA).toISOString() },
    AHORA
  ),
  "23 h sí gasta"
);
esperar(
  !gastaSesion({ status: "cancelled", scheduledAt: "no-es-una-fecha" }, AHORA),
  "sin fecha fiable NO se le quita la sesión: el dato nos falta a nosotros"
);

// ── Estado del bono ──────────────────────────────────────────────────────────
paso("Cuántas le quedan");
const pack = { totalSessions: 10 };
const citas = [
  { status: "completed", scheduledAt: cita(-72), sessionNumber: 1 },
  { status: "completed", scheduledAt: cita(-48), sessionNumber: 2 },
  { status: "cancelled", scheduledAt: cita(-24), cancelledAt: cita(-96), sessionNumber: 3 }, // con antelación
  { status: "no_show", noShowJustified: false, scheduledAt: cita(-12), sessionNumber: 4 },
  { status: "confirmed", scheduledAt: cita(48), sessionNumber: 5 },
];
const estado = estadoPack(pack, citas, AHORA);
esperar(estado.gastadas === 3, `gastadas 3 (dos realizadas + una falta): ${estado.gastadas}`);
esperar(estado.reservadas === 1, `reservada 1 (la futura): ${estado.reservadas}`);
esperar(estado.restantes === 6, `le quedan 6 libres, no 7: ${estado.restantes}`);
esperar(!estado.agotado, "y el bono sigue activo");

const agotado = estadoPack({ totalSessions: 2 }, [
  { status: "completed", scheduledAt: cita(-48) },
  { status: "completed", scheduledAt: cita(-24) },
], AHORA);
esperar(agotado.agotado && agotado.restantes === 0, "con todas usadas, el bono queda agotado");

esperar(
  estadoPack({ totalSessions: 1 }, [{ status: "confirmed", scheduledAt: cita(48) }], AHORA).restantes === 0,
  "una cita futura ya deja el bono sin sesiones libres"
);

// ── Numeración ───────────────────────────────────────────────────────────────
paso("Los números de sesión no se reciclan");
esperar(siguienteNumeroSesion([]) === 1, "la primera es la 1");
esperar(siguienteNumeroSesion(citas) === 6, "tras cinco, la siguiente es la 6");
esperar(
  siguienteNumeroSesion([
    { status: "completed", sessionNumber: 1 },
    { status: "cancelled", sessionNumber: 2 },
  ]) === 3,
  "cancelar la 2 NO libera el número: la siguiente es la 3"
);

esperar(
  etiquetaSesion({ sessionNumber: 3, pack: { totalSessions: 10 } })?.etiqueta === "3/10",
  "en el calendario se ve «3/10»"
);
esperar(etiquetaSesion({ sessionNumber: null }) === null, "una cita suelta no lleva etiqueta");
esperar(reservaSesion({ status: "confirmed" }) === true, "confirmada reserva sesión");

process.stdout.write(fallos === 0 ? "\n═══ ✓ Todo en orden ═══\n\n" : `\n═══ ✗ ${fallos} fallo(s) ═══\n\n`);
process.exit(fallos === 0 ? 0 : 1);
