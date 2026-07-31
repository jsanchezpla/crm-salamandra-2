/**
 * Credenciales de Cloudflare Web Analytics POR TENANT.
 *
 * Mismo patrón BYOK que el resto de integraciones del CRM (ver
 * lib/ai/anthropicKey.js): cada cliente trae su propia cuenta de Cloudflare y
 * su propio token, configurados desde Configuración → Integraciones. **NO hay
 * credencial global de entorno**: así el coste, el alcance y la revocación
 * quedan en el lado del cliente, y un token filtrado no expone a los demás.
 *
 * Qué es cada cosa:
 *   · cloudflareApiToken  SECRETO. Token de API con permiso de solo lectura
 *                         «Account Analytics: Read». Se guarda cifrado en
 *                         reposo (lib/crypto/secretBox.js).
 *   · cloudflareAccountId NO es secreto: es el identificador que sale en la URL
 *                         del panel de Cloudflare.
 *   · cloudflareSiteTag   NO es secreto: identifica UN sitio dentro de la
 *                         cuenta. Opcional — sin él se agregan todos los sitios
 *                         de la cuenta, que es lo correcto cuando el cliente
 *                         solo tiene una web.
 *
 * Devuelve siempre un objeto; `configured` dice si se puede consultar de verdad.
 */

import { decryptSecret } from "../crypto/secretBox.js";

// Los identificadores de Cloudflare son hex de 32 caracteres. Se valida aquí
// porque luego se interpolan en la consulta GraphQL: validar el formato es lo
// que hace que esa interpolación sea segura.
const HEX32 = /^[0-9a-f]{32}$/i;

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function getTenantCloudflareConfig(ctx) {
  const integraciones = ctx?.tenant?.settings?.integrations ?? {};

  const accountId = texto(integraciones.cloudflareAccountId);
  const siteTag = texto(integraciones.cloudflareSiteTag);

  let token = null;
  const guardado = integraciones.cloudflareApiToken;
  if (typeof guardado === "string" && guardado.trim()) {
    try {
      token = texto(decryptSecret(guardado)) || null;
    } catch {
      // Sin SETTINGS_ENCRYPTION_KEY o valor corrupto: se trata como no
      // configurado en vez de reventar la pantalla entera.
      token = null;
    }
  }

  const accountIdValido = HEX32.test(accountId);
  const siteTagValido = siteTag === "" || HEX32.test(siteTag);

  return {
    token,
    accountId: accountIdValido ? accountId : null,
    siteTag: siteTagValido && siteTag ? siteTag : null,
    // `siteTag` mal formado no impide consultar (se ignora), pero conviene
    // avisarlo en la pantalla para que nadie crea que está filtrando por sitio.
    siteTagInvalido: siteTag !== "" && !siteTagValido,
    configured: !!(token && accountIdValido),
  };
}
