/**
 * import-harbiz-recetas.js — las 1.083 recetas de Harbiz al Recetario.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── De dónde salen ─────────────────────────────────────────────────────────
 *
 * Harbiz es una app Meteor: los datos no viajan por HTTP sino por WebSocket,
 * así que no hay API que raspar. Se capturó la llamada que hace su propia pantalla
 * (`recipes.getRecipes`) y se pidieron las 1.083 en tandas de 100, verificando
 * que los ids únicos coincidieran con el total que declara Harbiz. El volcado
 * vive en `migracion-harbiz/harbiz-recetas.json`, FUERA del repositorio: es el
 * trabajo de años de Laura, no código.
 *
 * Harbiz quedó en SOLO LECTURA. Sus métodos de escritura existen y no se han
 * tocado.
 *
 * ── Los alimentos, que es la parte delicada ────────────────────────────────
 *
 * Cada receta trae sus ingredientes con macros por 100 g. Son 5.842 líneas y
 * 640 alimentos distintos, contra los 499 que ya tiene Laura. El cruce es por
 * nombre EXACTO y por singular/plural, y nada más:
 *
 *   Un cruce por parecido proponía «Setas»↔«Seitán», «Batata»↔«Patata» y
 *   «Pisto»↔«Pesto». En un catálogo de nutrición eso no es un typo, es cambiarle
 *   la comida a alguien.
 *
 * Las marcas se conservan («Copos de Avena - Mercadona») y se etiquetan como
 * `marca`, para poder archivarlas de golpe si molestan. Quitarles la marca
 * juntaría productos con macros distintas.
 *
 * Dentro de Harbiz hay 108 alimentos con el mismo nombre y varias fichas
 * («Aceite de Oliva» tiene tres, con 474 usos). Se fusionan quedándose con la
 * MÁS USADA, y las que traen macros distintas se listan al final: hay alguna
 * mal, como una miel a 64 kcal.
 *
 * Uso:
 *   node --env-file=.env.local scripts/import-harbiz-recetas.js
 *   docker exec crm-salamandra-app-1 node scripts/import-harbiz-recetas.js --confirm
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "nutri_laura";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-harbiz";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Plural→singular del castellano, y solo eso: «champiñones» → «champiñon». */
const sinPlural = (s) => norm(s).split(" ")
  .map((p) => (p.length > 4 && /(es|s)$/.test(p) ? p.replace(/es$|s$/, "") : p)).join(" ");

const cap = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** «15:30» → 15 · «:50» → 0 · «00:00» → null (Harbiz guarda mm:ss). */
function minutos(d) {
  if (!d || typeof d !== "string") return null;
  const m = d.match(/^(\d*):(\d{2})$/);
  if (!m) return null;
  const min = Number(m[1] || 0);
  return min > 0 ? min : null;
}

