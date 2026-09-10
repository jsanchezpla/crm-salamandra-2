import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { bonosConSesiones } from "../../../../../lib/billing/bonosConSesiones.js";
import { resumenPorTipoDeBono, totalesDeBonos, bonoCerrado } from "../../../../../lib/billing/bonos.js";
import { esPack } from "../../../../../lib/citas/packs.js";

/**
 * GET /api/billing/bonos/tipos — LOS GRUPOS: cada tipo de bono con la gente que
 * lo lleva detrás (10/09/2026, Rodrigo: «que se puedan ordenar por grupos igual
 * que cuotas»).
 *
 * El espejo de `/api/billing/cuotas/tipos`, con el catálogo que le toca: allí
 * los tipos son conceptos de facturación (`BillingConcept`) y aquí son TIPOS DE
 * CITA (`EventType`) — porque un bono no es una línea de precio, es el derecho a
 * N sesiones de una terapia concreta, y ese derecho lo define la agenda.
 *
 * Qué tipos salen:
 *   · los que el catálogo declara pack (`sessionsCount > 1`), aunque no los haya
 *     comprado nadie todavía: son los bonos que el centro vende;
 *   · y cualquier otro que TENGA bonos dados, aunque hoy sea una cita suelta.
 *     Pasa de verdad: se vende un bono de 4 sesiones sobre un tipo normal, o se
 *     cambia el tipo a suelto después. Esconderlos sería esconder dinero.
 *
 * ── UNA CONSULTA, NO UNA POR TIPO ──────────────────────────────────────────
 * Los bonos se traen una vez —con sus sesiones contadas y su cobro— y se
 * reparten en memoria. Aumenta tiene 232 bonos: preguntar por tipo serían
 * decenas de consultas para pintar una tabla que se mira de un vistazo.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { EventType } = tenantModels;
    /*
     * `?todos=1` trae TODOS los tipos de cita, packs o no.
     *
     * Lo pide el cajón de «Nuevo bono», y por eso lo sirve esta puerta y no
     * `/api/citas/event-types`: quien lleva Facturación puede no tener acceso al
     * módulo de Citas, y entonces aquella responde 403 y el desplegable se
     * queda vacío sin explicar por qué. Un bono de 4 sesiones sobre un tipo
     * suelto es legítimo (se avisa al darlo), así que la lista no se recorta.
     */
    const todos = new URL(request.url).searchParams.get("todos") === "1";

    // Los apagados y los ocultos también: un bono que ya no se ofrece puede
    // seguir teniendo gente con sesiones sin gastar, y casi todos los bonos de
    // acuerdo privado viven en tipos ocultos a propósito.
    const tipos = EventType
      ? (await EventType.findAll({
          attributes: ["id", "name", "sessionsCount", "price", "isHidden", "active"],
          order: [["name", "ASC"]],
        })).map((t) => t.toJSON())
      : [];

    const bonos = await bonosConSesiones({ tenantModels, hasModule, where: {} });
    const conBonos = new Set(bonos.map((b) => String(b.eventTypeId)));
    const delCatalogo = todos ? tipos : tipos.filter((t) => esPack(t) || conBonos.has(String(t.id)));

    const filas = resumenPorTipoDeBono({ tipos: delCatalogo, bonos });
    const vivos = bonos.filter((b) => !bonoCerrado(b));

    return ok({
      tipos: filas,
      total: filas.length,
      // El pie de la pantalla: lo vendido y lo que falta por cobrar de TODO,
      // que no es la suma de las filas visibles (se pueden filtrar).
      totales: { ...totalesDeBonos(vivos), cerrados: bonos.length - vivos.length },
    });
  } catch (err) {
    return serverError(err);
  }
});
