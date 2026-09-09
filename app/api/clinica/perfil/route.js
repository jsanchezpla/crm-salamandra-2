import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { CAMPOS, normalizarPerfil, perfilDelCentro } from "../../../../lib/clinica/perfilDelCentro.js";

/**
 * /api/clinica/perfil — lo que el centro dice de sí mismo, para que la IA lo
 * sepa (09/09/2026, Rodrigo: «la IA necesita un revamp para ser mucho más
 * capaz y tener más conocimiento del centro»).
 *
 * El texto se escribe en `settings.clinica.perfil` y de ahí lo lee
 * `lib/clinica/perfilDelCentro.js` para meterlo en el prompt de los cuatro
 * documentos clínicos. Sin esta puerta el perfil solo se podía poner por SQL, y
 * un dato que solo sabe escribir Salamandra no es un dato del cliente.
 *
 *   GET → { perfil, campos }   (los campos, para no repetir rótulos en la UI)
 *   PUT → lo reemplaza entero. Body: { perfil: { terapias, publico, … } }
 *
 * ── POR QUÉ SOLO ADMIN ─────────────────────────────────────────────────────
 * Lo que se escribe aquí cambia CÓMO redacta la IA en todos los informes del
 * centro, que salen firmados por una colegiada. Es la misma respuesta que se
 * dio con las plantillas: la decide dirección, no quien redacta.
 *
 * ── POR QUÉ LA AUDITORÍA NO LLEVA EL TEXTO ─────────────────────────────────
 * `master` es un schema COMPARTIDO por todos los clientes y esto es material
 * clínico del centro. Del cambio se guarda qué campos quedaron escritos y
 * cuánto ocupan, nunca lo que dicen.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/** El resumen que sí puede vivir en master: qué hay, no qué dice. */
function resumen(perfil) {
  const p = normalizarPerfil(perfil);
  return Object.fromEntries(CAMPOS.map((c) => [c.clave, (p[c.clave] ?? "").length]));
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    return ok({ perfil: perfilDelCentro(ctx.tenant), campos: CAMPOS });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo un administrador puede cambiar el perfil del centro");
    // Escribe en `master.tenants` y la demo pública da sesión de ADMIN a
    // visitantes anónimos: sin este guard, cualquiera con el enlace le cambia
    // el prompt de la IA al escaparate.
    assertNotDemoMasterWrite(ctx);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    if (body?.perfil === undefined || body.perfil === null || typeof body.perfil !== "object" || Array.isArray(body.perfil)) {
      return error("Se espera perfil: { … }", 422);
    }

    const antes = perfilDelCentro(ctx.tenant);
    // `normalizarPerfil` recorta a los topes de cada campo y tira lo vacío: lo
    // que llegue de más no entra en el prompt aunque alguien lo mande a mano.
    const perfil = normalizarPerfil(body.perfil);

    const { Tenant } = getMasterModels();
    const fila = await Tenant.findByPk(ctx.tenant.id);
    if (!fila) return error("Cliente no encontrado", 404);

    const settings = { ...(fila.settings ?? {}) };
    const clinica = { ...(settings.clinica ?? {}) };
    // Vaciarlo BORRA la clave en vez de dejar un objeto vacío: así el prompt
    // vuelve a salir byte a byte como el de un centro que nunca lo escribió,
    // que es la propiedad que fija `_smoke-perfil-del-centro`.
    if (Object.keys(perfil).length === 0) delete clinica.perfil;
    else clinica.perfil = perfil;
    settings.clinica = clinica;
    await fila.update({ settings });
    invalidateTenantCache(ctx.tenant.slug);

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.perfil.updated",
      entity: "Tenant",
      entityId: ctx.tenant.id,
      before: resumen(antes),
      after: resumen(perfil),
    });

    return ok({ perfil });
  } catch (err) {
    return serverError(err);
  }
});
