"use client";

/**
 * PlanEditorModal — modal grande tipo Harbiz para editar un plan
 * nutricional (plantilla o asignado).
 *
 * Sprint nutri-laura Recetario C3.
 *
 * Estructura:
 *   - Header: nombre del plan + dropdown "Plantillas ▾" para cargar otra
 *     plantilla. (El toggle "Visible al cliente" se retiró en C4 — Laura
 *     no usa portal cliente; entrega vía PDF/WhatsApp. La columna BD
 *     `plans.visible_to_client` se conserva por compatibilidad.)
 *   - Cuerpo a 2 columnas (lg+): izquierda = comidas/opciones/foods,
 *     derecha = panel paciente + resumen de macros.
 *   - Footer NO fijo: botones [Cancelar] [Guardar plan] al final del
 *     cuerpo scrollable.
 *
 * Persistencia:
 *   - Las operaciones estructurales (añadir/quitar comida, opción,
 *     alimento) se persisten inmediatamente vía las rutas /api/nutricion/plans/*.
 *   - Los campos de texto y numéricos se persisten en blur/Enter
 *     ("commit on blur"), no en cada keystroke — esto es lo que entendemos
 *     por "guardado manual" (no auto-save reactivo).
 *   - El botón [Guardar plan] del footer PATCH-ea metadata (name,
 *     description, visibleToClient) y cierra el modal. Si la plantilla
 *     tiene asignaciones activas, muestra el aviso con hadAssignments.
 *
 * Macros: cálculos in-memory con lib/nutricion/macros.js (sin call al
 * backend en cada cambio).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FoodSearchExternalModal from "./FoodSearchExternalModal.jsx";
import {
  computeFoodMacros,
  computeOptionMacros,
  computeMealMacros,
  computePlanMacros,
} from "../../../lib/nutricion/macros.js";

// ────────────────────────────────────────────────────────────────────────────
// Utilidades de formato
// ────────────────────────────────────────────────────────────────────────────

function fmtG(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1).replace(/\.0$/, "")} g`;
}

function fmtGNumber(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PlanEditorModal — exported main
// ────────────────────────────────────────────────────────────────────────────

export default function PlanEditorModal({ planId, onClose, onSaved, initialAssignmentsCount = 0 }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 'saving' marca que hay UN PATCH/POST/DELETE en vuelo desde la propia
  // modal. Se usa solo para el indicador "Guardando…" del header — el modelo
  // de persistencia es tiempo real (no hay botón Guardar), así que NO hay
  // estado `dirty` ni confirm al cerrar.
  const [saving, setSaving] = useState(false);
  // Contador de planes asignados activos. Lo conoceremos via prop (cuando
  // se abra desde la card de plantillas) y/o via cualquier PATCH /plans/[id]
  // posterior que devuelva hadAssignments. Sirve para mostrar el banner de
  // aviso de no-propagación cuando type='template' y count>0.
  const [activeAssignmentsCount, setActiveAssignmentsCount] = useState(
    Number(initialAssignmentsCount) || 0
  );
  const [expandedMealId, setExpandedMealId] = useState(null);
  // mealId → optionId activo
  const [activeOptionByMeal, setActiveOptionByMeal] = useState({});
  const [toast, setToast] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Para "+ Buscar en línea" mientras añadimos un alimento a una opción
  const [externalSearchFor, setExternalSearchFor] = useState(null);

  // Cliente cargado (solo si type='assigned')
  const [clientInfo, setClientInfo] = useState(null);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Cargar plan ───────────────────────────────────────────────────────────
  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/nutricion/plans/${planId}`);
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "No se pudo cargar el plan");
        return;
      }
      setPlan(j.data);
      // Por defecto expandimos la primera comida
      const firstMeal = (j.data.meals || [])[0];
      if (firstMeal) {
        setExpandedMealId(firstMeal.id);
        const aoMap = {};
        for (const m of j.data.meals) {
          const def = (m.options || []).find((o) => o.isDefault) || (m.options || [])[0];
          if (def) aoMap[m.id] = def.id;
        }
        setActiveOptionByMeal(aoMap);
      }
    } catch (err) {
      setError(err.message || "Error de red");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // ── Cargar cliente si es asignado ─────────────────────────────────────────
  useEffect(() => {
    if (!plan || plan.type !== "assigned" || !plan.clientId) {
      setClientInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/clients/${plan.clientId}`);
        const j = await r.json();
        if (!cancelled && j.ok) setClientInfo(j.data);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [plan?.id, plan?.clientId, plan?.type]);

  // ── Cerrar (sin confirm: el modelo es autosave total) ─────────────────────
  // No hay estado `dirty` que proteger — cada edición ya está persistida en
  // BD vía PATCH/POST/DELETE inmediato. ESC y × cierran limpio.
  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // ── Helpers API genéricos ─────────────────────────────────────────────────
  // Todos envuelven setSaving para que el indicador "Guardando…/Guardado"
  // refleje cualquier mutación (añadir comida, mover opción, editar gramos…).
  async function apiPatch(url, body) {
    setSaving(true);
    try {
      const r = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok && j.ok !== false, json: j, status: r.status };
    } finally {
      setSaving(false);
    }
  }
  async function apiPost(url, body) {
    setSaving(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, json: j, status: r.status };
    } finally {
      setSaving(false);
    }
  }
  async function apiDelete(url) {
    setSaving(true);
    try {
      const r = await fetch(url, { method: "DELETE" });
      return { ok: r.ok || r.status === 204, status: r.status };
    } finally {
      setSaving(false);
    }
  }

  // ── Mutaciones: metadata del plan ─────────────────────────────────────────
  // Solo `name` y `description` mantienen draft local: el textarea/input
  // necesita estado mientras tipeas, y se persiste al perder foco (onBlur).
  // `visibleToClient` se lee y escribe directamente sobre `plan` — el toggle
  // dispara PATCH inmediato (no hace falta draft).
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  useEffect(() => {
    if (!plan) return;
    setNameDraft(plan.name || "");
    setDescriptionDraft(plan.description || "");
  }, [plan?.id]);

  // Helper: aplica un PATCH de metadata, captura hadAssignments del response
  // y actualiza el plan local. Devuelve `{ ok, plan }`.
  async function patchPlanMetadata(updates, { onErrorRevert } = {}) {
    // apiPatch ya envuelve setSaving; no lo duplicamos aquí.
    const { ok, json } = await apiPatch(`/api/nutricion/plans/${plan.id}`, updates);
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al guardar" });
      if (typeof onErrorRevert === "function") onErrorRevert();
      return { ok: false };
    }
    setPlan((p) => ({ ...p, ...json.plan }));
    if (typeof json.hadAssignments === "number") {
      setActiveAssignmentsCount(json.hadAssignments);
    }
    onSaved?.(json.plan);
    return { ok: true, plan: json.plan };
  }

  async function commitName() {
    if (!plan) return;
    const newName = nameDraft.trim();
    if (newName === (plan.name || "")) return;
    if (newName.length < 2) {
      setToast({ kind: "err", text: "El nombre debe tener al menos 2 caracteres" });
      setNameDraft(plan.name || "");
      return;
    }
    await patchPlanMetadata(
      { name: newName },
      { onErrorRevert: () => setNameDraft(plan.name || "") }
    );
  }

  async function commitDescription() {
    if (!plan) return;
    const newDesc = descriptionDraft;
    if ((newDesc || "") === (plan.description || "")) return;
    await patchPlanMetadata(
      { description: newDesc },
      { onErrorRevert: () => setDescriptionDraft(plan.description || "") }
    );
  }

  // toggleVisibleToClient: retirado en C4 junto con el toggle del header.
  // patchPlanMetadata sigue aceptando { visibleToClient } por si algún día
  // se reactiva el portal cliente — basta con volver a montar la UI.

  // ── Mutaciones: comidas ───────────────────────────────────────────────────
  async function addMeal() {
    if (!plan) return;
    const name = window.prompt("Nombre de la comida (Desayuno, Comida, Cena…)") || "";
    if (!name.trim()) return;
    const { ok, json } = await apiPost(`/api/nutricion/plans/${plan.id}/meals`, {
      name: name.trim(),
    });
    if (!ok) {
      setToast({ kind: "err", text: json.error || "No se pudo añadir la comida" });
      return;
    }
    // Refrescar el árbol para tener IDs limpios y orden correcto
    await loadPlan();
    setExpandedMealId(json.data?.id ?? null);
  }

  async function renameMeal(meal) {
    const newName = window.prompt("Nuevo nombre", meal.name) || "";
    if (!newName.trim() || newName.trim() === meal.name) return;
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}`,
      { name: newName.trim() }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al renombrar" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) => (m.id === meal.id ? { ...m, name: json.data.name } : m)),
    }));
  }

  async function updateMealDescription(meal, description) {
    if ((meal.description || "") === (description || "")) return;
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}`,
      { description }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al guardar descripción" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id ? { ...m, description: json.data.description } : m
      ),
    }));
  }

  async function deleteMeal(meal) {
    if (!window.confirm(`¿Eliminar la comida "${meal.name}"? Esto borra sus opciones y alimentos.`)) return;
    const { ok } = await apiDelete(`/api/nutricion/plans/${plan.id}/meals/${meal.id}`);
    if (!ok) {
      setToast({ kind: "err", text: "No se pudo eliminar la comida" });
      return;
    }
    setPlan((p) => ({ ...p, meals: p.meals.filter((m) => m.id !== meal.id) }));
    if (expandedMealId === meal.id) setExpandedMealId(null);
  }

  async function moveMeal(meal, dir) {
    const meals = [...(plan.meals || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = meals.findIndex((m) => m.id === meal.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= meals.length) return;
    const a = meals[idx];
    const b = meals[swapIdx];
    // Swap via dos PATCH (no es lo más eficiente, pero el backlog C2 ya
    // contempla un endpoint /reorder).
    await apiPatch(`/api/nutricion/plans/${plan.id}/meals/${a.id}`, { order: b.order });
    await apiPatch(`/api/nutricion/plans/${plan.id}/meals/${b.id}`, { order: a.order });
    await loadPlan();
  }

  // ── Mutaciones: opciones ──────────────────────────────────────────────────
  async function addOption(meal) {
    const { ok, json } = await apiPost(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options`,
      {}
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "No se pudo añadir la opción" });
      return;
    }
    await loadPlan();
    setActiveOptionByMeal((prev) => ({ ...prev, [meal.id]: json.data.id }));
  }

  async function renameOption(meal, option) {
    const newName = window.prompt("Nuevo nombre de la opción", option.name) || "";
    if (!newName.trim() || newName.trim() === option.name) return;
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}`,
      { name: newName.trim() }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al renombrar opción" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id
          ? {
              ...m,
              options: m.options.map((o) => (o.id === option.id ? { ...o, name: json.data.name } : o)),
            }
          : m
      ),
    }));
  }

  async function setDefaultOption(meal, option) {
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}`,
      { isDefault: true }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al marcar por defecto" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id
          ? {
              ...m,
              options: m.options.map((o) => ({ ...o, isDefault: o.id === option.id })),
            }
          : m
      ),
    }));
  }

  async function deleteOption(meal, option) {
    if ((meal.options || []).length <= 1) {
      setToast({ kind: "err", text: "Una comida necesita al menos una opción" });
      return;
    }
    if (!window.confirm(`¿Eliminar "${option.name}"? Se borrarán sus alimentos.`)) return;
    const { ok } = await apiDelete(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}`
    );
    if (!ok) {
      setToast({ kind: "err", text: "No se pudo eliminar la opción" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id ? { ...m, options: m.options.filter((o) => o.id !== option.id) } : m
      ),
    }));
    setActiveOptionByMeal((prev) => {
      if (prev[meal.id] !== option.id) return prev;
      const remaining = (meal.options || []).filter((o) => o.id !== option.id);
      return { ...prev, [meal.id]: remaining[0]?.id ?? null };
    });
  }

  // ── Mutaciones: alimentos dentro de una opción ────────────────────────────
  async function addFoodToOption(meal, option, payload) {
    const { ok, json } = await apiPost(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/foods`,
      payload
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "No se pudo añadir el alimento" });
      return false;
    }
    await loadPlan();
    return true;
  }

  async function updateFoodLine(meal, option, line, updates) {
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/foods/${line.id}`,
      updates
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al guardar alimento" });
      return false;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id
          ? {
              ...m,
              options: m.options.map((o) =>
                o.id === option.id
                  ? {
                      ...o,
                      foods: o.foods.map((f) =>
                        f.id === line.id ? { ...f, ...json.data, food: f.food } : f
                      ),
                    }
                  : o
              ),
            }
          : m
      ),
    }));
    return true;
  }

  async function deleteFoodLine(meal, option, line) {
    if (!window.confirm(`¿Quitar "${line.food?.name || "alimento"}" de la opción?`)) return;
    const { ok } = await apiDelete(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/foods/${line.id}`
    );
    if (!ok) {
      setToast({ kind: "err", text: "No se pudo eliminar el alimento" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id
          ? {
              ...m,
              options: m.options.map((o) =>
                o.id === option.id ? { ...o, foods: o.foods.filter((f) => f.id !== line.id) } : o
              ),
            }
          : m
      ),
    }));
  }

  // ── Cargar plantilla (reemplaza contenido) ────────────────────────────────
  async function loadFromTemplate(templateId) {
    if (templateId === plan.id) return;
    if (!window.confirm("¿Cargar plantilla? Esto reemplazará TODO el contenido actual del plan.")) {
      return;
    }
    setToast({ kind: "ok", text: "Cargando plantilla…" });
    // 1. Cargar el árbol completo de la plantilla origen.
    let src;
    try {
      const r = await fetch(`/api/nutricion/plans/${templateId}`);
      const j = await r.json();
      if (!j.ok) {
        setToast({ kind: "err", text: j.error || "No se pudo cargar la plantilla" });
        return;
      }
      src = j.data;
    } catch {
      setToast({ kind: "err", text: "Error al cargar plantilla" });
      return;
    }

    // 2. Borrar todas las comidas actuales (CASCADE borra opciones/foods).
    for (const m of plan.meals || []) {
      await apiDelete(`/api/nutricion/plans/${plan.id}/meals/${m.id}`);
    }

    // 3. Crear las comidas/opciones/foods desde la fuente.
    for (const m of src.meals || []) {
      const { ok, json } = await apiPost(
        `/api/nutricion/plans/${plan.id}/meals`,
        { name: m.name, description: m.description, order: m.order }
      );
      if (!ok) continue;
      const newMealId = json.data.id;
      // Las opciones por defecto se crean automáticamente — borrarlas para
      // que no haya solapamientos con las que vamos a crear. Solo si quedaran.
      // (En realidad nuestro POST /meals no crea opciones, así que vamos directos.)
      for (const o of m.options || []) {
        const optRes = await apiPost(
          `/api/nutricion/plans/${plan.id}/meals/${newMealId}/options`,
          { name: o.name, order: o.order, isDefault: o.isDefault }
        );
        if (!optRes.ok) continue;
        const newOptId = optRes.json.data.id;
        for (const f of o.foods || []) {
          await apiPost(
            `/api/nutricion/plans/${plan.id}/meals/${newMealId}/options/${newOptId}/foods`,
            {
              foodId: f.foodId,
              unit: f.unit,
              amount: f.amount,
              householdLabel: f.householdLabel,
              householdGrams: f.householdGrams,
              notes: f.notes,
              order: f.order,
            }
          );
        }
      }
    }
    setTemplatesOpen(false);
    await loadPlan();
    setToast({ kind: "ok", text: "Plantilla cargada" });
  }

  // ── Macros calculados (memo) ──────────────────────────────────────────────
  const planMacros = useMemo(() => (plan ? computePlanMacros(plan) : null), [plan]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ModalShell onClose={handleClose}>
        <div className="p-10 text-center text-sm text-gray-400">Cargando plan…</div>
      </ModalShell>
    );
  }
  if (error || !plan) {
    return (
      <ModalShell onClose={handleClose}>
        <div className="p-10 text-center text-sm text-red-600">{error || "Plan no encontrado"}</div>
      </ModalShell>
    );
  }

  const meals = (plan.meals || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <ModalShell onClose={handleClose}>
      {/* Header sticky */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-5 lg:px-7 py-3.5 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-0.5">
            {plan.type === "template" ? "Plantilla" : "Plan asignado"}
          </div>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            placeholder="Nombre del plan"
            className="text-lg lg:text-xl font-semibold text-gray-900 leading-tight w-full bg-transparent border-0 focus:outline-none focus:bg-gray-50 px-1 -mx-1 rounded"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SaveStatusIndicator saving={saving} />
          <TemplatesDropdown
            open={templatesOpen}
            onOpen={() => setTemplatesOpen(true)}
            onClose={() => setTemplatesOpen(false)}
            onSelect={(t) => loadFromTemplate(t.id)}
            excludeId={plan.type === "template" ? plan.id : null}
          />
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-700 transition p-1"
            aria-label="Cerrar"
            title="Cerrar (Esc)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Banner persistente para plantillas con asignaciones activas */}
      {plan.type === "template" && activeAssignmentsCount > 0 && (
        <div className="bg-[var(--color-primary)]/[0.06] border-b border-[var(--color-primary)]/15 px-5 lg:px-7 py-2.5 flex items-start gap-2.5 text-xs text-[var(--color-primary)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4 shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
          </svg>
          <div className="leading-tight">
            Esta plantilla tiene <strong>{activeAssignmentsCount} {activeAssignmentsCount === 1 ? "asignación activa" : "asignaciones activas"}</strong>.
            Los cambios que hagas aquí <strong>no se aplican automáticamente</strong> a los planes ya
            asignados. Para actualizar a un paciente concreto, ve a su ficha y usa
            &ldquo;Re-aplicar plantilla origen&rdquo; (disponible en C4).
          </div>
        </div>
      )}

      {/* Cuerpo a 2 columnas en lg+ */}
      <div className="flex-1 px-4 lg:px-7 py-5 lg:py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Columna izquierda */}
        <div className="space-y-5 min-w-0">
          {/* Descripción / Comentarios — autosave en blur */}
          <section>
            <Label>Comentarios</Label>
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={commitDescription}
              placeholder="Notas generales del plan (texto libre)…"
              rows={3}
              className="w-full text-sm rounded-md border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-y"
            />
          </section>

          {/* Comidas */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <Label className="mb-0">Planificación de comidas</Label>
              <button
                onClick={addMeal}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
              >
                + Añadir comida
              </button>
            </div>

            {meals.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
                Aún no hay comidas. Crea la primera con &ldquo;Añadir comida&rdquo;.
              </div>
            ) : (
              <div className="space-y-2.5">
                {meals.map((meal, idx) => (
                  <MealAccordion
                    key={meal.id}
                    meal={meal}
                    index={idx}
                    total={meals.length}
                    expanded={expandedMealId === meal.id}
                    onToggle={() =>
                      setExpandedMealId(expandedMealId === meal.id ? null : meal.id)
                    }
                    activeOptionId={activeOptionByMeal[meal.id]}
                    onSelectOption={(optId) =>
                      setActiveOptionByMeal((prev) => ({ ...prev, [meal.id]: optId }))
                    }
                    onRename={() => renameMeal(meal)}
                    onUpdateDescription={(desc) => updateMealDescription(meal, desc)}
                    onDelete={() => deleteMeal(meal)}
                    onMoveUp={() => moveMeal(meal, "up")}
                    onMoveDown={() => moveMeal(meal, "down")}
                    onAddOption={() => addOption(meal)}
                    onRenameOption={(o) => renameOption(meal, o)}
                    onSetDefaultOption={(o) => setDefaultOption(meal, o)}
                    onDeleteOption={(o) => deleteOption(meal, o)}
                    onAddFood={(payload) => addFoodToOption(meal, currentOption(meal), payload)}
                    onUpdateFood={(line, updates) =>
                      updateFoodLine(meal, currentOption(meal), line, updates)
                    }
                    onDeleteFood={(line) => deleteFoodLine(meal, currentOption(meal), line)}
                    onOpenExternal={() => setExternalSearchFor({ mealId: meal.id, optionId: currentOption(meal)?.id })}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Indicador de autosave — no hay botón Guardar; todos los cambios
              se persisten al instante (estructura: en el momento del click;
              campos de texto: al perder foco). */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
            <SaveStatusIndicator saving={saving} verbose />
          </div>
        </div>

        {/* Columna derecha */}
        <aside className="space-y-4 lg:sticky lg:top-[88px] lg:self-start">
          {plan.type === "assigned" ? (
            <PatientPanel client={clientInfo} clientId={plan.clientId} />
          ) : (
            <TemplateSidePanel plan={plan} />
          )}
          <MacrosSummary macros={planMacros} />
        </aside>
      </div>

      {/* Modal externo de OFF reusado */}
      {externalSearchFor && (
        <FoodSearchExternalModal
          onClose={() => setExternalSearchFor(null)}
          onImported={async (imported) => {
            // Añadir el alimento importado a la opción donde se abrió.
            const meal = plan.meals.find((m) => m.id === externalSearchFor.mealId);
            const option = meal?.options.find((o) => o.id === externalSearchFor.optionId);
            if (meal && option) {
              await addFoodToOption(meal, option, {
                foodId: imported.id,
                unit: "g",
                amount: 100,
              });
            }
            setExternalSearchFor(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </ModalShell>
  );

  function currentOption(meal) {
    const opts = meal.options || [];
    const activeId = activeOptionByMeal[meal.id];
    return opts.find((o) => o.id === activeId) || opts[0] || null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ModalShell — envoltorio común (backdrop + caja centrada)
// ────────────────────────────────────────────────────────────────────────────

function ModalShell({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/55" />
      <section
        role="dialog"
        aria-modal="true"
        className="
          relative bg-white shadow-2xl overflow-hidden
          flex flex-col
          w-full h-full
          lg:max-w-[1400px] lg:max-h-[95vh] lg:rounded-xl
          mt-14 lg:mt-0
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-componentes: Label, MealAccordion, OptionPills, OptionTable, etc.
// ────────────────────────────────────────────────────────────────────────────

function Label({ children, className = "" }) {
  return (
    <div className={`text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 ${className}`}>
      {children}
    </div>
  );
}

function MealAccordion({
  meal, index, total, expanded, onToggle,
  activeOptionId, onSelectOption,
  onRename, onUpdateDescription, onDelete, onMoveUp, onMoveDown,
  onAddOption, onRenameOption, onSetDefaultOption, onDeleteOption,
  onAddFood, onUpdateFood, onDeleteFood, onOpenExternal,
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
          {/* Descripción */}
          <input
            type="text"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => onUpdateDescription(descDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
            placeholder="Descripción de la comida (ej. DESAYUNO + BEBIDA + FRUTA)…"
            className="w-full text-xs uppercase tracking-wider text-gray-700 px-3 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />

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

          {/* Tabla de alimentos de la opción activa */}
          {activeOption ? (
            <OptionTable
              option={activeOption}
              onAdd={onAddFood}
              onUpdate={onUpdateFood}
              onDelete={onDeleteFood}
              onOpenExternal={onOpenExternal}
            />
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

function OptionPills({ options, activeOptionId, onSelect, onAdd, onRename, onSetDefault, onDelete }) {
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

function OptionTable({ option, onAdd, onUpdate, onDelete, onOpenExternal }) {
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
            <AddFoodRow onAdd={onAdd} onOpenExternal={onOpenExternal} />
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
// FoodRow — fila editable de un alimento dentro de una opción
// ────────────────────────────────────────────────────────────────────────────

function FoodRow({ line, onUpdate, onDelete }) {
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
          <select
            value={line.unit}
            onChange={(e) => changeUnit(e.target.value)}
            className="px-1.5 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white"
          >
            <option value="g">gramos</option>
            <option value="household">medida casera</option>
            <option value="free">sin cantidad</option>
          </select>
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

function HouseholdMeasureSelect({ foodId, measures, currentLabel, onChange }) {
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
    <select
      value={currentLabel ?? ""}
      onChange={(e) => {
        if (e.target.value === "__new__") setEditingNew(true);
        else onChange(e.target.value);
      }}
      className="px-1.5 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white max-w-[150px]"
    >
      {measures.map((m) => (
        <option key={m.label} value={m.label}>{m.label} ({m.grams}g)</option>
      ))}
      {measures.length === 0 && (
        <option value="" disabled>Sin medidas — añade una</option>
      )}
      <option value="__new__">+ Añadir medida nueva…</option>
    </select>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AddFoodRow — fila final con autocomplete para añadir un alimento nuevo
// ────────────────────────────────────────────────────────────────────────────

function AddFoodRow({ onAdd, onOpenExternal }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
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
          <button
            onClick={onOpenExternal}
            className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 transition shrink-0"
            title="Buscar en OpenFoodFacts"
          >
            🔍 OFF
          </button>
        </div>
        {showDropdown && query.trim().length >= 1 && (
          <div className="absolute left-2.5 right-2.5 top-full mt-0.5 bg-white border border-gray-200 rounded-md shadow-lg z-30 max-h-64 overflow-y-auto">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}
            {!loading && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">
                Sin coincidencias. <button onClick={onOpenExternal} className="text-[var(--color-primary)] hover:underline">¿Buscar online?</button>
              </div>
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
            <button
              onClick={onOpenExternal}
              className="w-full text-left px-3 py-1.5 text-xs border-t border-gray-100 text-[var(--color-primary)] hover:bg-gray-50"
            >
              + Buscar en línea (OpenFoodFacts)
            </button>
          </div>
        )}
        {showDropdown && (
          <div className="fixed inset-0 z-20" onClick={() => setShowDropdown(false)} />
        )}
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Panel paciente (type='assigned') o info plantilla (type='template')
// ────────────────────────────────────────────────────────────────────────────

function PatientPanel({ client, clientId }) {
  if (!client && clientId) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-400">
        Cargando datos del paciente…
      </div>
    );
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-400">
        Sin cliente asociado.
      </div>
    );
  }
  // customFields actuales en nutri-laura: edad, motivo, info_adicional.
  // Peso/altura/alergias/sexo no están en el modelo; mostramos "No especificado".
  const cf = client.customFields || {};
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Paciente</div>
      <div className="font-semibold text-gray-900 text-base leading-tight">{client.name}</div>
      <dl className="text-xs space-y-1 pt-1">
        <Field label="Edad" value={cf.edad || "—"} suffix={cf.edad ? "años" : ""} />
        <Field label="Sexo" value="—" />
        <Field label="Altura" value="—" />
        <Field label="Peso" value="—" />
        <Field label="Motivo" value={cf.motivo || "—"} />
        <Field label="Alergias" value="—" />
        <Field label="Email" value={client.email || "—"} />
        <Field label="Teléfono" value={client.phone || "—"} />
      </dl>
      <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
        Algunos campos no están todavía en el perfil del paciente. Se podrán
        rellenar desde la ficha en C4.
      </p>
    </div>
  );
}

function Field({ label, value, suffix }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right">
        {value} {suffix && <span className="text-gray-400">{suffix}</span>}
      </dd>
    </div>
  );
}

function TemplateSidePanel({ plan }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Plantilla</div>
      <div className="font-semibold text-gray-900 text-base leading-tight">{plan.name}</div>
      <dl className="text-xs space-y-1 pt-1">
        <Field label="Creada" value={fmtDate(plan.createdAt)} />
        <Field label="Última edición" value={fmtDate(plan.updatedAt)} />
        <Field label="Comidas" value={String((plan.meals || []).length)} />
      </dl>
      <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
        Para asignar esta plantilla a un paciente, ve a su ficha (C4).
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Resumen de macros del plan completo
// ────────────────────────────────────────────────────────────────────────────

function MacrosSummary({ macros }) {
  const m = macros || { protein: null, carbs: null, fat: null, fiber: null };
  const sumPCG =
    (m.protein ?? 0) + (m.carbs ?? 0) + (m.fat ?? 0);
  function pct(v) {
    if (sumPCG <= 0 || v === null || v === undefined) return null;
    return Math.round((v / sumPCG) * 100);
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-2">Total del plan</div>
      <div className="space-y-1.5">
        <MacroBar label="Proteínas" value={m.protein} pct={pct(m.protein)} color="emerald" />
        <MacroBar label="Carbohidratos" value={m.carbs} pct={pct(m.carbs)} color="amber" />
        <MacroBar label="Grasas" value={m.fat} pct={pct(m.fat)} color="rose" />
        <MacroBar label="Fibra" value={m.fiber} pct={null} color="violet" />
      </div>
      <p className="text-[10px] text-gray-400 mt-3 leading-tight">
        Macros calculadas a partir de la opción por defecto de cada comida.
      </p>
    </div>
  );
}

function MacroBar({ label, value, pct, color }) {
  const colorClass = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  }[color];
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums text-gray-900">
          {fmtGNumber(value)} g {pct !== null && <span className="text-gray-400 ml-1">({pct}%)</span>}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1 mt-0.5 overflow-hidden">
        <div
          className={`${colorClass} h-full transition-all`}
          style={{ width: `${pct !== null ? Math.min(100, pct) : 0}%` }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TemplatesDropdown — abre dropdown con plantillas para cargar
// ────────────────────────────────────────────────────────────────────────────

function TemplatesDropdown({ open, onOpen, onClose, onSelect, excludeId }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || items !== null) return;
    setLoading(true);
    fetch("/api/nutricion/plans?type=template&limit=100")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setItems(j.items || []); else setItems([]); })
      .finally(() => setLoading(false));
  }, [open, items]);

  return (
    <div className="relative">
      <button
        onClick={() => (open ? onClose() : onOpen())}
        className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition flex items-center gap-1"
        title="Cargar contenido desde otra plantilla"
      >
        Plantillas ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-gray-200 rounded-md shadow-lg py-1 max-h-80 overflow-y-auto">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">Cargando…</div>}
            {!loading && items && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No hay plantillas.</div>
            )}
            {(items || [])
              .filter((p) => p.id !== excludeId)
              .map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                  onClick={() => { onClose(); onSelect(p); }}
                >
                  <div className="font-medium text-gray-800 truncate">{p.name}</div>
                  <div className="text-[10px] text-gray-400">Actualizada {fmtDate(p.updatedAt)}</div>
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SaveStatusIndicator — chip discreto que informa del modelo de autosave.
// `saving=true` muestra "Guardando…" con icono giratorio; en reposo muestra
// el check. `verbose` activa la versión más explícita del footer.
// ────────────────────────────────────────────────────────────────────────────

function SaveStatusIndicator({ saving, verbose = false }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 px-2 py-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 animate-spin">
          <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        Guardando…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 px-2 py-1" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 text-emerald-500">
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4.5 4.5L19 7.5" />
      </svg>
      {verbose ? "Cambios guardados automáticamente" : "Guardado"}
    </span>
  );
}
