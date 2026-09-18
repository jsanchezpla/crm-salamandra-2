import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { parseSortOrder } from "@/lib/billing/parseSort.js";
import { xlsxResponse, baseUrlFrom, MONEY_FMT, fmtDateEs } from "@/lib/billing/exportXlsx.js";
import { whereDeBusquedaCobros, palabrasDeBusqueda, familiasConPacienteQueCasa } from "@/lib/billing/busquedaCobros.js";
import { billingHasPatients } from "@/lib/billing/patientLink.js";
import { formaDeCobro, FORMAS_DE_COBRO } from "@/lib/billing/formaDeCobro.js";

const STATUS = { completed: "Completado", pending: "Pendiente", failed: "Fallido", refunded: "Reembolsado" };

/**
 * GET /api/billing/exports/payments — Cobros a XLSX.
 *
 * ── DE QUÉ FALLO REAL NACE LO DE ABAJO (18/09/2026, AV de Aumenta) ──────────
 * «revisar el excel de cobros, no tienen en cuenta los cobros filtrados y crea
 * todos y sin nombre». Las dos cosas eran ciertas:
 *
 *  1. **Sin nombre.** El Excel llevaba Factura · Método · Fecha · Estado ·
 *     Importe y de QUIÉN era el cobro, nada. En la pantalla la primera columna
 *     es «Paciente / cliente»; aquí no había ninguna. Y no es un detalle: en
 *     producción 216 de los 352 cobros de Aumenta no tienen factura (se cobra
 *     primero y se factura después), así que en esas filas la columna Factura
 *     dice «—» y la hoja entera no identificaba a nadie.
 *
 *  2. **Ignora el filtro.** Este endpoint aceptaba `from/to/status/method/
 *     invoiceId` pero NO `q`, la búsqueda por texto que la pantalla manda al
 *     servidor desde el 31/08/2026. Con «garcía» escrito en el buscador la
 *     tabla enseñaba sus cobros y el Excel se bajaba los 352: de ahí el «crea
 *     todos». Los otros cuatro filtros sí viajaban y sí se respetaban.
 *
 * La búsqueda usa exactamente las mismas reglas que el listado
 * (`lib/billing/busquedaCobros.js`): mismas palabras, mismos campos, mismas
 * familias por paciente. Si divergieran, el Excel volvería a decir otra cosa
 * que la pantalla.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice, Client, Patient } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");
    const method = searchParams.get("method");
    const invoiceId = searchParams.get("invoiceId");
    const q = searchParams.get("q");

    const where = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (status) where.status = status;
    if (method) where.method = method;
    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt[Op.gte] = `${from} 00:00:00`;
      if (to) where.paidAt[Op.lte] = `${to} 23:59:59`;
    }

    // El paciente solo donde hay tabla de pacientes (Aumenta), igual que en el
    // listado: en el resto de tenants ni existe la columna ni hace falta.
    const conPaciente = Boolean(Patient) && billingHasPatients(hasModule);
    const familiasPorPalabra = conPaciente
      ? await familiasConPacienteQueCasa(Patient, palabrasDeBusqueda(q))
      : null;
    const busqueda = whereDeBusquedaCobros(q, { conPaciente, familiasPorPalabra });
    if (busqueda) Object.assign(where, busqueda);

    // El cliente llega por los DOS caminos —enlace directo del cobro y el de su
    // factura—, como en el listado: un cobro sin factura solo tiene el directo.
    const include = [
      {
        model: Invoice,
        as: "invoice",
        attributes: ["id", "number", "total", "status", "clientId", "issueDate"],
        ...(Client ? { include: [{ model: Client, as: "client", attributes: ["id", "name"] }] } : {}),
      },
    ];
    if (Client) include.push({ model: Client, as: "client", attributes: ["id", "name"] });
    if (conPaciente) {
      include.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false });
    }

    const SORT = { paidAt: "paidAt", amount: "amount", method: "method", status: "status", "invoice.number": [{ model: Invoice, as: "invoice" }, "number"] };
    const rows = await Payment.findAll({
      where,
      include,
      order: parseSortOrder(searchParams.get("sortBy"), searchParams.get("sortDir"), SORT, [["paidAt", "DESC"]]),
      // Las columnas `$client.name$` de la búsqueda viven en el JOIN; sin esto
      // el subquery de Sequelize no las ve. Solo belongsTo: no duplica filas.
      ...(busqueda ? { subQuery: false } : {}),
    });

    const base = baseUrlFrom(request);
    const columns = [
      ...(conPaciente ? [{ header: "Paciente", key: "paciente", width: 26 }] : []),
      { header: "Cliente", key: "cliente", width: 30 },
      { header: "Factura", key: "factura", width: 18, link: true },
      { header: "Método", key: "metodo", width: 16 },
      { header: "Fecha", key: "fecha", width: 14 },
      { header: "Estado", key: "estado", width: 14 },
      { header: "Importe", key: "amount", width: 14, numFmt: MONEY_FMT },
    ];
    const data = rows.map((p) => {
      const inv = p.invoice;
      const factura =
        inv && inv.id && inv.status !== "draft"
          ? { text: inv.number || "(sin nº)", hyperlink: `${base}/api/billing/invoices/${inv.id}/pdf` }
          : inv?.number || "—";
      const cliente = p.client ?? inv?.client ?? null;
      const paciente = p.patient
        ? [p.patient.firstName, p.patient.lastName].filter(Boolean).join(" ")
        : "";
      return {
        ...(conPaciente ? { paciente: paciente || "—" } : {}),
        cliente: cliente?.name || "—",
        factura,
        // Un cobro pendiente no dice por dónde entró el dinero, aquí tampoco:
        // la misma regla que la pantalla (18/09/2026, AV-0188).
        metodo: formaDeCobro(p),
        fecha: fmtDateEs(p.paidAt),
        estado: STATUS[p.status] ?? p.status,
        amount: Number(p.amount || 0),
      };
    });

    return await xlsxResponse({
      filename: `cobros-${tenant.slug}.xlsx`,
      columns,
      rows: data,
      filters: [
        { label: "Búsqueda", value: q?.trim() || "—" },
        { label: "Desde", value: from || "—" },
        { label: "Hasta", value: to || "—" },
        { label: "Estado", value: status ? STATUS[status] ?? status : "Todos" },
        { label: "Método", value: method ? FORMAS_DE_COBRO[method] ?? method : "Todos" },
        { label: "Generado", value: new Date().toLocaleString("es-ES") },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
