// @vivo — trae de Organízate los bloqueos de agenda que faltan en el CRM; se relanza cada vez que el centro cambia horarios allí.
/**
 * traer-bloqueos.mjs — trae de Organízate los bloqueos de agenda que en el CRM
 * no están (19/09/2026, Rodrigo, por AV-0209 de Aumenta).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── QUÉ HACE, Y SOBRE TODO QUÉ NO ──────────────────────────────────────────
 * SOLO CREA. No borra ni modifica nada: ni bloqueos, ni citas, ni lo que el
 * centro haya puesto a mano estos días. El sincronizador general
 * (`actualizar-agenda-organizate.js`) también borra lo que sobra, y eso aquí
 * no toca: el encargo es rellenar lo que falta.
 *
 * ── «QUE NO ESTÉ YA EN EL CRM» (Rodrigo) ───────────────────────────────────
 * Un bloqueo NO se crea si a esa persona ya le pisa esa franja cualquier cosa:
 *   · otro bloqueo que solape, aunque tenga otro texto o dure otro rato —el
 *     texto se retoca a menudo y crear otro encima dejaría el hueco doble—;
 *   · o una CITA no cancelada, porque entonces el hueco no está libre: allí se
 *     reservó y aquí se acabó dando hora, que es lo que queremos.
 * Solo se crea cuando en esa franja no hay absolutamente nada.
 *
 * Respaldo: escribe los ids creados en un JSON, y con `--deshacer <fichero>`
 * se borran exactamente esos.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QueryTypes } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterDb } from "../lib/db/masterDb.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const iDatos = args.indexOf("--datos");
const DATOS = iDatos >= 0 ? args[iDatos + 1] : null;
const iDeshacer = args.indexOf("--deshacer");
const DESHACER = iDeshacer >= 0 ? args[iDeshacer + 1] : null;
const iDesde = args.indexOf("--desde");
const DESDE = iDesde >= 0 ? args[iDesde + 1] : "2026-09-19";
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const SCHEMA = `crm_${SLUG}`;
const MARCA = "Importada de Organízate";

const { sequelize } = getTenantDb(SLUG);
const q = (sql, replacements) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
const out = (m = "") => process.stdout.write(m + "\n");

/** Agenda de Organízate → nombre de la ficha de equipo (el mismo mapa de siempre). */
const AGENDAS = {
  1: "Isabel Alberca Bolaños", 3: "Laura Barrionuevo Machota", 4: "Silvia Pérez Hernández",
  5: "Raquel Mesones Bernal", 7: "Raquel Torralbo Samper", 8: "Laura Fernández Mulero",
  10: "Elena Gutiérrez García", 11: "Lucía Gonzalez Encinar", 12: "Daniela de la Cruz Esteban",
  13: "Araceli Vigara Méndez", 14: "Blanca Márquez Bascón", 15: "Estefanía Bermejo Blázquez",
  17: "Isabel Vara Perea", 18: "Arantxa Garrote Ortega", 22: "Laura Garrido Rascón",
  23: "Cristina Calderón Moreno",
};

async function deshacer() {
  const r = JSON.parse(readFileSync(DESHACER, "utf8"));
  out(`Deshacer ${DESHACER}: ${r.ids.length} bloqueos creados el ${r.fecha}.`);
  if (!CONFIRM) return out("Ensayo: nada borrado. Añade --confirm.");
  await sequelize.query(`DELETE FROM ${SCHEMA}.team_blocks WHERE id IN (:ids)`, {
    replacements: { ids: r.ids },
  });
  out("✓ Deshecho.");
}

