import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/usuarios/register/empresa
// Llamado por WordPress al registrar un trabajador de empresa.
// Sin JWT — el tenant se identifica por header x-tenant.
export async function POST(request) {
  try {
    const ctx = await getTenantContext(request);
    const { TrainingUser, Company, Course, CompanyCourse } = ctx.tenantModels;

    const body = await request.json();
    const rawEmail = body.email || body.email_1;
    const rawUsername = body.username || body.text_1;

    if (!rawEmail) {
      return NextResponse.json(
        { ok: false, error: "El email es obligatorio." },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const email = String(rawEmail).trim().toLowerCase();

    const user = await TrainingUser.findOne({
      where: { email, type: "company" },
      include: [
        {
          model: Company,
          as: "company",
          include: [{ model: Course, as: "courses", through: { attributes: [] } }],
        },
      ],
    });

    if (!user) {
      return NextResponse.json(
        { exists: false, message: "No autorizado para registrarte." },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    if (user.active) {
      return NextResponse.json(
        { exists: true, already_active: true, message: "Usuario ya activo." },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    await user.update({ active: true });

    const courses = user.company?.courses ?? [];
    const productIds = courses.filter((c) => c.wcProductId != null).map((c) => c.wcProductId);

    return NextResponse.json(
      {
        exists: true,
        normalized: {
          email: user.email,
          username: rawUsername ? String(rawUsername).trim() : user.username,
        },
        name: user.name,
        product_ids: productIds,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    const response = handleRouteError(err);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }
}
