import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifica la firma HMAC SHA256 de un webhook entrante de TutorLMS.
 *
 * SECRETO (renombrado 2026-07-24, pedido por Rodrigo): el nombre canónico es
 * `CRM_WEBHOOK_SECRET` — universal, el MISMO nombre que usa el define() de
 * wp-config.php en los WordPress conectados. El nombre viejo
 * `RETORIKA_WEBHOOK_SECRET` (de cuando solo Retorika usaba el puente) se
 * sigue aceptando como fallback para no romper nada durante la transición.
 *
 * Si no hay ninguno configurado, todas las firmas se rechazan y se loggea un
 * aviso ruidoso (una sola vez por proceso) para que el operador lo vea.
 *
 * Formatos aceptados del header de firma:
 *   - "sha256=<hex>"
 *   - "<hex>" (sin prefijo, compatibilidad con plugins antiguos)
 */

let secretMissingLogged = false;

export function verifyHmacSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const secret = process.env.CRM_WEBHOOK_SECRET || process.env.RETORIKA_WEBHOOK_SECRET;
  if (!secret) {
    if (!secretMissingLogged) {
      // eslint-disable-next-line no-console
      console.error(
        "[webhookAuth] CRM_WEBHOOK_SECRET no configurado (ni el legacy RETORIKA_WEBHOOK_SECRET), webhooks de TutorLMS rechazados"
      );
      secretMissingLogged = true;
    }
    return false;
  }

  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
