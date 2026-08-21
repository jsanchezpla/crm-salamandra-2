import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { parseSortOrder } from "@/lib/billing/parseSort.js";
import { xlsxResponse, MONEY_FMT, fmtDateEs } from "@/lib/billing/exportXlsx.js";

const TYPE = { salary: "Salario", rent: "Alquiler", software: "Software", material: "Material", commission: "Comisión", tax: "Impuestos", other: "Otro" };
const CATEGORY = { fixed: "Fijo", variable: "Variable", capex: "CAPEX", opex: "OPEX" };

/** GET /api/billing/exports/expenses — Gastos/costes a XLSX. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Client, Supplier, TenantBillingSettings } = tenantModels;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const category = searchParams.get("category");
    const employeeId = searchParams.get("employeeId");
    const partnerId = searchParams.get("partnerId");
    const clientId = searchParams.get("clientId");
    const supplierId = searchParams.get("supplierId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where = {};
    if (type) where.type = type;
    if (category) where.category = category;
    if (employeeId) where.employeeId = employeeId;
    if (partnerId) where.partnerId = partnerId;
    if (clientId) where.clientId = clientId;
    if (supplierId) where.supplierId = supplierId;
    if (from || to) {
      where.incurredAt = {};
      if (from) where.incurredAt[Op.gte] = from;
      if (to) where.incurredAt[Op.lte] = to;
    }

    const SORT = {
      incurredAt: "incurredAt", type: "type", category: "category", description: "description",
      taxBase: "taxBase", taxAmount: "taxAmount", total: "total",
      "employee.displayName": [{ model: TeamMember, as: "employee" }, "displayName"],
      "client.name": [{ model: Client, as: "client" }, "name"],
      "supplier.name": [{ model: Supplier, as: "supplier" }, "name"],
    };
    const rows = await Cost.findAll({
      where,
      include: [
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Client, as: "client", attributes: ["id", "name"] },
        { model: Supplier, as: "supplier", attributes: ["id", "name"] },
      ],
      order: parseSortOrder(searchParams.get("sortBy"), searchParams.get("sortDir"), SORT, [["incurredAt", "DESC"], ["type", "ASC"]]),
    });

    const columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Tipo", key: "tipo", width: 12 },
      { header: "Categoría", key: "categoria", width: 12 },
      { header: "Descripción", key: "description", width: 40 },
      { header: "Empleado", key: "empleado", width: 22 },
      { header: "Proveedor", key: "proveedor", width: 24 },
      { header: "Base", key: "taxBase", width: 13, numFmt: MONEY_FMT },
      { header: "IVA", key: "taxAmount", width: 13, numFmt: MONEY_FMT },
      { header: "Total", key: "total", width: 13, numFmt: MONEY_FMT },
    ];
    const data = rows.map((c) => ({
      fecha: fmtDateEs(c.incurredAt),
      tipo: TYPE[c.type] ?? c.type,
      categoria: CATEGORY[c.category] ?? c.category,
      description: c.description ?? "",
      empleado: c.employee?.displayName ?? "—",
      // Un gasto guarda a quién se le pagó incluso si ese proveedor está de
      // baja: `Supplier` no se borra, se desactiva, y aquí sale igual.
      proveedor: c.supplier?.name ?? "—",
      taxBase: Number(c.taxBase || 0),
      taxAmount: Number(c.taxAmount || 0),
      total: Number(c.total || 0),
    }));

    // La hoja «Filtros aplicados» tiene que nombrar TODO lo que se aplicó. Un
    // Excel de gastos que se baja con menos filas y una cabecera que calla el
    // filtro miente por omisión, y es un documento de dinero que se le manda a
    // la gestoría. Enumeraba solo Desde/Hasta/Tipo/Categoría; desde el
    // 21/08/2026 el proveedor se elige con un clic en `/facturacion/costes`, y
    // los otros tres (empleado, cliente, socio) los acepta este endpoint aunque
    // hoy ninguna pantalla los mande.
    //
    // Los nombres se buscan SOLO si ese filtro vino, así que la exportación
    // normal no hace ni una consulta de más. Si el id ya no existe —borrado, o
    // de otro tenant— se enseña el id en vez de callarse: que la cabecera diga
    // «Todos» cuando se filtró por algo es justo el fallo que se está cerrando.
    async function nombreDe(modelo, id, campo) {
      if (!id) return null;
      const fila = await modelo.findByPk(id, { attributes: ["id", campo] });
      return fila?.[campo] || `(id ${id})`;
    }
    async function nombreDeSocio(id) {
      if (!id) return null;
      const ajustes = await TenantBillingSettings.findOne({ attributes: ["partners"] });
      const socio = (ajustes?.partners ?? []).find((p) => p?.id === id);
      return socio?.name || `(id ${id})`;
    }
    async function filtrosAplicados() {
      // Fecha, tipo, categoría y proveedor salen siempre, con o sin valor:
      // son los que la pantalla ofrece, y ver «Todos» es la confirmación de
      // que no se filtró. Los otros tres solo aparecen si se usaron.
      const opcionales = [
        ["Empleado", await nombreDe(TeamMember, employeeId, "displayName")],
        ["Cliente", await nombreDe(Client, clientId, "name")],
        ["Socio", await nombreDeSocio(partnerId)],
      ];
      return [
        { label: "Desde", value: from || "—" },
        { label: "Hasta", value: to || "—" },
        { label: "Tipo", value: type ? TYPE[type] ?? type : "Todos" },
        { label: "Categoría", value: category ? CATEGORY[category] ?? category : "Todas" },
        { label: "Proveedor", value: (await nombreDe(Supplier, supplierId, "name")) ?? "Todos" },
        ...opcionales.filter(([, valor]) => valor).map(([label, value]) => ({ label, value })),
        { label: "Generado", value: new Date().toLocaleString("es-ES") },
      ];
    }

    return await xlsxResponse({
      filename: `gastos-${tenant.slug}.xlsx`,
      columns,
      rows: data,
      filters: await filtrosAplicados(),
    });
  } catch (err) {
    return serverError(err);
  }
});
