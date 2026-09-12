/**
 * Fuente ÚNICA de la clave de OpenAI del tenant. La usan dos cosas:
 *   · SIEMPRE, la transcripción de audio de sesiones clínicas con la **API de
 *     Whisper** (voz → texto, `lib/clinica/whisper.js`);
 *   · y desde el 12/09/2026, la REDACCIÓN (registros, informes, actas,
 *     correos…) cuando el tenant elige ChatGPT como proveedor en
 *     Configuración → Conexiones (`lib/ai/proveedorIa.js` → `getTenantIaKey`).
 *     Con Claude elegido, la redacción va por `lib/ai/anthropicKey.js`.
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
