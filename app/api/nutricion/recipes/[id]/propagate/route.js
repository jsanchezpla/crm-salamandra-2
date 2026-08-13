import { Op } from "sequelize";

import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { UUID_RE } from "../../../../../../lib/nutricion/plans.js";

/**
 * /api/nutricion/recipes/[id]/propagate — llevar una receta CORREGIDA a las
 * pautas y menús que ya la tenían escrita.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * Al meter una receta en un menú se congela una COPIA (nombre, ingredientes y,
 * desde el 13/08/2026, también pasos y foto). Eso es lo correcto: lo que se le
 * entregó a un paciente es un documento y no puede cambiar solo por debajo.
 *
 * Pero entonces una corrección de verdad —«esto no son 200 g, son 20»— no le
 * llega nunca a quien ya tiene la pauta, y «Re-aplicar menú origen» tampoco
 * sirve: recopia las copias viejas del menú plantilla, que están igual de mal.
 * Este endpoint es la tercera vía: propagar, pero A PROPÓSITO y sabiendo a
 * quién.
 *
 * GET   dice dónde está usada y cuáles se han quedado atrás.
 * POST  refresca la copia SOLO en los planes que se le pasen.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * No toca `servings` (la ración es del menú, no de la receta: si alguien puso
 * media, media se queda) ni el `ordering` dentro de la opción. Y no propaga a
 * planes ARCHIVADOS: una pauta archivada es historia, y reescribirla sería
 * falsear lo que se entregó aquel día.
 */

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "Recipe", entityId, before, after, ip });
  } catch {
    /* silent */
  }
}

/**
 * Todas las copias VIVAS de esta receta, con el plan al que pertenecen.
 *
 * El camino es largo —copia → opción → comida → plan— y se recorre a mano en
 * vez de con includes anidados por lo mismo que documenta `attachRecipesToTree`:
 * el include de tres niveles da problemas aquí.
 */
async function copiasVivas(models, recipeId) {
  const { PlanMealOptionRecipe, PlanMealOption, PlanMeal, Plan, Client } = models;

  const copias = await PlanMealOptionRecipe.findAll({ where: { recipeId } });
  if (copias.length === 0) return { copias: [], planPorCopia: new Map(), planes: [] };

  const opciones = await PlanMealOption.findAll({
    where: { id: [...new Set(copias.map((c) => c.planMealOptionId))] },
    attributes: ["id", "mealId"],
  });
  const mealPorOpcion = new Map(opciones.map((o) => [o.id, o.mealId]));

  const comidas = await PlanMeal.findAll({
    where: { id: [...new Set(opciones.map((o) => o.mealId))] },
    attributes: ["id", "planId"],
  });
  const planPorComida = new Map(comidas.map((m) => [m.id, m.planId]));

  const planes = await Plan.findAll({
    where: { id: [...new Set(comidas.map((m) => m.planId))], archivedAt: { [Op.is]: null } },
    attributes: ["id", "name", "type", "clientId", "assignedAt"],
  });
  const planPorId = new Map(planes.map((p) => [p.id, p]));

  // Nombre del paciente, para que la lista no sea una fila de UUID.
  const clientIds = [...new Set(planes.map((p) => p.clientId).filter(Boolean))];
  const nombrePorCliente = new Map();
  if (clientIds.length && Client) {
    try {
      const clientes = await Client.findAll({ where: { id: clientIds }, attributes: ["id", "name"] });
      for (const c of clientes) nombrePorCliente.set(c.id, c.name);
    } catch {
      /* sin nombres: la lista sigue siendo usable */
    }
  }

  const planPorCopia = new Map();
  for (const c of copias) {
    const mealId = mealPorOpcion.get(c.planMealOptionId);
    const planId = mealId ? planPorComida.get(mealId) : null;
    const plan = planId ? planPorId.get(planId) : null;
    if (plan) planPorCopia.set(c.id, plan);
  }

  return { copias, planPorCopia, planes, nombrePorCliente };
}

/** ¿La copia dice ya lo mismo que la receta viva? */
function estaAlDia(copia, receta, ingredientesVivos, ingredientesCopia) {
  if (copia.nameSnapshot !== receta.name) return false;
  if ((copia.photoPathSnapshot ?? null) !== (receta.photoPath ?? null)) return false;
  const pasosCopia = Array.isArray(copia.stepsSnapshot) ? copia.stepsSnapshot : [];
  const pasosVivos = Array.isArray(receta.steps) ? receta.steps : [];
  if (JSON.stringify(pasosCopia) !== JSON.stringify(pasosVivos)) return false;

  if (ingredientesVivos.length !== ingredientesCopia.length) return false;
  const clave = (x) =>
    [x.foodId, String(x.amount ?? ""), x.unit, x.householdLabel ?? "", String(x.householdGrams ?? ""), x.notes ?? ""].join("|");
  const vivos = ingredientesVivos.map(clave).sort();
  const copiados = ingredientesCopia
    .map((i) => ({
      foodId: i.foodId,
      amount: i.amountSnapshot,
      unit: i.unitSnapshot,
      householdLabel: i.householdLabelSnapshot,
      householdGrams: i.householdGramsSnapshot,
      notes: i.notesSnapshot,
    }))
    .map(clave)
    .sort();
  return vivos.every((v, i) => v === copiados[i]);
}

