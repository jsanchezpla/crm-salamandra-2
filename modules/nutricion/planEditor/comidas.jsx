"use client";

// modules/nutricion/planEditor/comidas.jsx — la columna izquierda del editor
// de pautas: el acordeón de cada comida con sus opciones (pestañas), y dentro
// la tabla de alimentos, las recetas enlazadas y las filas de añadir, con el
// selector de medidas caseras.


import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import {
  computeFoodMacros,
  computeOptionMacros,
  computeRecipeMacros,
  scaleMacros,
} from "../../../lib/nutricion/macros.js";
import { fmtGNumber } from "./ui.jsx";
import { WEEKDAYS } from "./semana.jsx";
export function MealAccordion({
  meal, index, total, expanded, onToggle,
  activeOptionId, onSelectOption,
  onRename, onUpdateDescription, onChangeWeekday, onDelete, onMoveUp, onMoveDown,
  onAddOption, onRenameOption, onSetDefaultOption, onDeleteOption,
  onAddFood, onUpdateFood, onDeleteFood,
  onAddRecipe, onUpdateRecipe, onDeleteRecipe,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [descDraft, setDescDraft] = useState(meal.description || "");

  useEffect(() => { setDescDraft(meal.description || ""); }, [meal.description]);

  const options = (meal.options || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const activeOption =
    options.find((o) => o.id === activeOptionId) ||
    options.find((o) => o.isDefault) ||
    options[0] ||
    null;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header del acordeón */}
      <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2.5 min-w-0 text-left"
        >
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-900 text-sm truncate">{meal.name}</span>
          <span className="text-[11px] text-gray-400">
            ({options.length} {options.length === 1 ? "opción" : "opciones"})
          </span>
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-gray-400 hover:text-gray-700 transition p-1.5"
            aria-label="Menú de la comida"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 12h14M5 16h14" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-20 w-44 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-xs">
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onClick={() => { setMenuOpen(false); onRename(); }}
                >Renombrar</button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() => { setMenuOpen(false); onMoveUp(); }}
                >↑ Subir</button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  disabled={index === total - 1}
                  onClick={() => { setMenuOpen(false); onMoveDown(); }}
                >↓ Bajar</button>
                <button
                  className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                >Eliminar comida</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cuerpo expandido */}
      {expanded && (
        <div className="border-t border-gray-100 p-3.5 space-y-3.5 bg-gray-50/50">
          {/* Descripción + día de la semana */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => onUpdateDescription(descDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
              }}
              placeholder="Descripción de la comida (ej. DESAYUNO + BEBIDA + FRUTA)…"
              className="flex-1 min-w-0 text-xs uppercase tracking-wider text-gray-700 px-3 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
            {/* Cambiar la comida de día (imprescindible en menús pre-rework
                cuyas comidas nacieron "sin día"). */}
            <Select
              value={meal.weekday != null ? String(meal.weekday) : ""}
              onChange={(v) => onChangeWeekday(v === "" ? null : Number(v))}
              options={[
                { value: "", label: "Sin día" },
                ...WEEKDAYS.map((name, i) => ({ value: String(i + 1), label: name })),
              ]}
              className="w-32 shrink-0 px-2 py-1.5 text-xs rounded-md border border-gray-200 bg-white"
              aria-label="Día de la semana de esta comida"
            />
          </div>

          {/* Pills de opciones */}
          <OptionPills
            options={options}
            activeOptionId={activeOption?.id}
            onSelect={onSelectOption}
            onAdd={onAddOption}
            onRename={onRenameOption}
            onSetDefault={onSetDefaultOption}
            onDelete={onDeleteOption}
          />

          {/* Opción activa: recetas (Sprint 8.2) + tabla de alimentos sueltos */}
          {activeOption ? (
            <div className="space-y-3">
              <OptionRecipes
                option={activeOption}
                onAddRecipe={onAddRecipe}
                onUpdateRecipe={onUpdateRecipe}
                onDeleteRecipe={onDeleteRecipe}
              />
              <OptionTable
                option={activeOption}
                onAdd={onAddFood}
                onUpdate={onUpdateFood}
                onDelete={onDeleteFood}
              />
            </div>
          ) : (
            <div className="text-center text-xs text-gray-400 py-4">
              Esta comida no tiene opciones. Añade una para empezar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OptionPills({ options, activeOptionId, onSelect, onAdd, onRename, onSetDefault, onDelete }) {
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map((o) => {
        const isActive = o.id === activeOptionId;
        return (
          <div key={o.id} className="relative">
            <button
              onClick={() => onSelect(o.id)}
              onContextMenu={(e) => { e.preventDefault(); setMenuOpenFor(o.id); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition flex items-center gap-1 ${
                isActive
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                  : "bg-white text-[var(--color-primary)] border-[var(--color-primary)]/40 hover:bg-[var(--color-primary)]/5"
              }`}
            >
              {o.isDefault && <span title="Por defecto">⭐</span>}
              <span>{o.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); setMenuOpenFor(o.id); }}
                className={`text-[11px] opacity-70 hover:opacity-100 ml-0.5 ${isActive ? "text-white" : "text-[var(--color-primary)]"}`}
                aria-label="Acciones de la opción"
              >
                ▾
              </span>
            </button>
            {menuOpenFor === o.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenFor(null)} />
                <div className="absolute left-0 top-full mt-1 z-20 w-44 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-xs">
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                    onClick={() => { setMenuOpenFor(null); onRename(o); }}
                  >Renombrar</button>
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                    disabled={o.isDefault}
                    onClick={() => { setMenuOpenFor(null); onSetDefault(o); }}
                  >Marcar por defecto ⭐</button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                    onClick={() => { setMenuOpenFor(null); onDelete(o); }}
                  >Eliminar opción</button>
                </div>
              </>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 transition"
      >
        + opción
      </button>
    </div>
  );
}

export function OptionTable({ option, onAdd, onUpdate, onDelete }) {
  const foods = (option.foods || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totals = useMemo(() => computeOptionMacros(option), [option]);

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-2.5 py-1.5 font-semibold w-20">Cant.</th>
              <th className="px-2.5 py-1.5 font-semibold w-40">Unidad</th>
              <th className="px-2.5 py-1.5 font-semibold">Alimento</th>
              <th className="px-2 py-1.5 font-semibold text-right w-14">Prot.</th>
              <th className="px-2 py-1.5 font-semibold text-right w-14">Carbs</th>
              <th className="px-2 py-1.5 font-semibold text-right w-14">Grasas</th>
              <th className="px-2 py-1.5 font-semibold text-right w-14">Fibra</th>
              <th className="px-2 py-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {foods.map((f) => (
              <FoodRow
                key={f.id}
                line={f}
                onUpdate={(updates) => onUpdate(f, updates)}
                onDelete={() => onDelete(f)}
              />
            ))}
            <AddFoodRow onAdd={onAdd} />
          </tbody>
          <tfoot>
            <tr className="bg-gray-50/80 text-[11px] text-gray-700 font-medium">
              <td colSpan={3} className="px-2.5 py-1.5">Total opción</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtGNumber(totals.protein)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtGNumber(totals.carbs)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtGNumber(totals.fat)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtGNumber(totals.fiber)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// OptionRecipes — recetas (congeladas) dentro de una opción + añadir (Sprint 8.2)
// ────────────────────────────────────────────────────────────────────────────

export function OptionRecipes({ option, onAddRecipe, onUpdateRecipe, onDeleteRecipe }) {
  const recipes = (option.recipes || []).slice().sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
  return (
    <div className="rounded-md border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/[0.03] p-2.5 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-primary)] font-semibold px-0.5">
        Recetas de la opción
      </div>
      {recipes.length === 0 && (
        <div className="text-[11px] text-gray-400 px-0.5">Sin recetas. Añade una del recetario.</div>
      )}
      {recipes.map((r) => (
        <RecipeInOptionRow
          // servings en la key: al cambiar (loadPlan) remonta con el draft
          // inicializado, evitando un setState-en-efecto para sincronizar.
          key={`${r.id}:${r.servings}`}
          pmor={r}
          onUpdate={(updates) => onUpdateRecipe(r, updates)}
          onDelete={() => onDeleteRecipe(r)}
        />
      ))}
      <AddRecipeRow onAdd={onAddRecipe} />
    </div>
  );
}

export function RecipeInOptionRow({ pmor, onUpdate, onDelete }) {
  // servingsDraft se inicializa del prop; el remonte por `key` (ver OptionRecipes)
  // lo re-sincroniza tras cada cambio, sin setState-en-efecto.
  const [servingsDraft, setServingsDraft] = useState(String(pmor.servings ?? 1));

  const base = computeRecipeMacros({ ingredients: pmor.ingredients || [] });
  const macros = scaleMacros(base, Number(servingsDraft) || pmor.servings || 1);
  const nIng = (pmor.ingredients || []).length;

  function commitServings() {
    const n = Number(servingsDraft);
    if (!Number.isFinite(n) || n <= 0) { setServingsDraft(String(pmor.servings ?? 1)); return; }
    if (n === Number(pmor.servings)) return;
    onUpdate({ servings: Math.round(n * 100) / 100 });
  }

  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-2.5 py-1.5">
      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate" title={pmor.nameSnapshot}>{pmor.nameSnapshot}</span>
      <span className="text-[10px] text-gray-400 hidden sm:inline">{nIng} ing.</span>
      <label className="flex items-center gap-1 text-[11px] text-gray-500">
        <input
          type="number" step="0.5" min="0.5"
          value={servingsDraft}
          onChange={(e) => setServingsDraft(e.target.value)}
          onBlur={commitServings}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          className="w-14 px-1.5 py-1 text-right rounded border border-gray-200 text-xs"
        />
        <span>rac.</span>
      </label>
      <span className="text-[11px] text-gray-500 tabular-nums w-24 text-right hidden sm:inline">
        P{fmtGNumber(macros.protein)} C{fmtGNumber(macros.carbs)} G{fmtGNumber(macros.fat)}
      </span>
      <button type="button" onClick={onDelete} className="text-gray-300 hover:text-red-500" aria-label="Quitar receta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

export function AddRecipeRow({ onAdd }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const query = q.trim();
      if (query.length < 1) { setResults([]); setOpen(false); return; }
      try {
        const r = await fetch(`/api/nutricion/recipes?q=${encodeURIComponent(query)}&limit=8`);
        const j = await r.json();
        setResults(j.items ?? []);
        setOpen(true);
      } catch { /* noop */ }
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="relative">
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="+ Añadir receta del recetario…"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-dashed border-[var(--color-primary)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
      />
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {results.map((r) => (
            <button
              key={r.id} type="button"
              onClick={() => { onAdd(r.id, 1); setQ(""); setResults([]); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex justify-between gap-2"
            >
              <span className="truncate">{r.name}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{r.ingredientCount} ing.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FoodRow — fila editable de un alimento dentro de una opción
// ────────────────────────────────────────────────────────────────────────────

export function FoodRow({ line, onUpdate, onDelete }) {
  const [amountDraft, setAmountDraft] = useState(line.amount ?? "");
  useEffect(() => { setAmountDraft(line.amount ?? ""); }, [line.amount]);

  const macros = useMemo(() => computeFoodMacros(line), [line]);
  const measures = Array.isArray(line.food?.householdMeasures) ? line.food.householdMeasures : [];

  async function commitAmount() {
    const v = String(amountDraft).trim();
    if (v === "") {
      setAmountDraft(line.amount ?? "");
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      setAmountDraft(line.amount ?? "");
      return;
    }
    if (Number(line.amount) === n) return;
    await onUpdate({ amount: n });
  }

  async function changeUnit(newUnit) {
    if (newUnit === line.unit) return;
    if (newUnit === "g") {
      // Cuando venimos de household, preservar el peso total real
      // (amount × householdGrams) para no perder datos. P. ej. 2 cucharadas
      // de aceite (15g/cucharada) → 30g en modo gramos, no 2g.
      let computedAmount;
      if (
        line.unit === "household" &&
        Number(line.amount) > 0 &&
        Number(line.householdGrams) > 0
      ) {
        computedAmount = Number(line.amount) * Number(line.householdGrams);
      } else {
        computedAmount = Number(line.amount) || Number(line.householdGrams) || 100;
      }
      await onUpdate({
        unit: "g",
        amount: computedAmount,
        householdLabel: null,
        householdGrams: null,
      });
    } else if (newUnit === "free") {
      await onUpdate({
        unit: "free",
        amount: null,
        householdLabel: null,
        householdGrams: null,
      });
    } else if (newUnit === "household") {
      // Necesitamos una medida casera. Si el alimento tiene al menos una,
      // usamos la primera; si no, fallback a "1 unidad" 100g (Laura podrá
      // ajustar luego o crear la medida desde el catálogo).
      const first = measures[0];
      const label = first?.label || "1 unidad";
      const grams = Number(first?.grams) || 100;
      await onUpdate({
        unit: "household",
        amount: 1,
        householdLabel: label,
        householdGrams: grams,
      });
    }
  }

  async function changeHouseholdMeasure(label) {
    const m = measures.find((x) => x.label === label);
    if (!m) return;
    await onUpdate({
      householdLabel: m.label,
      householdGrams: Number(m.grams),
    });
  }

  return (
    <tr className="hover:bg-gray-50/50">
      {/* Cantidad */}
      <td className="px-2.5 py-1.5">
        {line.unit === "free" ? (
          <span className="text-gray-300 text-xs">—</span>
        ) : (
          <input
            type="number"
            step="0.1"
            min="0"
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            className="w-16 px-1.5 py-1 text-xs text-right rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        )}
      </td>

      {/* Unidad + (si household) medida */}
      <td className="px-2.5 py-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          <Select
            value={line.unit}
            onChange={(v) => changeUnit(v)}
            options={[
              { value: "g", label: "gramos" },
              { value: "household", label: "medida casera" },
              { value: "free", label: "sin cantidad" },
            ]}
            className="px-1.5 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white"
          />
          {line.unit === "household" && (
            <HouseholdMeasureSelect
              foodId={line.foodId}
              measures={measures}
              currentLabel={line.householdLabel}
              onChange={changeHouseholdMeasure}
            />
          )}
        </div>
      </td>

      {/* Alimento */}
      <td className="px-2.5 py-1.5">
        <div className="font-medium text-gray-900 text-xs leading-tight">
          {line.food?.name || <span className="text-red-600">alimento archivado</span>}
        </div>
        {line.notes && (
          <div className="text-[10px] text-gray-500 mt-0.5 italic">{line.notes}</div>
        )}
      </td>

      {/* Macros calculados */}
      <td className="px-2 py-1.5 text-right text-[11px] text-gray-700 tabular-nums">{fmtGNumber(macros.protein)}</td>
      <td className="px-2 py-1.5 text-right text-[11px] text-gray-700 tabular-nums">{fmtGNumber(macros.carbs)}</td>
      <td className="px-2 py-1.5 text-right text-[11px] text-gray-700 tabular-nums">{fmtGNumber(macros.fat)}</td>
      <td className="px-2 py-1.5 text-right text-[11px] text-gray-700 tabular-nums">{fmtGNumber(macros.fiber)}</td>

      {/* Borrar */}
      <td className="px-1 py-1.5 text-right">
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 transition p-1"
          aria-label="Quitar alimento"
          title="Quitar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-3.5 h-3.5">
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HouseholdMeasureSelect — selector secundario de medidas caseras
// ────────────────────────────────────────────────────────────────────────────

export function HouseholdMeasureSelect({ foodId, measures, currentLabel, onChange }) {
  const [editingNew, setEditingNew] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function persistMeasure() {
    if (!newLabel.trim() || !Number.isFinite(Number(newGrams)) || Number(newGrams) <= 0) {
      setError("Etiqueta y gramos requeridos");
      return;
    }
    setSaving(true); setError(null);
    const merged = [...measures, { label: newLabel.trim(), grams: Number(newGrams) }];
    const r = await fetch(`/api/nutricion/foods/${foodId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdMeasures: merged }),
    });
    setSaving(false);
    if (r.ok) {
      onChange(newLabel.trim());
      setEditingNew(false);
      setNewLabel(""); setNewGrams("");
    } else {
      setError("Error al guardar la medida");
    }
  }

  if (editingNew) {
    return (
      <div className="inline-flex items-center gap-1 bg-white border border-[var(--color-primary)]/40 rounded px-1.5 py-0.5">
        <input
          autoFocus
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="ej. 1 plato"
          className="w-24 text-xs px-1 py-0.5 focus:outline-none"
        />
        <input
          type="number"
          step="0.1"
          min="0"
          value={newGrams}
          onChange={(e) => setNewGrams(e.target.value)}
          placeholder="g"
          className="w-14 text-xs px-1 py-0.5 text-right focus:outline-none"
        />
        <button
          onClick={persistMeasure}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 bg-[var(--color-primary)] text-white rounded disabled:opacity-50"
        >
          {saving ? "…" : "OK"}
        </button>
        <button
          onClick={() => { setEditingNew(false); setError(null); }}
          className="text-[10px] px-1 text-gray-400 hover:text-gray-700"
        >
          ✕
        </button>
        {error && <span className="text-[10px] text-red-600 ml-1">{error}</span>}
      </div>
    );
  }

  return (
    <Select
      value={currentLabel ?? ""}
      onChange={(v) => {
        if (v === "__new__") setEditingNew(true);
        else onChange(v);
      }}
      options={[
        ...measures.map((m) => ({ value: m.label, label: `${m.label} (${m.grams}g)` })),
        ...(measures.length === 0
          ? [{ value: "", label: "Sin medidas — añade una", disabled: true }]
          : []),
        { value: "__new__", label: "+ Añadir medida nueva…" },
      ]}
      className="px-1.5 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white max-w-[150px]"
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AddFoodRow — fila final con autocomplete para añadir un alimento nuevo
// ────────────────────────────────────────────────────────────────────────────

export function AddFoodRow({ onAdd }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (query.trim().length < 1) {
      setResults([]); return;
    }
    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/nutricion/foods?q=${encodeURIComponent(query.trim())}&limit=10`);
        const j = await r.json();
        if (j.ok) setResults(j.items || []);
      } catch { /* noop */ }
      setLoading(false);
    }, 300);
    return () => debounceTimer.current && clearTimeout(debounceTimer.current);
  }, [query]);

  async function handlePick(food) {
    // Por defecto añadimos en modo 'g' con 100g.
    const ok = await onAdd({
      foodId: food.id,
      unit: "g",
      amount: 100,
    });
    if (ok !== false) {
      setQuery("");
      setResults([]);
      setShowDropdown(false);
    }
  }

  // El alimento no existe en el catálogo: se crea al vuelo (solo nombre; las
  // macros se completan luego desde /nutricion/alimentos) y se añade a la opción.
  async function handleCreateAndPick() {
    const name = query.trim();
    if (name.length < 2 || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch(`/api/nutricion/foods`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo crear el alimento");
      await handlePick(j.data);
    } catch (e) {
      // Mostrar el fallo: sin esto el botón "revierte" en silencio y no se sabe
      // si el alimento llegó a crearse (reintentar duplicaría la fila).
      setCreateError(e.message);
    }
    setCreating(false);
  }

  return (
    <tr className="bg-[var(--color-accent,#F7F1EB)]/20">
      <td colSpan={8} className="px-2.5 py-2 relative">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 shrink-0">+ Añadir alimento:</span>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Buscar en mi catálogo…"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
        {showDropdown && query.trim().length >= 1 && (
          <div className="absolute left-2.5 right-2.5 top-full mt-0.5 bg-white border border-gray-200 rounded-md shadow-lg z-30 max-h-64 overflow-y-auto">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}
            {!loading && results.length === 0 && (
              <button
                onClick={handleCreateAndPick}
                disabled={creating || query.trim().length < 2}
                className="w-full text-left px-3 py-2 text-xs text-[var(--color-primary)] hover:bg-gray-50 disabled:opacity-50"
              >
                {creating ? "Añadiendo…" : <>+ Añadir «{query.trim()}» al catálogo</>}
              </button>
            )}
            {createError && (
              <div className="px-3 py-1.5 text-[11px] text-red-600 border-t border-gray-100">{createError}</div>
            )}
            {results.map((f) => (
              <button
                key={f.id}
                onClick={() => handlePick(f)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-3"
              >
                <span className="font-medium text-gray-800 truncate">{f.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                  P {fmtGNumber(f.proteinPer100)} · C {fmtGNumber(f.carbsPer100)} · G {fmtGNumber(f.fatPer100)}
                </span>
              </button>
            ))}
          </div>
        )}
        {showDropdown && (
          <div className="fixed inset-0 z-20" onClick={() => setShowDropdown(false)} />
        )}
      </td>
    </tr>
  );
}
