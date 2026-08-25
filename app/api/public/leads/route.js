import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";
import { sanearCustomFields } from "../../../../lib/utils/publicInput.js";
import { notifyAdmins } from "../../../../lib/notifications/notifyUsers.js";

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
    const limited = enforceRateLimit(request, { key: "public-leads", limit: 30, windowMs: 60_000 });
    if (limited) {
      // Reinyectar CORS para que la respuesta 429 sea legible desde un iframe/landing externo.
      for (const [h, v] of Object.entries(CORS_HEADERS)) limited.headers.set(h, v);
      return limited;
    }

    // Resolve tenant from x-tenant header (no auth cookie required)
    const { tenant, tenantModels, hasModule } = await getTenantContext(request);

    if (!hasModule("leads")) {
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
      empresa,
      customFields: customFieldsBody,
    } = body;

    // Accept both naming conventions:
    // WordPress form sends: nombre + apellidos (or full name in nombre), telefono
    // Internal API sends: name, phone
    const fullName = nameField?.trim() || [nombre?.trim(), apellidos?.trim()].filter(Boolean).join(" ") || null;
    const phone = phoneField?.trim() || telefono?.trim() || null;

    if (!fullName && !email) {
      return Response.json({ ok: false, error: "Se requiere nombre o email" }, { status: 400, headers: CORS_HEADERS });
    }

    // `motivo` en el modelo es ENUM (diagnostico/servicios/cursos/talleres
    // — legacy de aumenta/retorika). Si llega un valor que no es ENUM
    // válido (caso nutri_laura, donde "motivo" es texto libre del
    // formulario), lo movemos a customFields.motivo en lugar de fallar.
    const ENUM_MOTIVOS = ["diagnostico", "servicios", "cursos", "talleres"];
    const motivoIsEnum = motivo && ENUM_MOTIVOS.includes(motivo);

    // Saneo de customFields (arreglo 2026-07-23): endpoint público sin login.
    // Antes se volcaba el objeto tal cual, sin tope de tamaño → contaminación y
    // abuso de almacenamiento. Ahora se recorta a un JSON de 8 KB como máximo.
    const customFields = sanearCustomFields({
      ...(customFieldsBody && typeof customFieldsBody === "object" && !Array.isArray(customFieldsBody) ? customFieldsBody : {}),
      ...(empresa ? { empresa: String(empresa).trim() } : {}),
      ...(motivo && !motivoIsEnum ? { motivo: String(motivo).trim() } : {}),
    });

    const cap = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : v);
    const lead = await Lead.create({
      name: cap(fullName, 200),
      email: email?.trim().toLowerCase().slice(0, 160) ?? null,
      phone: cap(phone, 40),
      title: cap(fullName, 200),
      stage: "new",
      tipo_usuario: tipo_usuario ?? null,
      motivo: motivoIsEnum ? motivo : null,
      servicio: cap(servicio, 200) ?? null,
      curso: cap(curso, 200) ?? null,
      taller: cap(taller, 200) ?? null,
      mensaje: cap(mensaje, 4000) ?? null,
      customFields,
    });

    /*
     * Avisar de que ha entrado alguien (08/08/2026).
     *
     * Hasta hoy este endpoint guardaba la fila y no avisaba a NADIE: ni correo
     * ni campana. El hermano del módulo Formularios sí lo hace, y su propio
     * comentario explica por qué importa — en nutri_laura se acumularon seis
     * solicitudes sin que nadie supiera que habían entrado.
     *
     * Aquí es peor todavía: en Aumenta hay 13 de 15 personas del equipo que no
     * tienen acceso al módulo, así que el mensaje de una familia contando lo que
     * le pasa a su hijo se queda en una tabla hasta que entre un administrador.
     *
     * Solo la CAMPANA, no correo: el correo depende de que haya clave de Resend
     * configurada, y falla callado cuando no la hay (que es justo el caso de
     * Aumenta hoy). La campana no depende de nadie: si la fila se guarda, el
     * aviso aparece.
     *
     * SIN el mensaje ni el motivo: es información de salud y su sitio es el CRM,
     * no una notificación. Solo se dice que hay algo que mirar.
     *
     * `.catch()` y sin await: que no salga el aviso no puede tumbar un lead que
     * ya está guardado.
     */
    notifyAdmins({
      tenantId: tenant.id,
      tenantModels,
      type: "lead_recibido",
      title: "Nuevo interesado desde la web",
      body: `${lead.name || "Alguien"} ha rellenado el formulario de la web. Está en Interesados → Profesionales.`,
      entityType: "Lead",
      entityId: lead.id,
    }).catch(() => {});

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
