import PDFDocument from "pdfkit";
import { computeOptionMacros } from "./macros.js";
import { readRecipePhotoBuffer } from "./recipePhotoStorage.js";

/**
 * Genera el PDF del menú de un plan nutricional con pdfkit (server-side, sin
 * navegador headless). Devuelve un Buffer.
 *
 * Rework 2026-07-22 — el PDF ES la vista del paciente (no hay portal), así que
 * cuenta la semana como la vive él: una sección por DÍA (Lunes…Domingo) con sus
 * comidas dentro, recetas con FOTO y PASOS de preparación, y solo el contenido
 * REAL (comidas vacías fuera — un menú a medio rellenar no imprime 35 huecos).
 * Los planes pre-rework (comidas sin weekday) se imprimen como lista plana,
 * como siempre.
 *
 * Datos:
 *   - plan:   árbol de `loadPlanTree` (meals → options → foods + recipes),
 *             es decir, el MISMO shape que consume el editor. Las recetas van
 *             congeladas (snapshot) con sus ingredientes normalizados y traen
 *             photoPath/steps EN VIVO de la receta original (attachRecipesToTree).
 *   - client: { name } del paciente (null en plantillas).
 *   - tenantName / brand: para cabecera y color de acento.
 *   - tenantSlug: para leer las fotos de disco (sin él, PDF sin fotos).
 */

const WEEKDAY_NAMES = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

function optionHasContent(option) {
  return (option.foods || []).length > 0 || (option.recipes || []).length > 0;
}
function mealHasContent(meal) {
  // Un comentario de sección sin recetas TAMBIÉN es contenido ("Cena: libre").
  return (meal.options || []).some(optionHasContent) || !!(meal.description || "").trim();
}

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

function macrosLine(option) {
  const m = computeOptionMacros(option);
  const parts = [];
  if (m.protein != null) parts.push(`P ${fmtNum(m.protein)} g`);
  if (m.carbs != null) parts.push(`H ${fmtNum(m.carbs)} g`);
  if (m.fat != null) parts.push(`G ${fmtNum(m.fat)} g`);
  if (m.fiber != null) parts.push(`Fibra ${fmtNum(m.fiber)} g`);
  return parts.length ? parts.join("  ·  ") : null;
}

const INK = "#1F2937";
const MUTED = "#6B7280";
const LIGHT = "#9CA3AF";

// Salta de página si no quedan al menos `px` de alto útil, para no dejar un
// título/cabecera huérfano al pie separado de su contenido. pdfkit auto-pagina
// el texto que desborda, así que esto es solo cosmético (evitar viudas).
function ensureSpace(doc, px) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - px) doc.addPage();
}

// ¿El nombre de la opción es el genérico autogenerado ("Opción 1", "Opción 2")?
// En ese caso no lo mostramos junto al ordinal de posición (evita "Opción 1 ·
// Opción 2" cuando se ha borrado/reordenado una opción). Solo mostramos el
// nombre cuando es personalizado (p. ej. "Alta en proteína").
function isGenericOptionName(name) {
  return /^opción\s*\d+$/i.test((name || "").trim());
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
 * Pre-carga las fotos de receta del árbol a Buffers (pdfkit las embebe en
 * síncrono). Best-effort: una foto que falte en disco no tumba el PDF.
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

export async function buildMenuPdfBuffer({ plan, client, tenantName, brand, tenantSlug }) {
  const photoBuffers = await loadPhotoBuffers(plan, tenantSlug);
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      renderMenu(doc, { plan, client, tenantName, brand: brand || {}, photoBuffers });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderMenu(doc, { plan, client, tenantName, brand, photoBuffers }) {
  const primary = brand.primaryColor || "#1B3A2D";
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ── Cabecera ───────────────────────────────────────────────────────────────
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text((tenantName || "").toUpperCase(), { characterSpacing: 1.5 });
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(primary).text(plan.name || "Plan nutricional");

  const subParts = [];
  if (client?.name) subParts.push(`Paciente: ${client.name}`);
  const assigned = fmtDate(plan.assignedAt);
  if (assigned) subParts.push(`Asignado: ${assigned}`);
  if (subParts.length) {
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subParts.join("   ·   "));
  }

  doc.moveDown(0.6);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.margins.left + contentW, doc.y)
    .lineWidth(0.7)
    .strokeColor(primary)
    .stroke();
  doc.moveDown(0.9);

  // ── Comentarios de la nutricionista ────────────────────────────────────────
  // Desde el rework, la semana es ESTRUCTURA (weekday), no texto: description
  // vuelve a ser solo comentarios generales (pautas, recordatorios…).
  const description = (plan.description || "").trim();
  if (description) {
    ensureSpace(doc, 70);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(primary).text("Comentarios de tu nutricionista");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#333333").text(description, { lineGap: 2 });
    doc.moveDown(0.9);
  }

  // ── Semana / comidas ───────────────────────────────────────────────────────
  // Solo se imprime el contenido REAL: una comida sin nada dentro no aparece
  // (el paciente no necesita 35 huecos "(vacía)" de un menú a medio hacer).
  const meals = (plan.meals || []).filter(mealHasContent);
  if (meals.length === 0) {
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Este plan aún no tiene comidas.");
  }

  const dayComments = plan.dayComments || {};
  const hasWeek = meals.some((m) => m.weekday != null) || Object.keys(dayComments).length > 0;
  if (hasWeek) {
    // Bloques por día en orden Lunes→Domingo. Un día con SOLO comentarios
    // también cuenta (p. ej. "Domingo: comida libre"). Las comidas sin día
    // (raras en un plan semanal) van al final bajo "Otras comidas".
    const groups = [];
    for (let d = 1; d <= 7; d++) {
      const dayMeals = meals.filter((m) => m.weekday === d);
      const comment = (dayComments[String(d)] || "").trim();
      if (dayMeals.length || comment) groups.push({ title: WEEKDAY_NAMES[d], meals: dayMeals, comment });
    }
    const noDay = meals.filter((m) => m.weekday == null);
    if (noDay.length) groups.push({ title: "Otras comidas", meals: noDay, comment: "" });

    for (const group of groups) {
      ensureSpace(doc, 120);
      // Banda de día: fondo suave con el nombre del día bien visible.
      const bandY = doc.y;
      doc
        .save()
        .rect(doc.page.margins.left, bandY, contentW, 24)
        .fillOpacity(0.08)
        .fill(primary)
        .restore();
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor(primary)
        .text(group.title.toUpperCase(), doc.page.margins.left + 8, bandY + 6, { characterSpacing: 1 });
      doc.x = doc.page.margins.left;
      doc.y = bandY + 32;

      // Comentarios del día, justo bajo la banda.
      if (group.comment) {
        doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTED).text(group.comment, { lineGap: 1.5 });
        doc.moveDown(0.4);
      }

      for (const meal of group.meals) renderMeal(doc, meal, { primary, photoBuffers });
      doc.moveDown(0.4);
    }
  } else {
    // Plan pre-rework (sin días): lista plana, como siempre.
    for (const meal of meals) renderMeal(doc, meal, { primary, photoBuffers });
  }

  // ── Pie ────────────────────────────────────────────────────────────────────
  doc.moveDown(0.8);
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(LIGHT)
    .text(
      `Generado el ${new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })} · ${tenantName || ""}`
    );
}

