import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, created, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { enforceRateLimit } from "../../../../../../lib/utils/rateLimit.js";
import { MODULE_KEYS } from "../../../../../../lib/tenant/moduleKeys.js";
import {
  verificarFirmaRegistro,
  asegurarSolicitudDeAlta,
  VENTANA_SEGUNDOS,
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
    /*
     * ⚠️ REGISTRARSE EN LA WEB YA NO CREA UNA SOLICITUD (05/08/2026, Rodrigo).
     *
     * En esta web hay DOS registros distintos y este endpoint no puede
     * distinguirlos, porque los dos crean un usuario de WordPress:
     *   · el botón REGISTRO, para comprar cursos — la mayoría;
     *   · el formulario de /formularios, que sí es «quiero ser paciente».
     *
     * Tratar el primero como una solicitud llenaba Leads Comerciales de gente
     * que no había pedido nada: 46 rechazadas a mano en tres semanas. Y desde
     * que existe la puerta de admisión hacía daño de verdad, porque a esa
     * persona el portal le decía «tu solicitud está en revisión» sin haber
     * rellenado ningún formulario — un callejón sin salida, con el aviso
     * equivocado y sin enlace al que ir.
     *
     * LA REGLA: **una solicitud la crea SOLO el formulario de /formularios.**
     *
     * El endpoint se conserva respondiendo 200 para que el WordPress que hoy lo
     * llama no empiece a registrar errores en cada alta. El aviso se retira del
     * theme en la próxima versión (`nutrilaura-registro-crm.php`) y entonces
     * esta ruta se puede borrar entera.
     */
    /*
     * Aquí había un `void nombre; void wpUserId;` — restos de cuando este código
     * leía esos dos datos del cuerpo. Al quitar las declaraciones, esas dos
     * líneas se quedaron señalando a nada: en un módulo ESM (modo estricto) eso
     * lanza `ReferenceError`, lo recoge el `catch` de abajo y el endpoint
     * contestaba **500**. Justo lo contrario de lo que dice el comentario de
     * arriba, que es la única razón por la que esta ruta sigue viva: responder
     * 200 para que el WordPress que la llama no registre errores en cada alta.
     *
     * Lo encontró `eslint.undef.mjs` el 28/08/2026. Ni el lint ni el build lo
     * daban: `eslint-config-next` no lleva `no-undef` y Next compila sin
     * quejarse. Se veía solo llamando al endpoint, y como es de WordPress a
     * servidor, nadie lo estaba mirando.
     */
    return ok({ creada: false, motivo: "registro_no_es_solicitud" });
  } catch (err) {
    return serverError(err);
  }
});
