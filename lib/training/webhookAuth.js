import { createHmac, timingSafeEqual } from "crypto";
import { resolveRequestSlug } from "../tenant/tenantResolver.js";

/**
 * Verifica la firma HMAC SHA256 de un webhook entrante de TutorLMS.
 *
 * ── SECRETO POR TENANT (2026-07-26) ────────────────────────────────────────
 * Antes había UN único secreto global para todos los WordPress conectados. El
 * problema: el tenant destino se elige con la cabecera `x-tenant` (la pone quien
 * llama) y la firma NO lo cubría, así que cualquiera que tuviera el secreto
 * podía escribir en CUALQUIER tenant con el módulo training activo. Con dos
 * clientes conectados (Retorika y nutri_laura) eso significaba darle a cada uno
 * una llave que también abre los datos del otro.
 *
 * Ahora la firma se valida contra el secreto DEL TENANT al que la petición dice
 * ir, declarado como JSON por slug:
 *
 *   CRM_WEBHOOK_SECRETS={"retorika":"<hex 32B>","nutri_laura":"<otro hex 32B>"}
 *
 * Así la firma demuestra "tengo la llave del tenant que digo ser": una petición
 * firmada con el secreto de A pero con `x-tenant: B` se rechaza con 401.
 *
 * ── FALLBACK DE TRANSICIÓN ─────────────────────────────────────────────────
 * Si el tenant no tiene entrada propia en CRM_WEBHOOK_SECRETS se usa el global
 * `CRM_WEBHOOK_SECRET` (o el legacy `RETORIKA_WEBHOOK_SECRET`), para no romper a
 * los WordPress que aún no han migrado. Las entradas por-tenant tienen
 * PRECEDENCIA, así que migrar un tenant lo aísla al instante aunque los demás
 * sigan en el global. Cuando todos tengan el suyo, borrar el global.
 *
 * El slug se resuelve con `resolveRequestSlug`, la MISMA función que usa
 * `getTenantContext` para decidir en qué schema se escribe. Es deliberado: si
 * ambas resoluciones divergieran, se podría firmar como un tenant y acabar
 * escribiendo en otro.
 *
 * Formatos aceptados del header de firma:
 *   - "sha256=<hex>"
 *   - "<hex>" (sin prefijo, compatibilidad con plugins antiguos)
 *
 * NOMBRE: se llama `verifyWebhookSignature` (antes `verifyHmacSignature`) porque
 * al pasar a async un llamante que olvidara el `await` recibiría una Promise, y
 * `!promise` es `false` → habría dejado pasar CUALQUIER firma. Con el nombre
 * nuevo, un llamante sin actualizar peta en vez de abrir un bypass silencioso.
 */

let cachedSecrets = null;
let parseErrorLogged = false;
let secretMissingLogged = false;

function secretsMap() {
  if (cachedSecrets) return cachedSecrets;
  const raw = process.env.CRM_WEBHOOK_SECRETS;
  if (!raw) {
    cachedSecrets = new Map();
    return cachedSecrets;
  }
  try {
    cachedSecrets = new Map(Object.entries(JSON.parse(raw)));
  } catch {
    if (!parseErrorLogged) {
      console.error("[webhookAuth] CRM_WEBHOOK_SECRETS no es JSON válido; se ignora (se usará el secreto global)");
      parseErrorLogged = true;
    }
    cachedSecrets = new Map();
  }
  return cachedSecrets;
}

/**
 * Secreto aplicable a `slug`. Devuelve `{ secret, perTenant }`; `secret` es null
 * si no hay ninguno configurado.
 */
export function webhookSecretFor(slug) {
  const propio = slug ? secretsMap().get(slug) : null;
  if (typeof propio === "string" && propio.length > 0) {
    return { secret: propio, perTenant: true };
  }
  const global = process.env.CRM_WEBHOOK_SECRET || process.env.RETORIKA_WEBHOOK_SECRET;
  return { secret: global || null, perTenant: false };
}

/**
 * @param {string} rawBody        cuerpo crudo (o querystring) que se firmó
 * @param {string} signatureHeader valor de la cabecera x-retorika-signature
 * @param {Request} request        la request entrante (para saber a qué tenant dice ir)
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(rawBody, signatureHeader, request) {
  if (!signatureHeader) return false;

  const slug = request ? await resolveRequestSlug(request) : null;
  const { secret } = webhookSecretFor(slug);

  if (!secret) {
    if (!secretMissingLogged) {
      console.error(
        "[webhookAuth] Sin secreto de webhooks (ni CRM_WEBHOOK_SECRETS por tenant ni CRM_WEBHOOK_SECRET global); webhooks de TutorLMS rechazados"
      );
      secretMissingLogged = true;
    }
    return false;
  }

  const signature = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
