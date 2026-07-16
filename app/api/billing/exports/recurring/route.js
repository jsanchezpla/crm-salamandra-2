import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { parseSortOrder } from "@/lib/billing/parseSort.js";
import { xlsxResponse, fmtDateEs } from "@/lib/billing/exportXlsx.js";

const FREQ = { weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };

/** GET /api/billing/exports/recurring — Facturas recurrentes (plantillas) a XLSX. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { RecurringInvoice, Client } = tenantModels;
    const { searchParams } = new URL(request.url);
    const active = searchParams.get("active");
    const clientId = searchParams.get("clientId");

    const where = {};
    if (active !== null) where.active = active !== "false";
    if (clientId) where.clientId = clientId;

    const SORT = { nextRunAt: "nextRunAt", frequency: "frequency", active: "active", "client.name": [{ model: Client, as: "client" }, "name"] };
    const rows = await RecurringInvoice.findAll({
      where,
      include: [{ model: Client, as: "client", attributes: ["id", "name"] }],
      order: parseSortOrder(searchParams.get("sortBy"), searchParams.get("sortDir"), SORT, [["nextRunAt", "ASC"]]),
    });

    const columns = [
      { header: "Cliente", key: "clientName", width: 32 },
      { header: "Frecuencia", key: "frequency", width: 14 },
      { header: "Próxima emisión", key: "nextRunAt", width: 16 },
      { header: "Estado", key: "estado", width: 12 },
    ];
    const data = rows.map((r) => ({
      clientName: r.client?.name ?? "—",
      frequency: FREQ[r.frequency] ?? r.frequency,
      nextRunAt: fmtDateEs(r.nextRunAt),
      estado: r.active ? "Activa" : "Pausada",
    }));

    return await xlsxResponse({
      filename: `recurrentes-${tenant.slug}.xlsx`,
      columns,
      rows: data,
      filters: [{ label: "Generado", value: new Date().toLocaleString("es-ES") }],
    });
  } catch (err) {
    return serverError(err);
  }
});
