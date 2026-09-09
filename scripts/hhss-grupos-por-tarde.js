/**
 * hhss-grupos-por-tarde.js — los grupos de Habilidades sociales pasan a ser las
 * TARDES de verdad (09/09/2026, Aumenta; el centro mandó el Excel el mismo día).
 *
 * ── QUÉ ESTABA MAL ──────────────────────────────────────────────────────────
 * Los tres grupos que tenía el taller —«1 hora», «1 hora y media» y «Por
 * revisar»— no son grupos: son las CUOTAS con las que se cobraba en Organízate.
 * En «1 hora» había 28 niños que no coinciden nunca en la misma sala. Por eso
 * las siete tardes de HHSS seguían siendo bloqueos: convertirlas habría puesto
 * 28 asistentes en una sesión de cuatro.
 *
 * Y por eso Silvia no encontraba a Enrique al pasar lista (AV-0007, 03/09): él
 * paga una hora y va al grupo de hora y media, así que estaba en el grupo «1
 * hora» y la tarde de Silvia era «la de hora y media». Lo que pagas y a qué
 * tarde vas son dos cosas distintas, y aquí se separan.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 *   1. Crea los SEIS grupos reales, uno por tarde, con su día, su hora, su
 *      duración y quién lo da. Si ya existe uno con ese nombre, no lo toca.
 *   2. Mueve a cada niño del Excel a su tarde: `UPDATE grupo_id` sobre la
 *      inscripción que YA tiene.
 *   3. Apunta a quien no estuviera inscrito (con `--apuntar`), por la misma
 *      puerta que la pantalla, cuota incluida.
 *
 * ── LO QUE NO TOCA, Y ES LO IMPORTANTE ──────────────────────────────────────
 * **La cuota.** Mover a un niño de grupo se hace cambiando `grupo_id` en su
 * inscripción, NO dándolo de baja y apuntándolo de nuevo: la baja le cierra la
 * cuota a la familia (`lib/clinica/cuotaDeTaller.js`) y el alta le abre otra.
 * `cuota_id` se queda como está, y quien pagaba una hora sigue pagando una
 * hora aunque su tarde dure noventa minutos. Es justo el caso de Enrique.
 *
 * Tampoco toca a los 30 de «Por revisar» (ninguno tiene cuota y ninguno está en
 * el Excel de este curso) ni a quien pague el taller sin salir en la lista: se
 * quedan donde están y se listan al final para que el centro los mire.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/hhss-grupos-por-tarde.js aumenta
 *   … --apuntar    apunta también a quien no esté inscrito (le abre cuota)
 *   … --confirm    escribe
 *
 * En seco por defecto. En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/hhss-grupos-por-tarde.js aumenta --confirm
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { guardarTerapeutas } from "../lib/clinica/grupoDeTaller.js";
import { asegurarTipoDeCitaDeGrupo } from "../lib/clinica/tipoCitaTaller.js";
import { asegurarCuotaDeTaller } from "../lib/clinica/cuotaDeTaller.js";
import { clientIdOfPatient } from "../lib/clinica/patientClient.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));
const confirm = flags.has("--confirm");
const apuntar = flags.has("--apuntar");

function die(m) { process.stderr.write(`\n✗ ${m}\n\n`); process.exit(1); }
if (!slug) die("Falta el slug.\n  Uso: scripts/hhss-grupos-por-tarde.js <slug> [--apuntar] [--confirm]");

/**
 * Las seis tardes, tal como las mandó el centro el 09/09/2026.
 *
 * `terapeutas` son NOMBRES y no ids a propósito: un id copiado a mano en un
 * script no se puede revisar leyéndolo. Se resuelven abajo y, si alguno no casa
 * con una sola persona del equipo, no se escribe nada.
 *
 * `duracion` sale de la agenda, no del Excel: es lo que dura el bloqueo.
 */
