/**
 * lib/nutricion/macros.js — helper de cálculo de macros para planes
 * nutricionales (Sprint Recetario C2).
 *
 * Sin kcal. Solo proteínas / carbs / grasas / fibra.
 *
 * Convenciones:
 *   - Todos los inputs vienen de los modelos Sequelize (instancias o
 *     plain objects vía toJSON()). El helper opera sobre los nombres
 *     camelCase (proteinPer100, householdGrams, etc.).
 *   - Cuando un valor nutricional es null/undefined se propaga como 0
 *     en la suma, salvo en `unit='free'` donde toda la línea se
 *     reporta como nula (macros desconocidas).
 *   - Resultados redondeados a 2 decimales en el computeFoodMacros y
 *     mantenidos como número en los niveles superiores (los redondeos
 *     finales los hace el frontend al mostrar).
 *
 * Estructura esperada (mínima):
 *
 *   plan.meals[]
 *     .options[]      // PlanMealOption
 *       .isDefault    // boolean
 *       .order        // number
 *       .foods[]      // PlanMealOptionFood
 *         .unit       // 'g' | 'household' | 'free'
 *         .amount     // number | null
 *         .householdGrams // number | null
 *         .food       // { proteinPer100, carbsPer100, fatPer100, fiberPer100 }
 *
 * Si falta `food` (eager-load no incluido), el helper trata la línea
 * como `unit='free'`.
 */

const EMPTY = { protein: null, carbs: null, fat: null, fiber: null };

function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Macros absolutas (g) que aporta una porción de alimento en un plan.
 * Devuelve { protein, carbs, fat, fiber } con número o null.
 *
 * - unit='g'         → amount(g) × macro/100
 * - unit='household' → householdGrams × macro/100
 * - unit='free'      → todo null
 */
export function computeFoodMacros(line) {
  if (!line || !line.unit) return EMPTY;
  if (line.unit === "free") return EMPTY;
  if (!line.food) return EMPTY;

  let grams = null;
  if (line.unit === "g") grams = num(line.amount);
  else if (line.unit === "household") grams = num(line.householdGrams);

  if (grams === null || grams <= 0) return EMPTY;

  const f = line.food;
  return {
    protein: macroFor(f.proteinPer100, grams),
    carbs: macroFor(f.carbsPer100, grams),
    fat: macroFor(f.fatPer100, grams),
    fiber: macroFor(f.fiberPer100, grams),
  };
}

function macroFor(per100, grams) {
  const p = num(per100);
  if (p === null) return null;
  return round2((p * grams) / 100);
}

/**
 * Macros de una opción de comida (suma de sus foods). Líneas con
 * macro=null se ignoran en la suma (no anulan todo). Si TODAS las
 * líneas son null para un macro, el resultado para ese macro es null.
 */
export function computeOptionMacros(option) {
  const totals = { protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const counts = { protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const foods = (option && option.foods) || [];
  for (const f of foods) {
    const m = computeFoodMacros(f);
    for (const k of ["protein", "carbs", "fat", "fiber"]) {
      if (m[k] !== null) {
        totals[k] += m[k];
        counts[k]++;
      }
    }
  }
  return {
    protein: counts.protein === 0 ? null : round2(totals.protein),
    carbs: counts.carbs === 0 ? null : round2(totals.carbs),
    fat: counts.fat === 0 ? null : round2(totals.fat),
    fiber: counts.fiber === 0 ? null : round2(totals.fiber),
  };
}

/**
 * Macros de una comida = macros de su opción "default". Si no hay
 * `isDefault=true`, usa la de menor `order`. Si no hay opciones, EMPTY.
 */
export function computeMealMacros(meal) {
  const options = (meal && meal.options) || [];
  if (options.length === 0) return EMPTY;
  const sorted = [...options].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const chosen = sorted.find((o) => o.isDefault) || sorted[0];
  return computeOptionMacros(chosen);
}

/**
 * Macros del plan completo = suma de todas las comidas (default por
 * comida). Aplica la misma regla "null si todo es null" por macro.
 */
export function computePlanMacros(plan) {
  const totals = { protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const counts = { protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const meals = (plan && plan.meals) || [];
  for (const m of meals) {
    const macros = computeMealMacros(m);
    for (const k of ["protein", "carbs", "fat", "fiber"]) {
      if (macros[k] !== null) {
        totals[k] += macros[k];
        counts[k]++;
      }
    }
  }
  return {
    protein: counts.protein === 0 ? null : round2(totals.protein),
    carbs: counts.carbs === 0 ? null : round2(totals.carbs),
    fat: counts.fat === 0 ? null : round2(totals.fat),
    fiber: counts.fiber === 0 ? null : round2(totals.fiber),
  };
}
