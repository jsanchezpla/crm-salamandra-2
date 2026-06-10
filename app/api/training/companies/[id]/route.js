import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, noContent } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, Course } = tenantModels;
  const { id } = await params;

  const company = await Company.findByPk(id, {
    include: [{ model: Course, as: "courses" }],
  });

  if (!company) throw new NotFoundError("Empresa no encontrada");

  return ok(company);
});

/**
 * PATCH /api/training/companies/[id]
 *
 * Editar datos básicos de empresa. Campos editables: `name`, `externalId`,
 * `active`. Resto se ignora. El frontend mostrará un aviso informativo
 * cuando se desactive una empresa con empleados (activos o pre-aprobados),
 * pero el backend NO bloquea — la decisión es del admin.
 */
export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Company } = tenantModels;
  const { id } = await params;

  const company = await Company.findByPk(id);
  if (!company) throw new NotFoundError("Empresa no encontrada");

  const body = await request.json().catch(() => ({}));
  const updates = {};

  if ("name" in body) {
    if (!String(body.name ?? "").trim()) {
      throw new ValidationError("El campo name no puede estar vacío");
    }
    updates.name = String(body.name).trim();
  }
  if ("externalId" in body) {
    if (body.externalId === null || body.externalId === "") {
      updates.externalId = null;
    } else {
      const n = parseInt(body.externalId, 10);
      if (!Number.isFinite(n)) throw new ValidationError("externalId debe ser numérico o null");
      updates.externalId = n;
    }
  }
  if ("active" in body) {
    updates.active = !!body.active;
  }

  if (Object.keys(updates).length === 0) {
    return ok(company); // no-op
  }

  await company.update(updates);
  console.log(`[training] company patched id=${id} updates=${Object.keys(updates).join(",")}`);
  return ok(company);
});

/**
 * DELETE /api/training/companies/[id]
 *
 * Soft delete: pone `active=false`. No borra filas — preserva el historial
 * de empleados y cursos contratados. El frontend mostrará un aviso si hay
 * empleados activos/pendientes, pero la API no bloquea por construcción.
 */
export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Company } = tenantModels;
  const { id } = await params;

  const company = await Company.findByPk(id);
  if (!company) throw new NotFoundError("Empresa no encontrada");

  if (company.active) {
    await company.update({ active: false });
    console.log(`[training] company soft-deleted id=${id}`);
  }
  return noContent();
});
