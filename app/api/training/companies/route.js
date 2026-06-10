import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../lib/utils/errors.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { Company, TrainingUser, CompanyCourse } = tenantModels;

  const companies = await Company.findAll({
    order: [["name", "ASC"]],
  });

  // Contar cursos y usuarios por empresa en paralelo
  const ids = companies.map((c) => c.id);

  // 3 conteos en paralelo: cursos contratados (CompanyCourse), empleados
  // ACTIVOS (con acceso a su cuenta WP) y empleados PRE-APROBADOS
  // (importados pero pendientes de activación vía /register/empresa).
  const [courseCounts, activeUserCounts, pendingUserCounts] = await Promise.all([
    CompanyCourse.findAll({
      attributes: [
        "companyId",
        [CompanyCourse.sequelize.fn("COUNT", CompanyCourse.sequelize.col("id")), "count"],
      ],
      where: { companyId: ids },
      group: ["companyId"],
      raw: true,
    }),
    TrainingUser.findAll({
      attributes: [
        "companyId",
        [TrainingUser.sequelize.fn("COUNT", TrainingUser.sequelize.col("id")), "count"],
      ],
      where: { companyId: ids, type: "company", active: true },
      group: ["companyId"],
      raw: true,
    }),
    TrainingUser.findAll({
      attributes: [
        "companyId",
        [TrainingUser.sequelize.fn("COUNT", TrainingUser.sequelize.col("id")), "count"],
      ],
      where: { companyId: ids, type: "company", active: false },
      group: ["companyId"],
      raw: true,
    }),
  ]);

  const courseCountMap = Object.fromEntries(courseCounts.map((r) => [r.companyId, parseInt(r.count)]));
  const activeCountMap = Object.fromEntries(activeUserCounts.map((r) => [r.companyId, parseInt(r.count)]));
  const pendingCountMap = Object.fromEntries(pendingUserCounts.map((r) => [r.companyId, parseInt(r.count)]));

  const data = companies.map((c) => {
    const activeCount = activeCountMap[c.id] ?? 0;
    const pendingCount = pendingCountMap[c.id] ?? 0;
    return {
      ...c.toJSON(),
      courseCount: courseCountMap[c.id] ?? 0,
      activeCount,
      pendingCount,
      // Mantenemos `userCount` por compatibilidad con consumidores antiguos
      // (incluido el listado actual y módulos que aún no se han migrado).
      // Equivalente al valor que devolvía antes (solo activos).
      userCount: activeCount,
    };
  });

  return ok(data);
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { Company } = tenantModels;
  const body = await request.json();
  const { name, externalId, active } = body;

  if (!name?.trim()) throw new ValidationError("El campo name es obligatorio");

  const company = await Company.create({
    name: name.trim(),
    externalId: externalId ?? null,
    active: active !== undefined ? active : true,
  });

  return created(company);
});
