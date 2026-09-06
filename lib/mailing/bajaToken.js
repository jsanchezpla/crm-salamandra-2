import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * lib/mailing/bajaToken.js — los tokens de los enlaces que van DENTRO de un
 * correo de mailing: la baja, la confirmación de alta, el clic y la apertura.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el render del correo —que
 * escribe los enlaces— y los endpoints públicos —que los leen—. Si cada lado
 * derivara el token a su manera, el primer cambio dejaría sin baja a todos los
 * correos ya enviados.)
 *
 * ── POR QUÉ SE DERIVAN Y NO SE GUARDAN ──────────────────────────────────────
 * Mismo criterio que `lib/whatsapp/webhookAuth.js`: un token que se calcula
 * con HMAC del secreto del servidor no necesita tabla, no caduca cuando se
 * poda una tabla, y se puede volver a calcular para cualquier correo enviado
 * hace un año. La baja tiene que funcionar SIEMPRE: es ley (LSSI/RGPD) y
 * política de AWS.
 *
 *     baja      = base64url(email) . HMAC(secreto, "baja:<slug>:<email>")
 *     confirmar = base64url(email) . HMAC(secreto, "confirmar:<slug>:<email>")
 *     clic      = base64url(JSON{s: sendId, u: urlIndex}) . HMAC(secreto, "clic:<slug>:<json>")
 *     abierto   = base64url(sendId) . HMAC(secreto, "abierto:<slug>:<sendId>")
 *
 * El correo va en claro (base64url) porque hace falta recuperarlo: la
 * supresión se apunta por dirección, y la baja tiene que funcionar aunque la
 * fila de `mailing_sends` se haya borrado. Lo que impide fabricar una baja
 * ajena es la firma, no el ocultamiento.
 *
 * El secreto es `MAILING_TOKEN_SECRET`; si no está puesto se cae a
 * `SETTINGS_ENCRYPTION_KEY` para que el módulo funcione en local sin tocar el
 * .env, con el aviso escrito en `.env.production.example`: rotar cualquiera de
 * los dos invalida los enlaces de los correos ya enviados.
 */

function secreto() {
  const s = process.env.MAILING_TOKEN_SECRET || process.env.SETTINGS_ENCRYPTION_KEY;
  if (!s) throw new Error("MAILING_TOKEN_SECRET no configurado");
  return s;
}

function b64url(texto) {
  return Buffer.from(String(texto), "utf8").toString("base64url");
}

function desdeB64url(texto) {
  try {
    return Buffer.from(String(texto), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function firmar(proposito, slug, carga) {
  return createHmac("sha256", secreto()).update(`${proposito}:${slug}:${carga}`).digest("hex").slice(0, 32);
}

function igualesSeguro(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Correo normalizado para firmar y para comparar: minúsculas y sin espacios. */
export function normalizarEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function construir(proposito, slug, carga) {
  return `${b64url(carga)}.${firmar(proposito, slug, carga)}`;
}

/** Devuelve la carga si la firma cuadra; `null` si no. */
function abrir(proposito, slug, token) {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const carga = desdeB64url(partes[0]);
  if (carga == null) return null;
  let esperada;
  try {
    esperada = firmar(proposito, slug, carga);
  } catch {
    return null; // sin secreto no se valida nada
  }
  return igualesSeguro(esperada, partes[1]) ? carga : null;
}

// ── Baja ────────────────────────────────────────────────────────────────────
export function tokenDeBaja(slug, email) {
  return construir("baja", slug, normalizarEmail(email));
}
/** El correo que se da de baja, o `null` si el token no es de este cliente. */
export function emailDeTokenDeBaja(slug, token) {
  const email = abrir("baja", slug, token);
  return email && email.includes("@") ? email : null;
}

// ── Confirmación de alta (doble opt-in de los correos sueltos) ──────────────
export function tokenDeConfirmacion(slug, email) {
  return construir("confirmar", slug, normalizarEmail(email));
}
export function emailDeTokenDeConfirmacion(slug, token) {
  const email = abrir("confirmar", slug, token);
  return email && email.includes("@") ? email : null;
}

// ── Clic (redirección con medición) ─────────────────────────────────────────
/** `indice` es la posición del enlace dentro del correo (0, 1, 2…). */
export function tokenDeClic(slug, sendId, indice) {
  return construir("clic", slug, JSON.stringify({ s: String(sendId), u: Number(indice) || 0 }));
}
/** `{ sendId, indice }` o `null`. */
export function datosDeTokenDeClic(slug, token) {
  const carga = abrir("clic", slug, token);
  if (!carga) return null;
  try {
    const j = JSON.parse(carga);
    if (!j?.s) return null;
    return { sendId: String(j.s), indice: Number(j.u) || 0 };
  } catch {
    return null;
  }
}

// ── Apertura (el píxel) y «ver en el navegador» ─────────────────────────────
export function tokenDeEnvio(slug, sendId) {
  return construir("abierto", slug, String(sendId));
}
export function sendIdDeToken(slug, token) {
  return abrir("abierto", slug, token);
}
