import { Op } from "sequelize";
import { NextResponse } from "next/server";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { recipeInclude, serializeRecipe, sanitizeIngredients, sanitizeSteps } from "../../../../lib/nutricion/recipes.js";

const MAX_LIMIT = 100;

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "Recipe", entityId, before, after, ip });
  } catch {
    /* silent */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/recipes — listar recetas del recetario
//   ?q=  búsqueda por nombre · ?includeArchived=1 · ?page= ?limit=
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe } = tenantModels;
    const { searchParams } = new URL(request.url);

    const q = (searchParams.get("q") ?? "").trim();
    const includeArchived = searchParams.get("includeArchived") === "1";
    let limit = parseInt(searchParams.get("limit") ?? "50", 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 50;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    let page = parseInt(searchParams.get("page") ?? "1", 10);
    if (!Number.isInteger(page) || page <= 0) page = 1;
    const offset = (page - 1) * limit;

    const where = {};
    if (!includeArchived) where.isArchived = false;
    if (q) where.name = { [Op.iLike]: `%${q}%` };

    const { rows, count } = await Recipe.findAndCountAll({
      where,
      include: recipeInclude(tenantModels),
      distinct: true, // cuenta recetas distintas, no filas del JOIN de ingredientes
      limit,
      offset,
      order: [["name", "ASC"]],
    });

    return NextResponse.json({
      ok: true,
      items: rows.map((r) => serializeRecipe(r.toJSON())),
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/recipes — crear receta con sus ingredientes
//   body: { name, description?, ingredients?: [{ foodId, unit, amount, household_*?, notes?, ordering? }] }
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Recipe, RecipeFood, Food } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return error("name requerido (mínimo 2 caracteres)");
    if (name.length > 255) return error("name demasiado largo (máx 255)");
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 5000)
        : null;

    const ing = sanitizeIngredients(body.ingredients);
    if (!ing.ok) return error(ing.error);
    const lines = ing.value ?? [];

    // Pasos de preparación (rework 2026-07-22).
    const st = sanitizeSteps(body.steps);
    if (!st.ok) return error(st.error);
    const steps = st.value ?? [];

    // Validar que todos los food_id existen en el catálogo.
    if (lines.length > 0) {
      const foodIds = [...new Set(lines.map((l) => l.foodId))];
      const found = await Food.findAll({ where: { id: foodIds }, attributes: ["id"], raw: true });
      const foundSet = new Set(found.map((f) => f.id));
      const missing = foodIds.filter((id) => !foundSet.has(id));
      if (missing.length > 0) return error(`alimento(s) no encontrados: ${missing.join(", ")}`);
    }

    const recipeId = await tenantSequelize.transaction(async (t) => {
      const recipe = await Recipe.create(
        { name, description, steps, createdBy: userId ?? null, isArchived: false },
        { transaction: t }
      );
      if (lines.length > 0) {
        await RecipeFood.bulkCreate(
          lines.map((l) => ({ ...l, recipeId: recipe.id })),
          { transaction: t }
        );
      }
      return recipe.id;
    });

    const reloaded = await Recipe.findByPk(recipeId, { include: recipeInclude(tenantModels) });
    const data = serializeRecipe(reloaded.toJSON());

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.recipe.created",
      entityId: recipeId,
      before: null,
      after: { name: data.name, ingredientCount: data.ingredientCount },
      ip,
    });

    return created(data);
  } catch (err) {
    return serverError(err);
  }
});
