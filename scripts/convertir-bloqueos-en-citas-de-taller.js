// @vivo — Herramienta genérica: los bloqueos de la agenda que en realidad eran un taller pasan a ser CITAS de su grupo (con asistentes y terapeutas) y el bloqueo se retira. En seco por defecto.
/**
 * convertir-bloqueos-en-citas-de-taller.js — de «hora tachada» a cita de taller
 * (03/09/2026, Aumenta por Rodrigo: «los talleres de Habilidades Sociales,
 * Apoyo al estudio y Mente Activa que todavía figuran como bloqueos a pesar de
 * tener su tipo de cita… cámbialo, incluso si son citas ya pasadas»).
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Hasta el 01/09/2026 un taller se apuntaba en la agenda como un bloqueo con
 * nombre («TALLER HHSS»). Desde ese día es una cita de su grupo
 * (lib/clinica/citaDeTaller.js): con lista de asistentes, quién lo dio y el
 * registro de sesión que se copia a cada niño. Un bloqueo no tiene nada de
 * eso, y mientras siga siendo bloqueo esa tarde no le cuenta a nadie.
 *
 * ── QUÉ HACE, POR CADA BLOQUEO QUE CASA ─────────────────────────────────────
 *   1. Crea la cita: el tipo de cita del grupo, la hora y la duración del
 *      bloqueo, `patient_id` a NULL y `taller_grupo_id` puesto, confirmada
 *      (las pasadas se dan por asistidas por la presunción de siempre), con
 *      la persona del bloqueo como profesional —o quien coordina el grupo si
 *      el bloqueo era del centro entero— y las notas del bloqueo.
 *   2. Le monta la lista: los inscritos AHORA en el grupo y sus terapeutas
 *      (`montarCitaDeTaller`). Para una tarde pasada es la mejor lista que
 *      hay; quien no fue se marca desde la cita, uno a uno.
 *   3. Deja rastro en la auditoría de citas (`citas.booking_created`, con el
 *      id del bloqueo del que sale).
 *   4. Retira el bloqueo. Los documentos que colgaran de él se quedan (la FK
 *      es ON DELETE SET NULL); las actas solo existen en reuniones de equipo.
 *
 * Sin transacción (montarCitaDeTaller escribe por su cuenta), pero con la
 * vuelta atrás hecha a mano: si algo falla después de crear la cita, la cita
 * y su lista se borran y el bloqueo se queda como estaba.
 *
 * ── CÓMO SABE QUÉ BLOQUEO ES DE QUÉ GRUPO ───────────────────────────────────
 * Por el RÓTULO del bloqueo: casa con el nombre del taller (sin tildes ni
 * mayúsculas) o con un alias que se le dé (`--alias "hhss|h\.h\.s\.s=Habilidades
 * sociales"`). Y dentro del taller, el grupo:
 *   · si el taller tiene UN grupo, ese;
 *   · si tiene varios, el que dure lo mismo que el bloqueo, si es uno solo;
 *   · si sigue habiendo duda, hay que decirlo: `--grupo "regex del rótulo=uuid
 *     del grupo"`. Lo que no se resuelve se LISTA y no se toca.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/convertir-bloqueos-en-citas-de-taller.js <slug>
 *   … --alias "hhss|h\.h\.s\.s=Habilidades sociales"   (repetible)
 *   … --grupo "apoyo.*2=<uuid>"                        (repetible)
 *   … --desde 2025-09-01 --hasta 2026-12-31            (por fecha de inicio)
 *   … --confirm                                        escribe
 *
 * En el VPS: docker exec crm-salamandra-app-1 node scripts/convertir-bloqueos-en-citas-de-taller.js aumenta …
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { montarCitaDeTaller } from "../lib/clinica/citaDeTaller.js";
import { terapeutasDeGrupo } from "../lib/clinica/grupoDeTaller.js";
import { logCitasAudit } from "../lib/citas/audit.js";

const argv = process.argv.slice(2);
const conValor = new Set(["--alias", "--grupo", "--desde", "--hasta"]);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !conValor.has(a)));
const [slug] = argv.filter((a, i) => !a.startsWith("--") && !conValor.has(argv[i - 1]));
const valores = (k) => argv.map((a, i) => (a === k ? argv[i + 1] : null)).filter(Boolean);
const confirm = flags.has("--confirm");

function die(msg) { process.stderr.write(`\n✗ ${msg}\n\n`); process.exit(1); }
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fecha = (d) => new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

if (!slug) die("Falta el slug.\n  Uso: scripts/convertir-bloqueos-en-citas-de-taller.js <slug> [--alias …] [--grupo …] [--confirm]");

const parsear = (lista, que) => lista.map((v) => {
  const i = v.lastIndexOf("=");
  if (i <= 0) die(`${que} mal escrito: «${v}» (regex=valor)`);
  return { re: new RegExp(v.slice(0, i), "i"), valor: v.slice(i + 1).trim() };
});
const aliases = parsear(valores("--alias"), "--alias");
const forzados = parsear(valores("--grupo"), "--grupo");
const desde = valores("--desde")[0] ? new Date(`${valores("--desde")[0]}T00:00:00+02:00`) : null;
const hasta = valores("--hasta")[0] ? new Date(`${valores("--hasta")[0]}T23:59:59+02:00`) : null;

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const tenantModels = models;
const { TeamBlock, Booking, EventType, Taller, TallerGrupo, TallerInscripcion } = models;
if (!Taller || !TallerGrupo) die(`${slug} no tiene talleres.`);

// ── El catálogo: talleres, sus grupos y el tipo de cita de cada grupo ────────
const talleres = await Taller.findAll({ raw: true });
const grupos = await TallerGrupo.findAll({ raw: true });
const tipos = await EventType.findAll({ where: { tallerGrupoId: { [Op.ne]: null } }, raw: true });
const tipoDe = new Map(tipos.map((t) => [t.tallerGrupoId, t]));
const gruposDe = new Map();
for (const g of grupos) {
  if (!gruposDe.has(g.tallerId)) gruposDe.set(g.tallerId, []);
  gruposDe.get(g.tallerId).push(g);
}
const inscritosDe = new Map();
if (TallerInscripcion) {
  for (const g of grupos) {
    inscritosDe.set(g.id, await TallerInscripcion.count({ where: { grupoId: g.id, leftAt: null } }));
  }
}

process.stdout.write(`\n${slug} · bloqueos de taller → citas${confirm ? "" : "  (EN SECO)"}\n\n`);
for (const t of talleres) {
  process.stdout.write(`  Taller «${t.name}»\n`);
  for (const g of gruposDe.get(t.id) ?? []) {
    process.stdout.write(`    · ${g.name} (${g.duration} min, ${inscritosDe.get(g.id) ?? "?"} inscritos) → tipo ${tipoDe.get(g.id)?.name ?? "SIN TIPO DE CITA"}\n`);
  }
}

/** ¿De qué taller es este rótulo? Por nombre del taller o por alias. */
function tallerDelRotulo(label) {
  const n = norm(label);
  for (const a of aliases) if (a.re.test(label)) {
    const t = talleres.find((x) => norm(x.name) === norm(a.valor));
    if (!t) die(`El alias «${a.valor}» no es ningún taller de ${slug}.`);
    return t;
  }
  return talleres.find((t) => n.includes(norm(t.name))) ?? null;
}

