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

  await client.update({
    name: body.name?.trim() || client.name,
    email: body.email?.trim().toLowerCase() || client.email,
    phone: body.phone?.trim() || client.phone,
    notes: "notes" in body ? (body.notes?.trim() || null) : client.notes,
    customFields,
  });

  return ok(client);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  await client.destroy();
  return noContent();
});
