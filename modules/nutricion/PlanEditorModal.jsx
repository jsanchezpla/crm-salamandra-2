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

import { useCallback, useEffect, useMemo, useState } from "react";

import RecipePickerModal from "./RecipePickerModal.jsx";
import { computePlanMacros } from "../../lib/nutricion/macros.js";
import { Label, MacrosSummary, ModalShell, SaveStatusIndicator } from "./planEditor/ui.jsx";
import { MealAccordion } from "./planEditor/comidas.jsx";
import { DayView, WEEKDAYS, WeekGrid, WeekTabs } from "./planEditor/semana.jsx";
import { PatientPanel, TemplateSidePanel, TemplatesDropdown } from "./planEditor/paneles.jsx";

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
  // Picker de recetas abierto: { sectionName, meal|null } (rediseño 2026-07-22:
  // cada día son las 5 grandes comidas fijas; meal=null si la fila aún no
  // existe en BD y hay que crearla al vuelo).
  const [recipePicker, setRecipePicker] = useState(null);

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
        setError(j.error || "No se ha podido cargar");
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

  // Valores nutricionales en el PDF del paciente (2026-07-22). Optimista: el
  // interruptor se mueve al instante y se revierte solo si el PATCH falla.
  async function toggleShowMacros() {
    if (!plan) return;
    const next = !plan.showMacros;
    setPlan((p) => ({ ...p, showMacros: next }));
    await patchPlanMetadata(
      { showMacros: next },
      { onErrorRevert: () => setPlan((p) => ({ ...p, showMacros: !next })) }
    );
  }

  // insertWeekday (Nutrinotas): RETIRADO en el rework 2026-07-22. Los días ya
  // no son texto en los comentarios: son estructura (plan_meals.weekday) con
  // sus pestañas Lunes…Domingo. Los comentarios vuelven a ser solo comentarios.

  // toggleVisibleToClient: retirado en C4 junto con el toggle del header.
  // patchPlanMetadata sigue aceptando { visibleToClient } por si algún día
  // se reactiva el portal cliente — basta con volver a montar la UI.

  // ── Mutaciones: comidas ───────────────────────────────────────────────────
  // "Añadir comida" (nombre libre por prompt) está RETIRADO (rediseño
  // 2026-07-22): cada día son SIEMPRE las 5 grandes comidas. Si la fila de una
  // sección no existe todavía en BD (día de un plan antiguo, comida borrada en
  // su momento…), se crea en silencio la primera vez que se usa.

  // Garantiza que la sección (Desayuno…Cena) del día `day` existe como
  // plan_meal y devuelve { mealId }. `sectionIndex` fija el orden canónico.
  async function ensureSectionMeal(day, sectionName, sectionIndex, existingMeal) {
    if (existingMeal) return { mealId: existingMeal.id };
    const { ok, json } = await apiPost(`/api/nutricion/plans/${plan.id}/meals`, {
      name: sectionName,
      weekday: day,
      order: sectionIndex,
    });
    if (!ok) throw new Error(json.error || "No se pudo crear la comida");
    return { mealId: json.data.id };
  }

  // Garantiza que la comida tiene una opción por defecto y devuelve su id.
  async function ensureDefaultOption(mealId, existingMeal) {
    const existing = existingMeal
      ? (existingMeal.options || []).find((o) => o.isDefault) || (existingMeal.options || [])[0]
      : null;
    if (existing) return { optionId: existing.id };
    const { ok, json } = await apiPost(
      `/api/nutricion/plans/${plan.id}/meals/${mealId}/options`,
      { isDefault: true }
    );
    if (!ok) throw new Error(json.error || "No se pudo crear la opción");
    return { optionId: json.data.id };
  }

  // Añadir una receta a una gran comida del día (crea sección/opción al vuelo).
  async function addRecipeToSection({ day, sectionName, sectionIndex, meal }, recipe) {
    try {
      const { mealId } = await ensureSectionMeal(day, sectionName, sectionIndex, meal);
      const { optionId } = await ensureDefaultOption(mealId, meal);
      const { ok, json } = await apiPost(
        `/api/nutricion/plans/${plan.id}/meals/${mealId}/options/${optionId}/recipes`,
        { recipeId: recipe.id, servings: 1 }
      );
      if (!ok) throw new Error(json.error || "No se pudo añadir la receta");
      await loadPlan();
      setToast({ kind: "ok", text: `«${recipe.name}» añadida a ${sectionName}` });
    } catch (e) {
      setToast({ kind: "err", text: e.message });
    }
  }

  // Comentarios de una gran comida (plan_meals.description), creando la
  // sección al vuelo si aún no existe.
  async function saveSectionComment({ day, sectionName, sectionIndex, meal }, text) {
    const current = meal?.description || "";
    if (current === (text || "")) return;
    try {
      const { mealId } = await ensureSectionMeal(day, sectionName, sectionIndex, meal);
      const { ok, json } = await apiPatch(
        `/api/nutricion/plans/${plan.id}/meals/${mealId}`,
        { description: text || null }
      );
      if (!ok) throw new Error(json.error || "Error al guardar comentarios");
      await loadPlan();
    } catch (e) {
      setToast({ kind: "err", text: e.message });
    }
  }

  // Comentarios del día (plans.day_comments JSONB). Reemplaza el mapa entero.
  async function saveDayComment(day, text) {
    const current = plan.dayComments?.[String(day)] || "";
    if (current === (text || "").trim()) return;
    const next = { ...(plan.dayComments || {}) };
    if ((text || "").trim()) next[String(day)] = text.trim();
    else delete next[String(day)];
    await patchPlanMetadata({ dayComments: next });
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
    if (!window.confirm("¿Cargar menú? Esto reemplazará TODO el contenido actual.")) {
      return;
    }
    setToast({ kind: "ok", text: "Cargando menú…" });
    // 1. Cargar el árbol completo de la plantilla origen.
    let src;
    try {
      const r = await fetch(`/api/nutricion/plans/${templateId}`);
      const j = await r.json();
      if (!j.ok) {
        setToast({ kind: "err", text: j.error || "No se pudo cargar el menú" });
        return;
      }
      src = j.data;
    } catch {
      setToast({ kind: "err", text: "Error al cargar el menú" });
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
    setToast({ kind: "ok", text: "Menú cargado" });
  }

  // ── Macros calculados (memo) ──────────────────────────────────────────────
  const planMacros = useMemo(() => (plan ? computePlanMacros(plan) : null), [plan]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ModalShell onClose={handleClose}>
        <div className="p-10 text-center text-sm text-gray-400">Cargando…</div>
      </ModalShell>
    );
  }
  if (error || !plan) {
    return (
      <ModalShell onClose={handleClose}>
        <div className="p-10 text-center text-sm text-red-600">{error || "No se ha encontrado"}</div>
      </ModalShell>
    );
  }

  const meals = (plan.meals || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Comidas del día activo (0 = bloque "sin día" de planes pre-rework).
  const day = activeDay ?? 0;
  const dayMeals = meals.filter((m) => (m.weekday ?? 0) === day);
  const hasLegacyMeals = meals.some((m) => m.weekday == null);

  // Este mismo editor abre las dos cosas, y no se llaman igual (04/08/2026,
  // Rodrigo): la plantilla reutilizable es un MENÚ y lo que acaba en manos de
  // una paciente concreta es su PAUTA. El texto se dice desde aquí para que no
  // haya que acordarse en cada rótulo.
  const esPauta = plan.type === "assigned";
  const ESTO = esPauta ? "la pauta" : "el menú";

  return (
    <ModalShell onClose={handleClose}>
      {/* Header sticky */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-100 px-5 lg:px-7 py-3.5 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-0.5">
            {plan.type === "template" ? "Menú" : "Pauta asignada"}
          </div>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            placeholder={`Nombre de ${ESTO}`}
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
            Este menú tiene <strong>{activeAssignmentsCount} {activeAssignmentsCount === 1 ? "asignación activa" : "asignaciones activas"}</strong>.
            Los cambios que hagas aquí <strong>no se aplican automáticamente</strong> a las pautas ya
            asignadas. Para actualizar a un paciente concreto, ve a su ficha y usa
            &ldquo;Re-aplicar menú origen&rdquo;.
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
            ) : day !== 0 ? (
              /* Rediseño 2026-07-22: el día son SIEMPRE sus 5 grandes comidas,
                 una debajo de otra, con "+ Añadir receta" y comentarios por
                 sección; más los comentarios del propio día. */
              <DayView
                day={day}
                meals={dayMeals}
                dayComment={plan.dayComments?.[String(day)] || ""}
                onSaveDayComment={(text) => saveDayComment(day, text)}
                onOpenPicker={(section) => setRecipePicker(section)}
                onSaveSectionComment={saveSectionComment}
                onUpdateRecipe={(meal, option, pmor, updates) => updateOptionRecipe(meal, option, pmor, updates)}
                onDeleteRecipe={(meal, option, pmor) => deleteOptionRecipe(meal, option, pmor)}
                onDeleteFood={(meal, option, line) => deleteFoodLine(meal, option, line)}
                onDeleteMeal={(meal) => deleteMeal(meal)}
              />
            ) : dayMeals.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
                No hay comidas sin día. Usa las pestañas para ir a un día de la semana.
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

          {/* Lo que ve el paciente en su PDF. De momento una sola decisión:
              si el documento lleva o no las cifras de macronutrientes. Por
              defecto NO: en consulta de TCA los gramos suelen ser parte del
              problema, así que enseñarlos es una decisión consciente. Aquí
              dentro, la nutricionista sigue viendo todos los cálculos. */}
          <section>
            <Label>Lo que ve el paciente</Label>
            <button
              type="button"
              onClick={toggleShowMacros}
              role="switch"
              aria-checked={Boolean(plan.showMacros)}
              className="w-full flex items-start gap-3 text-left rounded-md border border-gray-200 px-3 py-2.5 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            >
              <span
                className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition relative ${
                  plan.showMacros ? "bg-[var(--color-primary)]" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                    plan.showMacros ? "left-[1.125rem]" : "left-0.5"
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-gray-900 leading-tight">
                  Mostrar valores nutricionales en el PDF
                </span>
                <span className="block text-xs text-gray-500 leading-snug mt-0.5">
                  {plan.showMacros
                    ? "El PDF incluye proteínas, hidratos, grasas y fibra de cada plato."
                    : "El PDF sale sin cifras: solo platos, ingredientes y preparación."}
                </span>
              </span>
            </button>
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

      {/* Picker de recetas (rediseño 2026-07-22): buscador + Crear receta */}
      {recipePicker && (
        <RecipePickerModal
          title={`${recipePicker.sectionName} · ${WEEKDAYS[(recipePicker.day ?? 1) - 1]}`}
          onClose={() => setRecipePicker(null)}
          onPick={async (recipe) => {
            await addRecipeToSection(recipePicker, recipe);
            setRecipePicker(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[80] px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${
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