/** ¿Y qué grupo? Forzado, único, o el de la misma duración. */
function grupoDelBloqueo(taller, label, minutos) {
  for (const f of forzados) if (f.re.test(label)) {
    const g = grupos.find((x) => x.id === f.valor);
    if (!g) die(`--grupo apunta a un grupo que no existe: ${f.valor}`);
    return { grupo: g };
  }
  const candidatos = gruposDe.get(taller.id) ?? [];
  if (candidatos.length === 1) return { grupo: candidatos[0] };
  const mismaDuracion = candidatos.filter((g) => Number(g.duration) === minutos);
  if (mismaDuracion.length === 1) return { grupo: mismaDuracion[0] };
  return { grupo: null, porQue: candidatos.length ? `${candidatos.length} grupos y ninguno (o varios) dura ${minutos} min` : "el taller no tiene grupos" };
}

// ── Los bloqueos ────────────────────────────────────────────────────────────
const where = {};
if (desde || hasta) where.startAt = { ...(desde ? { [Op.gte]: desde } : {}), ...(hasta ? { [Op.lte]: hasta } : {}) };
const bloqueos = await TeamBlock.findAll({ where, order: [["startAt", "ASC"]] });

const plan = [];
const dudas = [];
let ajenos = 0;
for (const b of bloqueos) {
  const taller = tallerDelRotulo(b.label);
  if (!taller) { ajenos++; continue; }
  const minutos = Math.round((new Date(b.endAt) - new Date(b.startAt)) / 60000);
  if (!(minutos >= 15 && minutos <= 480)) { dudas.push({ b, porQue: `dura ${minutos} min: no parece una sesión` }); continue; }
  const { grupo, porQue } = grupoDelBloqueo(taller, b.label, minutos);
  if (!grupo) { dudas.push({ b, porQue }); continue; }
  const tipo = tipoDe.get(grupo.id);
  if (!tipo) { dudas.push({ b, porQue: `el grupo «${grupo.name}» no tiene tipo de cita (scripts/backfill-talleres-tipos-cita.js)` }); continue; }
  plan.push({ b, taller, grupo, tipo, minutos });
}

