// @vivo — Herramienta genérica: pasa las citas que se le digan a otro tipo de cita, con las mismas vallas que la ficha de la cita. En seco por defecto.
/**
 * cambiar-tipo-de-cita.js — cambia DE TIPO citas concretas por su id
 * (03/09/2026, Aumenta por Rodrigo: entrevistas iniciales apuntadas con el
 * tipo de la cuota).
 *
 * Hace exactamente lo que hace la fila «Tipo» de la ficha de la cita, pero
 * para una lista: pasa por `puedeCambiarTipo` (lib/citas/cambioDeTipo.js)
 * como dirección, así que un taller o la sesión de un bono se rechazan aquí
 * igual que en pantalla, y deja su rastro en la auditoría de citas. La
 * duración de cada cita NO se toca: es suya, no del tipo.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/cambiar-tipo-de-cita.js <slug> \
 *        --a "ENTREVISTA INICIAL" --cita <uuid> --cita <uuid>
 *   … --a <uuid del tipo>   también vale el id
 *   … --confirm             escribe (sin él, solo enseña)
 *
 * En el VPS: docker exec crm-salamandra-app-1 node scripts/cambiar-tipo-de-cita.js aumenta …
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { puedeCambiarTipo } from "../lib/citas/cambioDeTipo.js";
import { logCitasAudit } from "../lib/citas/audit.js";

const argv = process.argv.slice(2);
const conValor = new Set(["--a", "--cita"]);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !conValor.has(a)));
const [slug] = argv.filter((a, i) => !a.startsWith("--") && !conValor.has(argv[i - 1]));
const valorDe = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const citas = argv.map((a, i) => (a === "--cita" ? argv[i + 1] : null)).filter(Boolean);
const confirm = flags.has("--confirm");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function die(msg) { process.stderr.write(`\n✗ ${msg}\n\n`); process.exit(1); }

if (!slug) die("Falta el slug.\n  Uso: scripts/cambiar-tipo-de-cita.js <slug> --a \"Tipo\" --cita <uuid> [--confirm]");
const aQue = valorDe("--a");
if (!aQue) die("Falta --a \"Nombre del tipo\" (o su id).");
if (!citas.length) die("Falta al menos un --cita <uuid>.");

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { Booking, EventType } = models;

const tipoNuevo = UUID_RE.test(aQue)
  ? await EventType.findByPk(aQue)
  : await EventType.findOne({ where: sequelize.where(sequelize.fn("lower", sequelize.col("name")), aQue.toLocaleLowerCase("es")) });
if (!tipoNuevo) die(`No hay ningún tipo de cita «${aQue}» en ${slug}.`);

process.stdout.write(`\n${slug} · citas → «${tipoNuevo.name}»${confirm ? "" : "  (EN SECO)"}\n\n`);

const fecha = (d) => new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

let cambiadas = 0;
for (const id of citas) {
  const row = await Booking.findByPk(id, { include: [{ model: EventType, as: "eventType", attributes: ["id", "name"] }] });
  if (!row) { process.stdout.write(`  ✗ ${id}: no existe\n`); continue; }
  const cambio = puedeCambiarTipo({ role: "admin", booking: row, tipoNuevo });
  const quien = `${row.clientName} · ${fecha(row.scheduledAt)} · ${row.eventType?.name ?? "sin tipo"}`;
  if (!cambio.ok) { process.stdout.write(`  ✗ ${quien}: ${cambio.motivo}\n`); continue; }
  if (cambio.sinCambio) { process.stdout.write(`  · ${quien}: ya era de ese tipo\n`); continue; }
  process.stdout.write(`  ${confirm ? "✓" : "→"} ${quien} → «${tipoNuevo.name}»\n`);
  if (confirm) {
    const before = row.toJSON();
    await row.update({ eventTypeId: tipoNuevo.id });
    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_updated",
      entity: "Booking",
      entityId: row.id,
      before: { eventTypeId: before.eventTypeId },
      after: { eventTypeId: tipoNuevo.id, porScript: "cambiar-tipo-de-cita" },
    });
  }
  cambiadas++;
}

process.stdout.write(`\n  ${confirm ? "Cambiadas" : "A cambiar"}: ${cambiadas} de ${citas.length}${confirm ? "" : " — relanza con --confirm"}\n\n`);
await sequelize.close();
await master.close();
