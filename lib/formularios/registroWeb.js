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
import { Op } from "sequelize";
import { getWidgetSsoSecrets } from "../citas/ssoToken.js";

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
  const secretos = getWidgetSsoSecrets(tenantSlug);
  if (secretos.length === 0) return { ok: false, motivo: "sin_secreto" };
  if (!firma || typeof firma !== "string") return { ok: false, motivo: "sin_firma" };

  // Vale cualquiera de los configurados, para poder rotar el secreto sin cortar
  // las altas de la web mientras WordPress todavía firma con el viejo.
  const casa = (secreto) => {
    const esperada = crypto.createHmac("sha256", derivarClave(secreto)).update(cuerpoCrudo).digest("hex");
    try {
      // Comparación en tiempo constante: con `===` se puede deducir la firma byte
      // a byte midiendo lo que tarda en responder.
      const a = Buffer.from(firma);
      const b = Buffer.from(esperada);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  };

  // `some` cortaría al primer acierto y delataría por tiempo CUÁL de los
  // secretos casó. Se comprueban todos siempre.
  let vale = false;
  for (const secreto of secretos) if (casa(secreto)) vale = true;
  if (!vale) return { ok: false, motivo: "firma_invalida" };
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

/**
 * Deja una solicitud pendiente en la bandeja para alguien de la web que NO
 * tiene ficha. Idempotente: si ya es cliente o ya tenía una esperando, no hace
 * nada.
 *
 * (Extraído del endpoint `registro-web` el 05/08/2026, regla #2: ahora lo
 * llaman DOS sitios y la lógica de idempotencia es exactamente la misma.)
 *
 *   · `registro-web` — WordPress avisa de que alguien se ha registrado.
 *   · el canje del SSO — alguien ENTRA en su área privada con un correo del
 *     que no tenemos ficha. Es la señal más valiosa de las dos: significa que
 *     esa persona está usando el portal AHORA MISMO y el CRM no sabe quién es
 *     —normalmente porque su ficha tiene otro correo—, y eso hace que su bono
 *     no le funcione y que sus citas no se enlacen con nadie.
 *
 * `origen` es el texto que verá la profesional en la bandeja, y distinguirlo
 * importa: no es lo mismo «se ha registrado» que «lleva rato entrando y no
 * tengo ficha suya».
 *
 * Nunca lanza: es un añadido a operaciones que tienen que salir bien igual.
 */
export async function asegurarSolicitudDeAlta(tenantModels, { email, nombre = "", origen, wpUserId = null }) {
  try {
    const { Client, Form, FormSubmission } = tenantModels ?? {};
    if (!Client || !Form || !FormSubmission || !email) return { creada: false, motivo: "sin_datos" };

    const limpio = String(email).trim().toLowerCase();

    // 1) Ya tiene ficha: el círculo está cerrado, no hay nada que decidir.
    const yaCliente = await Client.findOne({
      where: { email: { [Op.iLike]: limpio } },
      attributes: ["id"],
    });
    if (yaCliente) return { creada: false, motivo: "ya_es_cliente" };

    // 2) Ya hay una solicitud esperando (de cualquier formulario): no se
    //    duplica trabajo en la bandeja.
    const yaPendiente = await FormSubmission.findOne({
      where: { email: { [Op.iLike]: limpio }, status: "pending" },
      attributes: ["id"],
    });
    if (yaPendiente) return { creada: false, motivo: "ya_pendiente" };

    const form = await asegurarFormularioRegistro(Form);
    const limpioNombre = String(nombre || "").trim().slice(0, 200);

    const submission = await FormSubmission.create({
      formId: form.id,
      formSlug: FORM_SLUG,
      formTitle: FORM_TITULO,
      name: limpioNombre || null,
      email: limpio,
      phone: null,
      // El enunciado se guarda junto al valor, como el resto de solicitudes:
      // así la bandeja lo pinta sola y el histórico se sigue entendiendo.
      answers: [
        { key: "origen", label: "Origen", type: "text", value: origen },
        { key: "nombre", label: "Nombre", type: "text", value: limpioNombre || "—" },
        { key: "email", label: "Email", type: "email", value: limpio },
        ...(wpUserId
          ? [{ key: "wp_user_id", label: "Usuario de WordPress (id)", type: "text", value: String(wpUserId) }]
          : []),
      ],
      status: "pending",
    });

    return { creada: true, id: submission.id };
  } catch (err) {
    // Sin módulo de formularios, sin tabla, o cualquier otro tropiezo: quien
    // llama sigue su camino. Esto es una red, no un requisito.
    process.stderr.write(`[registroWeb] no se pudo dejar la solicitud: ${err.message}\n`);
    return { creada: false, motivo: "error" };
  }
}
