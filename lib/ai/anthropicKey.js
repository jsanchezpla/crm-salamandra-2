/**
 * Fuente ÚNICA de la clave de Anthropic (Claude) para TODO el CRM.
 *
 * La clave que se usa es SIEMPRE la que el tenant configura en
 * Configuración → Inteligencia Artificial (`settings.integrations.anthropicApiKey`).
 * Se guarda CIFRADA en reposo (ver lib/crypto/secretBox.js) y aquí se descifra
 * al momento de usarla.
 *
 * **NO se usa `ANTHROPIC_API_KEY` del entorno.** Cada cliente trae la suya (BYOK):
 * así el coste y el control de la cuenta de Anthropic quedan en su lado.
 *
 * Devuelve la clave (string) o `null` si el tenant no la ha configurado o no se
 * puede descifrar (p. ej. falta `SETTINGS_ENCRYPTION_KEY`).
 */

import { decryptSecret } from "../crypto/secretBox.js";

export function getTenantAnthropicKey(ctx) {
  const stored = ctx?.tenant?.settings?.integrations?.anthropicApiKey;
  if (typeof stored !== "string" || !stored.trim()) return null;
  try {
    const key = decryptSecret(stored).trim();
    return key || null;
  } catch {
    return null; // sin SETTINGS_ENCRYPTION_KEY o valor corrupto → no se usa
  }
}
