import PDFDocument from "pdfkit";
import { computeOptionMacros, computeRecipeMacros } from "./macros.js";
import { readRecipePhotoBuffer } from "./recipePhotoStorage.js";

/**
 * PDF del menú semanal — la ÚNICA vista que recibe el paciente (no hay portal:
 * se le manda por email como adjunto). Rediseño 2026-07-22 en TRES partes:
 *
 *   1. PORTADA HORIZONTAL — el calendario de la semana entera de un vistazo:
 *      cuadrícula 7 días × 5 comidas. Es la hoja que el paciente cuelga en la
 *      nevera.
 *   2. DÍAS DETALLADOS (vertical) — lo mismo que ve la nutricionista al editar
 *      un día: cada comida con sus recetas, sus alimentos y sus comentarios.
 *      Se reparten 2 días por página (Lun-Mar, Mié-Jue) y 3 en la última
 *      (Vie-Sáb-Dom); si un día trae mucho contenido, pdfkit añade página.
 *   3. RECETARIO — al final, cada receta USADA en la semana explicada al
 *      detalle: foto, ingredientes con cantidades y pasos de preparación.
 *      Sin repetir: una receta usada tres veces se explica una sola vez.
 *
 * Datos:
 *   - plan:   árbol de `loadPlanTree` (meals → options → foods + recipes). Las
 *             comidas llevan `weekday` (1=Lunes…7=Domingo) y las recetas traen
 *             photoPath/steps EN VIVO de la receta original.
 *   - client: { name } del paciente (null en plantillas).
 *   - tenantName / brand: cabecera y color de acento.
 *   - tenantSlug: para leer las fotos de disco (sin él, PDF sin fotos).
 *
 * Planes SIN días (menús anteriores al rework de la semana) se imprimen como
 * lista plana, igual que siempre: sin calendario no hay portada que llenar.
 */

const NUM = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
function fmtNum(n) {
  return NUM.format(Number(n || 0));
}

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

const WEEKDAY_NAMES = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

// Orden canónico de las 5 grandes comidas (las que siembra POST /plans).
const MEAL_ORDER = ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena"];

// Reparto de días por página en la parte 2 (petición explícita de producto).
const DAY_PAGES = [
  [1, 2],
  [3, 4],
  [5, 6, 7],
];

const INK = "#1F2937";
const MUTED = "#6B7280";
const LIGHT = "#9CA3AF";
const HAIRLINE = "#E5E7EB";

// Texto de cantidad de una línea de alimento / ingrediente, espejando cómo lo
// pinta el editor: g → "150 g"; medida casera → "2 taza(s)" (+ gramos aprox.
// si hay equivalencia); libre → las notas o "cantidad libre".
function amountLabel(line) {
  if (line.unit === "g") return `${fmtNum(line.amount)} g`;
  if (line.unit === "household") {
    const label = line.householdLabel || "ud.";
    const grams = line.householdGrams
      ? ` (~${fmtNum(Number(line.amount) * Number(line.householdGrams))} g)`
      : "";
    return `${fmtNum(line.amount)} ${label}${grams}`;
  }
  return line.notes ? String(line.notes) : "cantidad libre";
}

function foodLineText(line) {
  const name = line.food?.name || "Alimento";
  const qty = amountLabel(line);
  // En unit=free las notas YA son la cantidad; no repetirlas como apunte.
  const note = line.unit !== "free" && line.notes ? ` — ${line.notes}` : "";
  return `${name} · ${qty}${note}`;
}

function servingsLabel(servings) {
  const n = Number(servings || 1);
  return `${fmtNum(n)} ${n === 1 ? "ración" : "raciones"}`;
}

function macrosText(option) {
  const m = computeOptionMacros(option);
  const parts = [];
  if (m.protein != null) parts.push(`P ${fmtNum(m.protein)} g`);
  if (m.carbs != null) parts.push(`H ${fmtNum(m.carbs)} g`);
  if (m.fat != null) parts.push(`G ${fmtNum(m.fat)} g`);
  if (m.fiber != null) parts.push(`Fibra ${fmtNum(m.fiber)} g`);
  return parts.length ? parts.join("  ·  ") : null;
}

