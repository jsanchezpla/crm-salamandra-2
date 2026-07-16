import PDFDocument from "pdfkit";
import { computeOptionMacros } from "./macros.js";

/**
 * Genera el PDF del menú de un plan nutricional con pdfkit (server-side, sin
 * navegador headless). Devuelve un Buffer (un menú = 1-3 páginas, cabe en
 * memoria sin problema).
 *
 * Datos:
 *   - plan:   árbol de `loadPlanTree` (meals → options → foods + recipes),
 *             es decir, el MISMO shape que consume el editor. Las recetas van
 *             congeladas (snapshot) con sus ingredientes normalizados.
 *   - client: { name } del paciente (null en plantillas).
 *   - tenantName / brand: para cabecera y color de acento
 *     (tenant.settings.brand.primaryColor).
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

export function buildMenuPdfBuffer({ plan, client, tenantName, brand }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      renderMenu(doc, { plan, client, tenantName, brand: brand || {} });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderMenu(doc, { plan, client, tenantName, brand }) {
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

  // ── Comidas ────────────────────────────────────────────────────────────────
  const meals = plan.meals || [];
  if (meals.length === 0) {
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Este plan aún no tiene comidas.");
  }

  for (const meal of meals) {
    // Evitar que el título de una comida quede huérfano al final de página.
    ensureSpace(doc, 90);

    doc.font("Helvetica-Bold").fontSize(13.5).fillColor(primary).text(meal.name || "Comida");
    doc.moveDown(0.35);

    const options = meal.options || [];
    if (options.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Sin opciones definidas.", { indent: 10 });
      doc.moveDown(0.6);
      continue;
    }

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
        for (const ing of recipe.ingredients || []) {
          doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`–  ${foodLineText(ing)}`, { indent: 30 });
        }
      }

      if ((option.foods || []).length === 0 && (option.recipes || []).length === 0) {
        doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("(vacía)", { indent: 18 });
      }

      const macros = macrosLine(option);
      if (macros) {
        doc.moveDown(0.1);
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(LIGHT).text(macros, { indent: 18 });
      }
      doc.moveDown(0.45);
    });

    doc.moveDown(0.35);
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