const TARDES = [
  {
    nombre: "Lunes 17:45 · 7-9 años",
    horario: "Lunes de 17:45 a 18:45",
    duracion: 60,
    terapeutas: ["Raquel Torralbo Samper"],
    ninos: ["Marcos Becerro", "Mathias Pop", "Vera Herrero"],
  },
  {
    nombre: "Martes 18:15 · 6-7 años",
    horario: "Martes de 18:15 a 19:15",
    duracion: 60,
    // Dos personas: en la agenda hay un bloqueo de cada una a la misma hora.
    terapeutas: ["Daniela de la Cruz Esteban", "Laura Garrido Rascón"],
    ninos: ["Alberto Sixto", "Diego Sánchez Valoria", "José Úbeda", "Marcos Espejel García-Navas", "Óliver Barrionuevo", "Pablo Aragón"],
  },
  {
    nombre: "Miércoles 17:00 · 8-11 años",
    horario: "Miércoles de 17:00 a 18:00",
    duracion: 60,
    terapeutas: ["Lucía Gonzalez Encinar"],
    ninos: ["Ángela Fresneda", "Enoch", "Hugo García", "Jesús López Carrasco", "Carlos Becerro", "Lucas Gabriel Ginghina Gorga"],
  },
  {
    nombre: "Miércoles 17:15 · 10-12 años",
    horario: "Miércoles de 17:15 a 18:45",
    duracion: 90,
    terapeutas: ["Silvia Pérez Hernández"],
    ninos: ["Enrique Palacios", "Gabriel Rodríguez", "Gabriel Alejandro Pace Cisneros", "Hugo Fernández", "Mario Varela", "Víctor Dacosta", "Gael Bonilla"],
  },
  {
    nombre: "Jueves 18:30 · 12-18 años",
    horario: "Jueves de 18:30 a 19:30",
    duracion: 60,
    terapeutas: ["Daniela de la Cruz Esteban"],
    ninos: ["Carlos Labrador", "Lola Monge", "Marco López Rodríguez", "Paula Ruiz", "Rubén Muñoz", "Sergio Rodríguez", "Tristán Riarán", "Diego Moreno"],
  },
  {
    nombre: "Jueves 19:15 · 12-16 años",
    horario: "Jueves de 19:15 a 20:15",
    duracion: 60,
    terapeutas: ["Estefanía Bermejo Blázquez"],
    ninos: ["Angel Pozo", "Iris Coronado", "Natalia Mota", "Paula Muñoz"],
  },
];

/**
 * Los tres nombres del Excel que salían con varios pacientes posibles. Se
 * desempatan por la EDAD que el propio Excel pone entre paréntesis, y el
 * desempate se comprueba: si el que sale por edad no es también el único que ya
 * está inscrito en el taller con cuota, se para.
 */
const EDADES = { "Hugo Fernández": 11, "Sergio Rodríguez": 14, "Hugo García": 11 };

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { Taller, TallerGrupo, TallerInscripcion, TeamMember, Patient } = models;
if (!Taller || !TallerGrupo) die(`${slug} no tiene talleres.`);

const taller = await Taller.findOne({ where: { name: { [Op.iLike]: "Habilidades sociales" } } });
if (!taller) die(`${slug} no tiene el taller «Habilidades sociales».`);

const equipo = await TeamMember.findAll({ attributes: ["id", "displayName", "status"] });
const pacientes = await Patient.findAll({ attributes: ["id", "firstName", "lastName", "birthDate"] });
const gruposViejos = await TallerGrupo.findAll({ where: { tallerId: taller.id }, raw: true });
const inscripciones = await TallerInscripcion.findAll({ where: { tallerId: taller.id, leftAt: null } });
const inscritoPor = new Map(inscripciones.map((i) => [i.patientId, i]));
const nombreGrupo = new Map(gruposViejos.map((g) => [g.id, g.name]));

/**
 * El concepto de cobro que le toca a una tarde: el del grupo viejo que dura lo
 * mismo. Es lo que hace que apuntar a alguien nuevo le abra la cuota correcta
 * (una hora o una hora y media) en vez de la del taller a secas.
 */
function conceptoPorDuracion(min) {
  const g = gruposViejos.find((x) => Number(x.duration) === Number(min) && x.conceptId && x.name !== "Por revisar");
  return g?.conceptId ?? null;
}