// ¿El nombre de la opción es el genérico autogenerado ("Opción 1")? En ese
// caso no se muestra junto al ordinal de posición.
function isGenericOptionName(name) {
  return /^opción\s*\d+$/i.test((name || "").trim());
}

function optionHasContent(option) {
  return (option.foods || []).length > 0 || (option.recipes || []).length > 0;
}
function mealHasContent(meal) {
  return (meal.options || []).some(optionHasContent);
}

// Salta de página si no quedan al menos `px` de alto útil (evita títulos
// huérfanos al pie).
function ensureSpace(doc, px) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - px) doc.addPage();
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

export function menuPdfFilename(plan, client) {
  const base = (client?.name || plan.name || "menu")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `menu-${base || "plan"}.pdf`;
}

/**
 * Pre-carga las fotos de receta a Buffers (pdfkit las embebe en síncrono).
 * Best-effort: una foto que falte en disco no tumba el PDF.
 */
async function loadPhotoBuffers(plan, tenantSlug) {
  const buffers = new Map();
  if (!tenantSlug) return buffers;
  const paths = new Set();
  for (const meal of plan.meals || []) {
    for (const option of meal.options || []) {
      for (const recipe of option.recipes || []) {
        if (recipe.photoPath) paths.add(recipe.photoPath);
      }
    }
  }
  for (const p of paths) {
    try {
      buffers.set(p, await readRecipePhotoBuffer(tenantSlug, p));
    } catch {
      /* foto ausente o ilegible: el PDF sale sin ella */
    }
  }
  return buffers;
}

/**
 * Recetas ÚNICAS usadas en toda la semana, en orden de aparición. La clave es
 * el recipeId (provenance) y, si se perdió, el nombre congelado: dos usos de
 * la misma receta no deben explicarse dos veces en el recetario final.
 */
function collectUsedRecipes(plan) {
  const byKey = new Map();
  for (const meal of plan.meals || []) {
    for (const option of meal.options || []) {
      for (const r of option.recipes || []) {
        const key = r.recipeId || `name:${r.nameSnapshot || ""}`;
        if (!byKey.has(key)) byKey.set(key, r);
      }
    }
  }
  return [...byKey.values()];
}

