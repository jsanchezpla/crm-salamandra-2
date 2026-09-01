import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../lib/billing/audit.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../lib/billing/updateInvoiceStatus.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";
import { getTenantStripeConfig } from "../../../../lib/payments/stripeConfig.js";
import { urlPanelStripe } from "../../../../lib/billing/cobroDesdeStripe.js";
import { whereDeBusquedaCobros } from "../../../../lib/billing/busquedaCobros.js";

export const GET = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("invoiceId")) where.invoiceId = searchParams.get("invoiceId");
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("method")) where.method = searchParams.get("method");
    // Búsqueda en el SERVIDOR (31/08/2026): el filtro del navegador solo veía
    // los 100 cargados. La regla, en lib/billing/busquedaCobros.js.
    const busqueda = whereDeBusquedaCobros(searchParams.get("q"));
    if (busqueda) Object.assign(where, busqueda);

    if (searchParams.get("from") || searchParams.get("to")) {
      where.paidAt = {};
      if (searchParams.get("from")) where.paidAt[Op.gte] = `${searchParams.get("from")} 00:00:00`;
      if (searchParams.get("to")) where.paidAt[Op.lte] = `${searchParams.get("to")} 23:59:59`;
    }

    const allowedSort = {
      paidAt: "paidAt",
      amount: "amount",
      method: "method",
      status: "status",
      "invoice.number": [{ model: Invoice, as: "invoice" }, "number"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["paidAt", "DESC"]]
    );

    // El cliente se trae por los DOS caminos: el enlace directo del cobro
    // (cobros registrados antes de existir la factura, sprint 2026-07-29) y el
    // de su factura. En el listado, Olga necesita ver de QUIÉN es cada cobro
    // sin abrir la factura una por una.
    const { Client } = tenantModels;
    const include = [
      {
        model: Invoice, as: "invoice",
        attributes: ["id", "number", "total", "status", "clientId", "issueDate"],
        ...(Client ? { include: [{ model: Client, as: "client", attributes: ["id", "name"] }] } : {}),
      },
    ];
    if (Client) include.push({ model: Client, as: "client", attributes: ["id", "name"] });

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include,
      order,
      limit, offset,
      // Con búsqueda, las columnas `$client.name$` viven en el JOIN: el
      // subquery de Sequelize no las ve. Solo belongsTo: el count no duplica.
      ...(busqueda ? { subQuery: false } : {}),
    });

    // `clientName`/`clientId` planos para que la tabla no tenga que saber por
    // cuál de los dos caminos llegó el dato.
    //
    // `stripeUrl` se calcula AQUÍ y no en la pantalla: prueba y producción
    // tienen paneles distintos y el modo se deduce de la clave del tenant, que
    // el navegador no ve (29/08/2026 — el botón «Ver en Stripe» de Cobros).
    const { liveMode } = getTenantStripeConfig({ tenant });
    const payments = rows.map((p) => {
      const fila = p.toJSON();
      const directo = fila.client ?? null;
      const porFactura = fila.invoice?.client ?? null;
      const cliente = directo ?? porFactura;
      return {
        ...fila,
        clientId: cliente?.id ?? fila.clientId ?? null,
        clientName: cliente?.name ?? null,
        stripeUrl: urlPanelStripe(liveMode, fila.stripePaymentIntentId),
      };
    });

    return ok({ payments, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Payment, Invoice, Client, BillingConcept } = tenantModels;
    const body = await request.json();
    const { invoiceId, clientId, periodMonth, amount, paidAt, method, notes, patientId, conceptId, conceptIds } = body;

    // COBRO SIN FACTURA (sprint Aumenta 2026-07, punto 8): en el centro se
    // cobra primero y se factura después, así que exigir factura obligaba a
    // inventarse una o a no registrar el dinero. Sin factura hace falta saber
    // de QUIÉN es el cobro.
    if (!invoiceId && !clientId) return error("Hace falta una factura o un cliente");
    if (!amount || Number(amount) <= 0) return error("amount debe ser mayor que 0");
    if (!method) return error("method es obligatorio");
    if (!paidAt) return error("paidAt es obligatorio");

    // Mes al que corresponde ('YYYY-MM' desde la UI → primer día del mes). Es
    // lo que abre los documentos de ese mes en el portal de la familia.
    let mes = null;
    if (periodMonth) {
      const m = String(periodMonth).slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return error("El mes debe ser 'AAAA-MM'");
      mes = `${m}-01`;
    }

    let invoice = null;
    if (invoiceId) {
      invoice = await Invoice.findByPk(invoiceId);
      if (!invoice) return notFound("Factura no encontrada");
      if (["draft", "cancelled", "rectified"].includes(invoice.status)) {
        return error(`No se puede registrar un cobro en una factura en estado '${invoice.status}'`, 409);
      }
      const remaining = Number(invoice.total) - Number(invoice.paidAmount);
      if (Number(amount) > remaining + 0.0049) {
        return error(`El importe (${Number(amount)}) excede el pendiente de la factura (${remaining.toFixed(2)})`, 400);
      }
    } else if (Client) {
      const cliente = await Client.findByPk(clientId, { attributes: ["id"] });
      if (!cliente) return notFound("Cliente no encontrado");
    }

    // De quién y de qué terapia es la cuota (31/08/2026): opcionales, y un id
    // que no existe se descarta en vez de romper el cobro — el dinero manda.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let conceptoValido = null;
    if (typeof conceptId === "string" && UUID_RE.test(conceptId) && BillingConcept) {
      const c = await BillingConcept.findByPk(conceptId, { attributes: ["id"] });
      if (c) conceptoValido = conceptId;
    }
    const pacienteValido = typeof patientId === "string" && UUID_RE.test(patientId) ? patientId : null;

    const payment = await Payment.create({
      invoiceId: invoiceId || null,
      // Con factura, el cliente se hereda de ella; sin factura viene en el body.
      clientId: invoice ? invoice.clientId : clientId,
      periodMonth: mes,
      amount: Number(amount),
      paidAt,
      method,
      status: "completed",
      notes: notes || null,
      patientId: pacienteValido,
      conceptId: conceptoValido,
    });

    if (invoice) await updateInvoiceStatus(invoice, Payment);

    // La ficha APRENDE su cuota (31/08/2026, Rodrigo): lo que se le acaba de
    // cobrar ES su cuota, y es lo que el drawer rellenará la próxima vez.
    // Solo en cobros de cuota (sin factura), solo ids que existen en el
    // catálogo, y conservando duplicados (dos hermanos, misma cuota).
    if (!invoiceId && payment.clientId && Client && BillingConcept && Array.isArray(conceptIds)) {
      const candidatos = conceptIds.filter((x) => typeof x === "string" && UUID_RE.test(x));
      if (candidatos.length) {
        const existen = await BillingConcept.findAll({
          where: { id: [...new Set(candidatos)] }, attributes: ["id"],
        });
        const reales = new Set(existen.map((c) => String(c.id)));
        const aprendida = candidatos.filter((x) => reales.has(String(x)));
        if (aprendida.length) {
          await Client.update({ cuotaConceptIds: aprendida }, { where: { id: payment.clientId } });
        }
      }
    }

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.created",
      entity: "Payment",
      entityId: payment.id,
      before: null,
      after: resumenImporte(payment),
    });
    return created(payment);
  } catch (err) {
    return serverError(err);
  }
});