const HOY = new Date();
const edadDe = (b) => {
  if (!b) return null;
  const n = new Date(b);
  let e = HOY.getUTCFullYear() - n.getUTCFullYear();
  const m = HOY.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && HOY.getUTCDate() < n.getUTCDate())) e -= 1;
  return e;
};

/** El paciente de un nombre del Excel, o null si hay duda. */
function pacienteDe(nombre) {
  const partes = norm(nombre).split(" ").filter(Boolean);
  const nom = partes[0];
  const apes = partes.slice(1);
  const cands = pacientes.filter((p) => {
    if (!norm(p.firstName).split(" ").includes(nom)) return false;
    const ape = norm(p.lastName);
    return apes.every((a) => ape.includes(a) || norm(p.firstName).includes(a));
  });
  if (cands.length === 1) return { paciente: cands[0] };
  if (!cands.length) return { paciente: null, porQue: "no se encuentra" };

  // Varios: desempate por edad, y con una segunda señal que tiene que decir lo
  // mismo (estar ya inscrito en el taller). Con una sola no basta.
  const edad = EDADES[nombre];
  if (edad == null) return { paciente: null, porQue: `${cands.length} candidatos y no hay edad para desempatar` };
  const porEdad = cands.filter((p) => edadDe(p.birthDate) === edad);
  const porInscripcion = cands.filter((p) => inscritoPor.has(p.id));
  if (porEdad.length === 1 && porInscripcion.length === 1 && porEdad[0].id === porInscripcion[0].id) {
    return { paciente: porEdad[0] };
  }
  return { paciente: null, porQue: `${cands.length} candidatos: la edad y la inscripción no señalan al mismo` };
}

/* ═══ El plan ══════════════════════════════════════════════════════════════ */

process.stdout.write(`\n${slug} · Habilidades sociales por tardes${confirm ? "" : "  (EN SECO)"}\n\n`);
process.stdout.write(`  Grupos de hoy: ${gruposViejos.map((g) => `«${g.name}» (${g.duration}m)`).join(", ")}\n`);
process.stdout.write(`  Inscripciones vivas: ${inscripciones.length}\n\n`);

const plan = [];
const problemas = [];
const enExcel = new Set();

for (const t of TARDES) {
  const ids = [];
  for (const n of t.terapeutas) {
    const c = equipo.filter((m) => norm(m.displayName) === norm(n));
    if (c.length !== 1) { problemas.push(`terapeuta «${n}»: ${c.length} coincidencias en el equipo`); continue; }
    ids.push(c[0].id);
  }
  const mueve = [];
  const apunta = [];
  for (const n of t.ninos) {
    const { paciente, porQue } = pacienteDe(n);
    if (!paciente) { problemas.push(`«${n}» (${t.nombre}): ${porQue}`); continue; }
    enExcel.add(paciente.id);
    const ins = inscritoPor.get(paciente.id);
    if (ins) mueve.push({ nombre: n, ins, desde: nombreGrupo.get(ins.grupoId) ?? "sin grupo", conCuota: !!ins.cuotaId });
    else apunta.push({ nombre: n, paciente });
  }
  plan.push({ ...t, terapeutaIds: ids, mueve, apunta, concepto: conceptoPorDuracion(t.duracion) });
}

for (const p of plan) {
  const existe = gruposViejos.find((g) => g.name === p.nombre);
  process.stdout.write(`  «${p.nombre}» ${p.duracion}m · ${p.terapeutas.join(" + ")}${existe ? "  (ya existe)" : ""}\n`);
  process.stdout.write(`     concepto de cobro para altas nuevas: ${p.concepto ?? "NINGUNO (se usaría el del taller)"}\n`);
  for (const m of p.mueve) process.stdout.write(`     → ${m.nombre}: de «${m.desde}»${m.conCuota ? " (cuota intacta)" : ""}\n`);
  for (const a of p.apunta) process.stdout.write(`     + ${a.nombre}: NO estaba inscrito${apuntar ? " → se apunta y se le abre cuota" : " → se queda fuera (sin --apuntar)"}\n`);
}

