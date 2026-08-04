/**
 * lib/nutricion/recipes.js — utilidades del recetario (Sprint 8.2).
 *
 *   - recipeInclude: eager-load de Recipe con ingredients → food del catálogo.
 *   - serializeRecipe: ordena ingredientes y añade macros agregadas.
 *   - sanitizeIngredients: valida/normaliza la lista de ingredientes del body
 *     (reutiliza sanitizeFoodLine — misma forma que una línea de opción).
 *
 * Un ingrediente de receta es una línea con el mismo shape que
 * PlanMealOptionFood (food_id, amount, unit, household_label/grams, notes) más
 * `ordering`. Las macros de la receta se calculan en vivo del catálogo `foods`.
 */

import { computeRecipeMacros } from "./macros.js";
import { sanitizeFoodLine } from "./plans.js";

/**
 * Clasificación de una receta (04/08/2026, al traer las de Harbiz).
 *
 * Las CLAVES se guardan en inglés porque vienen así del origen y porque es lo
 * que hace el resto del CRM con los enums; las etiquetas en español se resuelven
 * AQUÍ, en un solo sitio, para que ninguna pantalla se invente una traducción.
 */
export const TIPOS_RECETA = {
  breakfast: "Desayuno",
  main: "Plato principal",
  snack: "Snack",
  dessert: "Postre",
};

/** Los 14 de declaración obligatoria (Reglamento UE 1169/2011). */
export const ALERGENOS = {
  Gluten: "Gluten",
  Shellfish: "Crustáceos",
  Egg: "Huevo",
  Fish: "Pescado",
  Peanuts: "Cacahuetes",
  Soy: "Soja",
  Milk: "Leche",
  Lactose: "Lactosa",
  Nuts: "Frutos de cáscara",
  Celery: "Apio",
  Mustard: "Mostaza",
  Sesame: "Sésamo",
  Sulphites: "Sulfitos",
  Lupin: "Altramuces",
  Molluscs: "Moluscos",
};

export const PREFERENCIAS = {
  Vegetarian: "Vegetariana",
  Vegan: "Vegana",
};

/** Traduce sin perder nada: lo desconocido se devuelve tal cual. */
const etiquetar = (dicc, lista) =>
  (Array.isArray(lista) ? lista : []).map((k) => ({ clave: k, etiqueta: dicc[k] ?? k }));

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

/** Include para cargar una receta con sus ingredientes + el food del catálogo. */
export function recipeInclude(models) {
  const { RecipeFood, Food } = models;
  return [
    {
      model: RecipeFood,
      as: "ingredients",
      include: [{ model: Food, as: "food", attributes: FOOD_ATTRS }],
    },
  ];
}

/** Ordena ingredientes por `ordering` y adjunta macros agregadas + recuento. */
export function serializeRecipe(recipeJson) {
  const ingredients = (recipeJson.ingredients || [])
    .slice()
    .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
  return {
    id: recipeJson.id,
    name: recipeJson.name,
    description: recipeJson.description ?? null,
    isArchived: !!recipeJson.isArchived,
    createdBy: recipeJson.createdBy ?? null,
    createdAt: recipeJson.createdAt,
    updatedAt: recipeJson.updatedAt,
    // Rework 2026-07-22: pasos de preparación + foto. `hasPhoto` es lo que
    // consume la UI (la foto se sirve por GET /recipes/[id]/photo); photoPath
    // no se expone — es un detalle de disco.
    steps: Array.isArray(recipeJson.steps) ? recipeJson.steps : [],
    hasPhoto: !!recipeJson.photoPath,
    // Clasificación (04/08/2026). Se devuelven las claves crudas —para filtrar—
    // y ya traducidas —para pintar—, resueltas en un solo sitio.
    recipeType: recipeJson.recipeType ?? null,
    recipeTypeLabel: recipeJson.recipeType ? (TIPOS_RECETA[recipeJson.recipeType] ?? recipeJson.recipeType) : null,
    tags: Array.isArray(recipeJson.tags) ? recipeJson.tags : [],
    allergens: Array.isArray(recipeJson.allergens) ? recipeJson.allergens : [],
    allergensLabels: etiquetar(ALERGENOS, recipeJson.allergens),
    dietaryPreferences: Array.isArray(recipeJson.dietaryPreferences) ? recipeJson.dietaryPreferences : [],
    dietaryPreferencesLabels: etiquetar(PREFERENCIAS, recipeJson.dietaryPreferences),
    durationMinutes: recipeJson.durationMinutes ?? null,
    rations: recipeJson.rations ?? null,
    ingredients,
    ingredientCount: ingredients.length,
    macros: computeRecipeMacros({ ingredients }),
  };
}

/**
 * Valida y normaliza los pasos de preparación: array de strings no vacíos,
 * máx 50 pasos de 2000 caracteres. Devuelve { ok, value?, error? }; value
 * `undefined` = el body no traía steps (no tocar).
 */
export function sanitizeSteps(list) {
  if (list === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(list)) return { ok: false, error: "steps debe ser un array de textos" };
  if (list.length > 50) return { ok: false, error: "steps: máximo 50 pasos" };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string") return { ok: false, error: `paso ${i + 1}: debe ser texto` };
    const s = list[i].trim().slice(0, 2000);
    if (s) out.push(s); // pasos en blanco se descartan en silencio
  }
  return { ok: true, value: out };
}

/**
 * Valida y normaliza la lista de ingredientes de una receta. Devuelve
 * { ok:true, value: [...] } (líneas normalizadas con `ordering` asignado por
 * índice si falta) o { ok:false, error }.
 */
export function sanitizeIngredients(list) {
  if (list === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(list)) return { ok: false, error: "ingredients debe ser un array" };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const res = sanitizeFoodLine(list[i], { isCreate: true });
    if (!res.ok) return { ok: false, error: `ingrediente ${i + 1}: ${res.error}` };
    const line = res.value;
    line.ordering = Number.isInteger(list[i]?.ordering) ? list[i].ordering : i;
    out.push(line);
  }
  return { ok: true, value: out };
}
