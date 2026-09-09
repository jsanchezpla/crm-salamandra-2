// @vivo — Rescate: una sesión cuya fecha ya no es la de su cita se suelta, para que la bandeja deje de pedir un registro que está escrito. En seco por defecto.
/**
 * soltar-sesiones-de-otra-cita.js — el registro escrito que la bandeja seguía
 * pidiendo (09/09/2026, AV-0094).
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * Blanca: «escribí el registro con la fecha mal, la corregí al día que fue, y
 * la bandeja me lo sigue pidiendo». La sesión se quedaba atada (`booking_id`)
 * a la cita del día EQUIVOCADO, y la bandeja busca el registro de una cita por
 * dos caminos —el `booking_id`, y una sesión suelta del mismo paciente el mismo
 * día (`lib/clinica/loMio.js`)—, de los que el segundo descarta a propósito las
 * sesiones que ya son de otra cita. Ni por uno ni por otro: la cita del día
 * bueno se quedaba pidiendo un registro que existía.
 *
 * Desde hoy, cambiar la fecha de una sesión la suelta sola (el PATCH de
 * `app/api/clinica/sessions/[id]/route.js`). Esto arregla las que ya estaban.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 * Pone `booking_id = NULL` en las sesiones cuya fecha NO es el día de la cita a
 * la que están atadas. Nada más: no borra, no mueve fechas y no re-ata. Suelta
 * es como están 23.000 de las 23.342 sesiones de Aumenta, y la bandeja las
 * encuentra igual por el día.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/soltar-sesiones-de-otra-cita.js <slug>
 *   … --confirm    escribe
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { diaDeMadrid } from "../lib/clinica/loMio.js";
import { logClinicaAudit } from "../lib/clinica/audit.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));
const confirm = flags.has("--confirm");

function die(m) { process.stderr.write(`\n✗ ${m}\n\n`); process.exit(1); }
if (!slug) die("Falta el slug.\n  Uso: scripts/soltar-sesiones-de-otra-cita.js <slug> [--confirm]");

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { ClinicSession, Booking } = models;
if (!ClinicSession || !Booking) die(`${slug} no tiene módulo clínico.`);

const atadas = await ClinicSession.findAll({
  where: { bookingId: { [sequelize.Sequelize.Op.ne]: null } },
  attributes: ["id", "bookingId", "sessionDate", "status"],
});
const citas = new Map(
  (await Booking.findAll({ attributes: ["id", "scheduledAt"], raw: true })).map((b) => [String(b.id), b.scheduledAt])
);

const sueltan = [];
for (const s of atadas) {
  const cuando = citas.get(String(s.bookingId));
  // Una sesión atada a una cita que ya no existe también sobra: la FK la deja
  // a null al borrarla, así que si llega aquí es que la cita está.
  if (!cuando) continue;
  if (diaDeMadrid(cuando) !== diaDeMadrid(s.sessionDate)) sueltan.push({ s, cuando });
}

process.stdout.write(`\n${slug} · sesiones atadas a una cita: ${atadas.length}${confirm ? "" : "  (EN SECO)"}\n`);
process.stdout.write(`  con la fecha en OTRO día que su cita: ${sueltan.length}\n\n`);
for (const { s, cuando } of sueltan) {
  process.stdout.write(`   · sesión del ${diaDeMadrid(s.sessionDate)} atada a la cita del ${diaDeMadrid(cuando)} · ${s.status}\n`);
}

if (!sueltan.length) {
  process.stdout.write(`\n  Nada que soltar.\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}
if (!confirm) {
  process.stdout.write(`\n  En seco: nada escrito. Relanza con --confirm.\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

let hechas = 0;
for (const { s, cuando } of sueltan) {
  await s.update({ bookingId: null });
  await logClinicaAudit({
    tenantId: tenant.id,
    userId: null,
    action: "clinica.session.updated",
    entity: "ClinicSession",
    entityId: s.id,
    // Sin nada del paciente: la auditoría vive en master, compartida.
    before: { bookingId: "(atada a una cita de otro día)" },
    after: { bookingId: null, motivo: "soltar-sesiones-de-otra-cita", diaCita: diaDeMadrid(cuando) },
  });
  hechas += 1;
}
process.stdout.write(`\n  Sueltas: ${hechas} de ${sueltan.length}\n\n`);
await sequelize.close();
await master.close();
