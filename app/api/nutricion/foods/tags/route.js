import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/foods/tags — secciones del catálogo con recuento.
//
// Devuelve los tags de los alimentos NO archivados, agregados:
//   { ok, items: [{ tag: "verduras-hortalizas", count: 57 }, …] }
//
// Alimenta los desplegables de sección (tabla de alimentos y buscador del
// editor de recetas). Se agrega en JS sobre ~500 filas en vez de SQL raw con
// unnest(): sin esquemas interpolados y dentro de la regla "siempre métodos de
// Sequelize". Los tags propios de la nutricionista aparecen igual que los del
// catálogo base; las secciones vacías (todo archivado) desaparecen solas.
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { Food } = tenantModels;

    const rows = await Food.findAll({
      where: { archivedAt: null },
      attributes: ["tags"],
      raw: true,
    });

    const counts = new Map();
    for (const row of rows) {
      for (const tag of row.tags || []) {
        if (typeof tag !== "string" || !tag.trim()) continue;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }

    const items = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag, "es"));

    return ok({ items });
  } catch (err) {
    return serverError(err);
  }
});