/** Comidas de un día, en el orden canónico de las 5 grandes secciones. */
function mealsOfDay(meals, day) {
  const list = meals.filter((m) => (m.weekday ?? 0) === day);
  return list.slice().sort((a, b) => {
    const ia = MEAL_ORDER.indexOf(a.name);
    const ib = MEAL_ORDER.indexOf(b.name);
    // Los nombres fuera del canon (comidas antiguas a medida) van al final.
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

export async function buildMenuPdfBuffer({ plan, client, tenantName, brand, tenantSlug }) {
  const photoBuffers = await loadPhotoBuffers(plan, tenantSlug);
  return new Promise((resolve, reject) => {
    try {
      const meals = (plan.meals || []).filter(mealHasContent);
      const hasWeek = meals.some((m) => m.weekday != null);
      // Con semana → la PRIMERA página es la portada-calendario en horizontal.
      const doc = new PDFDocument(
        hasWeek
          ? { size: "A4", layout: "landscape", margins: { top: 40, bottom: 40, left: 40, right: 40 } }
          : { size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } }
      );
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      renderMenu(doc, {
        plan,
        meals,
        hasWeek,
        client,
        tenantName,
        brand: brand || {},
        photoBuffers,
      });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderMenu(doc, ctx) {
  const { plan, meals, hasWeek, tenantName } = ctx;
  const primary = ctx.brand.primaryColor || "#1B3A2D";
  ctx.primary = primary;

  if (!hasWeek) {
    // Plan sin días (menú antiguo): render plano de siempre.
    renderPlainHeader(doc, ctx);
    if (meals.length === 0) {
      doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Este plan aún no tiene comidas.");
    }
    for (const meal of meals) renderMealDetail(doc, meal, ctx);
    renderRecipeBook(doc, ctx);
    renderFooter(doc, tenantName);
    return;
  }

  // ── PARTE 1 — Portada horizontal con el calendario semanal ────────────────
  renderCoverCalendar(doc, ctx);

  // ── PARTE 2 — Días detallados, en vertical ────────────────────────────────
  for (const group of DAY_PAGES) {
    const groupDays = group.filter((d) => mealsOfDay(meals, d).length > 0);
    if (groupDays.length === 0) continue;
    doc.addPage({ size: "A4", layout: "portrait", margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    for (const day of groupDays) renderDayDetail(doc, day, ctx);
  }

  // Comidas que quedaron sin día (menús mixtos tras editar).
  const noDay = meals.filter((m) => m.weekday == null);
  if (noDay.length) {
    doc.addPage({ size: "A4", layout: "portrait", margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    doc.font("Helvetica-Bold").fontSize(14).fillColor(primary).text("Otras comidas");
    doc.moveDown(0.5);
    for (const meal of noDay) renderMealDetail(doc, meal, ctx);
  }

  // ── PARTE 3 — Recetario al detalle ────────────────────────────────────────
  renderRecipeBook(doc, ctx);
  renderFooter(doc, tenantName);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1 — Portada horizontal: calendario de la semana
// ─────────────────────────────────────────────────────────────────────────────
function renderCoverCalendar(doc, ctx) {
  const { plan, meals, client, tenantName, primary } = ctx;
  const W = contentWidth(doc);
  const L = doc.page.margins.left;

  // Cabecera
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED)
    .text((tenantName || "").toUpperCase(), L, doc.page.margins.top, { characterSpacing: 1.5 });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(19).fillColor(primary).text(plan.name || "Menú semanal");

  const sub = [];
  if (client?.name) sub.push(`Paciente: ${client.name}`);
  const assigned = fmtDate(plan.assignedAt);
  if (assigned) sub.push(`Asignado: ${assigned}`);
  if (sub.length) {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(sub.join("   ·   "));
  }
  doc.moveDown(0.5);

  // Filas = las 5 grandes comidas presentes en la semana (+ extras a medida).
  const namesPresent = [];
  for (const name of MEAL_ORDER) {
    if (meals.some((m) => m.name === name && m.weekday != null)) namesPresent.push(name);
  }
  for (const m of meals) {
    if (m.weekday != null && !namesPresent.includes(m.name)) namesPresent.push(m.name);
  }
  const rows = namesPresent.length ? namesPresent : MEAL_ORDER;

  // Geometría: 1 columna de etiquetas + 7 de días.
  const labelW = 74;
  const colW = (W - labelW) / 7;
  const headH = 22;
  const tableTop = doc.y + 4;
  const availH = doc.page.height - doc.page.margins.bottom - tableTop - headH - 26;
  const rowH = Math.max(38, Math.min(78, availH / rows.length));

  // Cabecera de días
  doc.save().rect(L + labelW, tableTop, W - labelW, headH).fillOpacity(0.1).fill(primary).restore();
  for (let i = 0; i < 7; i++) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(primary).text(
      WEEKDAY_NAMES[i + 1].toUpperCase(),
      L + labelW + i * colW,
      tableTop + 7,
      { width: colW, align: "center", characterSpacing: 0.8 }
    );
  }

  // Celdas
  let y = tableTop + headH;
  for (const mealName of rows) {
    // Etiqueta de la comida
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK)
      .text(mealName.toUpperCase(), L + 3, y + rowH / 2 - 5, { width: labelW - 6, characterSpacing: 0.5 });

    for (let i = 0; i < 7; i++) {
      const day = i + 1;
      const x = L + labelW + i * colW;
      const meal = meals.find((m) => m.weekday === day && m.name === mealName);
      const text = meal ? calendarCellText(meal) : "";
      if (text) {
        doc.font("Helvetica").fontSize(7.2).fillColor(INK).text(text, x + 4, y + 5, {
          width: colW - 8,
          height: rowH - 10,
          align: "left",
          lineGap: 0.5,
          ellipsis: true,
        });
      }
      // Rejilla
      doc.save().lineWidth(0.4).strokeColor(HAIRLINE)
        .rect(x, y, colW, rowH).stroke().restore();
    }
    // Línea de separación de la etiqueta
    doc.save().lineWidth(0.4).strokeColor(HAIRLINE)
      .moveTo(L, y).lineTo(L + labelW, y).stroke().restore();
    y += rowH;
  }
  doc.save().lineWidth(0.4).strokeColor(HAIRLINE).moveTo(L, y).lineTo(L + labelW, y).stroke().restore();

  // Comentarios generales del menú, al pie de la portada.
  const description = (plan.description || "").trim();
  if (description) {
    doc.y = y + 10;
    doc.x = L;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(primary).text("Comentarios de tu nutricionista");
    doc.font("Helvetica").fontSize(8.5).fillColor("#333333")
      .text(description, { width: W, lineGap: 1, height: doc.page.height - doc.page.margins.bottom - doc.y - 4, ellipsis: true });
  }
}

/** Resumen de una celda del calendario: recetas y, si hay, alimentos sueltos. */
function calendarCellText(meal) {
  const opt = (meal.options || []).find((o) => o.isDefault) || (meal.options || [])[0];
  if (!opt) return "";
  const parts = (opt.recipes || []).map((r) => r.nameSnapshot || "Receta");
  const foods = opt.foods || [];
  if (foods.length) {
    // Con pocos alimentos se listan; con muchos, el recuento.
    if (foods.length <= 3) parts.push(...foods.map((f) => f.food?.name || "Alimento"));
    else parts.push(`${foods.length} alimentos`);
  }
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 2 — Un día al detalle
// ─────────────────────────────────────────────────────────────────────────────
function renderDayDetail(doc, day, ctx) {
  const { plan, meals, primary } = ctx;
  const W = contentWidth(doc);
  const L = doc.page.margins.left;
  const dayMeals = mealsOfDay(meals, day);

  ensureSpace(doc, 120);

  // Banda del día
  const bandY = doc.y;
  doc.save().rect(L, bandY, W, 22).fillOpacity(0.1).fill(primary).restore();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(primary)
    .text(WEEKDAY_NAMES[day].toUpperCase(), L + 8, bandY + 5.5, { characterSpacing: 1 });
  doc.x = L;
  doc.y = bandY + 28;

  // Comentario del día (plans.day_comments)
  const dayComment = (plan.dayComments?.[String(day)] || "").trim();
  if (dayComment) {
    doc.font("Helvetica-Oblique").fontSize(8.8).fillColor(MUTED)
      .text(dayComment, { width: W, lineGap: 1 });
    doc.moveDown(0.35);
  }

  for (const meal of dayMeals) renderMealDetail(doc, meal, ctx, { compact: true });
  doc.moveDown(0.5);
}

/**
 * Una comida con sus opciones. `compact` reduce tamaños para que quepan
 * 2-3 días por página vertical en la parte 2.
 */
function renderMealDetail(doc, meal, ctx, { compact = false } = {}) {
  const { primary, photoBuffers } = ctx;
  const size = compact ? { title: 10, opt: 9, line: 8.6, ing: 8, macros: 7.5 } : { title: 12.5, opt: 10.5, line: 10, ing: 9.5, macros: 8.5 };

  ensureSpace(doc, compact ? 60 : 90);
  doc.font("Helvetica-Bold").fontSize(size.title).fillColor(primary).text(meal.name || "Comida");

  // Comentario de la comida (plan_meals.description)
  const mealComment = (meal.description || "").trim();
  if (mealComment) {
    doc.font("Helvetica-Oblique").fontSize(size.ing).fillColor(MUTED).text(mealComment, { indent: 8, lineGap: 0.5 });
  }
  doc.moveDown(0.2);

  const options = (meal.options || []).filter(optionHasContent);
  options.forEach((option, idx) => {
    const generic = isGenericOptionName(option.name);
    if (options.length > 1 || !generic) {
      ensureSpace(doc, 40);
      const label = generic ? `Opción ${idx + 1}` : `Opción ${idx + 1} · ${option.name}`;
      doc.font("Helvetica-Bold").fontSize(size.opt).fillColor(INK).text(label, { indent: 10 });
      doc.moveDown(0.1);
    }

    for (const line of option.foods || []) {
      doc.font("Helvetica").fontSize(size.line).fillColor(INK).text(`•  ${foodLineText(line)}`, { indent: 16 });
    }

    for (const recipe of option.recipes || []) {
      ensureSpace(doc, compact ? 26 : 40);
      const label = `•  ${recipe.nameSnapshot || "Receta"}  ·  ${servingsLabel(recipe.servings)}`;
      doc.font("Helvetica-Bold").fontSize(size.line).fillColor(INK).text(label, { indent: 16 });

      if (compact) {
        // En el detalle del día basta el nombre + un apunte de ingredientes:
        // la receta completa (foto y pasos) va en el recetario del final.
        const ings = (recipe.ingredients || []).map((i) => i.food?.name).filter(Boolean);
        if (ings.length) {
          doc.font("Helvetica").fontSize(size.ing).fillColor(MUTED)
            .text(ings.join(", "), { indent: 26, lineGap: 0.5 });
        }
        const nSteps = (recipe.steps || []).length;
        if (nSteps) {
          doc.font("Helvetica-Oblique").fontSize(size.macros).fillColor(LIGHT)
            .text(`Preparación al final del documento (${nSteps} paso${nSteps === 1 ? "" : "s"})`, { indent: 26 });
        }
      } else {
        const photo = recipe.photoPath ? photoBuffers?.get(recipe.photoPath) : null;
        if (photo) {
          ensureSpace(doc, 84);
          try {
            doc.moveDown(0.15);
            doc.x = doc.page.margins.left + 16;
            doc.image(photo, { fit: [96, 72] });
            doc.x = doc.page.margins.left;
            doc.moveDown(0.15);
          } catch {
            doc.x = doc.page.margins.left;
          }
        }
        for (const ing of recipe.ingredients || []) {
          doc.font("Helvetica").fontSize(size.ing).fillColor(MUTED).text(`–  ${foodLineText(ing)}`, { indent: 28 });
        }
        const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
        if (steps.length) {
          doc.moveDown(0.1);
          doc.font("Helvetica-Oblique").fontSize(size.ing).fillColor(INK).text("Preparación:", { indent: 28 });
          steps.forEach((step, i) => {
            doc.font("Helvetica").fontSize(size.ing).fillColor(MUTED).text(`${i + 1}. ${step}`, { indent: 34, lineGap: 1 });
          });
        }
      }
    }

    const macros = macrosText(option);
    if (macros) {
      doc.font("Helvetica-Oblique").fontSize(size.macros).fillColor(LIGHT).text(macros, { indent: 16 });
    }
    doc.moveDown(compact ? 0.25 : 0.45);
  });

  doc.moveDown(compact ? 0.15 : 0.3);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 3 — Recetario: cada receta usada, al detalle
// ─────────────────────────────────────────────────────────────────────────────
function renderRecipeBook(doc, ctx) {
  const { plan, primary, photoBuffers } = ctx;
  const recipes = collectUsedRecipes(plan);
  if (recipes.length === 0) return;

  doc.addPage({ size: "A4", layout: "portrait", margins: { top: 48, bottom: 48, left: 48, right: 48 } });
  const W = contentWidth(doc);
  const L = doc.page.margins.left;

  doc.font("Helvetica-Bold").fontSize(17).fillColor(primary).text("Tus recetas");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
    .text("Cómo preparar cada plato de tu menú, con sus ingredientes y sus pasos.", { width: W });
  doc.moveDown(0.8);

  recipes.forEach((recipe, idx) => {
    ensureSpace(doc, 150);
    if (idx > 0) {
      doc.save().lineWidth(0.5).strokeColor(HAIRLINE)
        .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke().restore();
      doc.moveDown(0.7);
    }

    const startY = doc.y;
    const photo = recipe.photoPath ? photoBuffers?.get(recipe.photoPath) : null;
    const photoW = 132;
    const photoH = 99;
    const textX = photo ? L + photoW + 14 : L;
    const textW = photo ? W - photoW - 14 : W;

    if (photo) {
      try {
        doc.image(photo, L, startY, { fit: [photoW, photoH] });
      } catch {
        /* imagen corrupta: seguir sin foto */
      }
    }

    // Nombre + raciones
    doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
      .text(recipe.nameSnapshot || "Receta", textX, startY, { width: textW });
    doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
      .text(servingsLabel(recipe.servings), textX, doc.y + 1, { width: textW });
    doc.moveDown(0.35);

    // Ingredientes (junto a la foto mientras quepan)
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("Ingredientes", textX, doc.y, { width: textW });
    doc.moveDown(0.15);
    const ings = recipe.ingredients || [];
    if (ings.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("—", textX, doc.y, { width: textW });
    } else {
      for (const ing of ings) {
        doc.font("Helvetica").fontSize(9).fillColor(MUTED)
          .text(`•  ${foodLineText(ing)}`, textX, doc.y, { width: textW, lineGap: 0.5 });
      }
    }

    // Macros de la receta
    const m = computeRecipeMacros({ ingredients: ings });
    const macroParts = [];
    if (m.protein != null) macroParts.push(`P ${fmtNum(m.protein)} g`);
    if (m.carbs != null) macroParts.push(`H ${fmtNum(m.carbs)} g`);
    if (m.fat != null) macroParts.push(`G ${fmtNum(m.fat)} g`);
    if (m.fiber != null) macroParts.push(`Fibra ${fmtNum(m.fiber)} g`);
    if (macroParts.length) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(LIGHT)
        .text(macroParts.join("  ·  "), textX, doc.y, { width: textW });
    }

    // Debajo de la foto: pasos a ancho completo.
    doc.x = L;
    doc.y = Math.max(doc.y, photo ? startY + photoH : doc.y) + 8;

    const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
    if (steps.length) {
      ensureSpace(doc, 50);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("Preparación", L, doc.y, { width: W });
      doc.moveDown(0.2);
      steps.forEach((step, i) => {
        ensureSpace(doc, 26);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
          .text(`${i + 1}.`, L + 2, doc.y, { width: 16, continued: false });
        const lineY = doc.y - doc.currentLineHeight();
        doc.font("Helvetica").fontSize(9).fillColor(INK)
          .text(step, L + 20, lineY, { width: W - 20, lineGap: 1 });
        doc.moveDown(0.15);
      });
    } else {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(LIGHT)
        .text("Sin pasos de preparación.", L, doc.y, { width: W });
    }
    doc.moveDown(0.9);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cabecera del render plano (planes sin días) y pie del documento
// ─────────────────────────────────────────────────────────────────────────────
function renderPlainHeader(doc, ctx) {
  const { plan, client, tenantName, primary } = ctx;
  const W = contentWidth(doc);

  doc.font("Helvetica").fontSize(9).fillColor(MUTED)
    .text((tenantName || "").toUpperCase(), { characterSpacing: 1.5 });
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(primary).text(plan.name || "Plan nutricional");

  const sub = [];
  if (client?.name) sub.push(`Paciente: ${client.name}`);
  const assigned = fmtDate(plan.assignedAt);
  if (assigned) sub.push(`Asignado: ${assigned}`);
  if (sub.length) {
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(sub.join("   ·   "));
  }

  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + W, doc.y)
    .lineWidth(0.7).strokeColor(primary).stroke();
  doc.moveDown(0.9);

  const description = (plan.description || "").trim();
  if (description) {
    ensureSpace(doc, 70);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(primary).text("Comentarios de tu nutricionista");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#333333").text(description, { lineGap: 2 });
    doc.moveDown(0.9);
  }
}

function renderFooter(doc, tenantName) {
  doc.moveDown(0.8);
  ensureSpace(doc, 24);
  doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT).text(
    `Generado el ${new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })} · ${tenantName || ""}`,
    doc.page.margins.left,
    doc.y,
    { width: contentWidth(doc) }
  );
}
