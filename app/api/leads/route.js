import { NextResponse } from "next/server";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../lib/utils/errors.js";
import { handleRouteError } from "../../../lib/utils/errors.js";
import { getTenantContext } from "../../../lib/tenant/tenantResolver.js";
import { Op } from "sequelize";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) return forbidden();

  const { Lead } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const stage = searchParams.get("stage");
  const search = searchParams.get("search");
  const empresa = searchParams.get("empresa");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const motivo = searchParams.get("motivo");
  const promo = searchParams.get("promo");

  if (stage) where.stage = stage;
  if (motivo) where.motivo = motivo;
  if (promo) where.metadata = { [Op.contains]: { promo } };
  if (empresa) where.customFields = { [Op.contains]: { empresa } };
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

export async function POST(request) {
  try {
    const ctx = await getTenantContext(request);
    const { Lead } = ctx.tenantModels;

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
      message,
      source,
      promo,
      metadata,
    } = body;

    if (!name && !title) {
      return NextResponse.json(
        { ok: false, error: "Se requiere nombre o título del lead" },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const resolvedMetadata = metadata ?? {};
    if (promo) resolvedMetadata.promo = promo;

    const VALID_TIPO_USUARIO = ["ciudadano", "profesional"];
    const VALID_MOTIVO = ["diagnostico", "servicios", "cursos", "talleres"];

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
      tipo_usuario: VALID_TIPO_USUARIO.includes(tipo_usuario) ? tipo_usuario : null,
      motivo: VALID_MOTIVO.includes(motivo) ? motivo : null,
      servicio: servicio?.trim() ?? null,
      curso: curso?.trim() ?? null,
      taller: taller?.trim() ?? null,
      mensaje: mensaje?.trim() ?? message?.trim() ?? null,
      source: source?.trim() ?? null,
      metadata: resolvedMetadata,
    });

    return NextResponse.json({ ok: true, data: lead }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    const response = handleRouteError(err);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }
}
