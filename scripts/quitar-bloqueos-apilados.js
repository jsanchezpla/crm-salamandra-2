// @vivo — Rescate: varios bloqueos de la misma persona a la misma hora exacta dejan uno. Solo quita los que NO tienen rótulo propio. En seco por defecto.
/**
 * quitar-bloqueos-apilados.js — el hueco que se ve blanco porque tiene ocho
 * cajas encima (09/09/2026, AV-0054).
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * Daniela: «el viernes falta poner el DESCANSO, que es el hueco blanco que
 * queda de 15:30 a 15:45». Y el descanso estaba: lo que pasaba es que ese
 * viernes concreto tenía OCHO bloqueos apilados en el mismo cuarto de hora
 * —siete sin rótulo y el DESCANSO de verdad—, y ocho cajas de quince minutos
 * una encima de otra se reparten el ancho hasta no leerse. Los otros 39
 * viernes del curso tienen uno solo.
 *
 * ── LA REGLA, QUE ES CONSERVADORA A PROPÓSITO ──────────────────────────────
 * De un hueco con varios bloqueos de la MISMA persona, a la MISMA hora exacta
 * y de la MISMA categoría, se quitan **solo los que no tienen rótulo propio**,
 * y solo si queda al menos uno. Nunca se borra un bloqueo con texto: dos
 * motivos distintos a la misma hora puede ser un lío del centro, pero es SU
 * lío y lo tienen que ver ellas para decidir. Aquí solo se va lo que no dice
 * nada y está repetido.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/quitar-bloqueos-apilados.js <slug>
 *   … --confirm    borra
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { logCitasAudit } from "../lib/citas/audit.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));
const confirm = flags.has("--confirm");

function die(m) { process.stderr.write(`\n✗ ${m}\n\n`); process.exit(1); }
if (!slug) die("Falta el slug.\n  Uso: scripts/quitar-bloqueos-apilados.js <slug> [--confirm]");

const texto = (v) => (typeof v === "string" ? v.trim() : "");
const fecha = (d) => new Date(d).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const { sequelize, models } = getTenantDb(slug);
const { TeamBlock, TeamMember } = models;
if (!TeamBlock) die(`${slug} no tiene agenda.`);

const bloques = await TeamBlock.findAll({
  where: { teamMemberId: { [sequelize.Sequelize.Op.ne]: null } },
  attributes: ["id", "label", "startAt", "endAt", "teamMemberId", "categoryKey", "notes", "tallerId", "patientId"],
  order: [["startAt", "ASC"], ["created_at", "ASC"]],
});
const equipo = new Map((await TeamMember.findAll({ attributes: ["id", "displayName"], raw: true })).map((m) => [String(m.id), m.displayName]));

const huecos = new Map();
for (const b of bloques) {
  const k = [String(b.teamMemberId), new Date(b.startAt).toISOString(), new Date(b.endAt).toISOString(), b.categoryKey ?? ""].join("|");
  if (!huecos.has(k)) huecos.set(k, []);
  huecos.get(k).push(b);
}

const sobran = [];
const seQuedan = [];
for (const [, lista] of huecos) {
  if (lista.length < 2) continue;
  const conRotulo = lista.filter((b) => texto(b.label));
  const sinRotulo = lista.filter((b) => !texto(b.label));

  // Si NINGUNO tiene rótulo, se conserva el primero y se van los demás.
  const aQuitar = conRotulo.length ? sinRotulo : sinRotulo.slice(1);
  // Y un bloqueo sin rótulo pero con algo dentro (una nota, un taller, un
  // paciente) tampoco se toca: no está vacío, solo no tiene título.
  const seguros = aQuitar.filter((b) => !texto(b.notes) && !b.tallerId && !b.patientId);

  const quien = equipo.get(String(lista[0].teamMemberId)) ?? "?";
  const donde = `${quien} · ${fecha(lista[0].startAt)}`;
  if (seguros.length) sobran.push(...seguros.map((b) => ({ b, donde })));
  const quedan = lista.length - seguros.length;
  if (conRotulo.length > 1) seQuedan.push({ donde, porQue: `${conRotulo.length} bloqueos con texto propio: los dejo, que lo miren ellas`, quedan });
}

process.stdout.write(`\n${slug} · bloqueos apilados${confirm ? "" : "  (EN SECO)"}\n\n`);
const porHueco = new Map();
for (const s of sobran) porHueco.set(s.donde, (porHueco.get(s.donde) ?? 0) + 1);
for (const [donde, n] of porHueco) process.stdout.write(`  → ${donde}: ${n} sin rótulo de sobra\n`);
for (const s of seQuedan) process.stdout.write(`  ? ${s.donde}: ${s.porQue}\n`);
process.stdout.write(`\n  a quitar: ${sobran.length}\n`);

if (!sobran.length || !confirm) {
  process.stdout.write(`\n  ${sobran.length ? "En seco: nada borrado. Relanza con --confirm." : "Nada que quitar."}\n\n`);
  await sequelize.close(); await master.close(); process.exit(0);
}

let hechas = 0;
for (const { b, donde } of sobran) {
  try {
    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.bloqueo_deleted",
      entity: "TeamBlock",
      entityId: b.id,
      before: { startAt: b.startAt, endAt: b.endAt, categoryKey: b.categoryKey, motivo: "apilado sin rótulo sobre otro igual" },
    });
    await b.destroy();
    hechas += 1;
  } catch (err) {
    process.stdout.write(`  ✗ ${donde}: ${err.message}\n`);
  }
}
process.stdout.write(`\n  Quitados: ${hechas} de ${sobran.length}\n\n`);
await sequelize.close();
await master.close();
