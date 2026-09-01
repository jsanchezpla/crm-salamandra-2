import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { normalizarCategoria } from "../../../../lib/calendar/categorias.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// ───────────────────────────────────────────────────────────────────────────
// GET /api/calendar/categories — el catálogo entero.
//
// Devuelve TAMBIÉN las desactivadas: la pantalla de gestión las necesita, y
// el calendario tiene que poder pintar con su color un evento antiguo cuya
// categoría ya no se ofrece. Quien monta un desplegable filtra por `active`.
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("calendar")) return forbidden("Módulo calendario no activo");

  const { CalendarCategory } = tenantModels;
  const filas = await CalendarCategory.findAll({
    order: [["order", "ASC"], ["name", "ASC"]],
  });
  return ok(filas.map((c) => c.toJSON()));
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/calendar/categories — crear (solo admin, como los tipos de cita).
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("calendar")) return forbidden("Módulo calendario no activo");
  if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) {
    return forbidden("Solo un administrador puede tocar el catálogo de categorías");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body JSON inválido");
  }

  const { valores, error: mal } = normalizarCategoria(body, { creando: true });
  if (mal) return error(mal, 422);

  const { CalendarCategory } = tenantModels;
  const categoria = await CalendarCategory.create(valores);

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "calendar.categoria.creada",
    entity: "CalendarCategory",
    entityId: categoria.id,
    after: resumen(categoria, ["name", "color", "active"]),
  });

  return created(categoria.toJSON());
});
