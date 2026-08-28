import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../lib/billing/audit.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../lib/billing/calculateInvoice.js";
import { assignQuoteNumber } from "../../../../lib/billing/generateQuoteNumber.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";

import { ATRIBUTOS_CLIENTE_FACTURA } from "../../../../lib/billing/nifCliente.js";
// GET /api/billing/quotes — listado paginado con filtros
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Quote, Client, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("projectId")) where.projectId = searchParams.get("projectId");

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
      const porNombre = await filtroPorNombre(Quote.sequelize, q, ["Quote.number", "client.name"]);
      if (porNombre) (where[Op.and] ||= []).push(porNombre);
    }

    const allowedSort = {
      number: "number",
      issueDate: "issueDate",
      validUntil: "validUntil",
      status: "status",
      total: "total",
      "client.name": [{ model: Client, as: "client" }, "name"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["issueDate", "DESC"], ["number", "DESC"]]
    );

    const { count, rows } = await Quote.findAndCountAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ATRIBUTOS_CLIENTE_FACTURA },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
      ],
      order,
      limit,
      offset,
    });

    return ok({ quotes: rows, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/quotes — crear presupuesto (borrador, numerado al crear)
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Quote, TenantBillingSettings } = tenantModels;
    const body = await request.json();

    const {
      clientId,
      projectId,
      employeeId,
      issueDate,
      validUntil,
      lines = [],
      notes,
      customFields,
    } = body;

    if (!clientId) return error("clientId es obligatorio");
    const issue = issueDate || new Date().toISOString().slice(0, 10);

    const settings = await TenantBillingSettings.findOne();
    const defaultVat = settings ? Number(settings.defaultVatRate) : 21;
    const linesWithVat = (Array.isArray(lines) ? lines : []).map((l) => ({
      ...l,
      vatRate: l.vatRate != null ? Number(l.vatRate) : defaultVat,
    }));

    // Validez por defecto: 30 días desde la emisión
    let resolvedValid = validUntil || null;
    if (!resolvedValid) {
      const d = new Date(issue);
      d.setDate(d.getDate() + 30);
      resolvedValid = d.toISOString().slice(0, 10);
    }

    const calc = calculateInvoice({ lines: linesWithVat });

    // Numeración con reintento ante colisión (unicidad garantizada en BD)
    let quote = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const number = await assignQuoteNumber({ models: tenantModels, date: issue });
      try {
        quote = await Quote.create({
          clientId,
          projectId: projectId || null,
          employeeId: employeeId || null,
          series: "P",
          number,
          status: "draft",
          issueDate: issue,
          validUntil: resolvedValid,
          lines: calc.lines,
          taxBase: calc.taxBase,
          vatAmount: calc.vatAmount,
          total: calc.total,
          notes: notes || null,
          customFields: customFields || {},
        });
        break;
      } catch (e) {
        if (e?.name === "SequelizeUniqueConstraintError" && attempt < 3) continue;
        throw e;
      }
    }

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "quote.created",
      entity: "Quote",
      entityId: quote.id,
      before: null,
      after: { numero: quote.number ?? null, estado: quote.status ?? null, total: quote.total != null ? String(quote.total) : null },
    });
    return created(quote);
  } catch (err) {
    return serverError(err);
  }
});
