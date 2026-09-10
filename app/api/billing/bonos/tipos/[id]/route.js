import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { bonosConSesiones } from "../../../../../../lib/billing/bonosConSesiones.js";
import { bonoCerrado, ordenarBonos, totalesDeBonos, contarGente } from "../../../../../../lib/billing/bonos.js";
import { esPack } from "../../../../../../lib/citas/packs.js";

/**
 * GET /api/billing/bonos/tipos/[id] — LA FICHA DE UN GRUPO: quién tiene este
 * bono, cuánto le queda y qué se ha cobrado (10/09/2026, submódulo Bonos).
 *
 * El espejo de la ficha de un tipo de cuota, con las dos vistas que aquí tienen
 * sentido en vez de las tres de allí:
 *
 *   · QUIÉN LO TIENE — los bonos vivos, con las sesiones que le quedan a cada
 *     uno. Es la pregunta del mostrador: «¿a Hugo le queda alguna?».
 *   · LOS QUE PASARON — los agotados y los anulados, que es de donde sale el
 *     «volver a coger el bono». No se esconden: son la lista de a quién toca
 *     ofrecerle la renovación.
 *
 * La tercera pestaña de las cuotas —el curso mes a mes— no existe aquí y no es
 * un olvido: un bono no tiene meses. Su tiempo se mide en sesiones, y lo que
 * ocupa ese sitio es el contador de cada uno.
 */
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { EventType } = tenantModels;
    const { id } = (await ctx?.params) ?? {};

    const tipo = EventType ? await EventType.findByPk(id) : null;
    if (!tipo) return notFound("Ese tipo de bono no está en el catálogo");

    const bonos = ordenarBonos(await bonosConSesiones({ tenantModels, hasModule, where: { eventTypeId: id } }));
    const vivos = bonos.filter((b) => !bonoCerrado(b));
    const cerrados = bonos.filter((b) => bonoCerrado(b));

    return ok({
      tipo: {
        id: tipo.id,
        name: tipo.name,
        description: tipo.description ?? null,
        // Lo que dice el catálogo HOY. Puede no ser lo que compró la gente: quien
        // compró un bono de 10 tiene 10 aunque el programa ahora sean 12, y eso
        // es a propósito (`models/tenant/SessionPack.model.js`).
        sesionesDelTipo: Number(tipo.sessionsCount) || 1,
        precio: Number.isInteger(tipo.price) ? tipo.price : null,
        precioFraccionado: Number.isInteger(tipo.instalmentPrice) ? tipo.instalmentPrice : null,
        mesesFraccionado: tipo.instalmentMonths ?? null,
        esPack: esPack(tipo),
        oculto: tipo.isHidden === true,
        activo: tipo.active !== false,
        duracion: Number(tipo.duration) || null,
      },
      bonos,
      vivos: vivos.length,
      cerrados: cerrados.length,
      totales: totalesDeBonos(vivos),
      gente: contarGente(vivos),
      genteHistorica: contarGente(bonos),
    });
  } catch (err) {
    return serverError(err);
  }
});
