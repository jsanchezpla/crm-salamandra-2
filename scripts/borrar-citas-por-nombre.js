/**
 * borrar-citas-por-nombre.js — quita de la agenda las citas de personas
 * concretas (las pruebas que hizo el equipo antes de arrancar).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no borra nada.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * Antes de abrir la agenda de nutri_laura, el equipo (Jorge, Carlos, Rodrigo)
 * reservó citas a su nombre para probar el widget, el cobro y los avisos. En
 * producción quedan mezcladas con las de las pacientes de verdad y en la vista
 * de mes parecen jornada llena. Rodrigo pidió borrarlas el 10/08/2026, dejando
 * vivas solo las de Inés y Maider.
 *
 * ── Qué NO toca ────────────────────────────────────────────────────────────
 *
 * Los bloqueos de agenda NO son citas: viven en `team_blocks` (ausencias de una
 * persona) y `blocked_days` (festivos del centro), tablas aparte que este script
 * ni abre. Se quedan como están, que es justo lo que se pidió.
 *
 * Sí se lleva por delante lo que cuelga de cada cita borrada, o quedarían filas
 * apuntando al vacío: su sesión de cobro (`payment_sessions`), las peticiones de
 * cambio de hora (`booking_change_requests`, cuyo `booking_id` es NOT NULL) y
 * los avisos al cliente que nacieron de esa cita (`client_notices`).
 *
 * ── La red de seguridad ────────────────────────────────────────────────────
 *
 * El peligro no es borrar de más por error de SQL, es borrar a una paciente que
 * se llame igual: «Rodrigo» a secas caza cualquier nombre que empiece por
 * Rodrigo. Por eso el script SIEMPRE imprime, agrupada por nombre exacto, cada
 * cita que va a tocar antes de tocarla, y en modo real exige haber mirado esa
 * lista. Empezar por `--inventario` (lee y no escribe) enseña TODOS los nombres
 * con citas en la agenda, que es la única forma de saber qué queda vivo.
 *
 * Uso:
 *   node --env-file=.env.production scripts/borrar-citas-por-nombre.js --inventario
 *   node --env-file=.env.production scripts/borrar-citas-por-nombre.js
 *   node --env-file=.env.production scripts/borrar-citas-por-nombre.js --confirm
 *   … --tenant demo          → otro tenant (por defecto, nutri_laura)
 *   … --nombre "Ana Pérez"   → repetible; sustituye a la lista de abajo
 */

import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const INVENTARIO = args.includes("--inventario");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "nutri_laura";

/** Quien pidió el borrado. `Rodrigo` a secas cubre también sus apellidos. */
const POR_DEFECTO = ["Jorge Sánchez Pla", "Carlos Torrents", "Rodrigo"];

const nombresPedidos = args.reduce((acc, a, i) => {
  if (a === "--nombre" && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);
const A_BORRAR = nombresPedidos.length ? nombresPedidos : POR_DEFECTO;

/** Sin acentos, sin mayúsculas y sin espacios de más: «Sánchez» = «sanchez». */
function normalizar(s) {
  return (s ?? "")
    .normalize("NFD") // separa la tilde de la letra para poder quitarla
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coincide el nombre completo, o el patrón es el principio de ese nombre
 * («Rodrigo» caza «Rodrigo Herreros de Tejada», pero no «Rodrigo Martínez» sin
 * que se vea antes en la lista). Nunca coincidencia por el medio: «Torrents» no
 * debe llevarse a una «Ana Torrents» que no se ha nombrado.
 */
function coincide(nombreCita, patrones) {
  const n = normalizar(nombreCita);
  return patrones.some((p) => {
    const q = normalizar(p);
    return n === q || n.startsWith(`${q} `);
  });
}

const fecha = (d) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

/** Agrupa por el nombre tal cual está escrito en la ficha, para poder leerlo. */
function porNombre(citas) {
  const mapa = new Map();
  for (const c of citas) {
    const k = c.clientName || "(sin nombre)";
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(c);
  }
  return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);
}

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` CITAS POR NOMBRE → tenant "${SLUG}"`);
  if (INVENTARIO) console.log(" · INVENTARIO: solo lectura");
  else console.log(CONFIRM ? " ⚠️  MODO REAL: va a borrar" : " · SIMULACIÓN: no se borra nada");
  console.log(`${"═".repeat(64)}\n`);

  const { models } = getTenantDb(SLUG);
  const { Booking, PaymentSession, BookingChangeRequest, ClientNotice } = models;

  const todas = await Booking.findAll({
    attributes: ["id", "clientName", "clientEmail", "scheduledAt", "status"],
    order: [["scheduledAt", "ASC"]],
  });

  if (!todas.length) {
    console.log("✓ La agenda no tiene ninguna cita. Nada que hacer.\n");
    process.exit(0);
  }

  if (INVENTARIO) {
    console.log(`${todas.length} cita(s) en la agenda, por persona:\n`);
    for (const [nombre, citas] of porNombre(todas)) {
      console.log(`  ${String(citas.length).padStart(3)} · ${nombre}   <${citas[0].clientEmail ?? "sin correo"}>`);
    }
    console.log("\n· Los bloqueos van en otras tablas y no salen en esta lista.\n");
    process.exit(0);
  }

  const objetivo = todas.filter((c) => coincide(c.clientName, A_BORRAR));
  const supervivientes = todas.filter((c) => !coincide(c.clientName, A_BORRAR));

  console.log(`Buscando: ${A_BORRAR.join(" · ")}\n`);

  if (!objetivo.length) {
    console.log("✓ Ninguna cita coincide con esos nombres. No se toca nada.\n");
    process.exit(0);
  }

  console.log(`▶ SE BORRAN ${objetivo.length} cita(s):\n`);
  for (const [nombre, citas] of porNombre(objetivo)) {
    console.log(`  ${nombre}  (${citas.length})`);
    for (const c of citas) {
      console.log(`      · ${fecha(c.scheduledAt)}  ${c.status.padEnd(9)} <${c.clientEmail ?? "sin correo"}>`);
    }
  }

  console.log(`\n▶ SE QUEDAN ${supervivientes.length} cita(s):\n`);
  for (const [nombre, citas] of porNombre(supervivientes)) {
    console.log(`  ${String(citas.length).padStart(3)} · ${nombre}`);
  }

  if (!CONFIRM) {
    console.log("\n· Simulación: no se ha borrado nada.");
    console.log("  Repasa las dos listas y, si cuadran, repite con --confirm.\n");
    process.exit(0);
  }

  const ids = objetivo.map((c) => c.id);
  const cobros = await PaymentSession.destroy({ where: { entityType: "booking", entityId: { [Op.in]: ids } } });
  const cambios = await BookingChangeRequest.destroy({ where: { bookingId: { [Op.in]: ids } } });
  const avisos = await ClientNotice.destroy({ where: { bookingId: { [Op.in]: ids } } });
  const borradas = await Booking.destroy({ where: { id: { [Op.in]: ids } } });

  console.log(`\n✓ ${borradas} cita(s) borradas`);
  console.log(`  · ${cobros} sesión(es) de cobro, ${cambios} petición(es) de cambio, ${avisos} aviso(s)`);
  console.log("  · Bloqueos y festivos, intactos: este script no abre esas tablas.\n");
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n\n`);
  process.exit(1);
});
