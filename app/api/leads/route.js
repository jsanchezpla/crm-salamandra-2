import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden } from "../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../lib/utils/errors.js";
import { Op } from "sequelize";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) return forbidden();

  const { Lead } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const stage = searchParams.get("stage");
  const search = searchParams.get("search");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const motivo = searchParams.get("motivo");
  if (stage) where.stage = stage;
  if (motivo) where.motivo = motivo;
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
      { title: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Lead.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return ok({ leads: rows, total: count });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) return forbidden();

  const { Lead } = tenantModels;
  const body = await request.json();

  const {
    name,
    phone,
    email,
    title,
    stage,
    probability,
    value,
    expectedCloseDate,
    assignedTo,
    notes,
    customFields,
    tipo_usuario,
    motivo,
    servicio,
    curso,
    taller,
    mensaje,
  } = body;

  if (!name && !title) throw new ValidationError("Se requiere nombre o título del lead");

  const lead = await Lead.create({
    name: name?.trim() ?? null,
    phone: phone?.trim() ?? null,
    email: email?.trim().toLowerCase() ?? null,
    title: title?.trim() ?? name?.trim() ?? null,
    stage: stage ?? "new",
    probability: probability ?? null,
    value: value ?? null,
    expectedCloseDate: expectedCloseDate ?? null,
    assignedTo: assignedTo ?? null,
    notes: notes ?? null,
    customFields: customFields ?? {},
    tipo_usuario: tipo_usuario ?? null,
    motivo: motivo ?? null,
    servicio: servicio?.trim() ?? null,
    curso: curso?.trim() ?? null,
    taller: taller?.trim() ?? null,
    mensaje: mensaje?.trim() ?? null,
  });

  return created(lead);
});
