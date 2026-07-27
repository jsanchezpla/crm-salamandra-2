import { Op } from "sequelize";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { enforceRateLimit } from "../../../../../../../lib/utils/rateLimit.js";
import { MODULE_KEYS } from "../../../../../../../lib/tenant/moduleKeys.js";
import {
  verificarFirmaRegistro,
  asegurarFormularioRegistro,
  VENTANA_SEGUNDOS,
  FORM_SLUG,
  FORM_TITULO,
} from "../../../../../../../lib/formularios/registroWeb.js";

/**
 * POST /api/public/c/{tenant}/registro-web/sync
 *
 * PUESTA AL DÍA (una vez): WordPress manda DE GOLPE todos sus usuarios para que
 * los que no tengan ficha de cliente aparezcan como solicitudes pendientes.
 *
 * Hace falta porque el aviso automático (registro-web) solo salta cuando ALGUIEN
 * SE REGISTRA: las cuentas creadas antes de montar el circuito se quedaron sin
 * avisar. Esto las recupera.
 *
 * Va en lote y no de una en una a propósito: el endpoint individual tiene un
 * límite de peticiones por minuto (es un canal abierto a internet), así que
 * mandar 200 usuarios seguidos se cortaría a la mitad y PHP agotaría su tiempo.
 *
 * Mismo canal firmado que el aviso individual: HMAC con la subclave derivada del
 * secreto del tenant + marca de tiempo.
 *
 * Body: { usuarios: [{ email, nombre?, wp_user_id? }, …], ts, nonce? }
 *   200 → { recibidos, creadas, ya_clientes, ya_pendientes, invalidos, detalle }
 *   401 → firma inválida o caducada · 404 → tenant/módulo no disponible
 *
 * ES REPETIBLE SIN MIEDO: por cada persona se comprueba antes si ya es cliente o
 * si ya tiene una solicitud esperando. Lanzarlo dos veces no duplica nada.
 */
const LIMITE = { limit: 4, windowMs: 60_000 };
const MAX_USUARIOS = 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST = withPublicTenant(async (request, _ctx, { slug, tenantModels, hasModule }) => {
  try {
    const limitado = enforceRateLimit(request, { key: `registro-sync:${slug}`, ...LIMITE });
    if (limitado) return limitado;

    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return notFound("Módulo no disponible");

    const cuerpoCrudo = await request.text();
    const check = verificarFirmaRegistro({
      tenantSlug: slug,
      cuerpoCrudo,
      firma: request.headers.get("x-crm-signature"),
    });
    if (!check.ok) {
      if (check.motivo === "sin_secreto") return error("El CRM no tiene configurado el secreto de este tenant", 403);
      return error("Firma no válida", 401);
    }

    let datos;
    try {
      datos = JSON.parse(cuerpoCrudo);
    } catch {
      return error("Cuerpo no válido", 400);
    }

    const ts = Number(datos?.ts) || 0;
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > VENTANA_SEGUNDOS) {
      return error("Petición caducada", 401);
    }

    const usuarios = Array.isArray(datos?.usuarios) ? datos.usuarios : null;
    if (!usuarios) return error("Falta la lista de usuarios", 422);
    if (usuarios.length > MAX_USUARIOS) {
      return error(`Demasiados usuarios de golpe (máximo ${MAX_USUARIOS}). Mándalos por tandas.`, 413);
    }

    const { Client, Form, FormSubmission } = tenantModels;

    const resumen = { recibidos: usuarios.length, creadas: 0, ya_clientes: 0, ya_pendientes: 0, invalidos: 0 };
    const detalle = [];
    let form = null; // se crea solo si de verdad hace falta

    for (const u of usuarios) {
      const email = String(u?.email || "").trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) {
        resumen.invalidos += 1;
        continue;
      }

      const yaCliente = await Client.findOne({ where: { email: { [Op.iLike]: email } }, attributes: ["id"] });
      if (yaCliente) {
        resumen.ya_clientes += 1;
        continue;
      }

      const yaPendiente = await FormSubmission.findOne({
        where: { email: { [Op.iLike]: email }, status: "pending" },
        attributes: ["id"],
      });
      if (yaPendiente) {
        resumen.ya_pendientes += 1;
        continue;
      }

      if (!form) form = await asegurarFormularioRegistro(Form);

      const nombre = String(u?.nombre || "").trim().slice(0, 200);
      const wpUserId = Number(u?.wp_user_id) || null;

      await FormSubmission.create({
        formId: form.id,
        formSlug: FORM_SLUG,
        formTitle: FORM_TITULO,
        name: nombre || null,
        email,
        phone: null,
        answers: [
          // Se distingue del alta en caliente: esta viene de la puesta al día,
          // y conviene que Laura lo vea al abrirla.
          { key: "origen", label: "Origen", type: "text", value: "Usuario ya existente en la web (puesta al día)" },
          { key: "nombre", label: "Nombre", type: "text", value: nombre || "—" },
          { key: "email", label: "Email", type: "email", value: email },
          ...(wpUserId
            ? [{ key: "wp_user_id", label: "Usuario de WordPress (id)", type: "text", value: String(wpUserId) }]
            : []),
        ],
        status: "pending",
      });
      resumen.creadas += 1;
      detalle.push(email);
    }

    return ok({ ...resumen, detalle: detalle.slice(0, 50) });
  } catch (err) {
    return serverError(err);
  }
});
