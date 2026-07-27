import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, created, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { enforceRateLimit } from "../../../../../../lib/utils/rateLimit.js";
import { MODULE_KEYS } from "../../../../../../lib/tenant/moduleKeys.js";
import {
  verificarFirmaRegistro,
  asegurarFormularioRegistro,
  VENTANA_SEGUNDOS,
  FORM_SLUG,
  FORM_TITULO,
} from "../../../../../../lib/formularios/registroWeb.js";

/**
 * POST /api/public/c/{tenant}/registro-web
 *
 * WordPress avisa de que alguien se ha registrado en la web por su cuenta, y
 * aquí se crea una SOLICITUD pendiente en Formularios para que la profesional
 * decida si le abre ficha de cliente.
 *
 * No es un endpoint de navegador: solo lo llama el theme, firmado (HMAC con
 * subclave derivada del secreto del tenant) y con marca de tiempo.
 *
 * Body: { email, nombre?, wp_user_id?, ts, nonce? }
 * Cabecera: X-CRM-Signature: <hmac hex del cuerpo crudo>
 *
 *   201 → solicitud creada
 *   200 → no hacía falta crearla (ya es cliente / ya había una pendiente)
 *   401 → firma inválida o petición caducada · 404 → tenant o módulo no disponible
 *
 * IDEMPOTENTE a propósito: WordPress puede reintentar, y el alta que hace el
 * PROPIO CRM al aceptar una solicitud dispara el mismo hook en WordPress. Si eso
 * creara una solicitud nueva, cada aceptación generaría trabajo otra vez —
 * justo el bucle que hay que evitar. Por eso, antes de crear nada, se mira si
 * esa persona ya es cliente o si ya tiene una solicitud esperando.
 */
const LIMITE = { limit: 20, windowMs: 60_000 };

export const POST = withPublicTenant(async (request, _ctx, { slug, tenantModels, hasModule }) => {
  try {
    const limitado = enforceRateLimit(request, { key: `registro-web:${slug}`, ...LIMITE });
    if (limitado) return limitado;

    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return notFound("Módulo no disponible");

    // El cuerpo CRUDO es lo que se firma: si se parsea y se vuelve a serializar,
    // cualquier diferencia de formato (orden de claves, espacios) rompe la firma.
    const cuerpoCrudo = await request.text();
    const firma = request.headers.get("x-crm-signature");

    const check = verificarFirmaRegistro({ tenantSlug: slug, cuerpoCrudo, firma });
    if (!check.ok) {
      // Sin secreto configurado es un fallo de instalación, no un intento de
      // colarse: se distingue para que se pueda diagnosticar desde el theme.
      if (check.motivo === "sin_secreto") return error("El CRM no tiene configurado el secreto de este tenant", 403);
      return error("Firma no válida", 401);
    }

    let datos;
    try {
      datos = JSON.parse(cuerpoCrudo);
    } catch {
      return error("Cuerpo no válido", 400);
    }

    // Antirreplay: una petición vieja capturada del tráfico no vale.
    const ts = Number(datos?.ts) || 0;
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > VENTANA_SEGUNDOS) {
      return error("Petición caducada", 401);
    }

    const email = String(datos?.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return error("Email no válido", 422);
    }
    const nombre = String(datos?.nombre || "").trim().slice(0, 200);
    const wpUserId = Number(datos?.wp_user_id) || null;

    const { Client, Form, FormSubmission } = tenantModels;

    // ── Guardas de idempotencia ───────────────────────────────────────────
    // 1) Ya tiene ficha: el círculo ya está cerrado, no hay nada que decidir.
    const yaCliente = await Client.findOne({
      where: { email: { [Op.iLike]: email } },
      attributes: ["id"],
    });
    if (yaCliente) {
      return ok({ creada: false, motivo: "ya_es_cliente" });
    }

    // 2) Ya hay una solicitud esperando de esa persona (de cualquier
    //    formulario): no se duplica trabajo en la bandeja.
    const yaPendiente = await FormSubmission.findOne({
      where: { email: { [Op.iLike]: email }, status: "pending" },
      attributes: ["id"],
    });
    if (yaPendiente) {
      return ok({ creada: false, motivo: "ya_pendiente" });
    }

    const form = await asegurarFormularioRegistro(Form);

    const submission = await FormSubmission.create({
      formId: form.id,
      formSlug: FORM_SLUG,
      formTitle: FORM_TITULO,
      name: nombre || null,
      email,
      phone: null,
      // Se guarda el enunciado junto al valor, como el resto de solicitudes: así
      // la bandeja lo pinta sola y el histórico se sigue entendiendo.
      answers: [
        { key: "origen", label: "Origen", type: "text", value: "Registro en la web" },
        { key: "nombre", label: "Nombre", type: "text", value: nombre || "—" },
        { key: "email", label: "Email", type: "email", value: email },
        ...(wpUserId
          ? [{ key: "wp_user_id", label: "Usuario de WordPress (id)", type: "text", value: String(wpUserId) }]
          : []),
      ],
      status: "pending",
    });

    return created({ creada: true, id: submission.id });
  } catch (err) {
    return serverError(err);
  }
});
