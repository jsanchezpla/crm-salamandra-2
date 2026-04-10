import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { ValidationError } from "../../../../lib/utils/errors.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

// Preflight CORS
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    // Resolve tenant from x-tenant header (no auth cookie required)
    const { tenantModels, hasModule } = await getTenantContext(request);

    if (!hasModule("leads") && !hasModule("sales")) {
      return Response.json({ ok: false, error: "Módulo no disponible" }, { status: 403, headers: CORS_HEADERS });
    }

    const { Lead } = tenantModels;
    const body = await request.json();

    const {
      nombre,
      apellidos,
      name: nameField,
      email,
      telefono,
      phone: phoneField,
      tipo_usuario,
      motivo,
      servicio,
      curso,
      taller,
      mensaje,
      source,
    } = body;

    // Accept both naming conventions:
    // WordPress form sends: nombre + apellidos (or full name in nombre), telefono
    // Internal API sends: name, phone
    const fullName = nameField?.trim() || [nombre?.trim(), apellidos?.trim()].filter(Boolean).join(" ") || null;
    const phone = phoneField?.trim() || telefono?.trim() || null;

    if (!fullName && !email) {
      return Response.json({ ok: false, error: "Se requiere nombre o email" }, { status: 400, headers: CORS_HEADERS });
    }

    const lead = await Lead.create({
      name: fullName,
      email: email?.trim().toLowerCase() ?? null,
      phone,
      title: fullName,
      stage: "new",
      source: source ?? "web",
      tipo_usuario: tipo_usuario ?? "ciudadano",
      motivo: motivo ?? null,
      servicio: servicio?.trim() ?? null,
      curso: curso?.trim() ?? null,
      taller: taller?.trim() ?? null,
      mensaje: mensaje?.trim() ?? null,
      customFields: {},
    });

    return Response.json({ ok: true, id: lead.id }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    if (err?.message?.includes("no encontrado") || err?.message?.includes("no identificado")) {
      return Response.json({ ok: false, error: "Tenant no encontrado" }, { status: 404, headers: CORS_HEADERS });
    }
    if (err instanceof ValidationError) {
      return Response.json({ ok: false, error: err.message }, { status: 400, headers: CORS_HEADERS });
    }
    console.error("[public/leads] Error:", err);
    return Response.json({ ok: false, error: "Error interno" }, { status: 500, headers: CORS_HEADERS });
  }
}
