import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/modulos — qué tiene contratado cada cliente y qué lleva a medida.
 *
 * POR QUÉ EXISTE (08/08/2026)
 * Esto no se podía saber sin abrir la base de datos. La pregunta «¿cuántos
 * módulos tiene Aumenta?» tenía tres respuestas distintas —CLAUDE.md decía 13,
 * el entorno local 12 y los documentos del sprint ~17— y ninguna era la buena:
 * eran 20. Es la base de lo que se le factura a un cliente y de cualquier
 * conversación con él, así que tiene que poder mirarse sin consultar a mano.
 *
 * QUÉ CUENTA COMO «A MEDIDA», y por qué se distinguen cuatro cosas
 * No es lo mismo que un cliente tenga una PANTALLA propia (que hay que mantener
 * aparte cada vez que se toca la base) que un ajuste de comportamiento o un
 * campo extra. Se separan porque el coste de cada una es muy distinto:
 *   · pantalla  — un fichero entero en modules/overrides/, se queda atrás solo
 *   · lógica    — el módulo se comporta distinto para ese cliente
 *   · pruebas   — features en marcha que quizá no deberían seguir encendidas
 *   · campos    — datos extra en su schema
 *
 * NO devuelve el CONTENIDO de esas personalizaciones, solo si las hay: dentro
 * puede haber configuración sensible del cliente, y para saber a quién hay que
 * mantener basta con saber que existe.
 *
 * Mismos tres candados que el resto del back-office: módulo `provisioning` (que
 * solo tiene nuestro tenant), rol admin leído fresco de la base, y nunca desde
 * la demo.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** ¿Tiene algo dentro este JSONB? `{}` y null cuentan como vacío. */
function tieneAlgo(valor) {
  if (!valor) return false;
  if (typeof valor === "object") return Object.keys(valor).length > 0;
  const s = String(valor);
  return s !== "{}" && s !== "null" && s !== "";
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();

    const [tenants, modulos] = await Promise.all([
      Tenant.findAll({
        attributes: ["id", "name", "slug", "plan", "status"],
        order: [["name", "ASC"]],
      }),
      TenantModule.findAll({
        attributes: [
          "tenantId", "moduleKey", "enabled",
          "uiOverride", "logicOverrides", "featureFlags", "schemaExtensions",
        ],
      }),
    ]);

    const porTenant = new Map();
    for (const m of modulos) {
      if (!porTenant.has(m.tenantId)) porTenant.set(m.tenantId, []);
      porTenant.get(m.tenantId).push(m);
    }

    const clientes = tenants.map((t) => {
      const suyos = porTenant.get(t.id) ?? [];
      const activos = suyos.filter((m) => m.enabled);

      // Solo se listan las personalizaciones de módulos ENCENDIDOS: una pantalla
      // propia de un módulo apagado no la ve nadie y solo hace ruido.
      const aMedida = activos
        .map((m) => ({
          modulo: m.moduleKey,
          pantalla: m.uiOverride ?? null,
          logica: tieneAlgo(m.logicOverrides),
          pruebas: tieneAlgo(m.featureFlags),
          campos: tieneAlgo(m.schemaExtensions),
        }))
        .filter((m) => m.pantalla || m.logica || m.pruebas || m.campos);

      return {
        nombre: t.name,
        slug: t.slug,
        plan: t.plan,
        estado: t.status,
        modulos: activos.map((m) => m.moduleKey).sort(),
        apagados: suyos.filter((m) => !m.enabled).map((m) => m.moduleKey).sort(),
        aMedida,
      };
    });

    // El más grande arriba: es el que más cuesta mantener y del que más se
    // habla. Ordenar por nombre dejaba a los de un módulo mezclados con los de
    // veinte, que es justo lo que esta pantalla viene a distinguir.
    clientes.sort((a, b) => b.modulos.length - a.modulos.length);

    return ok({
      clientes,
      totales: {
        clientes: clientes.length,
        conPantallaPropia: clientes.filter((c) => c.aMedida.some((m) => m.pantalla)).length,
        personalizaciones: clientes.reduce((n, c) => n + c.aMedida.length, 0),
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
