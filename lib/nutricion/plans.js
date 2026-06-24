/**
 * lib/nutricion/plans.js — utilidades del módulo planes nutricionales
 * (Sprint nutri-laura Recetario C2).
 *
 *   - UUID_RE: regex de validación de UUIDs en path params.
 *   - sanitizeFoodLine: valida y normaliza el body de
 *     POST/PATCH /foods según el modo de cantidad (g | household | free).
 *     Refleja al 100% el CHECK plan_meal_option_foods_unit_chk.
 *   - assertMealBelongsToPlan / assertOptionBelongsToMeal /
 *     assertFoodLineBelongsToOption: validaciones de pertenencia en
 *     cadena para los endpoints anidados, para impedir que un user
 *     toque entidades de otro plan vía path manipulado.
 *   - countActiveAssignments: para el aviso del PATCH plantilla.
 *   - deepCopyPlanTree: clona meals/options/foods de un plan origen
 *     al destino en una sola transacción.
 */

import { Op } from "sequelize";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FOOD_UNITS = new Set(["g", "household", "free"]);

/**
 * Valida y normaliza una línea de PlanMealOptionFood.
 * Devuelve { ok: true, value } o { ok: false, error }.
 *
 * `isCreate=true` exige unit y food_id; en PATCH se aceptan parciales
 * pero si llega unit hay que validar TODAS las reglas del modo.
 */
export function sanitizeFoodLine(body, { isCreate = false } = {}) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body inválido" };
  }
  const out = {};

  if (isCreate || body.foodId !== undefined || body.food_id !== undefined) {
    const fid = body.foodId ?? body.food_id;
    if (typeof fid !== "string" || !UUID_RE.test(fid)) {
      return { ok: false, error: "food_id requerido y debe ser uuid" };
    }
    out.foodId = fid;
  }

  if (isCreate || body.unit !== undefined) {
    if (!FOOD_UNITS.has(body.unit)) {
      return { ok: false, error: "unit inválido (g | household | free)" };
    }
    out.unit = body.unit;
  }

  if (body.amount !== undefined) {
    if (body.amount === null) {
      out.amount = null;
    } else {
      const n = Number(body.amount);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        return { ok: false, error: "amount inválido" };
      }
      out.amount = Math.round(n * 100) / 100;
    }
  }

  if (body.householdLabel !== undefined || body.household_label !== undefined) {
    // Importante: NO usar `??` aquí. El frontend manda `householdLabel: null`
    // de forma deliberada para limpiar el campo (p. ej. household → g) y
    // `null ?? body.household_label` (que es undefined) devolvería undefined,
    // rompiendo la rama `if (v === null)` y rechazando con 400. Selección
    // explícita por `!== undefined`:
    const v = body.householdLabel !== undefined ? body.householdLabel : body.household_label;
    if (v === null) out.householdLabel = null;
    else if (typeof v === "string") {
      const t = v.trim();
      if (!t) return { ok: false, error: "household_label vacío" };
      if (t.length > 200) return { ok: false, error: "household_label demasiado largo" };
      out.householdLabel = t;
    } else {
      return { ok: false, error: "household_label inválido" };
    }
  }

  if (body.householdGrams !== undefined || body.household_grams !== undefined) {
    // Idéntico razonamiento: respetar `null` explícito sin caer al alias snake_case.
    const v = body.householdGrams !== undefined ? body.householdGrams : body.household_grams;
    if (v === null) out.householdGrams = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 10000) {
        return { ok: false, error: "household_grams inválido" };
      }
      out.householdGrams = Math.round(n * 100) / 100;
    }
  }

  if (body.notes !== undefined) {
    out.notes = body.notes === null ? null : String(body.notes).slice(0, 5000);
  }

  if (body.order !== undefined) {
    const n = Number(body.order);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "order inválido" };
    out.order = n;
  }

  // Validar coherencia entre unit y los demás campos cuando viene unit.
  if (out.unit !== undefined) {
    const checkUnit = out.unit;
    // Para PATCH, los campos no presentes mantienen su valor previo; el
    // CHECK de BD también atrapará incoherencias. Pero validamos en
    // creación y cuando viene unit + campos suficientes para detectar
    // mal uso temprano.
    if (isCreate) {
      const haveAmount = out.amount !== undefined && out.amount !== null;
      const haveLabel = !!out.householdLabel;
      const haveGrams = out.householdGrams !== undefined && out.householdGrams !== null;
      if (checkUnit === "g") {
        if (!haveAmount) return { ok: false, error: "unit='g' requiere amount" };
        if (haveLabel || haveGrams) {
          return { ok: false, error: "unit='g' no admite household_label / household_grams" };
        }
      } else if (checkUnit === "household") {
        if (!haveAmount) return { ok: false, error: "unit='household' requiere amount (cantidad de medidas caseras)" };
        if (!haveLabel) return { ok: false, error: "unit='household' requiere household_label" };
        if (!haveGrams) return { ok: false, error: "unit='household' requiere household_grams" };
      } else if (checkUnit === "free") {
        if (haveAmount) return { ok: false, error: "unit='free' no admite amount (usa notes)" };
        if (haveLabel || haveGrams) return { ok: false, error: "unit='free' no admite household_*" };
      }
    }
  }

  return { ok: true, value: out };
}

