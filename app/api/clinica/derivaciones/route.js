import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { referralSpecialtiesOf, slugEspecialidad } from "../../../../lib/clinica/derivaciones.js";

/**
 * /api/clinica/derivaciones — catálogo de especialidades de DERIVACIÓN del
 * centro (sprint Aumenta 2026-07, punto 3.1).
 *
 * Era una constante en el código: cada centro deriva a los suyos (un centro con
 * logopedia deriva a logopedas, y Aumenta no). Ahora vive en
 * `settings.clinica.referralSpecialties` y esto es su puerta.
 *
 *   GET → catálogo efectivo (el propio del tenant, o el de partida)
 *   PUT → lo reemplaza (solo admin). Body: { especialidades: ["Logopeda", …] }
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const MAX = 40;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    return ok({ especialidades: referralSpecialtiesOf(ctx.tenant) });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede cambiar el catálogo");
    // Escribe en `master.tenants` y la demo pública da sesión de ADMIN a
    // visitantes anónimos: sin este guard, cualquiera con el enlace le cambia
    // el catálogo al escaparate.
    assertNotDemoMasterWrite(ctx);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    if (!Array.isArray(body?.especialidades)) return error("Se espera especialidades: [...]", 422);

    const previas = referralSpecialtiesOf(ctx.tenant);
    const vistas = new Set();
    const especialidades = [];
    for (const bruto of body.especialidades) {
      const label = String(bruto ?? "").trim().slice(0, 80);
      if (!label) continue;
      // Si la etiqueta ya existía se CONSERVA su clave: los informes guardados
      // apuntan a la clave, y regenerarla los dejaría sin especialidad.
      const previa = previas.find((p) => p.label.toLowerCase() === label.toLowerCase());
      const key = previa?.key || slugEspecialidad(label);
      if (!key || vistas.has(key)) continue;
      vistas.add(key);
      especialidades.push({ key, label });
      if (especialidades.length >= MAX) break;
    }
    if (especialidades.length === 0) return error("Deja al menos una especialidad", 422);

    const { Tenant } = getMasterModels();
    const fila = await Tenant.findByPk(ctx.tenant.id);
    if (!fila) return error("Cliente no encontrado", 404);

    const settings = { ...(fila.settings ?? {}) };
    settings.clinica = { ...(settings.clinica ?? {}), referralSpecialties: especialidades };
    await fila.update({ settings });
    invalidateTenantCache(ctx.tenant.slug);

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.derivaciones.updated",
      entity: "Tenant",
      entityId: ctx.tenant.id,
      before: { especialidades: previas.length },
      after: { especialidades: especialidades.length },
    });

    return ok({ especialidades });
  } catch (err) {
    return serverError(err);
  }
});
