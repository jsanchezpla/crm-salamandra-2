import PDFDocument from "pdfkit";
import { computeOptionMacros, computeRecipeMacros } from "./macros.js";
import { readRecipePhotoBuffer } from "./recipePhotoStorage.js";
import { registerPoppins } from "../pdf/fonts.js";

/**
 * PDF del menú semanal — la ÚNICA vista que recibe el paciente (no hay portal:
 * se le manda por email como adjunto). Estructura en TRES partes:
 *
 *   1. PORTADA, la única hoja HORIZONTAL — el calendario de la semana entera
 *      de un vistazo: cuadrícula 7 días × comidas. Es la hoja de la nevera.
 *   2. DÍAS DETALLADOS (vertical) — cada día dentro de su TARJETA de fondo
 *      tenue, para que se vea de un golpe dónde empieza y acaba cada día. Los
 *      días fluyen y paginan solos: caben 2 o 3 por hoja según su contenido.
 *      Detrás del último día van los comentarios generales de la nutricionista.
 *   3. RECETARIO — cada receta USADA en la semana, también en tarjeta: foto,
 *      ingredientes con cantidades y pasos numerados. Sin repetir: una receta
 *      usada tres veces se explica una sola vez.
 *
 * DECISIONES DE PRODUCTO (2026-07-22, Rodrigo):
 *   - Tipografía Poppins en TODO el documento, igual que la interfaz.
 *   - `plan.showMacros` gobierna si se imprimen P/H/G/fibra. Por defecto NO:
 *     Laura trata trastornos de la conducta alimentaria y las cifras suelen ser
 *     parte del problema. Se activa por menú desde el editor del CRM.
 *   - Sin pies de página de ningún tipo.
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
 * lista plana en vertical: sin calendario no hay portada que llenar.
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

const INK = "#1F2937";
const MUTED = "#6B7280";
const LIGHT = "#9CA3AF";
const HAIRLINE = "#E5E7EB";

// La portada es la ÚNICA hoja apaisada; el resto del documento, vertical.
const PORTRAIT = {
  size: "A4",
  layout: "portrait",
  margins: { top: 46, bottom: 46, left: 46, right: 46 },
};
const LANDSCAPE = {
  size: "A4",
  layout: "landscape",
  margins: { top: 38, bottom: 38, left: 38, right: 38 },
};

// Geometría de las tarjetas (días y recetas).
const CARD = { padX: 14, padTop: 12, padBottom: 12, radius: 9, gap: 11, bar: 3.5 };

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

function macrosLine(macros) {
  const parts = [];
  if (macros.protein != null) parts.push(`P ${fmtNum(macros.protein)} g`);
  if (macros.carbs != null) parts.push(`H ${fmtNum(macros.carbs)} g`);
  if (macros.fat != null) parts.push(`G ${fmtNum(macros.fat)} g`);
  if (macros.fiber != null) parts.push(`Fibra ${fmtNum(macros.fiber)} g`);
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
// huérfanos al pie). Solo lo usan los renders que FLUYEN; las tarjetas
// calculan su propio salto porque conocen su altura exacta de antemano.
function ensureSpace(doc, px) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - px) doc.addPage();
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

/**
 * A partir de aquí, TODA página nueva nace vertical — incluidas las que pdfkit
 * añade solo por desbordamiento y las de `ensureSpace`, que llaman a
 * `doc.addPage()` sin argumentos y por tanto heredan `doc.options`. Sin esto,
 * un documento abierto en horizontal para la portada seguía sacando apaisadas
 * las hojas del recetario.
 */
function switchToPortrait(doc) {
  doc.options.size = PORTRAIT.size;
  doc.options.layout = PORTRAIT.layout;
  doc.options.margins = { ...PORTRAIT.margins };
}

