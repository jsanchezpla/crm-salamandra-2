/**
 * Recibo por correo de cada cambio en la configuración de un cliente.
 *
 * Por qué existe: la configuración de un cliente incluye sus credenciales de
 * cobro, de correo y de IA. Son suyas. Que alguien pueda tocarlas —nosotros
 * incluidos— sin que él se entere es lo que había que arreglar.
 *
 * ── DOS DECISIONES QUE NO SON OBVIAS ────────────────────────────────────────
 *
 * 1. Se envía con la cuenta de correo DE SALAMANDRA, nunca con la del cliente.
 *    Por dos motivos, y el segundo es el bueno:
 *      · si saliera con su clave, podría borrar la prueba desde su panel;
 *      · el aviso se caería justo cuando lo que se está cambiando ES su clave
 *        de correo — es decir, precisamente en el caso que más importa avisar.
 *
 *    Esa cuenta se lee del tenant `salamandra_solutions`, no de una variable de
 *    entorno: desde el paso a BYOK las credenciales de correo viven en la
 *    configuración de cada tenant, y Salamandra es un tenant más. Así además se
 *    gestiona desde la propia pantalla de Configuración.
 *
 * 2. Los destinatarios salen de `master.users`, NUNCA de un campo del
 *    formulario. Si el destinatario lo pusiera quien hace el cambio, se estaría
 *    mandando el recibo a sí mismo y el aviso no valdría como nada.
 *
 * Best-effort: guardar la configuración jamás falla porque el correo no salga.
 * Si falla, queda el rastro en `master.audit_logs`, que es la prueba de verdad;
 * el correo es la NOTIFICACIÓN, no el registro.
 */

import { getMasterModels } from "../db/masterDb.js";
import { sendEmail } from "../email/resendClient.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { cambioConfiguracionTemplate } from "../email/templates/configuracion/cambioAplicado.js";

/** Slug del tenant desde cuya cuenta de correo salen estos avisos. */
const EMISOR = "salamandra_solutions";

/** A dónde escribe el cliente si no reconoce un cambio. */
const CONTACTO = process.env.SOPORTE_EMAIL || "info@salamandrasolutions.com";

/**
 * Credenciales de correo de Salamandra. Devuelve null —con un aviso explícito—
 * si no están puestas: mejor que quede claro en el log que el recibo NO ha
 * salido, a que parezca que sí.
 */
async function credencialesDeSalamandra() {
  const { Tenant } = getMasterModels();
  const emisor = await Tenant.findOne({ where: { slug: EMISOR } });
  if (!emisor) {
    process.stderr.write(`[configuracion:aviso] no existe el tenant "${EMISOR}": no se puede avisar\n`);
    return null;
  }
  const { apiKey, fromEmail, replyTo } = getTenantResendConfig({ tenant: emisor });
  if (!apiKey || !fromEmail) {
    process.stderr.write(
      `[configuracion:aviso] RECIBO NO ENVIADO: a "${EMISOR}" le falta ${!apiKey ? "la clave de Resend" : "el remitente (from)"}. ` +
        `Configúralo en Configuración → Resend. El cambio SÍ ha quedado auditado.\n`
    );
    return null;
  }
  return { apiKey, fromEmail, replyTo };
}

/**
 * @param {object} args
 * @param {object} args.tenant   fila Tenant (id, name, settings)
 * @param {object} args.cambios  { before, after } tal cual se auditó
 * @param {string} [args.autorId] id del usuario que hizo el cambio
 */
/**
 * @param {object} opciones
 * @param {string} [opciones.autorId]  usuario DEL PROPIO CLIENTE que lo hizo
 * @param {string} [opciones.autor]    quién lo hizo cuando no es de su casa
 *
 * `autor` existe desde el 13/08/2026, cuando el back-office pasó a poder poner
 * las credenciales de un cliente. `autorId` se busca entre los usuarios de ESE
 * tenant, así que un cambio hecho por nosotros no casaba con nadie y el recibo
 * salía sin firmar. Un correo que dice «se ha cambiado tu clave de Stripe» sin
 * decir quién, cuando además no ha sido nadie de su equipo, es peor que no
 * mandarlo: no se puede reconocer ni desconocer.
 */
export async function avisarCambioDeConfiguracion({ tenant, cambios, autorId = null, autor: autorFijo = null }) {
  try {
    if (!tenant?.id || !cambios) return { ok: false, motivo: "sin datos" };

    const { User } = getMasterModels();

    // Administradores de ESTE cliente. Son los responsables de la cuenta.
    const admins = await User.findAll({
      where: { tenantId: tenant.id },
      attributes: ["id", "email", "role"],
    });
    const destinatarios = admins
      .filter((u) => u.role === "admin" || u.role === "superadmin")
      .map((u) => u.email)
      .filter(Boolean);

    if (destinatarios.length === 0) {
      process.stderr.write(
        `[configuracion:aviso] ${tenant.slug ?? tenant.id}: nadie a quien avisar (sin admins)\n`
      );
      return { ok: false, motivo: "sin administradores" };
    }

    // Quién lo hizo, por su email. Si no se sabe, el correo lo omite en vez de
    // inventarse un nombre.
    const autor = autorFijo ?? (autorId ? (admins.find((u) => u.id === autorId)?.email ?? null) : null);

    const tpl = cambioConfiguracionTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      before: cambios.before,
      after: cambios.after,
      autor,
      cuando: new Date(),
      contacto: CONTACTO,
    });

    const emisor = await credencialesDeSalamandra();
    if (!emisor) return { ok: false, motivo: "emisor sin configurar" };

    const res = await sendEmail({
      to: destinatarios.join(", "),
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: emisor.fromEmail,
      apiKey: emisor.apiKey,
      replyTo: emisor.replyTo || CONTACTO,
      tags: [{ name: "tipo", value: "configuracion-cambio" }],
    });

    if (!res.ok) {
      process.stderr.write(
        `[configuracion:aviso] ${tenant.slug ?? tenant.id}: no se pudo enviar — ${res.error}\n`
      );
    }
    return { ok: res.ok, destinatarios: destinatarios.length };
  } catch (err) {
    process.stderr.write(`[configuracion:aviso] fallo: ${err.message}\n`);
    return { ok: false, motivo: err.message };
  }
}