async function main() {
  if (DESHACER) return deshacer();
  if (!DATOS) { console.error("Falta --datos <fichero json>"); process.exit(1); }

  const volcado = JSON.parse(readFileSync(DATOS, "utf8"));
  out(`\nVolcado de ${String(volcado.extraido).slice(0, 16).replace("T", " ")} · ${volcado.reservas.length} reservas · ${volcado.rango.desde} → ${volcado.rango.hasta}`);
  out(CONFIRM ? "MODO ESCRITURA (solo CREA; no borra ni cambia nada)\n" : "ENSAYO: no se escribe nada\n");

  // Las fichas de equipo, por nombre
  const equipo = await q(`SELECT id, display_name FROM ${SCHEMA}.team_members`);
  const porNombre = new Map(equipo.map((t) => [t.display_name, t.id]));
  const sinFicha = new Map();

  // Lo que ya hay en el CRM, desde `DESDE`: bloqueos y citas vivas, en hora de Madrid
  const bloques = await q(`
    SELECT team_member_id AS tm,
           to_char(start_at AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD HH24:MI') AS ini,
           to_char(end_at   AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD HH24:MI') AS fin
      FROM ${SCHEMA}.team_blocks WHERE start_at >= :desde`, { desde: DESDE });
  const citas = await q(`
    SELECT team_member_id AS tm,
           to_char(scheduled_at AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD HH24:MI') AS ini,
           to_char((scheduled_at + make_interval(mins => COALESCE(duration, 60))) AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD HH24:MI') AS fin
      FROM ${SCHEMA}.bookings
     WHERE scheduled_at >= :desde AND status::text <> 'cancelled' AND team_member_id IS NOT NULL`, { desde: DESDE });

  /** Por persona y día, los tramos ocupados en minutos desde medianoche. */
  const ocupado = new Map();
  const mete = (tm, ini, fin, tipo) => {
    if (!tm) return;
    const [dia, hora] = ini.split(" ");
    const [dia2, hora2] = fin.split(" ");
    const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const desde = min(hora);
    const hasta = dia2 === dia ? min(hora2) : 24 * 60;
    const k = `${tm}|${dia}`;
    if (!ocupado.has(k)) ocupado.set(k, []);
    ocupado.get(k).push([desde, Math.max(hasta, desde + 1), tipo]);
  };
  for (const b of bloques) mete(b.tm, b.ini, b.fin, "bloqueo");
  for (const c of citas) mete(c.tm, c.ini, c.fin, "cita");
  out(`En el CRM desde ${DESDE}: ${bloques.length} bloqueos y ${citas.length} citas vivas.`);

  const aCrear = [];
  const tapadas = { bloqueo: 0, cita: 0 };
  const vistos = new Set();
  for (const r of volcado.reservas) {
    if (r.fecha < DESDE) continue;
    const nombre = AGENDAS[Number(r.idEmp)];
    const tm = nombre ? porNombre.get(nombre) : null;
    if (!tm) { sinFicha.set(r.idEmp, (sinFicha.get(r.idEmp) ?? 0) + 1); continue; }
    const dur = Number(r.dur) || 15;
    const min = Number(r.hora.slice(0, 2)) * 60 + Number(r.hora.slice(3, 5));
    const k = `${tm}|${r.fecha}|${r.hora}|${dur}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const tramos = ocupado.get(`${tm}|${r.fecha}`) ?? [];
    const choque = tramos.find(([a, b]) => min < b && min + dur > a);
    if (choque) { tapadas[choque[2]]++; continue; }
    aCrear.push({
      tm, fecha: r.fecha, hora: r.hora, dur, idRes: r.idRes,
      label: String(r.texto || "Reservado").slice(0, 120),
      nombre,
    });
    tramos.push([min, min + dur, "bloqueo"]);
    ocupado.set(`${tm}|${r.fecha}`, tramos);
  }

  out(`\n── LO QUE FALTA ─────────────────────────────────────────`);
  out(`  Reservas de Organízate desde ${DESDE}          ${vistos.size}`);
  out(`  Ya cubiertas por un bloqueo del CRM            ${tapadas.bloqueo}`);
  out(`  Ya cubiertas por una CITA (el hueco se dio)    ${tapadas.cita}`);
  out(`  SE CREAN (no hay nada en esa franja)           ${aCrear.length}`);
  if (sinFicha.size) out(`  ⚠️  Agendas sin ficha de equipo: ${[...sinFicha.entries()].map(([k, v]) => `emp${k} (${v})`).join(", ")}`);

  const porMes = new Map(), porQuien = new Map();
  for (const c of aCrear) {
    porMes.set(c.fecha.slice(0, 7), (porMes.get(c.fecha.slice(0, 7)) ?? 0) + 1);
    porQuien.set(c.nombre, (porQuien.get(c.nombre) ?? 0) + 1);
  }
  out("\n  Por mes:");
  for (const [m, n] of [...porMes].sort()) out(`    ${m}: ${n}`);
  out("\n  Por persona:");
  for (const [p, n] of [...porQuien].sort((a, b) => b[1] - a[1])) out(`    ${String(p).padEnd(28)} ${n}`);
  out("\n  Muestra:");
  for (const c of aCrear.slice(0, 6)) out(`    ${c.fecha} ${c.hora} ${String(c.dur).padStart(3)}' · ${c.nombre} · ${c.label.slice(0, 40)}`);

  if (!CONFIRM) { out("\nENSAYO: no se ha escrito nada. Con --confirm se crean.\n"); return; }
  if (!aCrear.length) { out("\nNo hay nada que crear.\n"); return; }

  const notes = `${MARCA} · reserva del planning · traída el ${new Date().toISOString().slice(0, 10)}`;
  const ids = [];
  for (let i = 0; i < aCrear.length; i += 200) {
    const lote = aCrear.slice(i, i + 200);
    const valores = lote
      .map((_, j) => `(gen_random_uuid(), :tm${j}, (:ini${j})::timestamp AT TIME ZONE 'Europe/Madrid', ((:ini${j})::timestamp + make_interval(mins => :dur${j})) AT TIME ZONE 'Europe/Madrid', :label${j}, :notes, now(), now())`)
      .join(", ");
    const repl = { notes };
    lote.forEach((c, j) => {
      repl[`tm${j}`] = c.tm;
      repl[`ini${j}`] = `${c.fecha} ${c.hora}`;
      repl[`dur${j}`] = c.dur;
      repl[`label${j}`] = c.label;
    });
    const filas = await sequelize.query(
      `INSERT INTO ${SCHEMA}.team_blocks (id, team_member_id, start_at, end_at, label, notes, created_at, updated_at)
       VALUES ${valores} RETURNING id`,
      { replacements: repl, type: QueryTypes.INSERT },
    );
    for (const f of filas[0] ?? []) ids.push(f.id);
    out(`  … ${Math.min(i + 200, aCrear.length)}/${aCrear.length}`);
  }

  const fichero = `/tmp/bloqueos-traidos-${Date.now()}.json`;
  writeFileSync(fichero, JSON.stringify({ slug: SLUG, fecha: new Date().toISOString(), ids }));
  out(`\n✓ Creados ${ids.length} bloqueos. Respaldo para deshacer: ${fichero}`);

  const master = getMasterDb();
  const [tenant] = await master.query("SELECT id FROM master.tenants WHERE slug = :slug", {
    replacements: { slug: SLUG }, type: QueryTypes.SELECT,
  });
  await auditar({
    tenantId: tenant?.id ?? null,
    userEmail: "mantenimiento",
    action: "team_block.importados",
    entity: "TeamBlock",
    entityId: null,
    after: { creados: ids.length, desde: DESDE, origen: "planning de Organízate", volcado: volcado.extraido, respaldo: fichero },
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