if (problemas.length) {
  process.stdout.write(`\n  ✗ NO SE PUEDE SEGUIR (${problemas.length}):\n`);
  for (const p of problemas) process.stdout.write(`     · ${p}\n`);
  process.stdout.write(`\n  Nada escrito.\n\n`);
  await sequelize.close(); await master.close(); process.exit(1);
}

/* ── Los que se quedan como están ────────────────────────────────────────── */
const fuera = inscripciones.filter((i) => !enExcel.has(i.patientId));
const porId = new Map(pacientes.map((p) => [p.id, p]));
process.stdout.write(`\n  SE QUEDAN COMO ESTÁN (${fuera.length}), porque no salen en el Excel de este curso:\n`);
const agr = new Map();
for (const i of fuera) {
  const k = `${nombreGrupo.get(i.grupoId) ?? "sin grupo"}${i.cuotaId ? " · con cuota" : " · sin cuota"}`;
  agr.set(k, (agr.get(k) ?? 0) + 1);
}
for (const [k, n] of agr) process.stdout.write(`     · ${n} en «${k}»\n`);
for (const i of fuera.filter((x) => x.cuotaId)) {
  const p = porId.get(i.patientId);
  process.stdout.write(`     ⚠ paga el taller y no está en ninguna tarde: ${p?.firstName} ${p?.lastName}\n`);
}

const totalMueve = plan.reduce((n, p) => n + p.mueve.length, 0);
const totalApunta = plan.reduce((n, p) => n + p.apunta.length, 0);
process.stdout.write(`\n  Resumen: ${plan.length} grupos · ${totalMueve} niños a mover · ${totalApunta} sin inscribir${apuntar ? " (se apuntan)" : ""}\n`);

if (!confirm) {
  process.stdout.write(`\n  En seco: nada escrito. Relanza con --confirm.\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

/* ═══ Escribir ═════════════════════════════════════════════════════════════ */

let creados = 0;
let movidos = 0;
let apuntados = 0;
for (const p of plan) {
  let grupo = await TallerGrupo.findOne({ where: { tallerId: taller.id, name: p.nombre } });
  if (!grupo) {
    grupo = await TallerGrupo.create({
      tallerId: taller.id,
      name: p.nombre,
      schedule: p.horario,
      duration: p.duracion,
      conceptId: p.concepto,
      active: true,
    });
    creados++;
  }
  await guardarTerapeutas({ tenantModels: models, grupo, ids: p.terapeutaIds, coordinaId: p.terapeutaIds[0] });
  const tipo = await asegurarTipoDeCitaDeGrupo({ tenantModels: models, taller, grupo });
  process.stdout.write(`\n  ✓ «${grupo.name}» · tipo de cita «${tipo?.name ?? "?"}»\n`);

  for (const m of p.mueve) {
    // SOLO el grupo. `cuota_id` no se toca: lo que paga la familia no cambia
    // porque el niño esté apuntado a otra tarde.
    await m.ins.update({ grupoId: grupo.id });
    movidos++;
    process.stdout.write(`     → ${m.nombre}\n`);
  }

  if (apuntar) {
    for (const a of p.apunta) {
      const ins = await TallerInscripcion.create({
        tallerId: taller.id,
        grupoId: grupo.id,
        patientId: a.paciente.id,
        joinedAt: new Date().toISOString().slice(0, 10),
      });
      const clientId = await clientIdOfPatient(models, a.paciente.id);
      const cuota = await asegurarCuotaDeTaller({ tenantModels: models, taller, grupo, patientId: a.paciente.id, clientId });
      if (cuota.cuotaId) await ins.update({ cuotaId: cuota.cuotaId });
      apuntados++;
      process.stdout.write(`     + ${a.nombre} · cuota ${cuota.cuotaId ? (cuota.creada ? "NUEVA" : "la que ya tenía") : `NO (${cuota.motivo ?? "?"})`}\n`);
    }
  }
}

process.stdout.write(`\n  Grupos creados: ${creados} · movidos: ${movidos} · apuntados: ${apuntados}\n\n`);
await sequelize.close();
await master.close();