/** Devuelve la fila si pertenece, lanza Error con code 'not_found' si no. */
export async function assertMealBelongsToPlan(PlanMeal, planId, mealId) {
  if (!UUID_RE.test(planId) || !UUID_RE.test(mealId)) {
    const e = new Error("ids inválidos"); e.code = "bad_request"; throw e;
  }
  const meal = await PlanMeal.findOne({ where: { id: mealId, planId } });
  if (!meal) {
    const e = new Error("comida no encontrada en este plan"); e.code = "not_found"; throw e;
  }
  return meal;
}

export async function assertOptionBelongsToMeal(PlanMealOption, mealId, optionId) {
  if (!UUID_RE.test(mealId) || !UUID_RE.test(optionId)) {
    const e = new Error("ids inválidos"); e.code = "bad_request"; throw e;
  }
  const opt = await PlanMealOption.findOne({ where: { id: optionId, mealId } });
  if (!opt) {
    const e = new Error("opción no encontrada en esta comida"); e.code = "not_found"; throw e;
  }
  return opt;
}

export async function assertFoodLineBelongsToOption(PlanMealOptionFood, optionId, lineId) {
  if (!UUID_RE.test(optionId) || !UUID_RE.test(lineId)) {
    const e = new Error("ids inválidos"); e.code = "bad_request"; throw e;
  }
  const line = await PlanMealOptionFood.findOne({ where: { id: lineId, optionId } });
  if (!line) {
    const e = new Error("alimento no encontrado en esta opción"); e.code = "not_found"; throw e;
  }
  return line;
}

/** Cuenta planes asignados activos (no archivados) cuyo origen es el templateId. */
export async function countActiveAssignments(Plan, templateId) {
  return await Plan.count({
    where: { templateId, type: "assigned", archivedAt: null },
  });
}

/**
 * Deep copy del árbol de un plan a otro (mismo schema). Asume que el
 * `destPlanId` ya existe vacío y `src` es el plan origen con meals →
 * options → foods eager-loaded. Inserta dentro de la transacción `t`.
 */
export async function deepCopyPlanTree({
  PlanMeal,
  PlanMealOption,
  PlanMealOptionFood,
  srcMeals,
  destPlanId,
  transaction,
}) {
  for (const m of srcMeals) {
    const newMeal = await PlanMeal.create(
      {
        planId: destPlanId,
        name: m.name,
        description: m.description,
        order: m.order,
      },
      { transaction }
    );
    const opts = m.options || [];
    for (const o of opts) {
      const newOpt = await PlanMealOption.create(
        {
          mealId: newMeal.id,
          name: o.name,
          order: o.order,
          isDefault: o.isDefault,
        },
        { transaction }
      );
      const foods = o.foods || [];
      for (const f of foods) {
        await PlanMealOptionFood.create(
          {
            optionId: newOpt.id,
            foodId: f.foodId,
            amount: f.amount,
            unit: f.unit,
            householdLabel: f.householdLabel,
            householdGrams: f.householdGrams,
            notes: f.notes,
            order: f.order,
          },
          { transaction }
        );
      }
    }
  }
}

/** Eager-load del plan completo con meals→options→foods→food del catálogo. */
export function planTreeInclude(models) {
  const { PlanMeal, PlanMealOption, PlanMealOptionFood, Food } = models;
  return [
    {
      model: PlanMeal,
      as: "meals",
      separate: false,
      include: [
        {
          model: PlanMealOption,
          as: "options",
          include: [
            {
              model: PlanMealOptionFood,
              as: "foods",
              include: [
                {
                  model: Food,
                  as: "food",
                  attributes: [
                    "id",
                    "name",
                    "defaultUnit",
                    "proteinPer100",
                    "carbsPer100",
                    "fatPer100",
                    "fiberPer100",
                    "source",
                    "archivedAt",
                    "householdMeasures",
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

/** Ordena meals → options → foods por `order` ASC tras un findByPk. */
export function sortPlanTree(planJson) {
  const meals = (planJson.meals || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const m of meals) {
    m.options = (m.options || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const o of m.options) {
      o.foods = (o.foods || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }
  planJson.meals = meals;
  return planJson;
}

/** Refresca con eager-load + sort. Devuelve plain JSON. */
export async function loadPlanTree(Plan, models, planId) {
  const row = await Plan.findByPk(planId, { include: planTreeInclude(models) });
  if (!row) return null;
  return sortPlanTree(row.toJSON());
}

// Helper para responder con sortedTree directamente sin volver a hidratar.
export { Op };
