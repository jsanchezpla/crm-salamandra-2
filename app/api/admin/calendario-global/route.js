import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { vinculosDe, vincular, desvincular } from "../../../../lib/calendario-global/vinculos.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * /api/admin/calendario-global — quién ve qué desde el calendario global
 * (03/09/2026). Es la misma tabla que toca `scripts/calendario-global-vincular.js`,
 * por la misma librería, para que el panel y el script no se contradigan.
 *
 *   GET    → cuentas del CRM que pueden mirar, clientes con su módulo
 *            Calendario y los vínculos que hay
 *   POST   { cuenta, slug, usuario?, color? } → vincula (o corrige)
 *   DELETE { cuenta, slug } → desvincula
 *
 * Mismos tres candados que el resto del back-office. Que el middleware
 * devuelva 404 desde el host de los clientes reduce superficie, no autoriza.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

async function cuentaPorCorreo(email) {
  const { User } = getMasterModels();
  if (!email || typeof email !== "string") return null;
  return User.findOne({
    where: { email: email.trim().toLowerCase() },
    attributes: ["id", "email", "tenantId", "soloBackoffice"],
  });
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { User, Tenant, TenantModule, CalendarioGlobalVinculo } = getMasterModels();
    const [tenants, modulos, cuentas, filas] = await Promise.all([
      Tenant.findAll({ where: { status: "active" }, attributes: ["id", "slug", "name"], order: [["slug", "ASC"]] }),
      TenantModule.findAll({ where: { moduleKey: "calendar", enabled: true }, attributes: ["tenantId"] }),
      // Las cuentas del CRM (las de back-office no entran en el calendario).
      User.findAll({ where: { soloBackoffice: false }, attributes: ["id", "email", "tenantId"], order: [["email", "ASC"]] }),
      CalendarioGlobalVinculo.findAll({ attributes: ["usuarioId"] }),
    ]);
    const conCalendario = new Set(modulos.map((m) => m.tenantId));
    const slugDe = new Map(tenants.map((t) => [t.id, t.slug]));

    // Los vínculos, por cuenta que mira, con lo que devuelve la misma función
    // que usa la pantalla del calendario: así el panel enseña lo que se ve.
    const miradores = [...new Set(filas.map((f) => f.usuarioId))];
    const vinculos = [];
    for (const usuarioId of miradores) {
      const cuenta = cuentas.find((c) => c.id === usuarioId);
      if (!cuenta) continue;
      for (const v of await vinculosDe(usuarioId)) {
        vinculos.push({ cuenta: cuenta.email, ...v });
      }
    }

    return ok({
      clientes: tenants.map((t) => ({ slug: t.slug, nombre: t.name, calendario: conCalendario.has(t.id) })),
      cuentas: cuentas.map((c) => ({ email: c.email, slug: slugDe.get(c.tenantId) ?? null })),
      vinculos,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const quien = await cuentaPorCorreo(body?.cuenta);
    if (!quien) return error("No existe esa cuenta");
    if (quien.soloBackoffice) return error("Esa cuenta es de back-office: el calendario global es para cuentas del CRM");
    const slug = String(body?.slug ?? "");
    if (!/^[a-z0-9_]+$/.test(slug)) return error("Cliente inválido");

    let resultado;
    try {
      resultado = await vincular({
        usuarioId: quien.id,
        slug,
        emailTenant: body?.usuario ? String(body.usuario) : null,
        color: body?.color ? String(body.color) : null,
      });
    } catch (e) {
      return error(e.message);
    }

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "calendario_global.vinculo.guardado",
      entity: "CalendarioGlobalVinculo",
      entityId: resultado.fila.id,
      after: { cuenta: quien.email, slug, creado: resultado.creado },
    });
    return ok({ creado: resultado.creado });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const quien = await cuentaPorCorreo(body?.cuenta);
    if (!quien) return error("No existe esa cuenta");
    const slug = String(body?.slug ?? "");
    if (!/^[a-z0-9_]+$/.test(slug)) return error("Cliente inválido");

    const n = await desvincular({ usuarioId: quien.id, slug });
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "calendario_global.vinculo.quitado",
      entity: "CalendarioGlobalVinculo",
      entityId: null,
      before: { cuenta: quien.email, slug },
    });
    return ok({ quitados: n });
  } catch (err) {
    return serverError(err);
  }
});
