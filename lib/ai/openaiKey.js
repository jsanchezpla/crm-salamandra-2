/**
 * Fuente ÚNICA de la clave de OpenAI del tenant. Se usa SOLO para la transcripción
 * de audio de sesiones clínicas con la **API de Whisper de OpenAI** (voz → texto);
 * la estructuración/resumen posterior la hace Claude (ver lib/ai/anthropicKey.js).
 *
 * La clave la configura el tenant en Configuración → Inteligencia Artificial
 * (`settings.integrations.openaiApiKey`). Se guarda CIFRADA en reposo
 * (lib/crypto/secretBox.js) y aquí se descifra al momento de usarla. BYOK: no hay
 * `OPENAI_API_KEY` de entorno; cada cliente trae la suya.
 *
 * Devuelve la clave (string) o `null` si no está configurada o no se puede
 * descifrar (p. ej. falta `SETTINGS_ENCRYPTION_KEY`).
 */

import { decryptSecret } from "../crypto/secretBox.js";

export function getTenantOpenAIKey(ctx) {
  const stored = ctx?.tenant?.settings?.integrations?.openaiApiKey;
  if (typeof stored !== "string" || !stored.trim()) return null;
  try {
    const key = decryptSecret(stored).trim();
    return key || null;
  } catch {
    return null; // sin SETTINGS_ENCRYPTION_KEY o valor corrupto → no se usa
  }
}
