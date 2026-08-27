"use client";

// modules/nutricion/planEditor/semana.jsx — la vista semanal del editor de
// pautas: pestañas de días, rejilla de la semana y el detalle de un día con
// sus tramos. Aquí viven los nombres de los días y las comidas estándar.

// ────────────────────────────────────────────────────────────────────────────
// Semana real (rework 2026-07-22). WEEKDAYS[0]="Lunes" ↔ weekday=1 … 7=Domingo.
// WeekTabs: pestañas de día con contador de comidas rellenas. WeekGrid: la
// semana completa de un vistazo, cada celda es una comida clicable.
// ────────────────────────────────────────────────────────────────────────────


import { useEffect, useState } from "react";
import { computeMealMacros } from "../../../lib/nutricion/macros.js";
import { fmtGNumber } from "./ui.jsx";
export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// Las 5 grandes comidas de cada día (rediseño 2026-07-22): estructura FIJA,
// sin "Añadir comida" con nombre libre.
export const STANDARD_MEALS = ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena"];

export function mealFilled(meal) {
  return (meal.options || []).some((o) => (o.foods || []).length > 0 || (o.recipes || []).length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// DayView — un día del menú: comentarios del día + las 5 grandes comidas, una
// debajo de otra. Cada sección: recetas (+ "Añadir receta") y comentarios.
// Las comidas con nombre no estándar (renombradas o antiguas) se muestran
// después de las 5, con botón para quitarlas — nada queda oculto.
// ────────────────────────────────────────────────────────────────────────────

export function DayView({
  day, meals, dayComment, onSaveDayComment, onOpenPicker,
  onSaveSectionComment, onUpdateRecipe, onDeleteRecipe, onDeleteFood, onDeleteMeal,
}) {
  const [commentDraft, setCommentDraft] = useState(dayComment);
  useEffect(() => { setCommentDraft(dayComment); }, [day, dayComment]);

  const norm = (s) => (s || "").trim().toLowerCase();
  const used = new Set();
  const sections = STANDARD_MEALS.map((name, idx) => {
    const meal = meals.find((m) => !used.has(m.id) && norm(m.name) === norm(name)) || null;
    if (meal) used.add(meal.id);
    return { day, sectionName: name, sectionIndex: idx, meal };
  });
  const extras = meals.filter((m) => !used.has(m.id));

  return (
    <div className="space-y-3">
      {/* Comentarios del día */}
      <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
          Comentarios del {WEEKDAYS[day - 1].toLowerCase()}
        </div>
        <textarea
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          onBlur={() => onSaveDayComment(commentDraft)}
          placeholder={`Notas para todo el ${WEEKDAYS[day - 1].toLowerCase()} (batch cooking, hidratación…)`}
          rows={2}
          className="w-full text-sm rounded-md border border-gray-100 bg-gray-50/50 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:bg-white resize-y"
        />
      </div>

      {sections.map((section) => (
        <DaySection
          key={section.sectionName}
          section={section}
          onOpenPicker={onOpenPicker}
          onSaveComment={onSaveSectionComment}
          onUpdateRecipe={onUpdateRecipe}
          onDeleteRecipe={onDeleteRecipe}
          onDeleteFood={onDeleteFood}
        />
      ))}

      {extras.map((meal) => (
        <DaySection
          key={meal.id}
          section={{ day, sectionName: meal.name, sectionIndex: 99, meal }}
          isExtra
          onOpenPicker={onOpenPicker}
          onSaveComment={onSaveSectionComment}
          onUpdateRecipe={onUpdateRecipe}
          onDeleteRecipe={onDeleteRecipe}
          onDeleteFood={onDeleteFood}
          onDeleteMeal={onDeleteMeal}
        />
      ))}
    </div>
  );
}

// Una gran comida del día: título, recetas con foto/raciones, alimentos
// sueltos heredados, "+ Añadir receta" y comentarios de la sección.
export function DaySection({
  section, isExtra = false,
  onOpenPicker, onSaveComment, onUpdateRecipe, onDeleteRecipe, onDeleteFood, onDeleteMeal,
}) {
  const { sectionName, meal } = section;
  const [commentDraft, setCommentDraft] = useState(meal?.description || "");
  useEffect(() => { setCommentDraft(meal?.description || ""); }, [meal?.id, meal?.description]);

  // Filas de contenido de TODAS las opciones (los planes nuevos tienen una;
  // en los heredados con alternativas, cada fila conoce su opción).
  const options = (meal?.options || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const multi = options.length > 1;
  const macros = meal ? computeMealMacros(meal) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3.5 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          {sectionName}
          {isExtra && <span className="ml-2 text-[10px] font-normal normal-case text-amber-600">(comida extra)</span>}
        </h4>
        <div className="flex items-center gap-2">
          {macros && macros.protein !== null && (
            <span className="text-[10px] text-gray-400 tabular-nums">
              P {fmtGNumber(macros.protein)} · C {fmtGNumber(macros.carbs)} · G {fmtGNumber(macros.fat)}
            </span>
          )}
          {isExtra && onDeleteMeal && (
            <button
              type="button"
              onClick={() => onDeleteMeal(meal)}
              className="text-gray-300 hover:text-red-600"
              aria-label={`Eliminar ${sectionName}`}
              title="Eliminar esta comida extra"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-3.5 h-3.5"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-3.5 pb-3 space-y-1.5">
        {options.map((option) => (
          <div key={option.id} className="space-y-1.5">
            {multi && ((option.recipes || []).length > 0 || (option.foods || []).length > 0) && (
              <div className="text-[10px] uppercase tracking-wider text-gray-400 pt-1">
                {option.isDefault ? "⭐ " : ""}{option.name}
              </div>
            )}
            {(option.recipes || []).map((pmor) => (
              <SectionRecipeRow
                key={pmor.id}
                pmor={pmor}
                onServings={(servings) => onUpdateRecipe(meal, option, pmor, { servings })}
                onDelete={() => onDeleteRecipe(meal, option, pmor)}
              />
            ))}
            {(option.foods || []).map((line) => (
              <div key={line.id} className="flex items-center gap-2 text-sm text-gray-700 rounded-md border border-gray-100 bg-gray-50/40 px-2.5 py-1.5">
                <span className="flex-1 min-w-0 truncate">
                  {line.food?.name ?? "Alimento"}
                  <span className="text-gray-400 text-xs ml-1.5">
                    {line.unit === "g" ? `${fmtGNumber(line.amount)} g` : line.unit === "household" ? `${fmtGNumber(line.amount)} ${line.householdLabel || "ud."}` : line.notes || "cantidad libre"}
                  </span>
                </span>
                <button type="button" onClick={() => onDeleteFood(meal, option, line)} className="text-gray-300 hover:text-red-600" aria-label="Quitar alimento">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-3.5 h-3.5"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        ))}

        {!meal || options.every((o) => (o.recipes || []).length === 0 && (o.foods || []).length === 0) ? (
          <div className="text-xs text-gray-300 py-0.5">Sin recetas todavía.</div>
        ) : null}

        <button
          type="button"
          onClick={() => onOpenPicker(section)}
          className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md border border-dashed border-[var(--color-primary)]/40 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition"
        >
          + Añadir receta
        </button>

        <input
          type="text"
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          onBlur={() => onSaveComment(section, commentDraft)}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
          placeholder={`Comentarios de ${sectionName.toLowerCase()}…`}
          className="w-full text-xs text-gray-600 px-2.5 py-1.5 rounded-md border border-gray-100 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:bg-white"
        />
      </div>
    </div>
  );
}

// Fila de receta dentro de una gran comida: foto mini, nombre, raciones, quitar.
export function SectionRecipeRow({ pmor, onServings, onDelete }) {
  const [servingsDraft, setServingsDraft] = useState(pmor.servings ?? 1);
  useEffect(() => { setServingsDraft(pmor.servings ?? 1); }, [pmor.id, pmor.servings]);

  function commit() {
    const n = Number(servingsDraft);
    if (!Number.isFinite(n) || n <= 0) { setServingsDraft(pmor.servings ?? 1); return; }
    if (n !== Number(pmor.servings ?? 1)) onServings(n);
  }

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-gray-100 px-2.5 py-1.5">
      {pmor.photoPath && pmor.recipeId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/nutricion/recipes/${pmor.recipeId}/photo`}
          alt=""
          loading="lazy"
          className="w-9 h-9 object-cover rounded shrink-0 border border-gray-100"
        />
      ) : (
        <div className="w-9 h-9 rounded shrink-0 bg-[var(--color-primary)]/[0.07] flex items-center justify-center text-[var(--color-primary)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-3-4.87v-1.5m-6 1.5v-1.5m12 9.75-1.5.75a3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0L3 16.5m15-3.379a48.474 48.474 0 0 0-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 0 1 3 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 0 1 6 13.12" /></svg>
        </div>
      )}
      <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{pmor.nameSnapshot || "Receta"}</span>
      <label className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
        <input
          type="number"
          step="0.5"
          min="0.5"
          value={servingsDraft}
          onChange={(e) => setServingsDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
          className="w-14 px-1.5 py-1 text-xs text-right rounded border border-gray-200"
          aria-label="Raciones"
        />
        rac.
      </label>
      <button type="button" onClick={onDelete} className="text-gray-300 hover:text-red-600 shrink-0" aria-label="Quitar receta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

export function WeekTabs({ activeDay, onSelect, meals, showLegacyTab }) {
  return (
    <div className="flex gap-1 flex-wrap mb-3">
      {WEEKDAYS.map((name, i) => {
        const d = i + 1;
        const filled = meals.filter((m) => m.weekday === d && mealFilled(m)).length;
        const on = activeDay === d;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            title={`${name}: ${filled} comida${filled === 1 ? "" : "s"} con contenido`}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition flex items-center gap-1.5 ${
              on
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-white border-gray-200 text-gray-600 hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
            }`}
          >
            {name.slice(0, 3)}
            {filled > 0 && (
              <span className={`text-[9px] rounded-full px-1 min-w-[14px] text-center ${on ? "bg-white/25" : "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"}`}>
                {filled}
              </span>
            )}
          </button>
        );
      })}
      {showLegacyTab && (
        <button
          type="button"
          onClick={() => onSelect(0)}
          title="Comidas que aún no tienen día asignado"
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition ${
            activeDay === 0
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-amber-50 border-amber-200 text-amber-700 hover:border-amber-400"
          }`}
        >
          Sin día
        </button>
      )}
    </div>
  );
}

// Resumen ultracorto del contenido de una comida para la celda de la semana:
// nombres de recetas + nº de alimentos sueltos de la opción por defecto.
export function mealCellSummary(meal) {
  const opt = (meal.options || []).find((o) => o.isDefault) || (meal.options || [])[0];
  if (!opt) return null;
  const parts = (opt.recipes || []).map((r) => r.nameSnapshot || "Receta");
  const nFoods = (opt.foods || []).length;
  if (nFoods > 0) parts.push(`${nFoods} alimento${nFoods === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

export function WeekGrid({ meals, onPickMeal }) {
  const legacy = meals.filter((m) => m.weekday == null);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="grid grid-cols-7 gap-1.5 min-w-[760px]">
        {WEEKDAYS.map((name, i) => {
          const d = i + 1;
          const dayMeals = meals
            .filter((m) => m.weekday === d)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          return (
            <div key={d} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-primary)] text-center py-1 bg-[var(--color-primary)]/[0.07] rounded-t-md">
                {name}
              </div>
              <div className="space-y-1 border border-t-0 border-gray-100 rounded-b-md p-1 bg-gray-50/40">
                {dayMeals.map((meal) => {
                  const summary = mealCellSummary(meal);
                  const filled = mealFilled(meal);
                  return (
                    <button
                      key={meal.id}
                      type="button"
                      onClick={() => onPickMeal(meal)}
                      title={`${name} · ${meal.name} — clic para editar`}
                      className={`w-full text-left rounded px-1.5 py-1 border transition ${
                        filled
                          ? "bg-white border-gray-200 hover:border-[var(--color-primary)]/50"
                          : "bg-transparent border-dashed border-gray-200 hover:border-[var(--color-primary)]/40"
                      }`}
                    >
                      <div className={`text-[10px] font-semibold truncate ${filled ? "text-gray-800" : "text-gray-400"}`}>{meal.name}</div>
                      {summary ? (
                        <div className="text-[9.5px] text-gray-500 leading-tight line-clamp-2">{summary}</div>
                      ) : (
                        <div className="text-[9.5px] text-gray-300">vacío</div>
                      )}
                    </button>
                  );
                })}
                {dayMeals.length === 0 && <div className="text-[9.5px] text-gray-300 text-center py-2">—</div>}
              </div>
            </div>
          );
        })}
      </div>
      {legacy.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          Hay {legacy.length} comida{legacy.length === 1 ? "" : "s"} sin día asignado (pestaña “Sin día”).
          Ábrelas y asígnales un día para que aparezcan en la semana.
        </div>
      )}
    </div>
  );
}
