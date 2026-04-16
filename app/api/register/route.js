import { NextResponse } from "next/server";
import { getTenantContext } from "../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../lib/utils/errors.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

// Preflight CORS — llamado desde JavaScript en WordPress
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/register
// Recibe el formulario [registro_privado] de WordPress y crea el TrainingUser.
// Endpoint público — sin JWT. El campo "password" lo gestiona WordPress, aquí se ignora.
export async function POST(request) {
  try {
    const ctx = await getTenantContext(request);
    const { TrainingUser } = ctx.tenantModels;

    const body = await request.json();
    const { name_1, name_2, text_1, email_1, select_1, date_1 } = body;

    if (!email_1) {
      return NextResponse.json({ ok: false, error: "El email es obligatorio." }, { status: 422, headers: CORS_HEADERS });
    }

    const email = String(email_1).trim().toLowerCase();

    const existing = await TrainingUser.findOne({ where: { email } });
    if (existing) {
      return NextResponse.json({ ok: true, exists: true }, { headers: CORS_HEADERS });
    }

    await TrainingUser.create({
      email,
      name: name_1 ? String(name_1).trim() : null,
      lastName: name_2 ? String(name_2).trim() : null,
      username: text_1 ? String(text_1).trim() : null,
      country: select_1 ? String(select_1).trim() : null,
      birthDate: date_1 || null,
      type: "private",
      active: true,
    });

    return NextResponse.json(
      { ok: true, message: "Usuario registrado." },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    const response = handleRouteError(err);
    // Añadir CORS headers incluso en errores para que WordPress reciba la respuesta
    CORS_HEADERS["Access-Control-Allow-Origin"] &&
      response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }
}
