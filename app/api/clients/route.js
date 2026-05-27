import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const country = searchParams.get("country");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const where = {};

  if (status) where.customFields = { [Op.contains]: { seStatus: status } };
  if (country && !status) where.customFields = { [Op.contains]: { country } };
  if (country && status) where.customFields = { [Op.contains]: { seStatus: status, country } };

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Client.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return ok({ clients: rows, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const body = await request.json();

  const { name, email, phone, notes } = body;
  if (!name?.trim()) return error("El nombre es obligatorio", 422);

  const customFields = {
    company: body.company?.trim() || null,
    country: body.country?.trim() || null,
    city: body.city?.trim() || null,
    topic: body.topic?.trim() || null,
    interestedProduct: body.interestedProduct?.trim() || null,
    origin: body.origin || "manual",
    leadId: body.leadId || null,
    seStatus: body.status || "new",
  };

  try {
    const client = await Client.create({
      name: name.trim(),
      email: email?.trim().toLowerCase() || null,
      phone: phone?.trim() || null,
      notes: notes?.trim() || null,
      customFields,
    });
    return created(client);
  } catch (err) {
    if (err?.name === "SequelizeValidationError" || err?.name === "SequelizeUniqueConstraintError") {
      const msg = err.errors?.[0]?.message || err.message;
      return error(`Datos inválidos: ${msg}`, 422);
    }
    throw err;
  }
});
