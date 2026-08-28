import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

// Limite defensivo de longitud para evitar payloads gigantes.
const MAX_STR = 200;

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.slice(0, MAX_STR);
}

export const GET = withTenant(async (request, _ctx, { tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingUser, Company } = tenantModels;
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  // Soft delete: por defecto NO incluye archivados. Pasar ?includeArchived=true
  // para ver TODOS (activos + archivados), o ?archivedOnly=true para solo
  // archivados.
  const includeArchived = searchParams.get("includeArchived") === "true";
  const archivedOnly = searchParams.get("archivedOnly") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const where = {};
  if (type) where.type = type;
  if (companyId) where.companyId = companyId;
  if (archivedOnly) {
    where.archivedAt = { [Op.ne]: null };
  } else if (!includeArchived) {
    where.archivedAt = null;
  }
  /*
   * Todas las palabras escritas, cada una en cualquiera de los campos
   * (28/08/2026). Antes buscaba la frase entera dentro de cada columna por
   * separado, y en `training_users` el nombre está partido en dos (`name` es el
   * nombre de pila y `last_name` los apellidos): escribir nombre y apellido no
   * encontraba a nadie. Es el mismo fallo que tenía Pacientes; `training_users`
   * y `patients` son las dos únicas tablas del CRM que parten el nombre.
   * El porqué, en `lib/utils/busqueda.js`.
   */
  if (search) {
    const porNombre = await filtroPorNombre(tenantSequelize, search, [
      "TrainingUser.name", "TrainingUser.last_name", "TrainingUser.email", "TrainingUser.username",
    ]);
    if (porNombre) (where[Op.and] ||= []).push(porNombre);
  }

  const { rows, count } = await TrainingUser.findAndCountAll({
    where,
    include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
    limit,
    offset,
    order: [["name", "ASC"]],
  });

  return ok({ users: rows, total: count, page, limit });
});

/**
 * POST /api/training/users
 *
 * Crea un empleado individual desde la UI (formulario en la ficha de empresa).
 * Alternativa al import por Excel cuando solo se quiere dar de alta a 1 persona.
 *
 * Body:
 *   {
 *     companyId: UUID (obligatorio),
 *     email: string (obligatorio),
 *     name?: string,
 *     lastName?: string,
 *     birthDate?: "YYYY-MM-DD",
 *     nif?: string
 *   }
 *
 * Reglas:
 *   - Se crea con type='company' y active=false (pre-aprobado: se activa al
 *     completar el registro en el campus, igual que un usuario importado).
 *   - Email único en el tenant (case-insensitive). Si ya existe:
 *       · si el match está archivado → se reactiva en la empresa indicada
 *         (mismo patrón que el import).
 *       · si no, devuelve 409.
 *   - Solo admin/superadmin.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { TrainingUser, Company } = tenantModels;
  const body = await request.json().catch(() => ({}));

  const companyId = trimOrNull(body.companyId);
  const emailRaw = trimOrNull(body.email);
  if (!companyId) throw new ValidationError("companyId es obligatorio");
  if (!emailRaw) throw new ValidationError("email es obligatorio");

  const email = emailRaw.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("email con formato inválido");
  }

  const company = await Company.findByPk(companyId);
  if (!company) throw new ValidationError("La empresa indicada no existe");

  const name = trimOrNull(body.name);
  const lastName = trimOrNull(body.lastName);
  const nif = trimOrNull(body.nif);
  const birthDate = trimOrNull(body.birthDate);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new ValidationError("birthDate debe tener formato YYYY-MM-DD");
  }

  const existing = await TrainingUser.findOne({ where: { email } });
  if (existing) {
    if (existing.archivedAt) {
      // Reactivar y reasignar a la empresa indicada (mismo criterio que el import).
      await existing.update({
        archivedAt: null,
        companyId,
        type: "company",
        ...(name ? { name } : {}),
        ...(lastName ? { lastName } : {}),
        ...(nif ? { nif } : {}),
        ...(birthDate ? { birthDate } : {}),
      });
      const reloaded = await TrainingUser.findByPk(existing.id, {
        include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
      });
      console.log(`[training:create] reactivated email=${email} companyId=${companyId}`);
      return ok(reloaded);
    }
    return error("Ya existe un usuario con ese email", 409);
  }

  const userRow = await TrainingUser.create({
    email,
    name,
    lastName,
    birthDate,
    nif,
    companyId,
    type: "company",
    active: false,
  });

  const full = await TrainingUser.findByPk(userRow.id, {
    include: [{ model: Company, as: "company", attributes: ["id", "name"] }],
  });
  console.log(`[training:create] created email=${email} id=${userRow.id} companyId=${companyId}`);
  return created(full);
});
