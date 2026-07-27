/**
 * lib/formularios/registroWeb.js — altas que nacen en WordPress.
 *
 * EL CÍRCULO COMPLETO. Hasta ahora solo iba en un sentido: Laura aceptaba una
 * solicitud en el CRM y el CRM creaba el usuario en WordPress
 * (lib/formularios/portalUser.js). Faltaba el otro: si alguien se registra por
 * su cuenta en la web (curso, formulario de WordPress…), no llegaba nada al
 * CRM y quedaba un usuario de la web SIN ficha de cliente.
 *
 * Ahora WordPress avisa y en el CRM aparece una solicitud en Formularios, que
 * Laura acepta o descarta como cualquier otra. Objetivo: nunca un cliente sin
 * usuario de la web, nunca un usuario de la web sin ficha (o al menos sin una
 * decisión consciente de Laura).
 *
 * AUTENTICACIÓN: mismo patrón que portalUser.js — HMAC con una SUBCLAVE
 * derivada del secreto del tenant (WIDGET_SSO_SECRETS) sobre una etiqueta de
 * propósito PROPIA. Así un token de este canal no vale para el SSO de citas ni
 * para el alta de usuarios, y al revés.
 */

import crypto from "node:crypto";
import { getWidgetSsoSecret } from "../citas/ssoToken.js";

/** Etiqueta de propósito. Tiene que coincidir con la del theme de WordPress. */
export const ETIQUETA_REGISTRO = "crm-registro-web-v1";

/** Margen aceptado entre el reloj de WordPress y el del CRM (segundos). */
export const VENTANA_SEGUNDOS = 300;

/** Slug y título del formulario "virtual" bajo el que entran estas altas. */
export const FORM_SLUG = "registro-web";
export const FORM_TITULO = "Alta desde la web";

function derivarClave(secreto) {
  return crypto.createHmac("sha256", secreto).update(ETIQUETA_REGISTRO).digest("hex");
}

/**
 * Comprueba la firma del aviso de WordPress.
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
export function verificarFirmaRegistro({ tenantSlug, cuerpoCrudo, firma }) {
  const secreto = getWidgetSsoSecret(tenantSlug);
  if (!secreto) return { ok: false, motivo: "sin_secreto" };
  if (!firma || typeof firma !== "string") return { ok: false, motivo: "sin_firma" };

  const esperada = crypto.createHmac("sha256", derivarClave(secreto)).update(cuerpoCrudo).digest("hex");
  try {
    // Comparación en tiempo constante: con `===` se puede deducir la firma byte
    // a byte midiendo lo que tarda en responder.
    const a = Buffer.from(firma);
    const b = Buffer.from(esperada);
    if (a.length !== b.length) return { ok: false, motivo: "firma_invalida" };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, motivo: "firma_invalida" };
  } catch {
    return { ok: false, motivo: "firma_invalida" };
  }
  return { ok: true };
}

/**
 * El formulario "virtual" bajo el que cuelgan estas altas.
 *
 * `active: false` A PROPÓSITO: no es un formulario que nadie rellene desde el
 * navegador — el endpoint público de formularios exige `active`, así que así
 * NADIE puede colar solicitudes falsas por esa vía. Estas solo entran firmadas.
 */
export async function asegurarFormularioRegistro(Form) {
  const [form] = await Form.findOrCreate({
    where: { slug: FORM_SLUG },
    defaults: {
      slug: FORM_SLUG,
      title: FORM_TITULO,
      description: "Altas de personas que se han registrado por su cuenta en la web.",
      fields: [],
      active: false,
    },
  });
  return form;
}
