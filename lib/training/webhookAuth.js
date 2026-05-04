import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifica la firma HMAC SHA256 de un webhook entrante de TutorLMS.
 *
 * El secret se lee en runtime desde `process.env.RETORIKA_WEBHOOK_SECRET`.
 * Si no está configurado, todas las firmas se rechazan y se loggea un
 * aviso ruidoso (una sola vez por proceso) para que el operador lo vea.
 *
 * Formatos aceptados del header de firma:
 *   - "sha256=<hex>"
 *   - "<hex>" (sin prefijo, compatibilidad con plugins antiguos)
 */

let secretMissingLogged = false;

export function verifyHmacSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const secret = process.env.RETORIKA_WEBHOOK_SECRET;
  if (!secret) {
    if (!secretMissingLogged) {
      // eslint-disable-next-line no-console
      console.error(
        "[webhookAuth] RETORIKA_WEBHOOK_SECRET no configurado, webhooks de TutorLMS rechazados"
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
