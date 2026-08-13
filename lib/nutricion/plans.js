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
    const e = new Error("comida no encontrada"); e.code = "not_found"; throw e;
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

export async function assertRecipeBelongsToOption(PlanMealOptionRecipe, optionId, pmorId) {
  if (!UUID_RE.test(optionId) || !UUID_RE.test(pmorId)) {
    const e = new Error("ids inválidos"); e.code = "bad_request"; throw e;
  }
  const row = await PlanMealOptionRecipe.findOne({ where: { id: pmorId, planMealOptionId: optionId } });
  if (!row) {
    const e = new Error("receta no encontrada en esta opción"); e.code = "not_found"; throw e;
  }
  return row;
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
export async function deepCopyPlanTree({ models, srcMeals, destPlanId, transaction }) {
  const {
    PlanMeal,
    PlanMealOption,
    PlanMealOptionFood,
    PlanMealOptionRecipe,
    PlanMealOptionRecipeFood,
  } = models;
  for (const m of srcMeals) {
    const newMeal = await PlanMeal.create(
      // weekday viaja con la copia: si el origen tiene semana real (rework
      // 2026-07-22), el asignado/duplicado la conserva; si es NULL (plan
      // pre-rework), sigue siendo "sin día".
      { planId: destPlanId, name: m.name, description: m.description, order: m.order, weekday: m.weekday ?? null },
      { transaction }
    );
    for (const o of m.options || []) {
      const newOpt = await PlanMealOption.create(
        { mealId: newMeal.id, name: o.name, order: o.order, isDefault: o.isDefault },
        { transaction }
      );
      // Líneas sueltas (modelo antiguo)
      for (const f of o.foods || []) {
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
      // Recetas congeladas (Sprint 8.2). Se copian con sus snapshots — usa los
      // campos *_snapshot originales (no los normalizados de sortPlanTree).
      for (const r of o.recipes || []) {
        const newRecipe = await PlanMealOptionRecipe.create(
          {
            planMealOptionId: newOpt.id,
            recipeId: r.recipeId,
            nameSnapshot: r.nameSnapshot,
            // Se copian tal cual, sin volver a mirar la receta viva: duplicar un
            // menú o re-aplicarlo NO es corregir una receta. Para eso está
            // «Actualizar recetas», que sí va a buscar el original.
            stepsSnapshot: Array.isArray(r.stepsSnapshot) ? r.stepsSnapshot : [],
            photoPathSnapshot: r.photoPathSnapshot ?? null,
            servings: r.servings,
            ordering: r.ordering,
          },
          { transaction }
        );
        for (const rf of r.ingredients || r.foods || []) {
          await PlanMealOptionRecipeFood.create(
            {
              planMealOptionRecipeId: newRecipe.id,
              foodId: rf.foodId,
              amountSnapshot: rf.amountSnapshot,
              unitSnapshot: rf.unitSnapshot,
              householdLabelSnapshot: rf.householdLabelSnapshot,
              householdGramsSnapshot: rf.householdGramsSnapshot,
              notesSnapshot: rf.notesSnapshot,
              ordering: rf.ordering,
            },
            { transaction }
          );
        }
      }
    }
  }
}

const FOOD_ATTRS = [
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
];

/**
 * Eager-load del plan con meals→options→foods sueltos→food del catálogo.
 *
 * NO incluye las recetas de la opción: cargar meals→options→recipes→ingredients
 * →food (belongsTo anidado bajo dos hasMany) hace que Sequelize genere SQL roto
 * ("missing FROM entry"). Las recetas se cargan aparte con `attachRecipesToTree`.
 */
export function planTreeInclude(models) {
  const { PlanMeal, PlanMealOption, PlanMealOptionFood, Food } = models;
  const foodInclude = { model: Food, as: "food", attributes: FOOD_ATTRS };
  return [
    {
      model: PlanMeal,
      as: "meals",
      separate: false,
      include: [
        {
          model: PlanMealOption,
          as: "options",
          include: [{ model: PlanMealOptionFood, as: "foods", include: [foodInclude] }],
        },
      ],
    },
  ];
}

/**
 * Carga las recetas congeladas de TODAS las opciones del árbol en una query
 * aparte (evita el bug de include anidado) y las adjunta a cada opción como
 * `option.recipes`, ordenadas y con los ingredientes normalizados. Muta y
 * devuelve el mismo `treeJson`.
 */
export async function attachRecipesToTree(models, treeJson) {
  const { PlanMealOptionRecipe, PlanMealOptionRecipeFood, Food } = models;
  const optionsById = new Map();
  for (const m of treeJson.meals || []) {
    for (const o of m.options || []) {
      o.recipes = [];
      optionsById.set(o.id, o);
    }
  }
  if (optionsById.size === 0) return treeJson;

  const consulta = (attributes) => ({
    where: { planMealOptionId: [...optionsById.keys()] },
    ...(attributes ? { attributes } : {}),
    include: [
      {
        model: PlanMealOptionRecipeFood,
        as: "ingredients",
        include: [{ model: Food, as: "food", attributes: FOOD_ATTRS }],
      },
    ],
    order: [["ordering", "ASC"]],
  });

  let rows;
  // Si el schema ya tiene las columnas *_snapshot, la pauta se lee congelada;
  // si no (ventana entre desplegar y migrar), se cae al comportamiento viejo.
  let tieneSnapshot = true;
  try {
    rows = await PlanMealOptionRecipe.findAll(consulta());
  } catch (err) {
    const code = err?.parent?.code || err?.original?.code;
    // Tenant con nutrición pero SIN las tablas del recetario todavía (ventana
    // pre-migración): 42P01. Degradar a "sin recetas" en vez de romper el plan.
    if (code === "42P01") return treeJson;
    // 42703: la tabla está pero le faltan `steps_snapshot`/`photo_path_snapshot`
    // (migrate-nutricion-congelar-receta sin pasar todavía). Sequelize hace
    // SELECT de TODOS los atributos del modelo, así que basta con que el modelo
    // vaya por delante del schema para tumbar la pantalla entera del menú —el
    // 42703 de siempre—. Se reintenta pidiendo solo las columnas viejas.
    if (code !== "42703") throw err;
    tieneSnapshot = false;
    rows = await PlanMealOptionRecipe.findAll(
      consulta(["id", "planMealOptionId", "recipeId", "nameSnapshot", "servings", "ordering"])
    );
  }

  // ── TODO SALE DEL SNAPSHOT (13/08/2026) ───────────────────────────────────
  //
  // Hasta hoy, foto y pasos se leían EN VIVO de la receta original por su
  // `recipeId`: el snapshot congelaba nombre e ingredientes y nada más. Media
  // receta quieta y media viva es lo peor de las dos opciones — corregir una
  // cantidad no le llegaba a quien ya tenía la pauta, y reescribir unos pasos
  // le cambiaba pautas de hace meses sin avisar.
  //
  // Ahora la pauta entregada es un documento cerrado. Lo que se lee es lo que
  // se congeló, y una corrección llega solo si alguien la propaga a propósito
  // (POST /api/nutricion/recipes/[id]/propagate).
  //
  // `tieneSnapshot` lo decidió la consulta de arriba. Si es false estamos en la
  // ventana entre desplegar y migrar: se lee en vivo, como antes, en vez de
  // enseñar todas las recetas sin pasos ni foto.
  const liveById = new Map();
  if (!tieneSnapshot) {
    const recipeIds = [...new Set(rows.map((row) => row.recipeId).filter(Boolean))];
    if (recipeIds.length) {
      try {
        const { Recipe } = models;
        const liveRows = await Recipe.findAll({
          where: { id: recipeIds },
          attributes: ["id", "photoPath", "steps"],
        });
        for (const lr of liveRows) liveById.set(lr.id, lr);
      } catch (err) {
        const code = err?.parent?.code || err?.original?.code;
        if (code !== "42703" && code !== "42P01") throw err;
      }
    }
  }

  for (const row of rows) {
    const r = row.toJSON();
    r.ingredients = (r.ingredients || [])
      .slice()
      .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0))
      .map(normalizeRecipeFood);
    if (tieneSnapshot) {
      r.photoPath = r.photoPathSnapshot ?? null;
      r.steps = Array.isArray(r.stepsSnapshot) ? r.stepsSnapshot : [];
    } else {
      const live = r.recipeId ? liveById.get(r.recipeId) : null;
      r.photoPath = live?.photoPath ?? null;
      r.steps = Array.isArray(live?.steps) ? live.steps : [];
    }
    const opt = optionsById.get(r.planMealOptionId);
    if (opt) opt.recipes.push(r);
  }
  return treeJson;
}