// Una comida (Desayuno, Cena…) con sus opciones. Solo llega aquí con contenido
// (renderMenu filtra); dentro, las opciones vacías tampoco se imprimen.
function renderMeal(doc, meal, { primary, photoBuffers }) {
  ensureSpace(doc, 90);
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(primary).text(meal.name || "Comida");
  doc.moveDown(0.3);

  // Comentarios de la gran comida (rediseño 2026-07-22): pauta de la sección
  // ("desayuno con al menos un lácteo…"), visible para el paciente.
  const mealComment = (meal.description || "").trim();
  if (mealComment) {
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTED).text(mealComment, { indent: 10, lineGap: 1.5 });
    doc.moveDown(0.25);
  }

  const options = (meal.options || []).filter(optionHasContent);
  options.forEach((option, idx) => {
    // Cabecera de opción: se muestra si hay varias opciones o si la única
    // tiene nombre PERSONALIZADO. El ordinal es la posición actual (idx+1),
    // no el nombre guardado, así que borrar/reordenar opciones no produce
    // numeraciones contradictorias.
    const generic = isGenericOptionName(option.name);
    if (options.length > 1 || !generic) {
      ensureSpace(doc, 46);
      const label = generic ? `Opción ${idx + 1}` : `Opción ${idx + 1} · ${option.name}`;
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(label, { indent: 10 });
      doc.moveDown(0.15);
    }

    for (const line of option.foods || []) {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(`•  ${foodLineText(line)}`, { indent: 18 });
    }

    for (const recipe of option.recipes || []) {
      ensureSpace(doc, 40);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(INK)
        .text(`•  ${recipe.nameSnapshot || "Receta"}  ·  ${servingsLabel(recipe.servings)}`, { indent: 18 });

      // Foto del plato (en vivo de la receta original; best-effort).
      const photo = recipe.photoPath ? photoBuffers?.get(recipe.photoPath) : null;
      if (photo) {
        ensureSpace(doc, 84);
        try {
          doc.moveDown(0.15);
          doc.x = doc.page.margins.left + 18;
          doc.image(photo, { fit: [96, 72] });
          doc.x = doc.page.margins.left;
          doc.moveDown(0.15);
        } catch {
          /* imagen corrupta: seguir sin foto */
          doc.x = doc.page.margins.left;
        }
      }

      for (const ing of recipe.ingredients || []) {
        doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`–  ${foodLineText(ing)}`, { indent: 30 });
      }

      // Pasos de preparación (en vivo de la receta original).
      const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
      if (steps.length) {
        doc.moveDown(0.1);
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(INK).text("Preparación:", { indent: 30 });
        steps.forEach((step, i) => {
          doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${i + 1}. ${step}`, { indent: 36, lineGap: 1 });
        });
      }
    }

    const macros = macrosLine(option);
    if (macros) {
      doc.moveDown(0.1);
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(LIGHT).text(macros, { indent: 18 });
    }
    doc.moveDown(0.45);
  });

  doc.moveDown(0.3);
}
