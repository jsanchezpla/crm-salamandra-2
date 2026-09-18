import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../lib/billing/audit.js";
import { limpiarCuota, metodosValidos } from "../../../../lib/billing/cuotas.js";
import { cuotaQueRepite, motivoDeRepetida } from "../../../../lib/billing/cuotaDuplicada.js";
import { sincronizarCobrosDelTramo } from "../../../../lib/billing/cobrosDelTramo.js";
import { cuotasConPacientes } from "../../../../lib/billing/cuotasConPacientes.js";
import { ordenarCuotasPorServicio } from "../../../../lib/billing/tiposDeCuota.js";

/**
 * GET/POST /api/billing/cuotas — las cuotas asignadas (01/09/2026).
 *
 * GET: las vigentes por defecto (`?todas=1` trae también las de baja), con su
 * pagador, su paciente y —cuando no tiene— LOS PACIENTES DE SU FAMILIA ya
 * resueltos; filtrable por cliente, paciente y método.
 *
 * POST: el alta, individual **o EN GRUPO** — que es lo que pidió Aumenta
 * («crear cuotas para grupos de pacientes»). Se manda UNA vez lo que comparten
 * (conceptos, importe, método, día de cobro, alta) y la lista de destinatarios;
 * sale una cuota por cada uno. Quien ya tiene una cuota activa para ese mismo
 * paciente se SALTA con su motivo en vez de duplicarle el cobro: el lote de 40
 * familias no puede convertirse en 40 cuotas repetidas por un doble clic.
 */

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("todas") !== "1") where.active = true;
    if (searchParams.get("clientId")) {
      // «Las cuotas que PAGA esta ficha» (07/09/2026): las suyas que no paga
      // otro, más las de otras familias que paga ella (la fundación). Es lo
      // que los cajones de cobro y de factura necesitan para rellenar el
      // importe: a la familia no se le puede sugerir lo que paga la fundación.
      const cid = searchParams.get("clientId");
      where[Op.or] = [{ clientId: cid, payerClientId: null }, { payerClientId: cid }];
    }
    if (searchParams.get("patientId")) where.patientId = searchParams.get("patientId");
    const metodos = metodosValidos(searchParams.getAll("metodo"));
    if (metodos.length) where.method = { [Op.in]: metodos };

    /*
     * A cada cuota se le cuelgan los pacientes DE SU FAMILIA (01/09/2026).
     *
     * Sin esto, filtrar por paciente en la pantalla de Cuotas no encontraba
     * nada en 259 de las 274 cuotas de Aumenta: las del volcado del Organizate
     * son de la familia y tienen `patientId` a NULL. La regla de que una cuota
     * sin paciente cubre a los pacientes de su familia vive en
     * `lib/billing/cuotaPacientes.js`, con su prueba; el cómo se traen, en
     * `lib/billing/cuotasConPacientes.js` (lo comparten esta pantalla y la de
     * tipos de cuota, 09/09/2026).
     */
    const filas = await cuotasConPacientes({ tenantModels, hasModule, where });

    /*
     * Y ORDENADAS POR SERVICIO (18/09/2026, AV-0194 de Isabel: «que salgan
     * ordenadas, todas las de TO juntas, todas las de logo juntas»).
     *
     * Hasta hoy la pantalla las pintaba como las devolvía Postgres, o sea en
     * ningún orden: para ver quién va a logopedia había que leerse las 291.
     * Se ordena aquí, en el servidor, para que la pantalla no tenga que saber
     * nada del catálogo; el cómo —y por qué una cuota de dos terapias hace
     * grupo propio— vive en `lib/billing/tiposDeCuota.js` con su prueba.
     */
    const { BillingConcept } = tenantModels;
    const catalogo = BillingConcept ? await BillingConcept.findAll({ attributes: ["id", "name"] }) : [];
    const cuotas = ordenarCuotasPorServicio(filas, new Map(catalogo.map((c) => [String(c.id), c.toJSON()])));

    return ok({ cuotas, total: cuotas.length });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota, Client, BillingConcept } = tenantModels;
    const body = await request.json();

    // El catálogo solo se trae si alguien choca, y una sola vez para todo el
    // lote: sirve para nombrar la cuota que repite, no para crear nada.
    let catalogo = null;
    const catalogoPorId = async () => {
      if (catalogo) return catalogo;
      const filas = await BillingConcept.findAll({ attributes: ["id", "name"] });
      catalogo = new Map(filas.map((c) => [String(c.id), c.toJSON()]));
      return catalogo;
    };

    // Un destinatario suelto o una lista: la pantalla manda siempre la lista,
    // pero la forma de uno solo se acepta para no obligar a envolver.
    const destinatarios = Array.isArray(body?.destinatarios) && body.destinatarios.length
      ? body.destinatarios
      : [{ clientId: body?.clientId, patientId: body?.patientId ?? null }];
    if (destinatarios.length > 500) {
      return error("Demasiados destinatarios de una vez (máximo 500)", 422);
    }

    // Lo que comparten todos se valida UNA vez, con el primer destinatario de
    // muestra: si el importe o la fecha están mal, no se crea ninguna.
    const muestra = limpiarCuota({ ...body, ...destinatarios[0] });
    if (muestra.problema) return error(muestra.problema, 422);

    // El pagador, si lo hay, es UNO para todo el lote (la fundación que paga
    // la de estos tres niños) y tiene que existir: se comprueba una vez.
    const pagadorId = muestra.valores.payerClientId ?? null;
    if (pagadorId) {
      const pagador = await Client.findByPk(pagadorId, { attributes: ["id"] });
      if (!pagador) return error("La ficha del pagador no existe", 422);
    }

    const permitirDuplicadas = body?.permitirDuplicadas === true;
    const creadas = [];
    const omitidas = [];

    for (const destino of destinatarios) {
      const { valores, problema } = limpiarCuota({ ...body, ...destino });
      if (problema) { omitidas.push({ ...destino, motivo: problema }); continue; }

      const ficha = await Client.findByPk(valores.clientId, { attributes: ["id", "name"] });
      if (!ficha) { omitidas.push({ ...destino, motivo: "la ficha no existe" }); continue; }
      if (pagadorId && pagadorId === String(valores.clientId)) {
        omitidas.push({ ...destino, nombre: ficha.name, motivo: "el pagador es la propia familia: déjalo vacío" });
        continue;
      }

      if (!permitirDuplicadas) {
        /*
         * Repetir es volver a cobrar LO MISMO (18/09/2026, AV-0195).
         *
         * Hasta hoy bastaba con tener cualquier cuota viva para quedarse
         * fuera, y eso dejaba sin alta a un niño que va a logopedia Y a
         * terapia ocupacional: en producción chocaban las 284 parejas
         * cliente+paciente con cuota, y de las 7 que tienen varias ninguna
         * comparte concepto. La regla —y por qué— en
         * `lib/billing/cuotaDuplicada.js`.
         */
        const vivas = await Cuota.findAll({
          where: { clientId: valores.clientId, patientId: valores.patientId ?? null, active: true },
          attributes: ["id", "conceptIds"],
        });
        const repite = cuotaQueRepite(vivas.map((c) => c.toJSON()), valores.conceptIds);
        if (repite) {
          omitidas.push({
            ...destino,
            nombre: ficha.name,
            motivo: motivoDeRepetida(repite, await catalogoPorId()),
            cuotaId: repite.id,
          });
          continue;
        }
      }

      const cuota = await Cuota.create(valores);
      creadas.push({ id: cuota.id, clientId: cuota.clientId, patientId: cuota.patientId, nombre: ficha.name });
    }

    // Auditoría DESPUÉS de mutar, como el resto del dinero. Un lote deja UNA
    // línea con el recuento: 300 líneas idénticas no se leen.
    if (creadas.length) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "cuota.created",
        entity: "Cuota",
        entityId: creadas.length === 1 ? creadas[0].id : null,
        before: null,
        after: {
          altas: creadas.length,
          importe: valoresImporte(body),
          conceptos: (muestra.valores.conceptIds ?? []).length,
          desde: muestra.valores.startDate,
          metodo: muestra.valores.method,
          pagador: pagadorId,
        },
      });
    }

    /*
     * Y sus cobros, ya (05/09/2026, AV-0048). Asignar la cuota y que en Cobros
     * no aparezca nada hasta que alguien vuelva a pulsar «Generar el mes» era
     * el agujero del proceso: se daba de alta al paciente, se le ponía la
     * cuota, y a la hora de cobrar no había nada que cobrar.
     *
     * TODOS los meses firmados desde el 10/09/2026 (Rodrigo: «seis meses de
     * cuota, seis cobros pendientes, cada uno relativo a un mes»), no solo el
     * del mes en curso. La cuota indefinida sigue estrenando el suyo y nada
     * más: sin fecha de baja no hay número firmado. Los frenos, en
     * `lib/billing/cobrosDelTramo.js`.
     *
     * Va DESPUÉS de crear y fuera de la transacción de cada alta: si esto
     * fallara, las cuotas ya están puestas y el lote mensual las recoge igual.
     */
    const cobros = creadas.length
      ? await sincronizarCobrosDelTramo({ tenantModels, cuotaIds: creadas.map((c) => c.id) })
      : { creados: 0, actualizados: 0, sinImporte: 0, intocables: 0, meses: [], resultados: [] };

    return created({ creadas: creadas.length, cuotas: creadas, omitidas, cobros });
  } catch (err) {
    return serverError(err);
  }
});

/** El importe tal cual se pactó, para el rastro (null = «lo que digan sus conceptos»). */
function valoresImporte(body) {
  const v = body?.amount;
  return v === null || v === undefined || v === "" ? null : String(v);
}
