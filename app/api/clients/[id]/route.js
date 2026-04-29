import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Interaction } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id, {
    include: [{ model: Interaction, as: "interactions", order: [["date", "DESC"]] }],
  });

  if (!client) return notFound("Cliente no encontrado");
  return ok(client);
});

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const customFields = {
    ...client.customFields,
    company: body.company?.trim() ?? client.customFields?.company ?? null,
    country: body.country?.trim() ?? client.customFields?.country ?? null,
    city: body.city?.trim() ?? client.customFields?.city ?? null,
    topic: body.topic?.trim() ?? client.customFields?.topic ?? null,
    interestedProduct: body.interestedProduct?.trim() ?? client.customFields?.interestedProduct ?? null,
    origin: body.origin ?? client.customFields?.origin ?? "manual",
    leadId: body.leadId ?? client.customFields?.leadId ?? null,
    seStatus: body.status ?? client.customFields?.seStatus ?? "new",
  };

  // Datos fiscales (solo si vienen explícitos en el body)
  const fiscalUpdates = {};
  for (const k of ["fiscalName", "fiscalAddress", "fiscalCity", "fiscalZip", "fiscalCountry", "taxId"]) {
    if (k in body) {
      const v = body[k];
      fiscalUpdates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }

  await client.update({
    name: body.name?.trim() || client.name,
    email: body.email?.trim().toLowerCase() || client.email,
    phone: body.phone?.trim() || client.phone,
    notes: "notes" in body ? (body.notes?.trim() || null) : client.notes,
    customFields,
    ...fiscalUpdates,
  });

  return ok(client);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Invoice } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  // No permitir borrar si tiene facturas (preservar histórico fiscal)
  if (Invoice) {
    const invoiceCount = await Invoice.count({ where: { clientId: id } });
    if (invoiceCount > 0) {
      return error(`No se puede borrar: el cliente tiene ${invoiceCount} factura(s). Márcalo como inactivo en su lugar.`, 409);
    }
  }

  await client.destroy();
  return noContent();
});