async function reunirDatos(tenantModels, recipeId) {
  const { Recipe, RecipeFood, PlanMealOptionRecipeFood } = tenantModels;

  const receta = await Recipe.findByPk(recipeId, { include: [{ model: RecipeFood, as: "ingredients" }] });
  if (!receta) return null;

  const { copias, planPorCopia, nombrePorCliente } = await copiasVivas(tenantModels, recipeId);

  const ingredientesCopia = copias.length
    ? await PlanMealOptionRecipeFood.findAll({ where: { planMealOptionRecipeId: copias.map((c) => c.id) } })
    : [];
  const porCopia = new Map();
  for (const i of ingredientesCopia) {
    if (!porCopia.has(i.planMealOptionRecipeId)) porCopia.set(i.planMealOptionRecipeId, []);
    porCopia.get(i.planMealOptionRecipeId).push(i);
  }

  const vivos = (receta.ingredients || []).slice().sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));

  return { receta, copias, planPorCopia, nombrePorCliente, porCopia, vivos };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — ¿dónde está usada esta receta y qué se ha quedado atrás?
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const datos = await reunirDatos(tenantModels, id);
    if (!datos) return notFound("Receta no encontrada");
    const { receta, copias, planPorCopia, nombrePorCliente, porCopia, vivos } = datos;

    // Un plan puede usar la misma receta en dos comidas: se agrupa POR PLAN,
    // que es la unidad que entiende quien mira la pantalla.
    const porPlan = new Map();
    for (const copia of copias) {
      const plan = planPorCopia.get(copia.id);
      if (!plan) continue;
      const alDia = estaAlDia(copia, receta, vivos, porCopia.get(copia.id) || []);
      const previo = porPlan.get(plan.id);
      if (previo) {
        previo.copias += 1;
        previo.desactualizado = previo.desactualizado || !alDia;
      } else {
        porPlan.set(plan.id, {
          planId: plan.id,
          nombre: plan.name,
          tipo: plan.type, // 'template' = menú reutilizable · 'assigned' = pauta de una persona
          clienteId: plan.clientId ?? null,
          cliente: plan.clientId ? nombrePorCliente.get(plan.clientId) ?? null : null,
          asignadaEl: plan.assignedAt ?? null,
          copias: 1,
          desactualizado: !alDia,
        });
      }
    }

    const items = [...porPlan.values()].sort((a, b) => {
      // Primero las pautas de personas concretas: son las que urgen.
      if (a.tipo !== b.tipo) return a.tipo === "assigned" ? -1 : 1;
      return (a.cliente || a.nombre || "").localeCompare(b.cliente || b.nombre || "", "es");
    });

    return ok({
      items,
      total: items.length,
      desactualizados: items.filter((i) => i.desactualizado).length,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — refrescar la copia de esta receta en los planes indicados.
//   body: { planIds: [uuid, …] }
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const planIds = Array.isArray(body?.planIds) ? body.planIds.filter((p) => UUID_RE.test(p)) : [];
    if (planIds.length === 0) return error("planIds requerido (lista de uuid)");

    const datos = await reunirDatos(tenantModels, id);
    if (!datos) return notFound("Receta no encontrada");
    const { receta, copias, planPorCopia, vivos } = datos;

    const pedidos = new Set(planIds);
    const aRefrescar = copias.filter((c) => {
      const plan = planPorCopia.get(c.id);
      return plan && pedidos.has(plan.id);
    });
    if (aRefrescar.length === 0) {
      return error("Ninguno de esos planes usa esta receta (o están archivados)", 422);
    }

    const { PlanMealOptionRecipe, PlanMealOptionRecipeFood } = tenantModels;
    const pasos = Array.isArray(receta.steps) ? receta.steps : [];

    await tenantSequelize.transaction(async (t) => {
      for (const copia of aRefrescar) {
        await PlanMealOptionRecipe.update(
          {
            nameSnapshot: receta.name,
            stepsSnapshot: pasos,
            photoPathSnapshot: receta.photoPath ?? null,
          },
          { where: { id: copia.id }, transaction: t }
        );
        // Los ingredientes se reemplazan enteros (borrar + recrear), igual que
        // hace el PATCH de la receta: casar línea a línea con una lista que
        // pudo cambiar de orden, de alimento y de tamaño es más frágil que
        // volver a escribirla.
        await PlanMealOptionRecipeFood.destroy({ where: { planMealOptionRecipeId: copia.id }, transaction: t });
        if (vivos.length) {
          await PlanMealOptionRecipeFood.bulkCreate(
            vivos.map((rf, i) => ({
              planMealOptionRecipeId: copia.id,
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
      }
    });

    const planesTocados = [...new Set(aRefrescar.map((c) => planPorCopia.get(c.id).id))];

    // Esto SÍ se audita, al revés que la edición granular de un menú: reescribe
    // de golpe lo que ya se le había entregado a varias personas.
    await logAudit({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "nutricion.recipe.propagated",
      entityId: id,
      before: null,
      after: { receta: receta.name, planes: planesTocados.length, copias: aRefrescar.length },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ planes: planesTocados.length, copias: aRefrescar.length });
  } catch (err) {
    return serverError(err);
  }
});
