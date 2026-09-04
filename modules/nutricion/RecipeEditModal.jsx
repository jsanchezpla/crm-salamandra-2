"use client";

/**
 * RecipeEditModal — drawer para crear/editar una receta del recetario.
 * Nombre + FOTO del plato + tabla de ingredientes (alimento del catálogo +
 * cantidad + unidad g/medida casera/libre) + PASOS de preparación.
 *
 * Rework 2026-07-22: foto y pasos (revierte el "solo ingredientes" de D4 —
 * decisión de producto). La foto se sube APARTE del JSON (multipart a
 * /api/nutricion/recipes/[id]/photo) después de guardar la receta: en un alta
 * el id no existe hasta el POST.
 *
 * `recipe=null` → crear (POST /api/nutricion/recipes).
 * `recipe` → editar (PATCH; reemplaza la lista de ingredientes completa).
 */

import { useEffect, useRef, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { computeFoodMacros, computeRecipeMacros } from "@/lib/nutricion/macros.js";
import { useFoodSections } from "./foodSections.js";
import PropagarRecetaPanel from "./PropagarRecetaPanel.jsx";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

const UNIT_OPTS = [
  { value: "g", label: "gramos" },
  { value: "household", label: "medida casera" },
  { value: "free", label: "libre" },
];

let ROW_SEQ = 0;
const rowKey = () => `r${++ROW_SEQ}`;

function toRow(ing) {
  return {
    key: rowKey(),
    foodId: ing.foodId ?? ing.food?.id,
    food: ing.food ?? null,
    unit: ing.unit ?? "g",
    amount: ing.amount ?? "",
    householdLabel: ing.householdLabel ?? null,
    householdGrams: ing.householdGrams ?? null,
    notes: ing.notes ?? null,
  };
}

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function RecipeEditModal({ recipe, onClose, onSaved }) {
  const isNew = !recipe;
  const [name, setName] = useState(recipe?.name ?? "");
  const [description, setDescription] = useState(recipe?.description ?? "");
  const [rows, setRows] = useState(() => (recipe?.ingredients ?? []).map(toRow));
  const [steps, setSteps] = useState(() => (Array.isArray(recipe?.steps) ? recipe.steps : []));
  // Foto: `photoFile` = pendiente de subir; `photoRemoved` = quitar la actual.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const hasCurrentPhoto = !!recipe?.hasPhoto && !photoRemoved;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Receta ya guardada y pendiente de decidir a qué pautas se lleva el cambio.
  const [propagar, setPropagar] = useState(null);

  // Liberar el objectURL del preview al desmontar o reemplazar.
  useEffect(() => () => photoPreview && URL.revokeObjectURL(photoPreview), [photoPreview]);

  function pickPhoto(file) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setError("La foto debe ser JPG, PNG o WebP");
    if (file.size > PHOTO_MAX_BYTES) return setError("La foto no puede superar 5 MB");
    setError(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoRemoved(false);
  }
  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoRemoved(true);
  }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addFood(food) {
    setRows((prev) => [...prev, toRow({ food, foodId: food.id, unit: "g", amount: 100 })]);
  }
  function patchRow(key, patch) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const total = computeRecipeMacros({
    ingredients: rows.map((r) => ({ unit: r.unit, amount: r.amount, householdGrams: r.householdGrams, food: r.food })),
  });

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (name.trim().length < 2) return setError("El nombre debe tener al menos 2 caracteres");
    setSaving(true);
    setError(null);

    const ingredients = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.foodId) return finishErr(`Ingrediente ${i + 1}: falta el alimento`);
      const line = { foodId: r.foodId, unit: r.unit, ordering: i };
      if (r.unit === "g") {
        const n = Number(r.amount);
        if (!Number.isFinite(n) || n <= 0) return finishErr(`Ingrediente ${i + 1}: cantidad inválida`);
        line.amount = n;
      } else if (r.unit === "household") {
        const n = Number(r.amount);
        if (!Number.isFinite(n) || n <= 0) return finishErr(`Ingrediente ${i + 1}: cantidad inválida`);
        if (!r.householdLabel || !(Number(r.householdGrams) > 0)) return finishErr(`Ingrediente ${i + 1}: elige una medida casera`);
        line.amount = n;
        line.householdLabel = r.householdLabel;
        line.householdGrams = Number(r.householdGrams);
      }
      ingredients.push(line);
    }

    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

    const url = isNew ? "/api/nutricion/recipes" : `/api/nutricion/recipes/${recipe.id}`;
    try {
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, ingredients, steps: cleanSteps }),
      });
      const j = await res.json();
      if (!j.ok) return finishErr(j.error || "Error al guardar");
      let data = j.data;

      // La foto viaja aparte (multipart) una vez la receta ya tiene id. Si
      // falla, la receta YA está guardada: avisar sin perder el trabajo.
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        const pr = await fetch(`/api/nutricion/recipes/${data.id}/photo`, { method: "POST", body: fd });
        const pj = await leerRespuestaApi(pr);
        if (!pj.ok) return finishErr(`Receta guardada, pero la foto falló: ${pj.error || "error de red"}. Reábrela e inténtalo de nuevo.`);
        data = { ...data, hasPhoto: true };
      } else if (photoRemoved && recipe?.hasPhoto) {
        await fetch(`/api/nutricion/recipes/${recipe.id}/photo`, { method: "DELETE" }).catch(() => {});
        data = { ...data, hasPhoto: false };
      }

      // Una receta que YA está metida en algún menú o pauta guarda allí su
      // propia copia congelada, así que este cambio no le llega a nadie por sí
      // solo. Antes de cerrar se pregunta a dónde llevarlo. El panel se va solo
      // y sin pintarse si la receta es nueva, no está usada o ya está al día:
      // solo interrumpe cuando de verdad hay algo desincronizado.
      if (isNew) {
        onSaved?.(data);
      } else {
        setPropagar({ id: data.id, name: data.name, data });
      }
    } catch (err) {
      finishErr(err.message || "Error de red");
    }
    function finishErr(msg) {
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {propagar && (
        <PropagarRecetaPanel
          recipeId={propagar.id}
          recipeName={propagar.name}
          onDone={() => {
            setPropagar(null);
            onSaved?.(propagar.data);
          }}
        />
      )}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative ml-auto bg-white shadow-2xl overflow-y-auto w-full max-w-2xl flex flex-col fixed right-0 top-14 lg:top-0 bottom-0">
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{isNew ? "Nueva receta" : "Editar receta"}</div>
            <h2 className="text-lg font-semibold text-gray-900">{isNew ? "Añadir al recetario" : recipe.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 px-6 py-5 space-y-5">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">Nombre <span className="text-red-500">*</span></span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={255}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">Descripción</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
          </label>

          {/* ── Foto del plato ─────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Foto del plato</div>
            <div className="flex items-center gap-3">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="Foto de la receta" className="w-24 h-[72px] object-cover rounded-md border border-gray-200" />
              ) : hasCurrentPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/nutricion/recipes/${recipe.id}/photo?v=${encodeURIComponent(recipe.updatedAt ?? "")}`} alt="Foto de la receta"
                  className="w-24 h-[72px] object-cover rounded-md border border-gray-200" />
              ) : (
                <div className="w-24 h-[72px] rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-300">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" /></svg>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer w-fit">
                  {photoPreview || hasCurrentPhoto ? "Cambiar foto" : "Subir foto"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {(photoPreview || hasCurrentPhoto) && (
                  <button type="button" onClick={removePhoto} className="text-[11px] text-gray-400 hover:text-red-600 text-left">Quitar foto</button>
                )}
                <span className="text-[10px] text-gray-400">JPG, PNG o WebP · máx 5 MB</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Ingredientes</div>
            <div className="space-y-2">
              {rows.map((r) => (
                <IngredientRow key={r.key} row={r} onPatch={(p) => patchRow(r.key, p)} onRemove={() => removeRow(r.key)} />
              ))}
              {rows.length === 0 && <div className="text-xs text-gray-400 py-2">Busca y añade alimentos del catálogo.</div>}
            </div>
            <AddIngredient onPick={addFood} />
          </div>

          {/* ── Pasos de preparación ───────────────────────────────────────── */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Pasos de preparación</div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 w-5 h-5 shrink-0 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                  <textarea rows={1} value={step} maxLength={2000}
                    onChange={(e) => setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder={`Paso ${i + 1}…`}
                    className="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <button type="button" disabled={i === 0} aria-label="Subir paso"
                      onClick={() => setSteps((prev) => { const n = prev.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                    </button>
                    <button type="button" disabled={i === steps.length - 1} aria-label="Bajar paso"
                      onClick={() => setSteps((prev) => { const n = prev.slice(); [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n; })}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    </button>
                  </div>
                  <button type="button" aria-label="Quitar paso" onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                    className="mt-1.5 text-gray-400 hover:text-red-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {steps.length === 0 && (
                <div className="text-xs text-gray-400 py-1">Añade los pasos para que el paciente sepa cómo prepararla.</div>
              )}
              <button type="button" disabled={steps.length >= 50}
                onClick={() => setSteps((prev) => [...prev, ""])}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                + Añadir paso
              </button>
            </div>
          </div>

          <div className="rounded-md bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-600 flex gap-4 flex-wrap">
            <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Total receta</span>
            <span>Prot: <strong>{fmt(total.protein)}g</strong></span>
            <span>Carb: <strong>{fmt(total.carbs)}g</strong></span>
            <span>Grasa: <strong>{fmt(total.fat)}g</strong></span>
            <span>Fibra: <strong>{fmt(total.fiber)}g</strong></span>
          </div>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Guardando…" : isNew ? "Crear receta" : "Guardar"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function fmt(v) {
  return v === null || v === undefined ? "—" : Math.round(v * 10) / 10;
}

function IngredientRow({ row, onPatch, onRemove }) {
  const measures = Array.isArray(row.food?.householdMeasures) ? row.food.householdMeasures : [];
  const m = computeFoodMacros({ unit: row.unit, amount: row.amount, householdGrams: row.householdGrams, food: row.food });
  return (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap border border-gray-100 rounded-md px-2 py-1.5">
      <span className="flex-1 min-w-[120px] text-sm text-gray-800 truncate">{row.food?.name ?? "—"}</span>
      {row.unit !== "free" && (
        <input type="number" step="0.1" min="0" value={row.amount} onChange={(e) => onPatch({ amount: e.target.value })}
          className="w-16 px-2 py-1 text-sm text-right rounded border border-gray-200" placeholder={row.unit === "g" ? "g" : "nº"} />
      )}
      <Select value={row.unit} onChange={(v) => onPatch({ unit: v, ...(v === "free" ? { amount: "", householdLabel: null, householdGrams: null } : {}), ...(v !== "household" ? { householdLabel: null, householdGrams: null } : {}) })}
        options={UNIT_OPTS} className="w-32 px-2 py-1 text-sm rounded border border-gray-200" />
      {row.unit === "household" && (
        <Select
          value={row.householdLabel ?? ""}
          onChange={(v) => { const mm = measures.find((x) => x.label === v); onPatch({ householdLabel: v || null, householdGrams: mm ? mm.grams : null }); }}
          options={[{ value: "", label: "— medida —" }, ...measures.map((x) => ({ value: x.label, label: `${x.label} (${x.grams}g)` }))]}
          className="w-40 px-2 py-1 text-sm rounded border border-gray-200"
        />
      )}
      <span className="text-[11px] text-gray-400 w-16 text-right">{m.protein !== null ? `${Math.round(m.protein)}p` : ""}</span>
      <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-600" aria-label="Quitar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

function AddIngredient({ onPick }) {
  const [q, setQ] = useState("");
  // Sección activa ("" = todas): acota la búsqueda y, sin texto, lista la
  // sección entera — "quiero ver qué verduras tengo" sin teclear nada.
  const [section, setSection] = useState("");
  const sectionOptions = useFoodSections();
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const query = q.trim();
      if (query.length < 1 && !section) {
        setResults([]);
        setOpen(false);
        return;
      }
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (section) params.set("tag", section);
        params.set("limit", section && !query ? "20" : "8");
        const r = await fetch(`/api/nutricion/foods?${params}`);
        const j = await r.json();
        setResults(j.items ?? []);
        setOpen(true);
      } catch { /* noop */ }
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, section]);

  // El alimento no existe: se crea al vuelo en el catálogo (solo nombre; las
  // macros se completan luego en /nutricion/alimentos) y se añade a la receta.
  async function createAndPick() {
    const name = q.trim();
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
      onPick(j.data);
      setQ("");
      setResults([]);
      setOpen(false);
    } catch (e) {
      // Feedback visible: sin él no se sabe si el alimento se creó y reintentar
      // podría duplicarlo en el catálogo.
      setCreateError(e.message);
    }
    setCreating(false);
  }

  return (
    <div className="relative mt-2">
      <div className="flex gap-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => (q.trim().length >= 1 || section) && setOpen(true)}
          placeholder="+ Buscar alimento del catálogo…"
          className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-dashed border-gray-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
        <Select
          value={section}
          onChange={setSection}
          options={sectionOptions}
          className="w-44 shrink-0 px-2 py-1.5 text-xs rounded-md border border-gray-200"
          aria-label="Sección del catálogo"
        />
      </div>
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {/* Sin resultados y con 1 solo carácter no hay nada que pintar: evitar
          renderizar la caja del dropdown vacía. */}
      {open && (results.length > 0 || q.trim().length >= 2) && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {results.map((f) => (
            <button key={f.id} type="button"
              onClick={() => { onPick(f); setQ(""); setResults([]); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between">
              <span className="truncate">{f.name}</span>
              <span className="text-[11px] text-gray-400 shrink-0 ml-2">{f.proteinPer100 ?? "—"}p / 100g</span>
            </button>
          ))}
          {results.length === 0 && q.trim().length >= 2 && (
            <button
              type="button"
              onClick={createAndPick}
              disabled={creating}
              className="w-full text-left px-3 py-2 text-sm text-[var(--color-primary)] hover:bg-gray-50 disabled:opacity-50"
            >
              {creating ? "Añadiendo…" : <>+ Añadir «{q.trim()}» al catálogo</>}
            </button>
          )}
          {createError && (
            <div className="px-3 py-1.5 text-[11px] text-red-600 border-t border-gray-100">{createError}</div>
          )}
        </div>
      )}
    </div>
  );
}
