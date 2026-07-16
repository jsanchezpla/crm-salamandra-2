import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { parseSortOrder } from "@/lib/billing/parseSort.js";
import { xlsxResponse, MONEY_FMT, fmtDateEs } from "@/lib/billing/exportXlsx.js";

const STATUS = {
  draft: "Borrador", sent: "Enviado", viewed: "Visto", accepted: "Aceptado",
  rejected: "Rechazado", expired: "Caducado", converted: "Facturado",
};

/** GET /api/billing/exports/quotes — Presupuestos a XLSX (respeta status y búsqueda q). */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Quote, Client, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    const q = (searchParams.get("q") || "").trim();

    const where = {};
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (q) {
      where[Op.and] = [{ [Op.or]: [{ number: { [Op.iLike]: `%${q}%` } }, { "$client.name$": { [Op.iLike]: `%${q}%` } }] }];
    }

    const SORT = {
      number: "number", issueDate: "issueDate", validUntil: "validUntil", status: "status", total: "total",
      "client.name": [{ model: Client, as: "client" }, "name"],
    };
    const rows = await Quote.findAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId"] },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
      ],
      order: parseSortOrder(searchParams.get("sortBy"), searchParams.get("sortDir"), SORT, [["issueDate", "DESC"], ["number", "DESC"]]),
    });

    const columns = [
      { header: "Nº", key: "number", width: 16 },
      { header: "Cliente", key: "clientName", width: 32 },
      { header: "Estado", key: "statusLabel", width: 14 },
      { header: "Importe", key: "total", width: 14, numFmt: MONEY_FMT },
      { header: "Validez", key: "validUntil", width: 14 },
    ];
    const data = rows.map((r) => ({
      number: r.number,
      clientName: r.client?.name ?? "",
      statusLabel: STATUS[r.status] ?? r.status,
      total: Number(r.total || 0),
      validUntil: fmtDateEs(r.validUntil),
    }));

    return await xlsxResponse({
      filename: `presupuestos-${tenant.slug}.xlsx`,
      columns,
      rows: data,
      filters: [
        { label: "Estado", value: status ? STATUS[status] ?? status : "Todos" },
        { label: "Búsqueda", value: q || "—" },
        { label: "Generado", value: new Date().toLocaleString("es-ES") },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
