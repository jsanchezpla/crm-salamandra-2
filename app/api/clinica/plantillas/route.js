import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { DOCUMENTOS, normalizarPlantillas, plantillasDe } from "../../../../lib/clinica/plantillas.js";

/**
 * /api/clinica/plantillas — las plantillas de informe y de registro de sesión
 * DEL CENTRO (29/08/2026, lo pidió Aumenta por Rodrigo).
 *
 * Los apartados eran una constante en el código —siete para el informe, siete
 * para el registro—, y cada tipo nuevo que pidieran (beca, derivación, alta)
 * era un fichero más y un despliegue. Ahora la lista vive en
 * `settings.clinica.plantillas` y esta es su puerta, igual que
 * `/api/clinica/derivaciones` lo es del catálogo de especialidades.
 *
 *   GET → { informe: [...], registro: [...] } — las EFECTIVAS: las del centro,
 *         o las de fábrica si no ha tocado nada. Las lee cualquiera del centro:
 *         quien redacta necesita saber con qué apartados escribe.
 *   PUT → reemplaza las de UN documento. Body: { doc, plantillas: [...] }.
 *         **Solo admin**: los títulos de un informe clínico salen firmados por
 *         una colegiada, así que la plantilla del centro la decide dirección.
 *         Para lo de un caso concreto están los apartados sueltos, que se
 *         añaden en el propio documento y no pasan por aquí.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const salida = {};
    for (const doc of DOCUMENTOS) salida[doc] = plantillasDe(ctx.tenant, doc);
    return ok(salida);
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede cambiar las plantillas");
    // Escribe en `master.tenants` y la demo pública da sesión de ADMIN a
    // visitantes anónimos: sin este guard, cualquiera con el enlace le cambia
    // las plantillas al escaparate.
    assertNotDemoMasterWrite(ctx);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const doc = String(body?.doc ?? "");
    if (!DOCUMENTOS.includes(doc)) return error("doc tiene que ser 'informe' o 'registro'", 422);
    if (!Array.isArray(body?.plantillas)) return error("Se espera plantillas: [...]", 422);

    // Las claves de los apartados que ya existían se CONSERVAN aunque se
    // reescriba su título: los informes y las sesiones guardados apuntan a la
    // clave, y regenerarla los dejaría con el apartado en blanco.
    const previas = plantillasDe(ctx.tenant, doc);
    const plantillas = normalizarPlantillas(body.plantillas, { previas });
    if (plantillas.length === 0) {
      return error("Deja al menos una plantilla, con su nombre y un apartado", 422);
    }

    const { Tenant } = getMasterModels();
    const fila = await Tenant.findByPk(ctx.tenant.id);
    if (!fila) return error("Cliente no encontrado", 404);

    const settings = { ...(fila.settings ?? {}) };
    const clinica = { ...(settings.clinica ?? {}) };
    clinica.plantillas = { ...(clinica.plantillas ?? {}), [doc]: plantillas };
    settings.clinica = clinica;
    await fila.update({ settings });
    invalidateTenantCache(ctx.tenant.slug);

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.plantillas.updated",
      entity: "Tenant",
      entityId: ctx.tenant.id,
      // Un RESUMEN, nunca los títulos: son texto del centro y no hace falta
      // duplicarlos en el log compartido de master.
      before: { doc, plantillas: previas.length },
      after: { doc, plantillas: plantillas.length },
    });

    return ok({ doc, plantillas });
  } catch (err) {
    return serverError(err);
  }
});