/** Redondea a 2 decimales o null. Las macros de Harbiz vienen por 100 g. */
const dec = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` RECETAS DE HARBIZ → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(64)}\n`);

  const recetas = JSON.parse(readFileSync(path.join(DATOS, "harbiz-recetas.json"), "utf8"));
  console.log(`Leídas del volcado: ${recetas.length} recetas\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  // ── 1. El catálogo de alimentos que ya existe ───────────────────────────
  const yaHay = await m.Food.findAll({ attributes: ["id", "name", "archivedAt"] });
  const activos = yaHay.filter((f) => !f.archivedAt);
  const porExacto = new Map(), porSingular = new Map();
  for (const f of activos) {
    porExacto.set(norm(f.name), f);
    if (!porSingular.has(sinPlural(f.name))) porSingular.set(sinPlural(f.name), f);
  }

  // ── 2. Los alimentos de Harbiz, agrupados por NOMBRE ────────────────────
  const deHarbiz = new Map();
  for (const r of recetas) {
    for (const i of r.ingredientes ?? []) {
      const k = norm(i.nombre);
      if (!k) continue;
      if (!deHarbiz.has(k)) deHarbiz.set(k, { nombre: cap(i.nombre), variantes: [] });
      deHarbiz.get(k).variantes.push(i);
    }
  }
  // De cada grupo manda la variante MÁS USADA.
  const macrosDudosas = [];
  for (const [, g] of deHarbiz) {
    const porFicha = new Map();
    for (const v of g.variantes) {
      const k = v.id;
      if (!porFicha.has(k)) porFicha.set(k, { ...v, usos: 0 });
      porFicha.get(k).usos++;
    }
    const orden = [...porFicha.values()].sort((a, b) => b.usos - a.usos);
    g.elegida = orden[0];
    g.usos = g.variantes.length;
    if (orden.length > 1) {
      const firmas = new Set(orden.map((o) => JSON.stringify(o.por100)));
      // Solo se avisa cuando la diferencia es GORDA: 4,05 vs 4 de proteína es
      // redondeo, una miel a 64 kcal en vez de 304 es un dato malo.
      const energias = orden.map((o) => o.por100?.energia).filter((x) => x != null);
      const disparidad = energias.length > 1 && (Math.max(...energias) - Math.min(...energias)) > Math.max(...energias) * 0.15;
      if (firmas.size > 1 && disparidad) {
        macrosDudosas.push({ nombre: g.nombre, opciones: orden.map((o) => `${o.usos} usos → ${o.por100?.energia} kcal`) });
      }
    }
  }

  // ── 3. Qué alimentos hay que crear ──────────────────────────────────────
  const aCrear = [], reutilizados = new Map();  // clave normalizada → Food existente
  for (const [k, g] of deHarbiz) {
    const ya = porExacto.get(k) ?? porSingular.get(sinPlural(g.nombre));
    if (ya) { reutilizados.set(k, ya); continue; }
    aCrear.push(g);
  }
  const conMarca = aCrear.filter((g) => / - /.test(g.nombre));

  // ── 4. Recuento antes de tocar nada ─────────────────────────────────────
  const yaImportadas = new Set(
    (await m.Recipe.findAll({ attributes: ["name"] })).map((r) => norm(r.name))
  );
  const lineasTotales = recetas.reduce((a, r) => a + (r.ingredientes?.length ?? 0), 0);

  console.log("── ALIMENTOS ─────────────────────────────────────────────────\n");
  console.log(`  En el catálogo de Laura (activos)  ${String(activos.length).padStart(5)}`);
  console.log(`  Distintos en Harbiz                ${String(deHarbiz.size).padStart(5)}`);
  console.log(`  …ya existen, se reutilizan         ${String(reutilizados.size).padStart(5)}`);
  console.log(`  …se crean nuevos                   ${String(aCrear.length).padStart(5)}   ${conMarca.length} con marca en el nombre\n`);

  console.log("── RECETAS ───────────────────────────────────────────────────\n");
  console.log(`  A importar                         ${String(recetas.length).padStart(5)}`);
  console.log(`  …con un nombre que ya existe       ${String(recetas.filter((r) => yaImportadas.has(norm(r.nombre))).length).padStart(5)}   se saltan`);
  console.log(`  Líneas de ingrediente              ${String(lineasTotales).padStart(5)}`);
  console.log(`  Con foto en Harbiz                 ${String(recetas.filter((r) => r.imagen).length).padStart(5)}   las trae el script de fotos`);
  console.log(`  Con duración                       ${String(recetas.filter((r) => minutos(r.duracion)).length).padStart(5)}`);
  const tipos = recetas.reduce((a, r) => { a[r.tipo ?? "—"] = (a[r.tipo ?? "—"] ?? 0) + 1; return a; }, {});
  console.log(`  Por tipo: ${Object.entries(tipos).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);

  if (macrosDudosas.length) {
    console.log(`  ⚠ ${macrosDudosas.length} alimento(s) con macros muy dispares en Harbiz. Se coge la más usada:`);
    for (const d of macrosDudosas.slice(0, 8)) console.log(`      ${d.nombre}: ${d.opciones.join("  |  ")}`);
    console.log("");
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(64)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(64)}\n`);
    process.exit(0);
  }

  // ── 5. Escritura ────────────────────────────────────────────────────────
  console.log("⚠️  Escribiendo…\n");
  let alimentosNuevos = 0, recetasNuevas = 0, saltadas = 0, lineas = 0, sinAlimento = 0;

  await sequelize.transaction(async (t) => {
    // 5.1 Alimentos que faltan.
    for (const g of aCrear) {
      const p = g.elegida.por100 ?? {};
      const food = await m.Food.create({
        name: g.nombre,
        slug: norm(g.nombre).replace(/ /g, "-").slice(0, 120),
        defaultUnit: "g",
        proteinPer100: dec(p.prot),
        carbsPer100: dec(p.carbs),
        fatPer100: dec(p.grasa),
        fiberPer100: dec(p.fibra),
        source: "custom",
        // `marca` permite archivarlos de golpe, igual que se hizo con los 2.924
        // de OpenFoodFacts. `harbiz` deja constancia de de dónde salieron.
        tags: / - /.test(g.nombre) ? ["harbiz", "marca"] : ["harbiz"],
      }, { transaction: t });
      reutilizados.set(norm(g.nombre), food);
      alimentosNuevos++;
    }

    // 5.2 Recetas.
    for (const r of recetas) {
      if (yaImportadas.has(norm(r.nombre))) { saltadas++; continue; }
      yaImportadas.add(norm(r.nombre));

      const receta = await m.Recipe.create({
        name: cap(r.nombre).slice(0, 255),
        description: r.descripcion || null,
        steps: [],
        recipeType: r.tipo || null,
        tags: (r.tags ?? []).map(cap).filter(Boolean),
        allergens: r.alergenos ?? [],
        dietaryPreferences: r.preferencias ?? [],
        durationMinutes: minutos(r.duracion),
        rations: r.raciones ?? null,
      }, { transaction: t });

      let orden = 0;
      for (const i of r.ingredientes ?? []) {
        const food = reutilizados.get(norm(i.nombre));
        if (!food) { sinAlimento++; continue; }
        await m.RecipeFood.create({
          recipeId: receta.id,
          foodId: food.id,
          amount: dec(i.cantidad),
          unit: "g",
          ordering: orden++,
        }, { transaction: t });
        lineas++;
      }
      recetasNuevas++;
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Alimentos creados     ${String(alimentosNuevos).padStart(5)}`);
  console.log(`  Recetas creadas       ${String(recetasNuevas).padStart(5)}   (${saltadas} ya estaban)`);
  console.log(`  Líneas de ingrediente ${String(lineas).padStart(5)}${sinAlimento ? `   ⚠ ${sinAlimento} sin alimento que enlazar` : ""}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
