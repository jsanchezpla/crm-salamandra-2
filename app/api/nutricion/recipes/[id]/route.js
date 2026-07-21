import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { recipeInclude, serializeRecipe, sanitizeIngredients, sanitizeSteps } from "../../../../../lib/nutricion/recipes.js";
import { UUID_RE } from "../../../../../lib/nutricion/plans.js";

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "Recipe", entityId, before, after, ip });
  } catch {
    /* silent */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/recipes/[id] — receta + ingredientes + macros
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id, { include: recipeInclude(tenantModels) });
    if (!recipe) return notFound("Receta no encontrada");
    return ok(serializeRecipe(recipe.toJSON()));
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/nutricion/recipes/[id]
//   body: { name?, description?, isArchived?, ingredients? }
//   Si viene `ingredients`, REEMPLAZA la lista completa (delete + recreate).
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe, RecipeFood, Food } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return notFound("Receta no encontrada");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const updates = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2) return error("name requerido (mínimo 2 caracteres)");
      if (name.length > 255) return error("name demasiado largo (máx 255)");
      updates.name = name;
    }
    if (body.description !== undefined) {
      updates.description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 5000)
          : null;
    }
    if (body.isArchived !== undefined) updates.isArchived = !!body.isArchived;

    // Pasos de preparación (rework 2026-07-22).
    const st = sanitizeSteps(body.steps);
    if (!st.ok) return error(st.error);
    if (st.value !== undefined) updates.steps = st.value;

    // Ingredientes: validar antes de abrir la transacción.
    const ing = sanitizeIngredients(body.ingredients);
    if (!ing.ok) return error(ing.error);
    const lines = ing.value; // undefined = no tocar; [] = vaciar
    if (Array.isArray(lines) && lines.length > 0) {
      const foodIds = [...new Set(lines.map((l) => l.foodId))];
      const found = await Food.findAll({ where: { id: foodIds }, attributes: ["id"], raw: true });
      const foundSet = new Set(found.map((f) => f.id));
      const missing = foodIds.filter((fid) => !foundSet.has(fid));
      if (missing.length > 0) return error(`alimento(s) no encontrados: ${missing.join(", ")}`);
    }

    await tenantSequelize.transaction(async (t) => {
      if (Object.keys(updates).length > 0) await recipe.update(updates, { transaction: t });
      if (lines !== undefined) {
        await RecipeFood.destroy({ where: { recipeId: id }, transaction: t });
        if (lines.length > 0) {
          await RecipeFood.bulkCreate(
            lines.map((l) => ({ ...l, recipeId: id })),
            { transaction: t }
          );
        }
      }
    });

    const reloaded = await Recipe.findByPk(id, { include: recipeInclude(tenantModels) });
    const data = serializeRecipe(reloaded.toJSON());

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.recipe.updated",
      entityId: id,
      before: null,
      after: { name: data.name, ingredientCount: data.ingredientCount, isArchived: data.isArchived },
      ip,
    });

    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/recipes/[id] — archivar (soft, isArchived=true).
// No hard-delete: la receta puede estar referenciada como provenance en
// plan_meal_option_recipes (recipeId SET NULL) y los snapshots ya la congelaron.
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const recipe = await Recipe.findByPk(id);
    if (!recipe) return notFound("Receta no encontrada");
    if (!recipe.isArchived) await recipe.update({ isArchived: true });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.recipe.archived",
      entityId: id,
      before: { isArchived: false },
      after: { isArchived: true },
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
