import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { ALLOWED_MODELS, isAllowedModel } from "../../../../lib/outreach/analysis/models.js";

/**
 * Ajustes del módulo Outreach. Fila única por tenant; se crea al vuelo la
 * primera vez que se consulta, para que el módulo funcione recién activado.
 *
 * `aiModel` permite bajar a un modelo más barato sin tocar código.
 * `companyContext` y `chainingRule` alimentan el system prompt del análisis.
 */

function isAdmin(request) {
  const role = request.headers.get("x-user-role");
  return role === "admin" || role === "superadmin";
}

async function getOrCreate(OutreachSettings) {
  const existing = await OutreachSettings.findOne();
  return existing ?? (await OutreachSettings.create({}));
}

export const GET = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const settings = await getOrCreate(ctx.tenantModels.OutreachSettings);
  return ok({ settings: settings.toJSON(), allowedModels: ALLOWED_MODELS });
});

export const PATCH = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!isAdmin(request)) throw new ForbiddenError("Solo un administrador puede cambiar los ajustes");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const settings = await getOrCreate(ctx.tenantModels.OutreachSettings);

  const patch = {};
  if ("aiModel" in body) {
    if (!isAllowedModel(body.aiModel)) {
      throw new ValidationError(`Modelo no admitido. Opciones: ${ALLOWED_MODELS.join(", ")}`);
    }
    patch.aiModel = body.aiModel;
  }
  if ("companyContext" in body) patch.companyContext = body.companyContext ?? null;
  if ("chainingRule" in body) patch.chainingRule = body.chainingRule ?? null;
  if ("emailTemplate" in body) patch.emailTemplate = body.emailTemplate ?? null;

  if (Object.keys(patch).length === 0) throw new ValidationError("Nada que actualizar");

  await settings.update(patch);
  return ok({ settings: settings.toJSON(), allowedModels: ALLOWED_MODELS });
});
