/**
 * secretBox — cifrado en reposo de secretos por-tenant (API keys de IA).
 *
 * AES-256-GCM (cifrado autenticado: detecta manipulación). La clave de cifrado
 * es un SECRETO DEL SERVIDOR (`SETTINGS_ENCRYPTION_KEY`, en el .env), que NUNCA
 * está en la base de datos. Así, un dump o backup de la BD contiene solo texto
 * cifrado inútil sin esa clave.
 *
 * Formato almacenado:  enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 * (base64 estándar no usa ":", así que separar por ":" es seguro).
 *
 * Compatibilidad hacia atrás:
 *   · Si `SETTINGS_ENCRYPTION_KEY` NO está configurada, `encryptSecret` devuelve
 *     el texto EN CLARO (con aviso por stderr): el sistema sigue funcionando,
 *     pero SIN cifrado. Hay que poner la env var para que cifre de verdad.
 *   · `decryptSecret` sobre un valor que NO empieza por "enc:v1:" lo devuelve tal
 *     cual (claves antiguas en claro siguen leyéndose sin romper nada).
 */

import crypto from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

// Deriva una clave de 32 bytes del secreto del entorno (SHA-256). El secreto
// debe ser un valor aleatorio fuerte (ver .env.production.example).
function deriveKey() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret || !secret.trim()) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function isEncrypted(stored) {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * ¿Hay clave de cifrado configurada? Para que quien vaya a guardar un secreto
 * pueda comprobarlo ANTES y dar un error entendible, en vez de descubrir el
 * problema cuando ya está escrito en claro en la base de datos.
 */
export function isEncryptionConfigured() {
  return deriveKey() !== null;
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext === "") return plaintext;
  const key = deriveKey();
  if (!key) {
    // En PRODUCCIÓN no se degrada. Guardar una API key de pagos en claro es peor
    // que fallar: el fallo se ve y se arregla, el texto plano no se ve y se
    // queda en cada backup. En local sí se degrada (con aviso) para no obligar a
    // configurar la variable solo para levantar el entorno.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SETTINGS_ENCRYPTION_KEY no configurada: no se puede guardar un secreto cifrado"
      );
    }
    process.stderr.write(
      "[secretBox] SETTINGS_ENCRYPTION_KEY no configurada: el secreto se guarda SIN cifrar.\n"
    );
    return plaintext; // degradación SOLO fuera de producción
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored) {
  if (!isEncrypted(stored)) return stored; // en claro (legado) o vacío: tal cual
  const key = deriveKey();
  if (!key) {
    throw new Error("SETTINGS_ENCRYPTION_KEY no configurada: no se puede descifrar el secreto");
  }
  const [, , ivB64, tagB64, ctB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
