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
 * ── CUANDO EL RÓTULO NO BASTA: `--serie` (09/09/2026) ───────────────────────
 * En Aumenta hay TRES series de tardes distintas rotuladas exactamente igual
 * («TALLER H.H.S.S», de Estefanía los jueves, de Laura los martes y de Silvia
 * los miércoles): con `--grupo` no hay regex que las separe, porque el texto es
 * el mismo. Lo que sí las separa es la SERIE —quién, qué día, a qué hora y
 * cuánto dura—, que es como se reconoce un taller semanal mirando la agenda.
 *
 * `--serie "regex=uuid"` casa contra esta clave, que se imprime en la lista de
 * dudas para poder copiarla:
 *
 *     Silvia Pérez Hernández · miércoles · 17:15 · 90m · TALLER H.H.S.S
 *
 * Gana sobre `--grupo`: es más específica.
 *
 * ── DOS BLOQUEOS PARA LA MISMA CLASE (09/09/2026) ───────────────────────────
 * Un taller que dan DOS personas está en la agenda dos veces, una por cada una:
 * el martes a las 18:15 hay un bloqueo de Daniela y otro de Laura, y son la
 * misma hora con los mismos niños. Convertir los dos dejaría la tarde
 * duplicada. Así que, cuando varios bloqueos caen en el MISMO grupo a la MISMA
 * hora, se crea UNA cita —que ya lleva dentro a los dos terapeutas del grupo,
 * los pone `montarCitaDeTaller`— y los demás bloqueos se retiran sin crear
 * nada. Se cuenta aparte para que se vea.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/convertir-bloqueos-en-citas-de-taller.js <slug>
 *   … --alias "hhss|h\.h\.s\.s=Habilidades sociales"   (repetible)
 *   … --grupo "apoyo.*2=<uuid>"                        (repetible)
 *   … --serie "Silvia.*miércoles.*90m=<uuid>"          (repetible, manda sobre --grupo)
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
const conValor = new Set(["--alias", "--grupo", "--serie", "--desde", "--hasta"]);
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
const porSerie = parsear(valores("--serie"), "--serie");
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

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const enMadrid = (d, o) => new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid", ...o });

/**
 * La CLAVE DE SERIE de un bloqueo: quién, qué día de la semana, a qué hora y
 * cuánto dura, más el rótulo. Es lo que distingue dos tardes que se llaman
 * igual, y lo que se le pasa a `--serie`.
 *
 * El día de la semana se saca de la fecha YA en Madrid, no del UTC: en verano
 * un bloqueo de las 00:30 sería del día anterior.
 */
function claveDeSerie(b, minutos, quien) {
  const f = enMadrid(b.startAt, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
  const dia = DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()];
  const hora = enMadrid(b.startAt, { hour: "2-digit", minute: "2-digit" });
  return `${quien ?? "(centro)"} · ${dia} · ${hora} · ${minutos}m · ${String(b.label ?? "").trim()}`;
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

/** ¿Y qué grupo? Por serie, forzado por rótulo, único, o el de la misma duración. */
function grupoDelBloqueo(taller, label, minutos, serie) {
  // La serie va primero: es más específica que el rótulo, y existe justo para
  // los casos en los que el rótulo no distingue.
  for (const f of porSerie) if (f.re.test(serie)) {
    const g = grupos.find((x) => x.id === f.valor);
    if (!g) die(`--serie apunta a un grupo que no existe: ${f.valor}`);
    return { grupo: g };
  }
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

// Quién es cada profesional, para poder nombrarlo en la clave de serie.
const quienEs = new Map(
  models.TeamMember
    ? (await models.TeamMember.findAll({ attributes: ["id", "displayName"], raw: true })).map((m) => [m.id, m.displayName])
    : []
);

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
  const serie = claveDeSerie(b, minutos, quienEs.get(b.teamMemberId));
  const { grupo, porQue } = grupoDelBloqueo(taller, b.label, minutos, serie);
  if (!grupo) { dudas.push({ b, serie, porQue }); continue; }
  const tipo = tipoDe.get(grupo.id);
  if (!tipo) { dudas.push({ b, serie, porQue: `el grupo «${grupo.name}» no tiene tipo de cita (scripts/backfill-talleres-tipos-cita.js)` }); continue; }
  plan.push({ b, taller, grupo, tipo, minutos, serie });
}

/*
 * Una clase, UNA cita. Un taller que dan dos personas está dos veces en la
 * agenda —un bloqueo por cada una— y las dos son la misma hora con los mismos
 * niños. La primera crea la cita (que ya lleva a los dos terapeutas dentro) y
 * las demás se retiran sin crear nada.
 */
const sobrantes = [];
const yaVisto = new Set();
const plan2 = [];
for (const p of plan) {
  const k = `${p.grupo.id}|${new Date(p.b.startAt).toISOString()}`;
  if (yaVisto.has(k)) sobrantes.push(p);
  else { yaVisto.add(k); plan2.push(p); }
}
plan.length = 0;
plan.push(...plan2);

process.stdout.write(`\n  Bloqueos leídos: ${bloqueos.length} · de otra cosa: ${ajenos} · a convertir: ${plan.length} · con dudas: ${dudas.length}${sobrantes.length ? ` · duplicados a retirar: ${sobrantes.length}` : ""}\n\n`);

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
  for (const { b, serie, porQue } of dudas) {
    process.stdout.write(`    ? ${fecha(b.startAt)} · ${porQue}\n`);
    // La clave, entera y copiable: es lo que hay que darle a --serie.
    if (serie) process.stdout.write(`      serie: ${serie}\n`);
  }
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

// Y los duplicados de una clase que ya tiene su cita: se retiran, sin crear
// nada y sin tocar la cita de al lado.
let retirados = 0;
for (const p of sobrantes) {
  try {
    await p.b.destroy();
    retirados++;
  } catch (err) {
    process.stdout.write(`  ✗ no se pudo retirar el bloqueo duplicado ${fecha(p.b.startAt)} «${p.b.label}»: ${err.message}\n`);
  }
}

process.stdout.write(`\n  Convertidos: ${hechas} de ${plan.length} · asistentes apuntados: ${asistentesTotal}${sobrantes.length ? ` · duplicados retirados: ${retirados} de ${sobrantes.length}` : ""}\n\n`);
await sequelize.close();
await master.close();
