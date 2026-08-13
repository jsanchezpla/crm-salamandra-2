import { withTenant } from "../../../../../../../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, notFound, serverError } from "../../../../../../../../../../lib/utils/apiResponse.js";
import {
  UUID_RE,
  assertMealBelongsToPlan,
  assertOptionBelongsToMeal,
} from "../../../../../../../../../../lib/nutricion/plans.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/recipes
// Body: { recipeId, servings? }
// Añade una receta del catálogo a la opción CONGELÁNDOLA (snapshot): copia el
// nombre, los ingredientes, los pasos y la foto actuales de la receta. Editar
// la receta del catálogo después NO cambia esta copia (D1 = congelado). Para
// que una corrección llegue a las pautas ya escritas está
// POST /api/nutricion/recipes/[id]/propagate.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id: planId, mealId, optionId } = await ctx.params;
    const {
      PlanMeal,
      PlanMealOption,
      PlanMealOptionRecipe,
      PlanMealOptionRecipeFood,
      Recipe,
      RecipeFood,
      Food,
    } = tenantModels;

    try {
      await assertMealBelongsToPlan(PlanMeal, planId, mealId);
      await assertOptionBelongsToMeal(PlanMealOption, mealId, optionId);
    } catch (e) {
      if (e.code === "not_found") return notFound(e.message);
      return error(e.message);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const recipeId = typeof body.recipeId === "string" ? body.recipeId : body.recipe_id;
    if (typeof recipeId !== "string" || !UUID_RE.test(recipeId)) {
      return error("recipeId requerido y debe ser uuid");
    }
    let servings = body.servings === undefined ? 1 : Number(body.servings);
    if (!Number.isFinite(servings) || servings <= 0 || servings > 100) {
      return error("servings inválido (número > 0)");
    }
    servings = Math.round(servings * 100) / 100;

    const recipe = await Recipe.findByPk(recipeId, {
      include: [{ model: RecipeFood, as: "ingredients" }],
    });
    if (!recipe || recipe.isArchived) return error("Receta no encontrada o archivada", 422);

    const maxOrdering = (await PlanMealOptionRecipe.max("ordering", { where: { planMealOptionId: optionId } })) ?? -1;

    const pmorId = await tenantSequelize.transaction(async (t) => {
      const pmor = await PlanMealOptionRecipe.create(
        {
          planMealOptionId: optionId,
          recipeId: recipe.id,
          nameSnapshot: recipe.name,
          // Pasos y foto también congelados (13/08/2026): antes se leían en
          // vivo y la pauta ya entregada cambiaba sola al editar la receta.
          stepsSnapshot: Array.isArray(recipe.steps) ? recipe.steps : [],
          photoPathSnapshot: recipe.photoPath ?? null,
          servings,
          ordering: Number(maxOrdering) + 1,
        },
        { transaction: t }
      );
      const ings = (recipe.ingredients || [])
        .slice()
        .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
      if (ings.length > 0) {
        await PlanMealOptionRecipeFood.bulkCreate(
          ings.map((rf, i) => ({
            planMealOptionRecipeId: pmor.id,
            foodId: rf.foodId,
            amountSnapshot: rf.amount,
            unitSnapshot: rf.unit,
            householdLabelSnapshot: rf.householdLabel,
            householdGramsSnapshot: rf.householdGrams,
            notesSnapshot: rf.notes,
            ordering: rf.ordering ?? i,
          })),
          { transaction: t }
        );
      }
      return pmor.id;
    });

    const reloaded = await PlanMealOptionRecipe.findByPk(pmorId, {
      include: [
        {
          model: PlanMealOptionRecipeFood,
          as: "ingredients",
          include: [{ model: Food, as: "food", attributes: ["id", "name", "proteinPer100", "carbsPer100", "fatPer100", "fiberPer100"] }],
        },
      ],
    });

    return created(reloaded.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
