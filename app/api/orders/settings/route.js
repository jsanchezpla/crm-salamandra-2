import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const { OrderSettings } = tenantModels;
  // Singleton: si no existe, devolvemos defaults razonables sin crear fila.
  const row = await OrderSettings.findOne();
  return ok(
    row ?? {
      transportPrice: 0,
      transportVatRate: 21,
      defaultVatRate: 21,
    }
  );
});

export const PUT = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("orders")) return forbidden("Módulo orders no activo");
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden cambiar la configuración");

  const { OrderSettings } = tenantModels;
  const body = await request.json();

  const num = (v, fallback) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  try {
    let row = await OrderSettings.findOne();
    const patch = {
      transportPrice: num(body.transportPrice, row?.transportPrice ?? 0),
      transportVatRate: num(body.transportVatRate, row?.transportVatRate ?? 21),
      defaultVatRate: num(body.defaultVatRate, row?.defaultVatRate ?? 21),
    };
    if (patch.transportPrice < 0) return error("transportPrice no puede ser negativo", 422);

    if (!row) {
      row = await OrderSettings.create(patch);
    } else {
      await row.update(patch);
    }
    return ok(row);
  } catch (err) {
    if (err?.name?.startsWith("Sequelize")) {
      return error(`Datos inválidos: ${err.errors?.[0]?.message || err.message}`, 422);
    }
    return serverError(err);
  }
});
