import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError } from "../../../../../lib/utils/errors.js";
import { normalizarCategoria } from "../../../../../lib/calendar/categorias.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

async function resolver(tenantModels, id) {
  const fila = await tenantModels.CalendarCategory.findByPk(id);
  if (!fila) throw new NotFoundError("Categoría no encontrada");
  return fila;
}

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/calendar/categories/[id] — editar (solo admin).
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("calendar")) return forbidden("Módulo calendario no activo");
  if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) {
    return forbidden("Solo un administrador puede tocar el catálogo de categorías");
  }

  const { id } = await params;
  const categoria = await resolver(tenantModels, id);

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body JSON inválido");
  }

  const { valores, error: mal } = normalizarCategoria(body);
  if (mal) return error(mal, 422);

  await categoria.update(valores);
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "calendar.categoria.editada",
    entity: "CalendarCategory",
    entityId: categoria.id,
    after: resumen(categoria, ["name", "color", "active"]),
  });

  return ok(categoria.toJSON());
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/calendar/categories/[id]
//
// Si la categoría está EN USO no se borra: se desactiva. Mismo criterio que
// los tipos de cita — borrarla dejaría media agenda sin clasificar y sin forma
// de saber qué era cada cosa, y eso no se puede deshacer. Devuelve
// `{ borrada, enUso }` para que la pantalla pueda decir cuál de las dos pasó.
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("calendar")) return forbidden("Módulo calendario no activo");
  if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) {
    return forbidden("Solo un administrador puede tocar el catálogo de categorías");
  }

  const { id } = await params;
  const categoria = await resolver(tenantModels, id);
  const antes = resumen(categoria, ["name", "color", "active"]);

  const enUso = await tenantModels.CalendarTask.count({ where: { categoryId: categoria.id } });
  if (enUso > 0) {
    await categoria.update({ active: false });
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "calendar.categoria.desactivada",
      entity: "CalendarCategory",
      entityId: categoria.id,
      before: antes,
    });
    return ok({ borrada: false, enUso });
  }

  await categoria.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "calendar.categoria.borrada",
    entity: "CalendarCategory",
    entityId: id,
    before: antes,
  });
  return ok({ borrada: true, enUso: 0 });
});
