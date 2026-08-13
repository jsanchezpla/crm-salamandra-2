/**
 * lib/buzon/avisarPorCorreo.js — los dos correos del buzón.
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman el endpoint del cliente y el
 * nuestro, y el remitente se resuelve igual en los dos.)
 *
 * ── DE QUIÉN SALE EL CORREO, QUE ES LO QUE SE HACE MAL ──────────────────────
 * NO con `RESEND_API_KEY` del entorno. En producción está VACÍA —lo cuenta el
 * incidente del 03/08/2026 en `lib/email/resendClient.js`— y con la clave vacía
 * `sendEmail` entra en modo simulacro, devuelve `{ok:true}` y no manda nada. O
 * sea: el aviso se guardaría, el log diría que todo bien, y no nos enteraríamos
 * de nada. Justo el fallo que este trabajo viene a arreglar.
 *
 * Sale con las credenciales de Resend del tenant `salamandra_solutions`, que es
 * el patrón que ya usa `lib/configuracion/avisoCambio.js` para el único otro
 * correo que mandamos NOSOTROS. Y tampoco con la clave del cliente que reporta:
 * le gastaríamos su cuota y su reputación de dominio para un correo nuestro.
 *
 * ── BEST-EFFORT, SIEMPRE ────────────────────────────────────────────────────
 * Ninguna de estas dos funciones puede tumbar la petición. Un aviso guardado y
 * sin correo se ve igual en el buzón; un aviso perdido porque el correo falló no
 * lo recupera nadie. Si no sale, se dice en el log con todas las letras.
 */

import { getMasterModels } from "../db/masterDb.js";
import { sendEmail, envioRealizado } from "../email/resendClient.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { avisoParaNosotros, respuestaParaElCliente } from "../email/templates/buzon/avisoNuevo.js";

/** Slug del tenant desde cuya cuenta de correo salen estos avisos. */
const EMISOR = "salamandra_solutions";

/** A dónde nos llegan. */
const NUESTRO_BUZON = process.env.SOPORTE_EMAIL || "info@salamandrasolutions.com";

/** El host del back-office, para el enlace que nos mandamos a nosotros. */
function baseDelPanel() {
  const h = (process.env.ADMIN_HOST || "").trim();
  if (!h) return "";
  return h.startsWith("localhost") || h.includes(".localhost") ? `http://${h}` : `https://${h}`;
}

async function credencialesDeSalamandra(etiqueta) {
  const { Tenant } = getMasterModels();
  const emisor = await Tenant.findOne({ where: { slug: EMISOR } });
  if (!emisor) {
    process.stderr.write(`[buzon:${etiqueta}] no existe el tenant "${EMISOR}": no se puede avisar\n`);
    return null;
  }
  const { apiKey, fromEmail, replyTo } = getTenantResendConfig({ tenant: emisor });
  if (!apiKey || !fromEmail) {
    process.stderr.write(
      `[buzon:${etiqueta}] CORREO NO ENVIADO: a "${EMISOR}" le falta ${!apiKey ? "la clave de Resend" : "el remitente (from)"}. ` +
        `Configúralo en Configuración → Resend. El aviso SÍ está guardado y se ve en /admin/buzon.\n`
    );
    return null;
  }
  return { apiKey, fromEmail, replyTo };
}

/** Ha entrado un aviso: avisarnos a nosotros. */
export async function avisarnos({ aviso }) {
  try {
    const emisor = await credencialesDeSalamandra("entrada");
    if (!emisor) return { ok: false, motivo: "emisor sin configurar" };

    const panel = baseDelPanel();
    const tpl = avisoParaNosotros({
      aviso,
      url: panel ? `${panel}/admin/buzon` : "el buzón del panel",
    });

    const res = await sendEmail({
      to: NUESTRO_BUZON,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: emisor.fromEmail,
      apiKey: emisor.apiKey,
      // Contestar al correo va DIRECTO a quien escribió. Es lo que convierte
      // este aviso en algo que se puede resolver desde el móvil.
      replyTo: aviso.usuarioEmail || emisor.replyTo || undefined,
      tags: [{ name: "tipo", value: "buzon-entrada" }],
    });

    const { salio, motivo } = envioRealizado(res, "buzon:entrada");
    return { ok: salio, motivo };
  } catch (err) {
    process.stderr.write(`[buzon:entrada] fallo: ${err.message}\n`);
    return { ok: false, motivo: err.message };
  }
}

/** Le hemos contestado: avisarle a él. */
export async function avisarAlCliente({ aviso, mensaje }) {
  try {
    if (!aviso.usuarioEmail) {
      process.stderr.write(`[buzon:respuesta] ${aviso.numero}: sin correo de quien escribió, no se avisa\n`);
      return { ok: false, motivo: "sin destinatario" };
    }

    const emisor = await credencialesDeSalamandra("respuesta");
    if (!emisor) return { ok: false, motivo: "emisor sin configurar" };

    // El correo se pinta con SU marca, que la reconoce de un vistazo. Si el
    // cliente ya no existe, se manda igual con la nuestra: la persona que
    // escribió sigue mereciendo la respuesta.
    const { Tenant } = getMasterModels();
    const suyo = aviso.tenantId ? await Tenant.findByPk(aviso.tenantId) : null;

    const tpl = respuestaParaElCliente({
      aviso,
      mensaje,
      brand: suyo?.settings?.brand,
      tenantName: aviso.tenantNombre || suyo?.name || "Salamandra Solutions",
    });

    const res = await sendEmail({
      to: aviso.usuarioEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: emisor.fromEmail,
      apiKey: emisor.apiKey,
      replyTo: emisor.replyTo || NUESTRO_BUZON,
      tags: [{ name: "tipo", value: "buzon-respuesta" }],
    });

    const { salio, motivo } = envioRealizado(res, "buzon:respuesta");
    return { ok: salio, motivo };
  } catch (err) {
    process.stderr.write(`[buzon:respuesta] fallo: ${err.message}\n`);
    return { ok: false, motivo: err.message };
  }
}