export function menuPdfFilename(plan, client) {
  const base = (client?.name || plan.name || "pauta")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `pauta-${base || "pauta"}.pdf`;
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
      const doc = new PDFDocument(hasWeek ? LANDSCAPE : PORTRAIT);
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
        // Cifras de macronutrientes: solo si la nutricionista lo ha decidido
        // expresamente en el editor de ese menú.
        showMacros: Boolean(plan.showMacros),
        F: registerPoppins(doc),
      });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderMenu(doc, ctx) {
  const { meals, hasWeek } = ctx;
  ctx.primary = ctx.brand.primaryColor || "#1B3A2D";

  if (!hasWeek) {
    // Plan sin días (menú antiguo): render plano de siempre.
    renderPlainHeader(doc, ctx);
    if (meals.length === 0) {
      doc.font(ctx.F.regular).fontSize(11).fillColor(MUTED)
        .text("Esta pauta aún no tiene comidas.");
    }
    for (const meal of meals) renderMealFlowing(doc, meal, ctx);
    renderRecipeBook(doc, ctx);
    return;
  }

  // ── PARTE 1 — Portada horizontal con el calendario semanal ────────────────
  renderCoverCalendar(doc, ctx);

  // ── PARTE 2 — Días detallados, en vertical, cada uno en su tarjeta ────────
  switchToPortrait(doc);
  const daysWithContent = [1, 2, 3, 4, 5, 6, 7].filter((d) => mealsOfDay(meals, d).length > 0);
  if (daysWithContent.length) {
    doc.addPage();
    // El aviso del recetario, UNA sola vez, en lugar de repetirlo bajo cada
    // una de las 35 recetas de la semana.
    if (collectUsedRecipes(ctx.plan).some((r) => (r.steps || []).length)) {
      doc.font(ctx.F.italic).fontSize(8.5).fillColor(LIGHT).text(
        "Cada receta está explicada al final del documento, con sus ingredientes y sus pasos.",
        doc.page.margins.left,
        doc.y,
        { width: contentWidth(doc) }
      );
      doc.moveDown(0.8);
    }
    for (const day of daysWithContent) renderDayCard(doc, day, ctx);
  }

  // Comidas que quedaron sin día (menús mixtos tras editar).
  const noDay = meals.filter((m) => m.weekday == null);
  if (noDay.length) {
    doc.addPage();
    doc.font(ctx.F.bold).fontSize(14).fillColor(ctx.primary).text("Otras comidas");
    doc.moveDown(0.5);
    for (const meal of noDay) renderMealFlowing(doc, meal, ctx);
  }

  // Comentarios generales: DEBAJO del último día (antes iban al pie de la
  // portada, donde no cabían y se cortaban con puntos suspensivos).
  renderGeneralComments(doc, ctx);

  // ── PARTE 3 — Recetario al detalle ────────────────────────────────────────
  renderRecipeBook(doc, ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de bloques
//
// Un bloque es una línea o párrafo con su estilo. Existe para poder MEDIR el
// contenido antes de pintarlo: pdfkit dibuja en orden de llamada, así que el
// fondo de una tarjeta hay que trazarlo ANTES que su texto — y para eso hay
// que saber de antemano cuánto va a ocupar.
// ─────────────────────────────────────────────────────────────────────────────
function blk(text, style) {
  return {
    text: text == null ? "" : String(text),
    font: style.font,
    size: style.size,
    color: style.color || INK,
    indent: style.indent || 0,
    lineGap: style.lineGap || 0,
    gapAfter: style.gapAfter || 0,
    options: style.options || null,
    prefix: style.prefix || null,
  };
}

/** Separador vertical entre bloques (no imprime nada). */
function spacer(px) {
  return { text: "", font: null, size: 1, color: INK, indent: 0, lineGap: 0, gapAfter: px, options: null, prefix: null };
}

function blockHeight(doc, b, width) {
  if (!b.text) return b.gapAfter;
  doc.font(b.font).fontSize(b.size);
  const w = Math.max(12, width - b.indent);
  return doc.heightOfString(b.text, { width: w, lineGap: b.lineGap, ...(b.options || {}) }) + b.gapAfter;
}

function blocksHeight(doc, blocks, width) {
  let total = 0;
  for (const b of blocks) total += blockHeight(doc, b, width);
  return total;
}

function drawBlocks(doc, blocks, x, y, width) {
  let cy = y;
  for (const b of blocks) {
    const h = blockHeight(doc, b, width);
    if (b.text) {
      // Prefijo opcional en la sangría (los ordinales de los pasos de receta).
      if (b.prefix) {
        doc.font(b.prefix.font).fontSize(b.prefix.size).fillColor(b.prefix.color)
          .text(b.prefix.text, x, cy, { width: Math.max(8, b.indent - 2), align: "left" });
      }
      const w = Math.max(12, width - b.indent);
      doc.font(b.font).fontSize(b.size).fillColor(b.color)
        .text(b.text, x + b.indent, cy, { width: w, lineGap: b.lineGap, ...(b.options || {}) });
    }
    cy += h;
  }
  return cy;
}

/** Fondo de tarjeta: tinte muy leve del color de marca + barra lateral. */
function drawCardBackground(doc, x, y, w, h, primary) {
  doc.save();
  doc.roundedRect(x, y, w, h, CARD.radius).fillOpacity(0.045).fill(primary);
  doc.restore();
  doc.save();
  doc.roundedRect(x, y, CARD.bar, h, CARD.bar / 2).fillOpacity(0.45).fill(primary);
  doc.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1 — Portada horizontal: calendario de la semana
// ─────────────────────────────────────────────────────────────────────────────
function renderCoverCalendar(doc, ctx) {
  const { plan, meals, client, tenantName, primary, F } = ctx;
  const W = contentWidth(doc);
  const L = doc.page.margins.left;

  // Cabecera
  doc.font(F.medium).fontSize(8.5).fillColor(MUTED)
    .text((tenantName || "").toUpperCase(), L, doc.page.margins.top, { characterSpacing: 1.5 });
  doc.moveDown(0.35);
  doc.font(F.bold).fontSize(19).fillColor(primary).text(plan.name || "Pauta semanal");

  const sub = [];
  if (client?.name) sub.push(`Paciente: ${client.name}`);
  const assigned = fmtDate(plan.assignedAt);
  if (assigned) sub.push(`Asignado: ${assigned}`);
  if (sub.length) {
    doc.moveDown(0.25);
    doc.font(F.regular).fontSize(9.5).fillColor(MUTED).text(sub.join("   ·   "));
  }
  doc.moveDown(0.6);

  // Filas = las 5 grandes comidas presentes en la semana (+ extras a medida).
  const namesPresent = [];
  for (const name of MEAL_ORDER) {
    if (meals.some((m) => m.name === name && m.weekday != null)) namesPresent.push(name);
  }
  for (const m of meals) {
    if (m.weekday != null && !namesPresent.includes(m.name)) namesPresent.push(m.name);
  }
  const rows = namesPresent.length ? namesPresent : MEAL_ORDER;

  // Geometría: 1 columna de etiquetas + 7 de días. La rejilla se estira hasta
  // el margen inferior — los comentarios ya no viven aquí, así que sobra sitio.
  const labelW = 78;
  const colW = (W - labelW) / 7;
  const headH = 22;
  const tableTop = doc.y + 4;
  const availH = pageBottom(doc) - tableTop - headH;
  const rowH = Math.max(38, Math.min(96, availH / rows.length));

  // Cabecera de días
  doc.save().roundedRect(L + labelW, tableTop, W - labelW, headH, 3).fillOpacity(0.1).fill(primary).restore();
  for (let i = 0; i < 7; i++) {
    doc.font(F.bold).fontSize(8.5).fillColor(primary).text(
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
    doc.font(F.bold).fontSize(8.5).fillColor(INK)
      .text(mealName.toUpperCase(), L + 3, y + rowH / 2 - 5, { width: labelW - 8, characterSpacing: 0.5 });

    for (let i = 0; i < 7; i++) {
      const day = i + 1;
      const x = L + labelW + i * colW;
      const meal = meals.find((m) => m.weekday === day && m.name === mealName);
      const text = meal ? calendarCellText(meal) : "";
      if (text) {
        doc.font(F.regular).fontSize(7.4).fillColor(INK).text(text, x + 5, y + 6, {
          width: colW - 10,
          height: rowH - 12,
          align: "left",
          lineGap: 1,
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
// PARTE 2 — Un día por tarjeta
// ─────────────────────────────────────────────────────────────────────────────

/** Contenido de un día como lista de bloques medibles. */
function dayBlocks(doc, day, ctx) {
  const { plan, meals, primary, showMacros, F } = ctx;
  const out = [];

  const dayComment = (plan.dayComments?.[String(day)] || "").trim();
  if (dayComment) {
    out.push(blk(dayComment, { font: F.italic, size: 8.8, color: MUTED, lineGap: 1, gapAfter: 8 }));
  }

  const dayMeals = mealsOfDay(meals, day);
  dayMeals.forEach((meal, mealIdx) => {
    out.push(blk(meal.name || "Comida", { font: F.bold, size: 9.5, color: primary, gapAfter: 2 }));

    const mealComment = (meal.description || "").trim();
    if (mealComment) {
      out.push(blk(mealComment, { font: F.italic, size: 8.2, color: MUTED, indent: 10, lineGap: 0.5, gapAfter: 2.5 }));
    }

    const options = (meal.options || []).filter(optionHasContent);
    options.forEach((option, idx) => {
      const generic = isGenericOptionName(option.name);
      if (options.length > 1 || !generic) {
        const label = generic ? `Opción ${idx + 1}` : `Opción ${idx + 1} · ${option.name}`;
        out.push(blk(label, { font: F.medium, size: 8.6, color: INK, indent: 10, gapAfter: 1.5 }));
      }

      for (const line of option.foods || []) {
        out.push(blk(`•  ${foodLineText(line)}`, { font: F.regular, size: 8.6, color: INK, indent: 12, lineGap: 0.5 }));
      }

      for (const recipe of option.recipes || []) {
        // "1 ración" es ruido en la inmensa mayoría de líneas: solo se dice
        // cuando la receta va escalada a más de una.
        const n = Number(recipe.servings || 1);
        const label = n === 1
          ? `•  ${recipe.nameSnapshot || "Receta"}`
          : `•  ${recipe.nameSnapshot || "Receta"}  ·  ${servingsLabel(n)}`;
        out.push(blk(label, { font: F.medium, size: 8.9, color: INK, indent: 12 }));

        // En el detalle del día basta el nombre + un apunte de ingredientes:
        // la receta completa (foto y pasos) va en el recetario del final.
        // Solo los ingredientes: el "cómo se hace" vive en el recetario del
        // final, y se avisa UNA vez al abrir los días. Repetir el aviso en las
        // 35 recetas de la semana era media hoja de texto muerto.
        const ings = (recipe.ingredients || []).map((i) => i.food?.name).filter(Boolean);
        if (ings.length) {
          out.push(blk(ings.join(", "), { font: F.regular, size: 8.1, color: MUTED, indent: 24, lineGap: 0.5 }));
        }
      }

      if (showMacros) {
        const macros = macrosLine(computeOptionMacros(option));
        if (macros) out.push(blk(macros, { font: F.italic, size: 7.4, color: LIGHT, indent: 12, gapAfter: 1 }));
      }
    });

    if (mealIdx < dayMeals.length - 1) out.push(spacer(6));
  });

  return out;
}

function renderDayCard(doc, day, ctx) {
  const { primary, F } = ctx;
  const L = doc.page.margins.left;
  const W = contentWidth(doc);
  const innerW = W - CARD.padX * 2;

  const title = WEEKDAY_NAMES[day].toUpperCase();
  const titleOpts = { characterSpacing: 1.2 };
  doc.font(F.bold).fontSize(11.5);
  const titleH = doc.heightOfString(title, { width: innerW, ...titleOpts });

  const blocks = dayBlocks(doc, day, ctx);
  const bodyH = blocksHeight(doc, blocks, innerW);
  const cardH = CARD.padTop + titleH + 7 + bodyH + CARD.padBottom;

  const fullPageH = pageBottom(doc) - doc.page.margins.top;

  // Un día que no cabe ni en una hoja entera no puede llevar tarjeta (habría
  // que partirla): se imprime fluyendo y dejando que pdfkit pagine. En la
  // práctica no pasa con 5 comidas, pero el documento no puede romperse por
  // un menú con muchas opciones.
  if (cardH > fullPageH) {
    renderDayFlowing(doc, day, ctx);
    return;
  }

  if (doc.y + cardH > pageBottom(doc)) doc.addPage();

  const top = doc.y;
  drawCardBackground(doc, L, top, W, cardH, primary);

  doc.font(F.bold).fontSize(11.5).fillColor(primary)
    .text(title, L + CARD.padX, top + CARD.padTop, { width: innerW, ...titleOpts });

  drawBlocks(doc, blocks, L + CARD.padX, top + CARD.padTop + titleH + 7, innerW);

  doc.x = L;
  doc.y = top + cardH + CARD.gap;
}

/** Plan B del día: sin tarjeta, fluyendo y paginando con pdfkit. */
function renderDayFlowing(doc, day, ctx) {
  const { plan, meals, primary, F } = ctx;
  const W = contentWidth(doc);
  const L = doc.page.margins.left;

  ensureSpace(doc, 90);
  const bandY = doc.y;
  doc.save().roundedRect(L, bandY, W, 22, 4).fillOpacity(0.1).fill(primary).restore();
  doc.font(F.bold).fontSize(11.5).fillColor(primary)
    .text(WEEKDAY_NAMES[day].toUpperCase(), L + 8, bandY + 5.5, { characterSpacing: 1.2 });
  doc.x = L;
  doc.y = bandY + 28;

  const dayComment = (plan.dayComments?.[String(day)] || "").trim();
  if (dayComment) {
    doc.font(F.italic).fontSize(8.8).fillColor(MUTED).text(dayComment, { width: W, lineGap: 1 });
    doc.moveDown(0.35);
  }
  for (const meal of mealsOfDay(meals, day)) renderMealFlowing(doc, meal, ctx, { compact: true });
  doc.moveDown(0.5);
}

/**
 * Una comida con sus opciones, fluyendo. Solo para los caminos que NO usan
 * tarjeta: planes sin días, comidas huérfanas y el plan B de `renderDayCard`.
 */
function renderMealFlowing(doc, meal, ctx, { compact = false } = {}) {
  const { primary, showMacros, photoBuffers, F } = ctx;
  const size = compact
    ? { title: 9.5, opt: 8.6, line: 8.6, ing: 8, macros: 7.4 }
    : { title: 12.5, opt: 10.5, line: 10, ing: 9.5, macros: 8.5 };

  ensureSpace(doc, compact ? 60 : 90);
  doc.font(F.bold).fontSize(size.title).fillColor(primary).text(meal.name || "Comida");

  const mealComment = (meal.description || "").trim();
  if (mealComment) {
    doc.font(F.italic).fontSize(size.ing).fillColor(MUTED).text(mealComment, { indent: 8, lineGap: 0.5 });
  }
  doc.moveDown(0.2);

  const options = (meal.options || []).filter(optionHasContent);
  options.forEach((option, idx) => {
    const generic = isGenericOptionName(option.name);
    if (options.length > 1 || !generic) {
      ensureSpace(doc, 40);
      const label = generic ? `Opción ${idx + 1}` : `Opción ${idx + 1} · ${option.name}`;
      doc.font(F.medium).fontSize(size.opt).fillColor(INK).text(label, { indent: 10 });
      doc.moveDown(0.1);
    }

    for (const line of option.foods || []) {
      doc.font(F.regular).fontSize(size.line).fillColor(INK).text(`•  ${foodLineText(line)}`, { indent: 16 });
    }

    for (const recipe of option.recipes || []) {
      ensureSpace(doc, compact ? 26 : 40);
      const n = Number(recipe.servings || 1);
      const label = n === 1
        ? `•  ${recipe.nameSnapshot || "Receta"}`
        : `•  ${recipe.nameSnapshot || "Receta"}  ·  ${servingsLabel(n)}`;
      doc.font(F.medium).fontSize(size.line).fillColor(INK).text(label, { indent: 16 });

      if (compact) {
        const ings = (recipe.ingredients || []).map((i) => i.food?.name).filter(Boolean);
        if (ings.length) {
          doc.font(F.regular).fontSize(size.ing).fillColor(MUTED).text(ings.join(", "), { indent: 26, lineGap: 0.5 });
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
          doc.font(F.regular).fontSize(size.ing).fillColor(MUTED).text(`–  ${foodLineText(ing)}`, { indent: 28 });
        }
        const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
        if (steps.length) {
          doc.moveDown(0.1);
          doc.font(F.medium).fontSize(size.ing).fillColor(INK).text("Preparación:", { indent: 28 });
          steps.forEach((step, i) => {
            doc.font(F.regular).fontSize(size.ing).fillColor(MUTED).text(`${i + 1}. ${step}`, { indent: 34, lineGap: 1 });
          });
        }
      }
    }

    if (showMacros) {
      const macros = macrosLine(computeOptionMacros(option));
      if (macros) doc.font(F.italic).fontSize(size.macros).fillColor(LIGHT).text(macros, { indent: 16 });
    }
    doc.moveDown(compact ? 0.25 : 0.45);
  });

  doc.moveDown(compact ? 0.15 : 0.3);
}

/**
 * Comentarios generales de la nutricionista, en su propia tarjeta y DEBAJO del
 * último día de la semana.
 */
function renderGeneralComments(doc, ctx) {
  const { plan, primary, F } = ctx;
  const text = (plan.description || "").trim();
  if (!text) return;

  const L = doc.page.margins.left;
  const W = contentWidth(doc);
  const innerW = W - CARD.padX * 2;

  const title = "Comentarios de tu nutricionista";
  doc.font(F.bold).fontSize(10);
  const titleH = doc.heightOfString(title, { width: innerW });
  doc.font(F.regular).fontSize(9.2);
  const textH = doc.heightOfString(text, { width: innerW, lineGap: 1.5 });
  const cardH = CARD.padTop + titleH + 5 + textH + CARD.padBottom;

  const fullPageH = pageBottom(doc) - doc.page.margins.top;
  if (cardH > fullPageH) {
    // Comentario kilométrico: sin tarjeta, fluyendo, pero ENTERO (nunca
    // recortado — es lo que la nutricionista le quiere decir al paciente).
    ensureSpace(doc, 60);
    doc.font(F.bold).fontSize(10).fillColor(primary).text(title, L, doc.y, { width: W });
    doc.moveDown(0.3);
    doc.font(F.regular).fontSize(9.2).fillColor(INK).text(text, L, doc.y, { width: W, lineGap: 1.5 });
    return;
  }

  if (doc.y + cardH > pageBottom(doc)) doc.addPage();
  const top = doc.y;
  drawCardBackground(doc, L, top, W, cardH, primary);
  doc.font(F.bold).fontSize(10).fillColor(primary)
    .text(title, L + CARD.padX, top + CARD.padTop, { width: innerW });
  doc.font(F.regular).fontSize(9.2).fillColor(INK)
    .text(text, L + CARD.padX, top + CARD.padTop + titleH + 5, { width: innerW, lineGap: 1.5 });

  doc.x = L;
  doc.y = top + cardH + CARD.gap;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 3 — Recetario: cada receta usada, al detalle
// ─────────────────────────────────────────────────────────────────────────────
function renderRecipeBook(doc, ctx) {
  const { plan, primary, F } = ctx;
  const recipes = collectUsedRecipes(plan);
  if (recipes.length === 0) return;

  switchToPortrait(doc);
  doc.addPage();
  const W = contentWidth(doc);

  doc.font(F.bold).fontSize(17).fillColor(primary).text("Tus recetas");
  doc.moveDown(0.2);
  doc.font(F.regular).fontSize(9.5).fillColor(MUTED)
    .text("Cómo preparar cada plato de tu pauta, con sus ingredientes y sus pasos.", { width: W });
  doc.moveDown(0.9);

  for (const recipe of recipes) renderRecipeCard(doc, recipe, ctx);
}

function renderRecipeCard(doc, recipe, ctx) {
  const { primary, showMacros, photoBuffers, F } = ctx;
  const L = doc.page.margins.left;
  const W = contentWidth(doc);
  const innerW = W - CARD.padX * 2;

  const photo = recipe.photoPath ? photoBuffers?.get(recipe.photoPath) : null;
  const photoW = 124;
  const photoH = 93;
  const headW = photo ? innerW - photoW - 13 : innerW;

  // Cabecera: nombre, raciones, ingredientes (y macros si procede).
  const head = [];
  head.push(blk(recipe.nameSnapshot || "Receta", { font: F.bold, size: 12.5, color: primary, gapAfter: 1 }));
  head.push(blk(servingsLabel(recipe.servings), { font: F.regular, size: 8.5, color: LIGHT, gapAfter: 5 }));
  head.push(blk("Ingredientes", { font: F.bold, size: 9, color: INK, gapAfter: 2 }));
  const ings = recipe.ingredients || [];
  if (ings.length === 0) {
    head.push(blk("—", { font: F.regular, size: 9, color: MUTED }));
  } else {
    for (const ing of ings) {
      head.push(blk(`•  ${foodLineText(ing)}`, { font: F.regular, size: 9, color: MUTED, lineGap: 0.5 }));
    }
  }
  if (showMacros) {
    const macros = macrosLine(computeRecipeMacros({ ingredients: ings }));
    if (macros) head.push(blk(macros, { font: F.italic, size: 8, color: LIGHT, options: null, gapAfter: 0 }));
  }

  const headH = Math.max(photo ? photoH : 0, blocksHeight(doc, head, headW));

  // Pasos, a ancho completo bajo la foto.
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const body = [];
  if (steps.length) {
    body.push(blk("Preparación", { font: F.bold, size: 9, color: INK, gapAfter: 3 }));
    steps.forEach((step, i) => {
      body.push(blk(step, {
        font: F.regular,
        size: 9,
        color: INK,
        indent: 20,
        lineGap: 1,
        gapAfter: 3,
        prefix: { text: `${i + 1}.`, font: F.bold, size: 9, color: primary },
      }));
    });
  }
  const bodyH = blocksHeight(doc, body, innerW);
  const cardH = CARD.padTop + headH + (steps.length ? 10 : 0) + bodyH + CARD.padBottom;

  const fullPageH = pageBottom(doc) - doc.page.margins.top;
  if (cardH > fullPageH) {
    // Receta gigantesca: sin tarjeta, fluyendo (nunca se recorta).
    renderRecipeFlowing(doc, recipe, ctx, { photo, head, body, headW, innerW, photoW, photoH });
    return;
  }

  if (doc.y + cardH > pageBottom(doc)) doc.addPage();

  const top = doc.y;
  drawCardBackground(doc, L, top, W, cardH, primary);

  if (photo) {
    try {
      doc.image(photo, L + CARD.padX, top + CARD.padTop, { fit: [photoW, photoH] });
    } catch {
      /* imagen corrupta: la tarjeta se pinta igual, sin foto */
    }
  }
  drawBlocks(doc, head, L + CARD.padX + (photo ? photoW + 13 : 0), top + CARD.padTop, headW);
  if (steps.length) {
    drawBlocks(doc, body, L + CARD.padX, top + CARD.padTop + headH + 10, innerW);
  }

  doc.x = L;
  doc.y = top + cardH + CARD.gap;
}

/** Plan B de la receta: sin tarjeta, dejando paginar a pdfkit. */
function renderRecipeFlowing(doc, recipe, ctx, { photo, head, body, headW, innerW, photoW, photoH }) {
  const L = doc.page.margins.left;
  ensureSpace(doc, 140);
  const top = doc.y;
  if (photo) {
    try {
      doc.image(photo, L, top, { fit: [photoW, photoH] });
    } catch {
      /* sin foto */
    }
  }
  const endHead = drawBlocks(doc, head, L + (photo ? photoW + 13 : 0), top, headW);
  doc.x = L;
  doc.y = Math.max(endHead, photo ? top + photoH : top) + 10;
  for (const b of body) {
    ensureSpace(doc, 26);
    // drawBlocks devuelve el borde inferior: NO sumar además la altura, que
    // pdfkit ya ha movido doc.y al pintar (dejaba un hueco del doble).
    doc.y = drawBlocks(doc, [b], L, doc.y, innerW);
  }
  doc.x = L;
  doc.moveDown(0.9);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cabecera del render plano (planes sin días)
// ─────────────────────────────────────────────────────────────────────────────
function renderPlainHeader(doc, ctx) {
  const { plan, client, tenantName, primary, F } = ctx;
  const W = contentWidth(doc);

  doc.font(F.medium).fontSize(9).fillColor(MUTED)
    .text((tenantName || "").toUpperCase(), { characterSpacing: 1.5 });
  doc.moveDown(0.4);
  doc.font(F.bold).fontSize(20).fillColor(primary).text(plan.name || "Pauta nutricional");

  const sub = [];
  if (client?.name) sub.push(`Paciente: ${client.name}`);
  const assigned = fmtDate(plan.assignedAt);
  if (assigned) sub.push(`Asignado: ${assigned}`);
  if (sub.length) {
    doc.moveDown(0.25);
    doc.font(F.regular).fontSize(10).fillColor(MUTED).text(sub.join("   ·   "));
  }

  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + W, doc.y)
    .lineWidth(0.7).strokeColor(primary).stroke();
  doc.moveDown(0.9);

  const description = (plan.description || "").trim();
  if (description) {
    ensureSpace(doc, 70);
    doc.font(F.bold).fontSize(11.5).fillColor(primary).text("Comentarios de tu nutricionista");
    doc.moveDown(0.3);
    doc.font(F.regular).fontSize(10).fillColor(INK).text(description, { lineGap: 2 });
    doc.moveDown(0.9);
  }
}
