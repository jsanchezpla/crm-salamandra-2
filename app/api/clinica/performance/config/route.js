import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../../lib/tenant/tenantResolver.js";
import { getPerformanceRoles, normalizeRoles } from "../../../../../lib/clinica/performanceConfig.js";
import { PERFORMANCE_PRESETS } from "../../../../../lib/clinica/performancePresets.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";
import { assertNotDemoMasterWrite } from "../../../../../lib/demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// GET — configuración de desempeño por roles vigente (la guardada o el rol
// legacy sintetizado), los presets para "Añadir rol" y las posiciones (puestos)
// que existen hoy en team_members para el multi-select. SOLO DIRECCIÓN.
export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver la configuración de desempeño");

  const { roles, isDefaultConfig } = getPerformanceRoles(ctx.tenant);

  // Puestos únicos presentes en el tenant (mismo criterio que el selector
  // dinámico de Equipo: SELECT DISTINCT position).
  const { TeamMember } = ctx.tenantModels;
  const roleRows = await TeamMember.findAll({
    attributes: ["position"],
    where: { position: { [Op.ne]: null } },
    group: ["position"],
    raw: true,
  });
  const positions = roleRows.map((r) => r.position).filter(Boolean).sort();

  return ok({ roles, isDefaultConfig, presets: PERFORMANCE_PRESETS, positions });
});

// PUT — guardar la configuración de roles (solo dirección). Body { roles }.
// Se persiste en master.tenants.settings.clinica.performanceRoles (mismo
// mecanismo que incentiveTiers) y se invalida la caché del tenant. Guardar la
// config NO toca ninguna evaluación: las claves de área son inmutables y las
// puntuaciones guardadas se conservan.
export const PUT = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede configurar el desempeño");
  assertNotDemoMasterWrite(ctx); // demo pública: no escribir en master

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const roles = normalizeRoles(body.roles);
  if (!roles) {
    return error("La configuración de roles no es válida (revisa claves, umbrales y que los pesos de cada rol sumen 100).");
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(ctx.tenant.id);
  if (!tenant) return notFound("Tenant no encontrado");

  // Objeto fresco para que Sequelize detecte el cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  settings.clinica = { ...(settings.clinica ?? {}) };
  const before = settings.clinica.performanceRoles ?? null;
  settings.clinica.performanceRoles = { roles };

  await tenant.update({ settings });
  invalidateTenantCache(ctx.slug);

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.performance.config.update",
    entity: "Tenant",
    entityId: ctx.tenant.id,
    before: { performanceRoles: before },
    after: { performanceRoles: { roles } },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ roles, isDefaultConfig: false });
});
