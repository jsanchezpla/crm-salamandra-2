import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { enforceRateLimit } from "../../../../../../../lib/utils/rateLimit.js";
import { ok, created, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { validarRespuestas, formPublico } from "../../../../../../../lib/formularios/fields.js";
import { puntuarSpam, buscarDuplicadoReciente } from "../../../../../../../lib/formularios/antispam.js";
import { MODULE_KEYS } from "../../../../../../../lib/tenant/moduleKeys.js";
import { getTenantResendConfig } from "../../../../../../../lib/outreach/resendConfig.js";

/**
 * Formulario público del módulo Formularios.
 *
 *   GET  /api/public/c/{tenant}/formularios/{slug}  → la definición, para pintarlo
 *   POST /api/public/c/{tenant}/formularios/{slug}  → recibir una solicitud
 *
 * Es un endpoint ABIERTO A INTERNET que escribe en la base de datos de un
 * tenant. Por eso, en este orden: límite de peticiones → módulo activo →
 * formulario existente y activo → validación → antispam → guardar.
 *
 * El CORS y el preflight OPTIONS los pone el middleware para todo /api/public;
 * aquí no hay que repetirlos.
 *
 * NUNCA `getTenantContext` en una ruta pública: resolvería el tenant por la
 * cabecera `x-tenant`, que la elige quien llama. El tenant va en la URL.
 */

// El límite se aplica dentro del handler, no en el wrapper: allí las opciones
// se evalúan al cargar el módulo y todavía no existe el slug del tenant, así
// que un tenant podría gastarle el cupo a otro.
const LIMITE = { limit: 8, windowMs: 60_000 };

async function cargarFormulario(tenantModels, formSlug) {
  const { Form } = tenantModels;
  if (!Form) return null;
  return Form.findOne({ where: { slug: String(formSlug || "").slice(0, 64) } });
}

export const GET = withPublicTenant(
  async (request, ctx, { slug, tenantModels, hasModule, brand }) => {
    try {
      // Rate-limit también en el GET (arreglo 2026-07-23): sin él, cada peticion
      // ejecutaba un Form.findOne contra la BD sin freno alguno (DoS barato).
      const limitado = enforceRateLimit(request, { key: `formulario-get:${slug}`, limit: 30, windowMs: 60_000 });
      if (limitado) return limitado;

      if (!hasModule(MODULE_KEYS.FORMULARIOS)) return notFound("Formulario no encontrado");
      const { formSlug } = await ctx.params;

      const form = await cargarFormulario(tenantModels, formSlug);
      if (!form || !form.active) return notFound("Formulario no encontrado");

      return ok({ form: formPublico(form.toJSON()), brand });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);

export const POST = withPublicTenant(
  async (request, ctx, { slug, tenant, tenantModels, hasModule }) => {
    try {
      // 1. Límite por IP, con cubo propio por tenant y por formulario.
      const { formSlug } = await ctx.params;
      const limitado = enforceRateLimit(request, { ...LIMITE, key: `formulario:${slug}:${formSlug}` });
      if (limitado) return limitado;

      // 2. Módulo activo para este tenant.
      if (!hasModule(MODULE_KEYS.FORMULARIOS)) return notFound("Formulario no encontrado");

      // 3. Formulario existente y encendido.
      const form = await cargarFormulario(tenantModels, formSlug);
      if (!form || !form.active) return notFound("Formulario no encontrado");

      let cuerpo;
      try {
        cuerpo = await request.json();
      } catch {
        return error("No hemos podido leer los datos del formulario.");
      }

      // 4. Validación contra la definición del propio formulario.
      const validado = validarRespuestas(form.toJSON(), cuerpo);
      if (!validado.ok) {
        return error(validado.errores[0]?.mensaje || "Revisa los datos.", 422, {
          campos: validado.errores,
        });
      }

      // 5. Antispam. A un bot se le responde bien y no se guarda nada: un
      //    error le diría exactamente qué corregir para colarse a la siguiente.
      const { puntos, motivos } = puntuarSpam(cuerpo);
      if (puntos >= 2) {
        console.warn(`[formularios] descartada por spam (${slug}/${formSlug}): ${motivos.join(", ")}`);
        return created({ ok: true, mensaje: form.thankYouMessage || "¡Gracias!" });
      }

      const { FormSubmission } = tenantModels;
      const destinos = validado.destinos;

      // 6. ¿Doble clic o reintento del navegador? Misma respuesta, sin duplicar.
      const duplicado = await buscarDuplicadoReciente(FormSubmission, {
        formId: form.id,
        phone: destinos.phone || null,
        email: destinos.email || null,
      });
      if (duplicado) {
        return created({ ok: true, mensaje: form.thankYouMessage || "¡Gracias!" });
      }

      const ajustes = form.settings || {};
      await FormSubmission.create({
        formId: form.id,
        formSlug: form.slug,
        formTitle: form.title,
        name: destinos.name || null,
        email: destinos.email || null,
        phone: destinos.phone || null,
        answers: validado.answers,
        status: "pending",
        spamScore: puntos,
        sourceUrl: String(cuerpo?._url || request.headers.get("referer") || "").slice(0, 500) || null,
        consentAt: validado.consentimiento ? new Date() : null,
        consentText: validado.consentimiento?.texto || null,
        consentVersion: ajustes.privacyVersion || null,
      });

      // El aviso a la nutricionista se dispara aparte y sin bloquear: que no
      // salga un correo no puede impedir que la solicitud quede guardada.
      notificarNuevaSolicitud({ ajustes, form, destinos, tenant }).catch(() => {});

      return created({ ok: true, mensaje: form.thankYouMessage || "¡Gracias!" });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);

/**
 * Aviso interno de "ha entrado una solicitud". NO lleva las respuestas: el
 * motivo de consulta es información de salud y no tiene por qué viajar por
 * correo. Solo dice quién y que entre en el CRM.
 */
async function notificarNuevaSolicitud({ ajustes, form, destinos, tenant }) {
  const destinatarios = Array.isArray(ajustes?.notifyEmails) ? ajustes.notifyEmails.filter(Boolean) : [];
  if (destinatarios.length === 0) return;

  const { sendEmail } = await import("../../../../../../../lib/email/resendClient.js");
  const nombre = destinos.name || "Alguien";
  const telefono = destinos.phone ? ` · ${destinos.phone}` : "";

  // BYOK: el aviso sale de la cuenta del propio negocio.
  const cfgResend = getTenantResendConfig({ tenant });
  await sendEmail({
    to: destinatarios,
    from: cfgResend.fromEmail || undefined,
    replyTo: cfgResend.replyTo || undefined,
    apiKey: cfgResend.apiKey || undefined,
    subject: `Nueva solicitud desde la web — ${nombre}`,
    html:
      `<p><strong>${escapar(nombre)}</strong>${escapar(telefono)} ha enviado el formulario ` +
      `«${escapar(form.title)}».</p>` +
      `<p>Entra en el CRM para verla y decidir. No incluimos aquí lo que ha escrito: ` +
      `es información confidencial y su sitio es el CRM.</p>`,
    text:
      `${nombre}${telefono} ha enviado el formulario «${form.title}». ` +
      `Entra en el CRM para verla.`,
  });
}

function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
