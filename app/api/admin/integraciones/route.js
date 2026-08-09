import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import {
  INTEGRACIONES,
  NOMBRES_MODULO,
  TIPOS,
  necesitaDestino,
} from "../../../../lib/provisioning/integraciones.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/integraciones — por dónde se tocan los módulos entre sí.
 *
 * POR QUÉ EXISTE (09/08/2026, a petición de Jorge)
 * El catálogo de venta (`lib/provisioning/catalogo.js`) dice qué módulo NECESITA
 * a otro para existir —clínica necesita pacientes— y eso ya se usaba en el alta.
 * Pero no dice nada de la otra capa, que es la que se nota a diario: que un lead
 * se convierta en ficha de cliente, que una cita quede colgada de esa ficha, que
 * una factura sepa de qué persona del equipo es. Eso no estaba escrito en ningún
 * sitio y solo lo sabía quien había leído ese trozo de código.
 *
 * NO ES UNA LISTA ESTÁTICA, y ahí está la gracia
 * El mapa por sí solo es documentación. Cruzado con lo que cada cliente tiene
 * contratado contesta las preguntas que se hacen de verdad al teléfono:
 *   · «si a Aumenta le apago Pacientes, ¿qué se le rompe?»
 *   · «¿por qué a este cliente no le sale el botón de convertir en ficha?»
 *   · «¿qué gana este si le vendemos Facturación?»
 *
 * A MEDIAS ≠ ROTO
 * Un cliente con el módulo de origen y sin el de destino tiene la integración a
 * medias. A veces es deliberado (Quality Energy tiene leads y no quiere fichas
 * de cliente) y a veces es un olvido. La pantalla lo enseña como un aviso, nunca
 * como un error, y solo para los tipos donde la falta se NOTA — una conversión
 * que no tiene a dónde ir, un enlace que se queda sin la otra punta. Un `gating`
 * o una agregación sin destino simplemente no aparece, que es lo correcto.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();

    const [tenants, modulos] = await Promise.all([
      Tenant.findAll({ attributes: ["id", "name", "slug", "status"], order: [["name", "ASC"]] }),
      TenantModule.findAll({ attributes: ["tenantId", "moduleKey", "enabled"] }),
    ]);

    /** slug → Set de moduleKey encendidos. */
    const activos = new Map();
    const nombrePorSlug = new Map();
    for (const t of tenants) {
      activos.set(t.slug, new Set());
      nombrePorSlug.set(t.slug, t.name);
    }
    const slugPorId = new Map(tenants.map((t) => [t.id, t.slug]));
    for (const m of modulos) {
      if (!m.enabled) continue;
      const slug = slugPorId.get(m.tenantId);
      if (slug) activos.get(slug).add(m.moduleKey);
    }

    // Nuestro propio tenant no cuenta: tiene el panel, no es un cliente al que
    // se le venda nada. Colarlo en los recuentos hacía parecer que una
    // integración la usaba un cliente más de los que la usan.
    const clientes = [...activos.keys()].filter((s) => s !== ctx.tenant?.slug);

    const integraciones = INTEGRACIONES.map((i) => {
      const vivas = [];
      const aMedias = [];

      for (const slug of clientes) {
        const tiene = activos.get(slug);
        const conOrigen = tiene.has(i.desde);
        const conDestino = tiene.has(i.hacia);
        if (conOrigen && conDestino) vivas.push(slug);
        else if (conOrigen && necesitaDestino(i.tipo)) aMedias.push(slug);
      }

      return { ...i, vivas, aMedias };
    });

    // Primero lo que más clientes están usando: es lo que más se rompe si se
    // toca y lo que antes hay que saber explicar por teléfono.
    integraciones.sort((a, b) => b.vivas.length - a.vivas.length);

    // La misma lista vista por cliente, para el «¿cómo va lo de Aumenta?».
    const porCliente = clientes
      .map((slug) => ({
        slug,
        nombre: nombrePorSlug.get(slug),
        modulos: activos.get(slug).size,
        vivas: integraciones.filter((i) => i.vivas.includes(slug)).length,
        aMedias: integraciones.filter((i) => i.aMedias.includes(slug)).length,
      }))
      .sort((a, b) => b.vivas - a.vivas);

    return ok({
      integraciones,
      porCliente,
      nombresModulo: NOMBRES_MODULO,
      tipos: TIPOS,
      totales: {
        integraciones: integraciones.length,
        // Cuántas no las usa NADIE hoy: o son de un módulo que no ha vendido
        // nadie, o están escritas de más. Las dos cosas conviene verlas.
        sinNadie: integraciones.filter((i) => i.vivas.length === 0).length,
        aMedias: integraciones.reduce((n, i) => n + i.aMedias.length, 0),
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
