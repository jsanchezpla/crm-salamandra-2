import { SignJWT, jwtVerify } from "jose";

/**
 * Token del enlace "vuelve a meter tu tarjeta".
 *
 * Cuando una retención caduca o el banco rechaza el cobro, la profesional puede
 * pedirle al paciente la tarjeta otra vez. Ese correo lleva un enlace, y el
 * enlace necesita identificar la cita SIN pedirle que se registre en ningún
 * sitio: mucha gente reserva sin tener cuenta.
 *
 * ── POR QUÉ UN TOKEN FIRMADO Y NO UNA COLUMNA ────────────────────────────────
 * La alternativa era guardar un `paymentToken` en la tabla, pero eso significa
 * otra migración en todos los tenants para un dato que no hace falta persistir:
 * lo único que tiene que probar el enlace es "quien lo tiene puede pagar ESTA
 * cita, y solo durante unos días". Un JWT firmado hace exactamente eso y caduca
 * solo, sin dejar nada que limpiar.
 *
 * Tampoco se reutiliza `cancellationToken`. Es de otra cosa: un enlace para
 * pagar no debería servir para cancelar. Que las dos acciones sean del paciente
 * no las hace la misma llave.
 *
 * Mismo secreto que el portal (`CITAS_PORTAL_SESSION_SECRET`) pero con **scope
 * distinto**, que es lo que impide que un token de un sitio valga en el otro.
 *
 * TTL de 7 días: lo que dura una retención. Más allá, el enlace debería ser uno
 * nuevo pedido a propósito, no uno viejo que sigue vivo en una bandeja.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */

const SCOPE = "citas-pagar";
const TTL = "7d";

function getKey() {
  const secret = process.env.CITAS_PORTAL_SESSION_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/** Firma el enlace de pago de una cita concreta. */
export async function firmarTokenPago({ bookingId, tenant }) {
  const key = getKey();
  if (!key) {
    const err = new Error("SECRETO_AUSENTE");
    err.code = "SECRETO_AUSENTE";
    throw err;
  }
  return new SignJWT({ bookingId, tenant, scope: SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

/**
 * Verifica el token para `slug`. Devuelve `{ bookingId }`.
 *
 * `algorithms: ["HS256"]` explícito: sin él, un token con `alg: none` pasaría la
 * verificación sin firma ninguna.
 */
export async function verificarTokenPago(token, slug) {
  const key = getKey();
  const fallo = () => {
    const err = new Error("TOKEN_INVALIDO");
    err.code = "TOKEN_INVALIDO";
    return err;
  };
  if (!key || !token) throw fallo();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ["HS256"] }));
  } catch {
    throw fallo();
  }
  if (payload?.scope !== SCOPE) throw fallo();
  if (payload?.tenant !== slug) throw fallo();
  if (!payload?.bookingId) throw fallo();
  return { bookingId: String(payload.bookingId) };
}
