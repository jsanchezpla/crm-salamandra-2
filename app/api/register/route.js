import { NextResponse } from "next/server";
import { getTenantContext } from "../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../lib/utils/errors.js";
import { enforceRateLimit } from "../../../lib/utils/rateLimit.js";
import { origenPermitido, corsParaOrigen } from "../../../lib/utils/wpOrigin.js";

// Preflight CORS — llamado desde JavaScript en WordPress.
// Acotado al dominio del cliente (antes era "*", contra la propia norma de
// CLAUDE.md). El preflight aún no conoce el tenant, así que responde con el
// origen solo si está en la lista por defecto; el POST vuelve a comprobarlo ya
// con el tenant resuelto.
export async function OPTIONS(request) {
  return new NextResponse(null, { status: 204, headers: corsParaOrigen(request, null) });
}

// Acepta DD/MM/YYYY (WordPress) y YYYY-MM-DD (ISO)
function normalizarFecha(fecha) {
  if (!fecha) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const [d, m, y] = fecha.split("/");
  if (d && m && y) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return null;
}

// POST /api/register
// Recibe el formulario [registro_privado] de WordPress y crea el TrainingUser.
// Endpoint público — sin JWT. El campo "password" lo gestiona WordPress, aquí se ignora.
//
// Cerrado igual que sus hermanos /api/usuarios/register/empresa y
// /api/cursos-empresas (2026-07-28): era el único que se quedó fuera de aquel
// repaso y permitía escribir filas de TrainingUser en cualquier tenant con el
// módulo, de forma anónima y solo mandando la cabecera x-tenant.
export async function POST(request) {
  try {
    const limited = enforceRateLimit(request, {
      key: "register-privado",
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) {
      for (const [h, v] of Object.entries(corsParaOrigen(request, null))) limited.headers.set(h, v);
      return limited;
    }

    const ctx = await getTenantContext(request);
    const cors = corsParaOrigen(request, ctx.tenant);

    if (!origenPermitido(request, ctx.tenant)) {
      return NextResponse.json({ ok: false, error: "Origen no autorizado." }, { status: 403, headers: cors });
    }

    const { TrainingUser } = ctx.tenantModels;

    const body = await request.json();
    // password se desestructura para excluirlo explícitamente — nunca se guarda
    const { name_1, name_2, text_1, email_1, select_1, date_1 } = body;

    if (!email_1) {
      return NextResponse.json({ ok: false, error: "El email es obligatorio." }, { status: 422, headers: cors });
    }

    const email = String(email_1).trim().toLowerCase();

    const existing = await TrainingUser.findOne({ where: { email } });
    if (existing) {
      return NextResponse.json({ ok: true, exists: true }, { headers: cors });
    }

    await TrainingUser.create({
      email,
      name: name_1 ? String(name_1).trim() : null,
      lastName: name_2 ? String(name_2).trim() : null,
      username: text_1 ? String(text_1).trim() : null,
      country: select_1 ? String(select_1).trim() : null,
      birthDate: normalizarFecha(date_1),
      type: "private",
      active: true,
    });

    return NextResponse.json({ ok: true, message: "Usuario registrado." }, { headers: cors });
  } catch (err) {
    const response = handleRouteError(err);
    // CORS también en los errores para que WordPress reciba la respuesta.
    for (const [h, v] of Object.entries(corsParaOrigen(request, null))) response.headers.set(h, v);
    return response;
  }
}
