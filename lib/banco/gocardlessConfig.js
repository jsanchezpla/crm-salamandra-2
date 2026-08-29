/**
 * Config del banco del tenant (BYOK) — mismo patrón que `lib/payments/stripeConfig.js`.
 *
 * El banco es del CLIENTE, así que la cuenta de GoCardless Bank Account Data es
 * SUYA: se crea gratis en bankaccountdata.gocardless.com y da acceso PSD2 de
 * SOLO LECTURA a los movimientos (no puede mover dinero: leer no es pagar).
 * No hay fallback al `.env`: sin credenciales del tenant, no hay banco.
 *
 * Claves en `tenant.settings.integrations`:
 *   · gocardlessSecretId  (a la vista) — identifica el par; solo no abre nada
 *   · gocardlessSecretKey (cifrada, AES-256-GCM vía lib/crypto/secretBox.js)
 */

import { decryptSecret } from "../crypto/secretBox.js";

export function getTenantGocardlessConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  const secretId = typeof integ.gocardlessSecretId === "string" ? integ.gocardlessSecretId.trim() || null : null;

  let secretKey = null;
  if (typeof integ.gocardlessSecretKey === "string" && integ.gocardlessSecretKey.trim()) {
    try {
      secretKey = decryptSecret(integ.gocardlessSecretKey).trim() || null;
    } catch {
      // Igual que en Stripe: si no se puede DESCIFRAR (clave de cifrado rotada),
      // a efectos prácticos no está configurado. Decir «listo» mientras todas
      // las llamadas fallan sería peor.
      secretKey = null;
    }
  }

  return { secretId, secretKey, configured: !!secretId && !!secretKey };
}

export function tenantTieneBanco(ctx) {
  return getTenantGocardlessConfig(ctx).configured;
}
