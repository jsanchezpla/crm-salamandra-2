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

import Select from "@/components/ui/Select.jsx";
import {
  computeFoodMacros,
  computeOptionMacros,
  computeMealMacros,
  computePlanMacros,
  computeRecipeMacros,
  scaleMacros,
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
  // Día activo de la semana: 1=Lunes … 7=Domingo; 0 = comidas sin día
  // (planes pre-rework). null hasta que el plan carga.
  const [activeDay, setActiveDay] = useState(null);
  // Vista semana: cuadrícula 7 días × comidas para verlo todo de un vistazo.
  const [weekView, setWeekView] = useState(false);

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
      const allMeals = j.data.meals || [];
      const hasWeek = allMeals.some((m) => m.weekday != null);
      // Día inicial: Lunes si el plan tiene semana; el bloque "sin día" si es
      // un plan pre-rework. En recargas se conserva el día donde estabas.
      setActiveDay((prev) => (prev != null ? prev : hasWeek ? 1 : 0));
      // Por defecto expandimos la primera comida del día visible
      const day = hasWeek ? 1 : 0;
      const firstMeal = allMeals.find((m) => (m.weekday ?? 0) === day) || allMeals[0];
      if (firstMeal) {
        setExpandedMealId((prev) => prev ?? firstMeal.id);
        const aoMap = {};
        for (const m of allMeals) {
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

  // insertWeekday (Nutrinotas): RETIRADO en el rework 2026-07-22. Los días ya
  // no son texto en los comentarios: son estructura (plan_meals.weekday) con
  // sus pestañas Lunes…Domingo. Los comentarios vuelven a ser solo comentarios.

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
      // La comida nace en el día que estás mirando (0 = bloque "sin día").
      weekday: activeDay ? activeDay : null,
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

  // Mover una comida a otro día (o quitarle el día con null). Clave para los
  // planes pre-rework: sus comidas "sin día" se pueden repartir por la semana.
  async function changeMealWeekday(meal, weekday) {
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}`,
      { weekday }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "No se pudo cambiar el día" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) => (m.id === meal.id ? { ...m, weekday: json.data.weekday } : m)),
    }));
    // Seguir a la comida a su nuevo día para no "perderla" de vista.
    setActiveDay(json.data.weekday ?? 0);
  }

  async function moveMeal(meal, dir) {
    // Subir/bajar DENTRO de su día: reordenar contra comidas de otros días no
    // tendría efecto visible (la lista está agrupada por weekday).
    const dayMeals = (plan.meals || [])
      .filter((m) => (m.weekday ?? 0) === (meal.weekday ?? 0))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = dayMeals.findIndex((m) => m.id === meal.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= dayMeals.length) return;
    const a = dayMeals[idx];
    const b = dayMeals[swapIdx];
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

  // ── Mutaciones: recetas dentro de una opción (Sprint 8.2) ─────────────────
  // Al añadir una receta se congela (snapshot) en el backend. loadPlan() tras
  // cada cambio: el árbol ya incluye option.recipes con ingredientes + macros.
  async function addRecipeToOption(meal, option, recipeId, servings) {
    if (!option) return false;
    const { ok, json } = await apiPost(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/recipes`,
      { recipeId, servings }
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "No se pudo añadir la receta" });
      return false;
    }
    await loadPlan();
    return true;
  }

  async function updateOptionRecipe(meal, option, pmor, updates) {
    if (!option) return false;
    const { ok, json } = await apiPatch(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/recipes/${pmor.id}`,
      updates
    );
    if (!ok) {
      setToast({ kind: "err", text: json.error || "Error al guardar la receta" });
      return false;
    }
    // Actualización IN PLACE (como updateFoodLine): NO loadPlan, que resetearía
    // la comida expandida y la opción activa. Conserva los ingredientes.
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
                      recipes: (o.recipes || []).map((r) =>
                        r.id === pmor.id ? { ...r, ...json.data } : r
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

  async function deleteOptionRecipe(meal, option, pmor) {
    if (!option) return;
    if (!window.confirm(`¿Quitar "${pmor.nameSnapshot}" de la opción?`)) return;
    const { ok } = await apiDelete(
      `/api/nutricion/plans/${plan.id}/meals/${meal.id}/options/${option.id}/recipes/${pmor.id}`
    );
    if (!ok) {
      setToast({ kind: "err", text: "No se pudo quitar la receta" });
      return;
    }
    setPlan((p) => ({
      ...p,
      meals: p.meals.map((m) =>
        m.id === meal.id
          ? {
              ...m,
              options: m.options.map((o) =>
                o.id === option.id
                  ? { ...o, recipes: (o.recipes || []).filter((r) => r.id !== pmor.id) }
                  : o
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
        // weekday viaja con la copia (rework 2026-07-22): sin él, cargar una
        // plantilla semanal aplastaría toda la semana en "sin día".
        { name: m.name, description: m.description, order: m.order, weekday: m.weekday ?? null }
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
        // Las recetas congeladas de la opción TAMBIÉN se copian (bug del flujo
        // antiguo: se perdían al cargar plantilla). Solo si conservan
        // provenance (recipeId): un snapshot cuya receta original se borró no
        // puede recrearse vía POST /recipes.
        for (const rec of o.recipes || []) {
          if (!rec.recipeId) continue;
          await apiPost(
            `/api/nutricion/plans/${plan.id}/meals/${newMealId}/options/${newOptId}/recipes`,
            { recipeId: rec.recipeId, servings: rec.servings ?? 1 }
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
  // Comidas del día activo (0 = bloque "sin día" de planes pre-rework).
  const day = activeDay ?? 0;
  const dayMeals = meals.filter((m) => (m.weekday ?? 0) === day);
  const hasLegacyMeals = meals.some((m) => m.weekday == null);

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
          {/* Semana del paciente: pestañas Lunes…Domingo + vista de cuadrícula.
              Rework 2026-07-22: los días son ESTRUCTURA (plan_meals.weekday),
              ya no texto en los comentarios. */}
          <section>
            <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
              <Label className="mb-0">Semana del paciente</Label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWeekView((v) => !v)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition ${
                    weekView
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {weekView ? "Volver al día" : "Ver semana completa"}
                </button>
                {!weekView && (
                  <button
                    onClick={addMeal}
                    className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
                  >
                    + Añadir comida
                  </button>
                )}
              </div>
            </div>

            {!weekView && (
              <WeekTabs
                activeDay={day}
                onSelect={(d) => { setActiveDay(d); setExpandedMealId(null); }}
                meals={meals}
                showLegacyTab={hasLegacyMeals}
              />
            )}

            {weekView ? (
              <WeekGrid
                meals={meals}
                onPickMeal={(meal) => {
                  setActiveDay(meal.weekday ?? 0);
                  setWeekView(false);
                  setExpandedMealId(meal.id);
                }}
              />
            ) : dayMeals.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
                {day === 0
                  ? "No hay comidas sin día. Usa las pestañas para ir a un día de la semana."
                  : `${WEEKDAYS[day - 1]} aún no tiene comidas. Créalas con "Añadir comida".`}
              </div>
            ) : (
              <div className="space-y-2.5">
                {dayMeals.map((meal, idx) => (
                  <MealAccordion
                    key={meal.id}
                    meal={meal}
                    index={idx}
                    total={dayMeals.length}
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
                    onChangeWeekday={(w) => changeMealWeekday(meal, w)}
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
                    onAddRecipe={(recipeId, servings) => addRecipeToOption(meal, currentOption(meal), recipeId, servings)}
                    onUpdateRecipe={(pmor, updates) => updateOptionRecipe(meal, currentOption(meal), pmor, updates)}
                    onDeleteRecipe={(pmor) => deleteOptionRecipe(meal, currentOption(meal), pmor)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Comentarios generales — autosave en blur. Desde el rework los días
              viven en las pestañas de arriba; esto es SOLO para pautas y notas
              (hidratación, suplementos, recordatorios…). */}
          <section>
            <Label>Comentarios</Label>
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={commitDescription}
              placeholder="Pautas generales para el paciente (hidratación, suplementos, recordatorios…)"
              rows={3}
              className="w-full text-sm rounded-md border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-y"
            />
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

function OptionTable({ option, onAdd, onUpdate, onDelete }) {
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

function OptionRecipes({ option, onAddRecipe, onUpdateRecipe, onDeleteRecipe }) {
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

function RecipeInOptionRow({ pmor, onUpdate, onDelete }) {
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

function AddRecipeRow({ onAdd }) {
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

function AddFoodRow({ onAdd }) {
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
      <TemplateAssignPanel plan={plan} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Asignación directa a pacientes desde el editor (Nutrinotas item 9).
// Lista los pacientes con este menú asignado (copia independiente: editar el
// menú NO cambia sus planes; para eso está "Re-aplicar" en la ficha) y permite
// asignar a otro paciente sin salir del editor.
// ────────────────────────────────────────────────────────────────────────────

function TemplateAssignPanel({ plan }) {
  const [assignments, setAssignments] = useState([]);
  const [clients, setClients] = useState([]);
  const [pickedClientId, setPickedClientId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }

  const loadAssignments = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/nutricion/plans?type=assigned&templateId=${plan.id}&withSummary=true&limit=100`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (j.ok) {
        const items = j.items || j.data?.items || [];
        setAssignments(items.filter((p) => !p.archivedAt));
      }
    } catch { /* noop */ }
  }, [plan.id]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  // Pacientes (clientes) para el selector — carga única.
  useEffect(() => {
    fetch(`/api/clients?limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setClients(j.data?.clients ?? []))
      .catch(() => {});
  }, []);

  async function assign() {
    if (!pickedClientId || assigning) return;
    setAssigning(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/nutricion/plans/${plan.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: pickedClientId }),
      });
      const j = await r.json();
      if (r.status === 409) throw new Error("Ese paciente ya tiene este menú asignado");
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo asignar");
      setMsg({ kind: "ok", text: "Menú asignado (copia independiente)" });
      setPickedClientId("");
      loadAssignments();
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setAssigning(false);
    }
  }

  const clientOptions = useMemo(
    () => [
      { value: "", label: "Asignar a paciente…" },
      ...clients.map((c) => ({ value: c.id, label: c.name })),
    ],
    [clients]
  );

  return (
    <div className="pt-2 border-t border-gray-100 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Pacientes con este menú</div>
      {assignments.length === 0 ? (
        <p className="text-[11px] text-gray-400">Sin asignaciones activas.</p>
      ) : (
        <ul className="space-y-1">
          {assignments.map((a) => (
            <li key={a.id} className="text-xs text-gray-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
              <span className="truncate">{a.client?.name || a.clientName || a.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <Select
            value={pickedClientId}
            onChange={setPickedClientId}
            options={clientOptions}
            searchable
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white"
          />
        </div>
        <button
          onClick={assign}
          disabled={!pickedClientId || assigning}
          className="text-[11px] font-medium px-2 py-1.5 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40 shrink-0"
        >
          {assigning ? "…" : "Asignar"}
        </button>
      </div>
      <p className="text-[10px] text-gray-400">
        La asignación crea una copia independiente: los cambios posteriores del menú no
        alteran los planes ya asignados (usa «Re-aplicar» en la ficha del paciente).
      </p>
      {msg && (
        <p className={`text-[11px] ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Semana real (rework 2026-07-22). WEEKDAYS[0]="Lunes" ↔ weekday=1 … 7=Domingo.
// WeekTabs: pestañas de día con contador de comidas rellenas. WeekGrid: la
// semana completa de un vistazo, cada celda es una comida clicable.
// ────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function mealFilled(meal) {
  return (meal.options || []).some((o) => (o.foods || []).length > 0 || (o.recipes || []).length > 0);
}

function WeekTabs({ activeDay, onSelect, meals, showLegacyTab }) {
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
          title="Comidas de este menú que aún no tienen día asignado"
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
function mealCellSummary(meal) {
  const opt = (meal.options || []).find((o) => o.isDefault) || (meal.options || [])[0];
  if (!opt) return null;
  const parts = (opt.recipes || []).map((r) => r.nameSnapshot || "Receta");
  const nFoods = (opt.foods || []).length;
  if (nFoods > 0) parts.push(`${nFoods} alimento${nFoods === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function WeekGrid({ meals, onPickMeal }) {
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
          Este menú tiene {legacy.length} comida{legacy.length === 1 ? "" : "s"} sin día asignado (pestaña “Sin día”).
          Ábrelas y asígnales un día para que aparezcan en la semana.
        </div>
      )}
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