process.stdout.write(`\n  Bloqueos leídos: ${bloqueos.length} · de otra cosa: ${ajenos} · a convertir: ${plan.length} · con dudas: ${dudas.length}\n\n`);

const porGrupo = new Map();
for (const p of plan) porGrupo.set(p.grupo.id, (porGrupo.get(p.grupo.id) ?? 0) + 1);
for (const [gid, n] of porGrupo) {
  const g = grupos.find((x) => x.id === gid);
  const t = talleres.find((x) => x.id === g.tallerId);
  const pasados = plan.filter((p) => p.grupo.id === gid && new Date(p.b.startAt) < new Date()).length;
  process.stdout.write(`  → «${t.name} · ${g.name}»: ${n} bloqueos (${pasados} pasados, ${n - pasados} futuros)\n`);
}
if (dudas.length) {
  process.stdout.write(`\n  Sin tocar, por dudas:\n`);
  for (const { b, porQue } of dudas) process.stdout.write(`    ? «${b.label}» ${fecha(b.startAt)} · ${porQue}\n`);
}

if (!confirm) {
  process.stdout.write(`\n  En seco: nada escrito. Relanza con --confirm.\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

// ── Escribir ────────────────────────────────────────────────────────────────
let hechas = 0;
let asistentesTotal = 0;
const coordinadorDe = new Map();
for (const p of plan) {
  const { b, grupo, tipo, minutos } = p;
  let teamMemberId = b.teamMemberId ?? null;
  if (!teamMemberId) {
    if (!coordinadorDe.has(grupo.id)) coordinadorDe.set(grupo.id, (await terapeutasDeGrupo({ tenantModels, grupoId: grupo.id }))[0] ?? null);
    teamMemberId = coordinadorDe.get(grupo.id);
  }
  let row = null;
  try {
    row = await Booking.create({
      eventTypeId: tipo.id,
      clientName: tipo.name,
      clientEmail: null,
      clientPhone: null,
      scheduledAt: b.startAt,
      duration: minutos,
      modality: "presencial",
      status: "confirmed",
      notes: b.notes ?? null,
      teamMemberId,
      patientId: null,
      clientId: null,
      tallerGrupoId: grupo.id,
    });
    const montado = await montarCitaDeTaller({ tenantModels, booking: row, grupoId: grupo.id });
    asistentesTotal += montado.asistentes;
    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: { bloqueo: { id: b.id, label: b.label, startAt: b.startAt, endAt: b.endAt, teamMemberId: b.teamMemberId } },
      after: { ...row.toJSON(), source: "convertir-bloqueos-en-citas-de-taller", ...montado },
    });
    await b.destroy();
    hechas++;
    process.stdout.write(`  ✓ ${fecha(b.startAt)} «${b.label}» → «${tipo.name}» (${montado.asistentes} asistentes, ${montado.impartidores} terapeutas)\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${fecha(b.startAt)} «${b.label}»: ${err.message}\n`);
    if (row) {
      // Vuelta atrás a mano: la cita a medias no se queda.
      try {
        if (models.TallerAsistencia) await models.TallerAsistencia.destroy({ where: { bookingId: row.id } });
        if (models.TallerCitaTerapeuta) await models.TallerCitaTerapeuta.destroy({ where: { bookingId: row.id } });
        await row.destroy();
      } catch (e2) {
        process.stdout.write(`    ⚠ y no se pudo deshacer la cita ${row.id}: ${e2.message}\n`);
      }
    }
  }
}

process.stdout.write(`\n  Convertidos: ${hechas} de ${plan.length} · asistentes apuntados: ${asistentesTotal}\n\n`);
await sequelize.close();
await master.close();
