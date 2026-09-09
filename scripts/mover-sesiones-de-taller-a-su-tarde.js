// @vivo — Rescate: una sesión de taller registrada en un grupo VIEJO se archiva en la tarde a la que de verdad pertenece, deducida por sus asistentes. En seco por defecto.
/**
 * mover-sesiones-de-taller-a-su-tarde.js — el registro de grupo que se quedó
 * en el cajón de antes (09/09/2026, AV-0033).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Daniela, el mismo día en que los grupos de Habilidades sociales pasaron a ser
 * las tardes de verdad: «la semana pasada yo ya registré mi primera sesión en
 * el grupo "1 hora y media" y ahora entiendo que tengo que registrarlas en el
 * grupo "miércoles 17:15", ¿hay alguna forma de que se me copie la de la semana
 * pasada en ese grupo? Para no tener que volverla a registrar».
 *
 * Los grupos viejos («1 hora», «1 hora y media», «Por revisar») eran las CUOTAS
 * de Organízate, y las sesiones de taller escritas antes del reparto se quedaron
 * archivadas ahí. El trabajo no se ha perdido —cada niño tiene su registro en su
 * ficha, y eso no se toca— pero la sesión de grupo cuelga de un grupo que ya no
 * tiene tardes.
 *
 * ── CÓMO SABE A QUÉ TARDE VA, SIN ADIVINAR ─────────────────────────────────
 * Por sus ASISTENTES. Se mira a qué pacientes se les copió el registro y con
 * qué grupo nuevo casan. Se mueve SOLO si una tarde se lleva la mayoría amplia
 * y ninguna otra se le acerca; si hay empate o la mayoría es floja, se lista y
 * no se toca. En Aumenta los cuatro casos casaban 6 de 6, 7 de 8, 6 de 7 y 2 de
 * 4, cada uno con una sola tarde.
 *
 * ── LO QUE NO TOCA ─────────────────────────────────────────────────────────
 * Los registros clínicos de cada niño (`clinic_sessions`), que es donde está el
 * trabajo escrito y firmado. Aquí solo cambia DÓNDE ESTÁ ARCHIVADA la sesión de
 * grupo: su `grupo_id`.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/mover-sesiones-de-taller-a-su-tarde.js <slug>
 *   … --confirm    escribe
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { logClinicaAudit } from "../lib/clinica/audit.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));
const confirm = flags.has("--confirm");

function die(m) { process.stderr.write(`\n✗ ${m}\n\n`); process.exit(1); }
if (!slug) die("Falta el slug.\n  Uso: scripts/mover-sesiones-de-taller-a-su-tarde.js <slug> [--confirm]");

/** Los grupos que son una CUOTA y no una tarde: de estos hay que salir. */
const ES_GRUPO_VIEJO = /^1 hora|^Por revisar|^\d+ d[ií]as?$/i;

/** Cuánta mayoría hace falta para dar por buena una tarde. */
const MAYORIA = 0.6;

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { TallerSesion, TallerGrupo, TallerInscripcion, ClinicSession, TeamMember } = models;
if (!TallerSesion || !TallerGrupo) die(`${slug} no tiene talleres.`);

const grupos = await TallerGrupo.findAll({ attributes: ["id", "name", "tallerId"], raw: true });
const nombre = new Map(grupos.map((g) => [String(g.id), g.name]));
const equipo = new Map((await TeamMember.findAll({ attributes: ["id", "displayName"], raw: true })).map((m) => [String(m.id), m.displayName]));

const inscritos = new Map();
for (const g of grupos) {
  const ids = (await TallerInscripcion.findAll({ where: { grupoId: g.id, leftAt: null }, attributes: ["patientId"], raw: true })).map((i) => String(i.patientId));
  inscritos.set(String(g.id), new Set(ids));
}

const sesiones = await TallerSesion.findAll();
const mueven = [];
const dudas = [];
for (const s of sesiones) {
  const suGrupo = nombre.get(String(s.grupoId));
  if (!suGrupo || !ES_GRUPO_VIEJO.test(suGrupo)) continue;

  const pacientes = (await ClinicSession.findAll({ where: { tallerSesionId: s.id }, attributes: ["patientId"], raw: true })).map((c) => String(c.patientId));
  const quien = equipo.get(String(s.teamMemberId)) ?? "?";
  const cuando = new Date(s.sessionDate).toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "2-digit" });
  const etiqueta = `${cuando} · «${suGrupo}» · ${quien} · ${pacientes.length} asistentes`;

  if (!pacientes.length) { dudas.push({ etiqueta, porQue: "no tiene asistentes de los que deducir la tarde" }); continue; }

  const candidatas = grupos
    // Solo tardes del MISMO taller: una sesión de HHSS no se va a Apoyo.
    .filter((g) => String(g.tallerId) === String(s.tallerId) && !ES_GRUPO_VIEJO.test(g.name))
    .map((g) => ({ g, casan: pacientes.filter((p) => inscritos.get(String(g.id)).has(p)).length }))
    .filter((x) => x.casan > 0)
    .sort((a, b) => b.casan - a.casan);

  if (!candidatas.length) { dudas.push({ etiqueta, porQue: "sus asistentes no están en ninguna tarde" }); continue; }
  const [mejor, segunda] = candidatas;
  if (mejor.casan < Math.ceil(pacientes.length * MAYORIA)) {
    dudas.push({ etiqueta, porQue: `la mejor solo casa ${mejor.casan} de ${pacientes.length}` });
    continue;
  }
  if (segunda && segunda.casan === mejor.casan) {
    dudas.push({ etiqueta, porQue: `empate entre «${mejor.g.name}» y «${segunda.g.name}»` });
    continue;
  }
  mueven.push({ s, etiqueta, destino: mejor.g, casan: mejor.casan, de: pacientes.length });
}

process.stdout.write(`\n${slug} · sesiones de taller en un grupo viejo${confirm ? "" : "  (EN SECO)"}\n\n`);
for (const m of mueven) {
  process.stdout.write(`  → ${m.etiqueta}\n     a «${m.destino.name}» (casan ${m.casan} de ${m.de})\n`);
}
for (const d of dudas) process.stdout.write(`  ? ${d.etiqueta}\n     se queda: ${d.porQue}\n`);
process.stdout.write(`\n  a mover: ${mueven.length} · con dudas: ${dudas.length}\n`);

if (!mueven.length || !confirm) {
  process.stdout.write(`\n  ${mueven.length ? "En seco: nada escrito. Relanza con --confirm." : "Nada que mover."}\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

let hechas = 0;
for (const m of mueven) {
  const antes = String(m.s.grupoId);
  await m.s.update({ grupoId: m.destino.id });
  await logClinicaAudit({
    tenantId: tenant.id,
    userId: null,
    action: "clinica.taller_sesion.updated",
    entity: "TallerSesion",
    entityId: m.s.id,
    // Sin nombres: la auditoría vive en master, compartida por todos.
    before: { grupoId: antes },
    after: { grupoId: String(m.destino.id), motivo: "mover-sesiones-de-taller-a-su-tarde", casan: `${m.casan}/${m.de}` },
  });
  hechas += 1;
}
process.stdout.write(`\n  Movidas: ${hechas} de ${mueven.length}\n\n`);
await sequelize.close();
await master.close();
