import { Readable } from "node:stream";
import { Op } from "sequelize";
import archiver from "archiver";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/lib/billing/invoicePdf.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/billing/invoices/bulk-pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Descarga un ZIP con los PDFs de todas las facturas emitidas (no borrador) cuya
 * fecha de emisión cae en el rango. El ZIP se transmite en streaming: cada PDF se
 * genera y se añade sobre la marcha, sin acumular todos en memoria.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
      return error("Parámetros from y to obligatorios en formato YYYY-MM-DD");
    }

    const { Invoice, Client, TenantBillingSettings } = tenantModels;
    const settings = (await TenantBillingSettings.findOne()) || {};
    const partners = Array.isArray(settings.partners) ? settings.partners : [];

    const invoices = await Invoice.findAll({
      where: {
        status: { [Op.ne]: "draft" },
        issueDate: { [Op.between]: [from, to] },
      },
      include: [{ model: Client, as: "client" }],
      order: [["issueDate", "ASC"], ["number", "ASC"]],
    });

    if (invoices.length === 0) {
      return error("No hay facturas emitidas en ese rango de fechas", 404);
    }

    const archive = archiver("zip", { zlib: { level: 9 } });

    // Genera y añade los PDFs en segundo plano; el ZIP se va emitiendo a la vez.
    (async () => {
      for (const inv of invoices) {
        try {
          const partnerName = inv.partnerId
            ? partners.find((p) => p.id === inv.partnerId)?.name || null
            : null;
          const buf = await buildInvoicePdfBuffer({
            invoice: inv,
            client: inv.client,
            settings,
            partnerName,
          });
          archive.append(buf, { name: invoicePdfFilename(inv) });
        } catch {
          // Una factura problemática no debe abortar todo el ZIP: se omite.
        }
      }
      archive.finalize();
    })();

    const filename = `facturas-${from}-${to}.zip`;
    return new Response(Readable.toWeb(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
