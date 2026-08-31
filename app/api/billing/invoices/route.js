import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenFactura, datosPeticion } from "../../../../lib/billing/audit.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../lib/billing/calculateInvoice.js";
import { ivaPorDefecto } from "../../../../lib/billing/ivaPorDefecto.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";
import { withEffectiveStatusList } from "../../../../lib/billing/invoiceStatus.js";
import { resolveInvoicePatientId, invoicePatientInclude } from "../../../../lib/billing/patientLink.js";

import { ATRIBUTOS_CLIENTE_FACTURA } from "../../../../lib/billing/nifCliente.js";
// GET /api/billing/invoices — listado paginado con filtros
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Client, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("patientId")) where.patientId = searchParams.get("patientId");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("series")) where.series = searchParams.get("series");
    if (searchParams.get("from") || searchParams.get("to")) {
      where.issueDate = {};
      if (searchParams.get("from")) where.issueDate[Op.gte] = searchParams.get("from");
      if (searchParams.get("to")) where.issueDate[Op.lte] = searchParams.get("to");
    }
    const q = (searchParams.get("q") || "").trim();
    /*
     * Todas las palabras, cada una en cualquiera de los campos (28/08/2026):
     * antes «castro hugo» no encontraba la factura de «Hugo Castro Díaz», ni
     * «diaz» sin tilde. Ver `lib/utils/busqueda.js`.
     *
     * El cliente va con el alias de la ASOCIACIÓN en minúscula (`client`), que
     * es lo mismo a lo que apuntaba `"$client.name$"`. El número de factura,
     * con el del modelo.
     */
    if (q) {
      const porNombre = await filtroPorNombre(Invoice.sequelize, q, ["Invoice.number", "client.name"]);
      if (porNombre) (where[Op.and] ||= []).push(porNombre);
    }

    const allowedSort = {
      number: "number",
      issueDate: "issueDate",
      status: "status",
      taxBase: "taxBase",
      total: "total",
      paidAmount: "paidAmount",
      "client.name": [{ model: Client, as: "client" }, "name"],
      "employee.displayName": [{ model: TeamMember, as: "employee" }, "displayName"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["issueDate", "DESC"], ["number", "DESC"]]
    );

    const { count, rows } = await Invoice.findAndCountAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ATRIBUTOS_CLIENTE_FACTURA },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        ...invoicePatientInclude(tenantModels, hasModule),
      ],
      order,
      limit,
      offset,
    });

    return ok({ invoices: withEffectiveStatusList(rows), total: count, page, limit, pages: Math.ceil(count / limit) });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/invoices — crear borrador (sin asignar número)
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, TenantBillingSettings } = tenantModels;
    const body = await request.json();

    const {
      clientId,
      patientId,
      employeeId,
      partnerId,
      eventTypeId,
      issueDate,
      dueDate,
      lines = [],
      series = "F",
      irpfRate,
      notes,
      customFields,
    } = body;

    if (!clientId) return error("clientId es obligatorio");
    if (!issueDate) return error("issueDate es obligatorio");
    if (!Array.isArray(lines) || lines.length === 0) {
      return error("Se requiere al menos una línea");
    }

    // Enlace opcional factura↔paciente (el pagador sigue siendo clientId).
    const patRes = await resolveInvoicePatientId(patientId, tenantModels, hasModule);
    if (patRes.err) return error(patRes.err);

    // Enlace opcional factura↔tipo de cita (29/08/2026, interno): de aquí
    // salen los «Ingresos por servicio» de la portada. Sin él, la factura
    // simplemente no cuenta en esa gráfica.
    let resolvedEventTypeId = null;
    if (eventTypeId) {
      const { EventType } = tenantModels;
      const et = EventType ? await EventType.findByPk(eventTypeId, { attributes: ["id"] }).catch(() => null) : null;
      if (!et) return error("eventTypeId no corresponde a ningún tipo de cita de este centro");
      resolvedEventTypeId = et.id;
    }

    // Aplicar defaults del tenant: vatRate por línea, IRPF y dueDate desde
    // defaultPaymentTermsDays si no llegan explícitos.
    const settings = await TenantBillingSettings.findOne();
    // Exención general de IVA: si el emisor no repercute IVA, las líneas sin tipo
    // explícito nacen a 0 y se congela la nota legal en la factura.
    const vatExempt = !!(settings && settings.vatExempt);
    const defaultVat = ivaPorDefecto(settings);
    const defaultIrpf = settings ? Number(settings.defaultIrpfRate ?? 0) : 0;
    const termsDays = settings ? Number(settings.defaultPaymentTermsDays ?? 30) : 30;
    const linesWithVat = lines.map((l) => ({
      ...l,
      vatRate: l.vatRate != null ? Number(l.vatRate) : defaultVat,
    }));
    const resolvedIrpf = irpfRate != null ? Number(irpfRate) : defaultIrpf;

    let resolvedDueDate = dueDate || null;
    if (!resolvedDueDate && Number.isFinite(termsDays) && termsDays > 0) {
      const due = new Date(issueDate);
      due.setDate(due.getDate() + termsDays);
      resolvedDueDate = due.toISOString().slice(0, 10);
    }

    const calc = calculateInvoice({ lines: linesWithVat, irpfRate: resolvedIrpf });

    // Borrador: sin número, sin serie congelada
    const invoice = await Invoice.create({
      clientId,
      patientId: patRes.patientId,
      employeeId: employeeId || null,
      partnerId: partnerId || null,
      eventTypeId: resolvedEventTypeId,
      issueDate,
      dueDate: resolvedDueDate,
      lines: calc.lines,
      taxBase: calc.taxBase,
      vatAmount: calc.vatAmount,
      irpfRate: calc.irpfRate,
      irpfAmount: calc.irpfAmount,
      total: calc.total,
      paidAmount: 0,
      series,
      number: `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "draft",
      notes: notes || null,
      customFields: {
        ...(customFields || {}),
        ...(vatExempt ? { vatExemptNote: settings.vatExemptNote || "Operación exenta de IVA conforme al artículo 20 de la Ley 37/1992 del IVA." } : {}),
      },
      // legacy campos quedan a 0/null
      subtotal: calc.taxBase,
      vatRate: 0,
    });

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "invoice.created",
      entity: "Invoice",
      entityId: invoice.id,
      before: null,
      after: resumenFactura(invoice),
    });
    return created(invoice);
  } catch (err) {
    return serverError(err);
  }
});
