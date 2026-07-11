"use client";

/**
 * FoodEditModal — modal completo para crear o editar un alimento del
 * catálogo. Maneja nombre, unidad por defecto, las 4 macros, tags y
 * household_measures (lista editable de { label, grams }).
 *
 * Cuando se abre con `food=null` crea uno nuevo (POST); con `food` lo
 * edita (PATCH). El catalog API protege source — no se permite
 * cambiarlo desde la UI.
 */

import { useEffect, useMemo, useState } from "react";

import Select from "@/components/ui/Select.jsx";

const UNITS = [
  { value: "g", label: "Gramos (g)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "unidad", label: "Unidad" },
];

const DEFAULT_MEASURES = [
  { label: "1 cucharada", grams: 15 },
  { label: "1 cucharadita", grams: 5 },
  { label: "1 unidad pequeña", grams: 50 },
  { label: "1 unidad mediana", grams: 80 },
  { label: "1 unidad grande", grams: 120 },
  { label: "1 puñado", grams: 30 },
  { label: "1 taza", grams: 240 },
  { label: "1 vaso", grams: 250 },
  { label: "1 lata", grams: 120 },
];

function toInputValue(v) {
  if (v === null || v === undefined || v === "") return "";
  return String(v);
}

export default function FoodEditModal({ food, onClose, onSaved }) {
  const isNew = !food;

  const [name, setName] = useState(food?.name ?? "");
  const [defaultUnit, setDefaultUnit] = useState(food?.defaultUnit ?? "g");
  const [proteinPer100, setProteinPer100] = useState(toInputValue(food?.proteinPer100));
  const [carbsPer100, setCarbsPer100] = useState(toInputValue(food?.carbsPer100));
  const [fatPer100, setFatPer100] = useState(toInputValue(food?.fatPer100));
  const [fiberPer100, setFiberPer100] = useState(toInputValue(food?.fiberPer100));
  const [tags, setTags] = useState(Array.isArray(food?.tags) ? food.tags : []);
  const [tagInput, setTagInput] = useState("");
  const [measures, setMeasures] = useState(
    Array.isArray(food?.householdMeasures) && food.householdMeasures.length > 0
      ? food.householdMeasures.map((m) => ({ label: m.label ?? "", grams: m.grams ?? "" }))
      : DEFAULT_MEASURES.map((m) => ({ ...m }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isOff = food?.source === "openfoodfacts";

  const canSubmit = useMemo(() => name.trim().length >= 2 && !saving, [name, saving]);

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  }

  function removeTag(t) {
    setTags(tags.filter((x) => x !== t));
  }

  function setMeasure(i, patch) {
    setMeasures((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function addMeasure() {
    setMeasures((prev) => [...prev, { label: "", grams: "" }]);
  }

  function removeMeasure(i) {
    setMeasures((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    // Validamos household_measures localmente: descartamos filas vacías,
    // exigimos label + grams numérico positivo en las que tengan datos.
    const cleanMeasures = [];
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      const label = (m.label ?? "").trim();
      const gramsRaw = String(m.grams ?? "").trim();
      if (!label && !gramsRaw) continue;
      const grams = Number(gramsRaw);
      if (!label) {
        setError(`Medida #${i + 1}: falta la etiqueta`);
        setSaving(false);
        return;
      }
      if (!Number.isFinite(grams) || grams <= 0) {
        setError(`Medida "${label}": gramos inválido`);
        setSaving(false);
        return;
      }
      cleanMeasures.push({ label, grams });
    }

    const payload = {
      name: name.trim(),
      defaultUnit,
      proteinPer100: proteinPer100 === "" ? null : Number(proteinPer100),
      carbsPer100: carbsPer100 === "" ? null : Number(carbsPer100),
      fatPer100: fatPer100 === "" ? null : Number(fatPer100),
      fiberPer100: fiberPer100 === "" ? null : Number(fiberPer100),
      tags,
      householdMeasures: cleanMeasures,
    };

    const url = isNew ? "/api/nutricion/foods" : `/api/nutricion/foods/${food.id}`;
    const method = isNew ? "POST" : "PATCH";

    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Error al guardar");
        return;
      }
      onSaved?.(j.data);
    } catch (err) {
      setError(err.message || "Error de red");
    } finally {
      setSaving(false);
    }
  }

  // ESC para cerrar
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside
        className="
          relative ml-auto bg-white shadow-2xl overflow-y-auto
          w-full max-w-xl flex flex-col
          fixed right-0 top-14 lg:top-0 bottom-0
        "
      >
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">
              {isNew ? "Nuevo alimento" : "Editar alimento"}
            </div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isNew ? "Añadir al catálogo" : food.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 px-6 py-5 space-y-5">
          {isOff && (
            <div className="px-3 py-2 bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/15 rounded-md text-[11px] text-[var(--color-primary)]">
              Este alimento viene de OpenFoodFacts. Los datos nutricionales se
              pueden ajustar libremente, pero su origen queda registrado como
              importación externa.
            </div>
          )}

          <Field label="Nombre" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={200}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </Field>

          <Field label="Unidad por defecto">
            <Select
              value={defaultUnit}
              onChange={(v) => setDefaultUnit(v)}
              options={UNITS.map((u) => ({ value: u.value, label: u.label }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </Field>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
              Macros por 100 g
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MacroField label="Proteínas (g)" value={proteinPer100} onChange={setProteinPer100} />
              <MacroField label="Carbohidratos (g)" value={carbsPer100} onChange={setCarbsPer100} />
              <MacroField label="Grasas (g)" value={fatPer100} onChange={setFatPer100} />
              <MacroField label="Fibra (g)" value={fiberPer100} onChange={setFiberPer100} />
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
              Tags
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Añadir tag y pulsar Enter…"
                className="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
              >
                Añadir
              </button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="hover:text-red-600"
                      aria-label={`Quitar ${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-400">
                Medidas caseras
              </div>
              <button
                type="button"
                onClick={addMeasure}
                className="text-xs text-[var(--color-primary)] hover:underline"
              >
                + añadir medida
              </button>
            </div>
            <div className="space-y-2">
              {measures.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => setMeasure(i, { label: e.target.value })}
                    placeholder="Etiqueta (1 cucharada…)"
                    className="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={m.grams}
                    onChange={(e) => setMeasure(i, { grams: e.target.value })}
                    placeholder="g"
                    className="w-20 px-2 py-1.5 text-sm text-right rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  />
                  <button
                    type="button"
                    onClick={() => removeMeasure(i)}
                    className="text-gray-400 hover:text-red-600 transition"
                    aria-label={`Quitar medida ${i + 1}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? "Guardando…" : isNew ? "Crear" : "Guardar"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}

function MacroField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500 block mb-1">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 text-sm text-right rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
      />
    </label>
  );
}
