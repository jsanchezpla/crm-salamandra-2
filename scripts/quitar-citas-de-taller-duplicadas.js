// @vivo — Herramienta de rescate: si un grupo de taller acaba con DOS citas a la misma hora, se queda la primera y se retiran las demás. En seco por defecto.
/**
 * quitar-citas-de-taller-duplicadas.js — un grupo, una hora, UNA cita
 * (09/09/2026).
 *
 * ── DE QUÉ ERROR NACE ───────────────────────────────────────────────────────
 * El 03/09 se convirtieron en citas los bloqueos de Apoyo al estudio y Mente
 * Activa. El 07/09 se colocó el armazón de bloqueos del curso entero, que los
 * VOLVIÓ A PONER encima de esas mismas horas. Y el 09/09, al convertir HHSS, se
 * convirtieron también esos: 154 citas nuevas sobre 154 que ya existían.
 *
 * `convertir-bloqueos-en-citas-de-taller.js` no miraba las citas que ya había
 * —solo deduplicaba los bloqueos de la misma pasada—, así que el fallo era
 * silencioso: en la agenda salían dos cajas iguales una encima de otra.
 * Desde hoy ese script comprueba antes de crear; esto limpia lo que ya pasó.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 * Busca grupos de taller con más de una cita a la MISMA hora exacta, se queda
 * con la más antigua —la primera que se creó— y retira las demás con su lista
 * de asistentes y sus terapeutas.
 *
 * ── LO QUE NO BORRA NUNCA ───────────────────────────────────────────────────
 * Una cita que tenga un REGISTRO DE SESIÓN colgando. Si alguien ya escribió la
 * sesión de esa tarde, la cita no es un duplicado sobrante: es donde está el
 * trabajo. Se lista y se deja, para que lo mire una persona.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/quitar-citas-de-taller-duplicadas.js <slug>
 *   … --confirm    borra
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/quitar-citas-de-taller-duplicadas.js aumenta --confirm
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { logCitasAudit } from "../lib/citas/audit.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));
const confirm = flags.has("--confirm");

function die(m) { process.stderr.write(`\n✗ ${m}\n\n`); process.exit(1); }
if (!slug) die("Falta el slug.\n  Uso: scripts/quitar-citas-de-taller-duplicadas.js <slug> [--confirm]");

const fecha = (d) => new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { Booking, TallerGrupo, ClinicSession, TallerAsistencia, TallerCitaTerapeuta } = models;
if (!Booking || !TallerGrupo) die(`${slug} no tiene talleres.`);

const citas = await Booking.findAll({
  where: { tallerGrupoId: { [sequelize.Sequelize.Op.ne]: null } },
  attributes: ["id", "tallerGrupoId", "scheduledAt", "createdAt", "duration", "teamMemberId"],
  order: [["scheduled_at", "ASC"], ["created_at", "ASC"]],
});
const nombreGrupo = new Map((await TallerGrupo.findAll({ attributes: ["id", "name"], raw: true })).map((g) => [g.id, g.name]));

// Por grupo y hora exacta.
const porHueco = new Map();
for (const c of citas) {
  const k = `${c.tallerGrupoId}|${new Date(c.scheduledAt).toISOString()}`;
  if (!porHueco.has(k)) porHueco.set(k, []);
  porHueco.get(k).push(c);
}

const sobran = [];
const intocables = [];
for (const [, lista] of porHueco) {
  if (lista.length < 2) continue;
  // La más antigua se queda: es la que puede llevar trabajo encima.
  const [, ...resto] = lista.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const c of resto) {
    const conRegistro = ClinicSession ? await ClinicSession.count({ where: { bookingId: c.id } }) : 0;
    if (conRegistro) intocables.push(c);
    else sobran.push(c);
  }
}

process.stdout.write(`\n${slug} · citas de taller duplicadas${confirm ? "" : "  (EN SECO)"}\n\n`);
process.stdout.write(`  citas de taller: ${citas.length} · huecos con más de una: ${[...porHueco.values()].filter((l) => l.length > 1).length}\n`);
process.stdout.write(`  a retirar: ${sobran.length}${intocables.length ? ` · con registro escrito, SE QUEDAN: ${intocables.length}` : ""}\n\n`);

const agr = new Map();
for (const c of sobran) agr.set(nombreGrupo.get(c.tallerGrupoId), (agr.get(nombreGrupo.get(c.tallerGrupoId)) ?? 0) + 1);
for (const [g, n] of agr) process.stdout.write(`   · «${g}»: ${n}\n`);
for (const c of intocables) process.stdout.write(`   ⚠ ${fecha(c.scheduledAt)} «${nombreGrupo.get(c.tallerGrupoId)}» tiene registro: se queda\n`);

if (!confirm) {
  process.stdout.write(`\n  En seco: nada borrado. Relanza con --confirm.\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

let hechas = 0;
for (const c of sobran) {
  try {
    if (TallerAsistencia) await TallerAsistencia.destroy({ where: { bookingId: c.id } });
    if (TallerCitaTerapeuta) await TallerCitaTerapeuta.destroy({ where: { bookingId: c.id } });
    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_deleted",
      entity: "Booking",
      entityId: c.id,
      before: { tallerGrupoId: c.tallerGrupoId, scheduledAt: c.scheduledAt, duration: c.duration, motivo: "duplicada: el grupo ya tenía una cita a esa hora" },
    });
    await Booking.destroy({ where: { id: c.id } });
    hechas++;
  } catch (err) {
    process.stdout.write(`  ✗ ${fecha(c.scheduledAt)} «${nombreGrupo.get(c.tallerGrupoId)}»: ${err.message}\n`);
  }
}

process.stdout.write(`\n  Retiradas: ${hechas} de ${sobran.length}\n\n`);
await sequelize.close();
await master.close();