/**
 * Normaliza un ingrediente snapshot de receta (amount_snapshot, etc.) a los
 * nombres de campo que esperan computeFoodMacros y la UI (amount, unit,
 * householdGrams…), conservando también los *_snapshot originales.
 */
function normalizeRecipeFood(rf) {
  return {
    ...rf,
    amount: rf.amountSnapshot,
    unit: rf.unitSnapshot,
    householdLabel: rf.householdLabelSnapshot,
    householdGrams: rf.householdGramsSnapshot,
    notes: rf.notesSnapshot,
  };
}

/** Ordena meals → options → foods. Comidas: primero las sin día (weekday NULL,
 * planes pre-rework), después Lunes→Domingo; dentro del mismo día, por `order`.
 * Las recetas de la opción se cargan/ordenan aparte con `attachRecipesToTree`. */
export function sortPlanTree(planJson) {
  const meals = (planJson.meals || [])
    .slice()
    .sort((a, b) => {
      const wa = a.weekday ?? 0; // NULL (sin día) delante, como bloque "General"
      const wb = b.weekday ?? 0;
      if (wa !== wb) return wa - wb;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  for (const m of meals) {
    m.options = (m.options || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const o of m.options) {
      o.foods = (o.foods || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }
  planJson.meals = meals;
  return planJson;
}

/** Refresca con eager-load + sort + recetas adjuntas. Devuelve plain JSON. */
export async function loadPlanTree(Plan, models, planId) {
  const row = await Plan.findByPk(planId, { include: planTreeInclude(models) });
  if (!row) return null;
  const tree = sortPlanTree(row.toJSON());
  await attachRecipesToTree(models, tree);
  return tree;
}

// Helper para responder con sortedTree directamente sin volver a hidratar.
export { Op };
