/**
 * import-aumenta-tipos-cita.js — los 56 tipos de cita reales de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Al importar la agenda, las 12.030 citas se colgaron TODAS de un tipo
 * inventado, «Sesión (importada)», porque los tipos reales no estaban. Rodrigo
 * lo vio enseguida: en el CRM seguían los tres de ejemplo.
 *
 * Organízate tiene 56 tratamientos con su nombre y su precio: «CUOTA LOGOPEDIA
 * 45», «LOGOPEDIA 60 · 60,00 €», «CUOTA TERAPIA OCUPACIONAL 45 X 2 SS
 * SEMANALES»… Ese es el catálogo de verdad.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────
 *
 * 1. Crea un `EventType` por tratamiento, con su duración y su precio.
 * 2. Reasigna cada cita a su tipo real, cruzando por el texto del servicio que
 *    la cita ya lleva guardado en `additionalData`.
 * 3. Deja «Sesión (importada)» solo si queda alguna cita sin tipo reconocible.
 *
 * NO toca los tres tipos de ejemplo del CRM: eso lo decide Rodrigo.
 *
 * Uso:
 *   node scripts/import-aumenta-tipos-cita.js            → simulación
 *   node scripts/import-aumenta-tipos-cita.js --confirm  → escribe
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const TIPO_IMPORTADO = "Sesión (importada)";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();

/** «CUOTA LOGOPEDIA 45» → 45 minutos. Los valores reales son 30/45/60. */
function duracion(nombre) {
  const m = String(nombre ?? "").match(/\b(30|45|60|90)\b/);
  return m ? Number(m[1]) : 45;
}

/** «50,00 €» → 50. Muchos tratamientos van a 0: la tarifa está en el bono. */
function precio(txt) {
  const t = String(txt ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}

/** Slug estable a partir del nombre. */
function slugDe(nombre) {
  return norm(nombre).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Departamento al que pertenece el tratamiento, para agrupar. */
function especialidad(nombre) {
  const g = norm(nombre);
  if (/H\.?H\.?\.?S\.?S|HABILIDADES SOCIALES/.test(g)) return "habilidades_sociales";
  if (/NEUROPSICOLOG/.test(g)) return "neuropsicologia";
  if (/LOGOPEDIA|LOGOPEDIC/.test(g)) return "logopedia";
  if (/PSICOLOG/.test(g)) return "psicologia";
  if (/PEDAGOG/.test(g)) return "pedagogia";
  if (/FISIOTERAPIA|FISIO/.test(g)) return "fisioterapia";
  if (/TERAPIA OCUPACIONAL|T\.\s?OCUPACIONAL/.test(g)) return "terapia_ocupacional";
  return null;
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` TIPOS DE CITA DE AUMENTA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const fichero = JSON.parse(readFileSync(path.join(DATOS, "organizate-tratamientos.json"), "utf8"));
  const filas = fichero.bloques.find((b) => b.clave === "s6_tratamientos")?.filas ?? [];
  const tratamientos = filas
    .map((f) => ({ nombre: cap(f[1]), importe: precio(f[2]) }))
    .filter((t) => t.nombre);

  console.log(`Tratamientos en Organízate: ${tratamientos.length}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  // ── Cuántas citas cruzarían con cada tratamiento ────────────────────────
  const citas = await m.Booking.findAll({ attributes: ["id", "additionalData", "eventTypeId"] });
  const porTratamiento = new Map(tratamientos.map((t) => [norm(t.nombre), 0]));
  let sinCruce = 0;
  const noCruzan = new Map();

  const servicioDe = (b) => {
    const m2 = String(b.additionalData ?? "").match(/·\s*(.+)$/);
    return m2 ? cap(m2[1]).replace(/\s*Imprimir\s*$/i, "") : null;
  };

  for (const b of citas) {
    const serv = servicioDe(b);
    const k = serv ? norm(serv) : null;
    if (k && porTratamiento.has(k)) porTratamiento.set(k, porTratamiento.get(k) + 1);
    else { sinCruce++; if (serv) noCruzan.set(k, (noCruzan.get(k) ?? 0) + 1); }
  }

  const conCitas = [...porTratamiento.entries()].filter(([, n]) => n > 0);
  const porEsp = {};
  for (const t of tratamientos) {
    const e = especialidad(t.nombre) ?? "(sin departamento)";
    porEsp[e] = (porEsp[e] ?? 0) + 1;
  }

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Tipos de cita nuevos      ${String(tratamientos.length).padStart(6)}`);
  console.log(`  …con citas que reasignar  ${String(conCitas.length).padStart(6)}`);
  console.log(`  Citas totales             ${String(citas.length).padStart(6)}`);
  console.log(`  …que encuentran su tipo   ${String(citas.length - sinCruce).padStart(6)}`);
  console.log(`  …sin tipo reconocible     ${String(sinCruce).padStart(6)}\n`);
  console.log("  Tratamientos por departamento:");
  for (const [k, v] of Object.entries(porEsp).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${String(v).padStart(4)}`);
  }
  if (noCruzan.size) {
    console.log(`\n  Servicios de las citas que NO casan con ningún tratamiento (${noCruzan.size}):`);
    [...noCruzan.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([n, c]) => console.log(`    ${String(c).padStart(5)} ×  ${n ?? "(sin servicio)"}`));
  }
  console.log("");

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  let creados = 0, yaEstaban = 0, reasignadas = 0;

  await sequelize.transaction(async (t) => {
    const idPorNombre = new Map();
    for (const tr of tratamientos) {
      const ya = await m.EventType.findOne({ where: { name: tr.nombre }, transaction: t });
      if (ya) { idPorNombre.set(norm(tr.nombre), ya.id); yaEstaban++; continue; }
      const et = await m.EventType.create({
        name: tr.nombre,
        slug: slugDe(tr.nombre),
        duration: duracion(tr.nombre),
        description: `Importado de Organízate${tr.importe ? ` · ${tr.importe} €` : ""}`,
        active: true,
      }, { transaction: t });
      idPorNombre.set(norm(tr.nombre), et.id);
      creados++;
    }

    for (const b of citas) {
      const serv = servicioDe(b);
      const destino = serv ? idPorNombre.get(norm(serv)) : null;
      if (!destino || destino === b.eventTypeId) continue;
      await m.Booking.update({ eventTypeId: destino }, { where: { id: b.id }, transaction: t });
      reasignadas++;
    }

    // El tipo provisional solo se va si ya no lo usa nadie.
    const provisional = await m.EventType.findOne({ where: { name: TIPO_IMPORTADO }, transaction: t });
    if (provisional) {
      const quedan = await m.Booking.count({ where: { eventTypeId: provisional.id }, transaction: t });
      if (quedan === 0) {
        await provisional.destroy({ transaction: t });
        console.log(`  · «${TIPO_IMPORTADO}» eliminado: ya no lo usa ninguna cita`);
      } else {
        console.log(`  · «${TIPO_IMPORTADO}» se queda: aún lo usan ${quedan} cita(s) sin tipo reconocible`);
      }
    }
  });

  console.log("\n── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Tipos de cita creados  ${String(creados).padStart(6)}   (${yaEstaban} ya existían)`);
  console.log(`  Citas reasignadas      ${String(reasignadas).padStart(6)}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
