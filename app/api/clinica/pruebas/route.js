import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { pruebasDe, areasDe, normalizarPruebasDelCentro } from "../../../../lib/clinica/pruebasDiagnosticas.js";

/**
 * /api/clinica/pruebas — el catálogo de pruebas diagnósticas del centro
 * (05/09/2026, AV-0045 de Aumenta: «sería importante que el sistema quedara
 * preparado para añadir nuevas pruebas en el futuro sin tener que modificar
 * toda la plantilla»).
 *
 *   GET → { pruebas: [...], areas: [...] } — las de fábrica (el listado que
 *         mandó el centro, 13 áreas) y las que el centro haya añadido. Las lee
 *         cualquiera del centro: quien redacta el informe elige de aquí.
 *   PUT → reemplaza las del CENTRO. Body: { pruebas: [{ nombre, uso, areas }] }.
 *         Las de fábrica no se tocan ni se pueden pisar. **Solo admin**, como
 *         las plantillas: es el catálogo con el que se firma un diagnóstico.
 *
 * Misma casa que `/api/clinica/plantillas`: `settings.clinica` en master, sin
 * tabla nueva, y `invalidateTenantCache` al guardar.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const pruebas = pruebasDe(ctx.tenant);
    return ok({ pruebas, areas: areasDe(pruebas) });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede cambiar el catálogo de pruebas");
    assertNotDemoMasterWrite(ctx);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    if (!Array.isArray(body?.pruebas)) return error("Se espera pruebas: [...]", 422);
    const propias = normalizarPruebasDelCentro(body.pruebas);

    const { Tenant } = getMasterModels();
    const fila = await Tenant.findByPk(ctx.tenant.id);
    if (!fila) return error("Cliente no encontrado", 404);

    const settings = { ...(fila.settings ?? {}) };
    const clinica = { ...(settings.clinica ?? {}) };
    clinica.pruebasDiagnosticas = propias.map(({ key, nombre, uso, areas }) => ({ key, nombre, uso, areas }));
    settings.clinica = clinica;
    await fila.update({ settings });
    invalidateTenantCache(ctx.tenant.slug);

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.pruebas.updated",
      entity: "Tenant",
      entityId: ctx.tenant.id,
      after: { pruebasDelCentro: propias.length },
    });

    const pruebas = pruebasDe({ settings });
    return ok({ pruebas, areas: areasDe(pruebas) });
  } catch (err) {
    return serverError(err);
  }
});
