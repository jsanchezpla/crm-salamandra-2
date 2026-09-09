import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { cuotasConPacientes } from "../../../../../../lib/billing/cuotasConPacientes.js";
import { cuotaLlevaTipo, filaDeCuota, ordenarFilas, contarPacientes } from "../../../../../../lib/billing/tiposDeCuota.js";
import { hoyVigente, cobroSePuedeRehacer } from "../../../../../../lib/billing/cuotas.js";
import { cursoVigente, mesesDelCurso, tramoDelCurso, rotuloCurso } from "../../../../../../lib/billing/cursoEscolar.js";

/**
 * GET /api/billing/cuotas/tipos/[id]?curso=2026 — la ficha de UN tipo de cuota
 * (09/09/2026, petición de Aumenta).
 *
 * Trae de una vez lo que necesitan sus tres pestañas, porque son tres vistas de
 * las mismas filas y pedirlas por separado acabaría enseñando números distintos
 * en cada una:
 *
 *   · PACIENTES — quién lleva esta cuota (y quién la llevaba: las bajas van con
 *     su fecha, no se esconden).
 *   · FICHA — el paciente a nivel facturación: su cuota, su precio y el texto
 *     con el que sale en la factura.
 *   · MESES — el cobro de cada mes del curso escolar (sep-jun) y LA FACTURA en
 *     la que acabó, que es lo que pidieron: «todo esto a su vez tiene que
 *     relacionarse con la factura que corresponda a cada paciente».
 *
 * El curso, no el año natural: la cuota de un centro va de septiembre a junio y
 * una rejilla de enero a diciembre la parte por la mitad (`lib/billing/
 * cursoEscolar.js`).
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept, Payment, Invoice } = tenantModels;
    const { id } = await params;

    const concepto = await BillingConcept.findByPk(id);
    if (!concepto) return notFound("Esa cuota no está en el catálogo");

    const { searchParams } = new URL(request.url);
    const pedido = searchParams.get("curso");
    const curso = pedido === null || pedido === "" ? cursoVigente() : Number(pedido);
    if (!Number.isInteger(curso) || curso < 2000 || curso > 2100) {
      return error("El curso tiene que ser el año en que empieza (2026 = curso 2026/27)", 422);
    }
    const meses = mesesDelCurso(curso);
    const tramo = tramoDelCurso(curso);

    /*
     * Las cuotas que llevan este tipo se filtran EN MEMORIA y no en SQL: los
     * conceptos viven en una columna JSONB y un `@>` aquí ataría la pantalla a
     * Postgres por ahorrar una décima. Aumenta tiene 278 cuotas en total.
     */
    const todas = await cuotasConPacientes({ tenantModels, hasModule, where: {} });
    const cuotas = todas.filter((c) => cuotaLlevaTipo(c, id));

    // El catálogo entero: una cuota puede llevar más conceptos y la ficha tiene
    // que poder nombrarlos («va con Psicología 60x1»).
    const catalogo = await BillingConcept.findAll({ attributes: ["id", "name", "description", "unitPrice", "vatRate"] });
    const porId = new Map(catalogo.map((c) => [String(c.id), c.toJSON()]));

    const hoy = hoyVigente();
    const filas = ordenarFilas(cuotas.map((c) => filaDeCuota(c, { conceptosPorId: porId, hoy })));

    /*
     * Los cobros del curso, en UNA consulta para todas las cuotas de la
     * pantalla. Con su factura: de eso trata la tercera pestaña.
     */
    const cobrosPorCuota = new Map();
    if (filas.length) {
      const cobros = await Payment.findAll({
        where: {
          cuotaId: { [Op.in]: filas.map((f) => f.cuotaId) },
          periodMonth: { [Op.between]: [tramo.desde, tramo.hasta] },
        },
        attributes: ["id", "cuotaId", "periodMonth", "amount", "status", "method", "paidAt", "invoiceId", "notes", "invoiceText", "stripePaymentIntentId", "bankTransactionId", "paymentSessionId"],
        include: Invoice
          ? [{ model: Invoice, as: "invoice", attributes: ["id", "number", "status"], required: false }]
          : [],
      });
      for (const p of cobros) {
        const fila = p.toJSON();
        const clave = String(fila.cuotaId);
        const rehacer = cobroSePuedeRehacer(fila);
        if (!cobrosPorCuota.has(clave)) cobrosPorCuota.set(clave, {});
        cobrosPorCuota.get(clave)[String(fila.periodMonth).slice(0, 7)] = {
          id: fila.id,
          importe: Number(fila.amount) || 0,
          estado: fila.status,
          method: fila.method,
          paidAt: fila.paidAt,
          notes: fila.notes ?? null,
          invoiceText: fila.invoiceText ?? null,
          facturaId: fila.invoice?.id ?? fila.invoiceId ?? null,
          facturaNumero: fila.invoice?.number ?? null,
          facturaEstado: fila.invoice?.status ?? null,
          // Si ya es dinero o papel, la rejilla no deja tocarlo por detrás: el
          // mismo freno que usa la generación mensual (`cobroSePuedeRehacer`).
          sePuedeRehacer: rehacer.ok,
          motivoIntocable: rehacer.motivo ?? null,
        };
      }
    }

    const conMeses = filas.map((f) => ({ ...f, meses: cobrosPorCuota.get(f.cuotaId) ?? {} }));
    // Las vivas por su id, NO por posición: `ordenarFilas` ya movió las filas
    // de sitio y cruzarlas por índice contaría a otros pacientes.
    const idsVivas = new Set(conMeses.filter((f) => !f.deBaja).map((f) => f.cuotaId));
    const vivas = cuotas.filter((c) => idsVivas.has(String(c.id)));

    // Lo que suma el curso entero, por si alguien pregunta cuánto vale esta
    // cuota al año: solo cuenta lo que de verdad hay apuntado, mes a mes.
    let cobrado = 0;
    let pendiente = 0;
    for (const fila of conMeses) {
      for (const mes of meses) {
        const c = fila.meses[mes];
        if (!c) continue;
        if (c.estado === "completed") cobrado += c.importe;
        else if (c.estado === "pending") pendiente += c.importe;
      }
    }

    return ok({
      tipo: {
        ...concepto.toJSON(),
        // El «Texto en la factura» resuelto, que es lo que ve la familia.
        textoFactura: concepto.description || concepto.name,
      },
      curso,
      cursoRotulo: rotuloCurso(curso),
      meses,
      filas: conMeses,
      totales: {
        cuotas: conMeses.filter((f) => !f.deBaja).length,
        bajas: conMeses.filter((f) => f.deBaja).length,
        ...contarPacientes(vivas),
        alMes: Math.round(conMeses.filter((f) => !f.deBaja).reduce((s, f) => s + (f.conceptos.length === 1 ? f.importe : 0), 0) * 100) / 100,
        cobrado: Math.round(cobrado * 100) / 100,
        pendiente: Math.round(pendiente * 100) / 100,
      },
      hoy,
    });
  } catch (err) {
    return serverError(err);
  }
});
