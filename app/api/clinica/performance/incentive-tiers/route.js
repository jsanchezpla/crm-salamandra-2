import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../../lib/tenant/tenantResolver.js";
import { normalizeTiers, tiersFromTenant, DEFAULT_INCENTIVE_TIERS } from "../../../../../lib/clinica/incentives.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";
import { assertNotDemoMasterWrite } from "../../../../../lib/demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// GET — tabla de tramos vigente (la del tenant o el default). SOLO DIRECCIÓN:
// los tramos describen el esquema de incentivos, que las terapeutas no ven.
export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver los tramos");
  const configured = normalizeTiers(ctx.tenant?.settings?.clinica?.incentiveTiers);
  return ok({ tiers: configured ?? DEFAULT_INCENTIVE_TIERS, isDefault: configured == null });
});

// PUT — guardar la tabla de tramos (solo dirección). Se persiste en
// master.tenants.settings.clinica.incentiveTiers y se invalida la caché para
// que la propuesta se recalcule al instante.
export const PUT = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede configurar los tramos");
  assertNotDemoMasterWrite(ctx); // demo pública: no escribir en master

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const tiers = normalizeTiers(body.tiers);
  if (!tiers) return error("La tabla de tramos no es válida (indica al menos un tramo con importe).");

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(ctx.tenant.id);
  if (!tenant) return notFound("Tenant no encontrado");

  // Objeto fresco para que Sequelize detecte el cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  settings.clinica = { ...(settings.clinica ?? {}) };
  const before = settings.clinica.incentiveTiers ?? null;
  settings.clinica.incentiveTiers = tiers;

  await tenant.update({ settings });
  invalidateTenantCache(ctx.slug);

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.performance.tiers",
    entity: "Tenant",
    entityId: ctx.tenant.id,
    before: { incentiveTiers: before },
    after: { incentiveTiers: tiers },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ tiers, isDefault: false });
});
