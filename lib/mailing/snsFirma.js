import { createVerify } from "node:crypto";

/**
 * lib/mailing/snsFirma.js — ¿este aviso lo firma de verdad Amazon SNS?
 *
 * (Fichero nuevo en /lib, regla #2: es la puerta del webhook de rebotes y
 * quejas, `app/api/webhooks/ses/[tenantSlug]`, y no tiene nada que ver con
 * mandar correo. Va aparte por el mismo motivo que `whatsapp/webhookAuth.js`.)
 *
 * SES no llama a webhooks: publica los rebotes y las quejas en un tema de SNS
 * y SNS los entrega por HTTPS. Cada entrega llega firmada con la clave privada
 * de Amazon y trae la URL del certificado con el que comprobarla
 * (`SigningCertURL`). Sin esta comprobación, cualquiera que adivine la URL del
 * webhook podría meter «quejas» falsas y vaciar la lista de un cliente.
 *
 * Qué se comprueba, en este orden y fallando en cerrado:
 *   1. Que `SigningCertURL` sea https y de `sns.<región>.amazonaws.com` (o
 *      `.amazonaws.com.cn`). Si no, no se descarga NADA: un atacante podría
 *      señalar a su propio certificado.
 *   2. Que la firma (SHA1withRSA en `SignatureVersion` 1, SHA256withRSA en 2)
 *      cuadre con la cadena canónica que documenta AWS: los campos en orden
 *      alfabético, cada uno como "Nombre\nValor\n".
 *
 * Los certificados se cachean en memoria por URL: SNS rota poco y cada aviso
 * no debería costar una descarga.
 *
 * Referencia: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */

const CAMPOS = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

const HOST_SNS_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

const cacheCertificados = new Map();

/** ¿Es una URL de la que se puede descargar un certificado de SNS? */
export function urlDeCertificadoValida(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && HOST_SNS_RE.test(u.hostname) && u.pathname.endsWith(".pem");
  } catch {
    return false;
  }
}

/** La cadena que Amazon firmó, construida como manda su documentación. */
export function cadenaAFirmar(mensaje) {
  const campos = CAMPOS[mensaje?.Type];
  if (!campos) return null;
  let s = "";
  for (const campo of campos) {
    if (mensaje[campo] === undefined || mensaje[campo] === null) continue; // Subject es opcional
    s += `${campo}\n${mensaje[campo]}\n`;
  }
  return s;
}

async function certificado(url, descargar) {
  if (cacheCertificados.has(url)) return cacheCertificados.get(url);
  const pem = await descargar(url);
  // SNS sirve un certificado X.509; `createVerify` acepta también una clave
  // pública en PEM, que es lo que usan las pruebas (Node no fabrica
  // certificados). Lo que protege no es esta comprobación sino la de la URL.
  if (!pem || !/BEGIN (CERTIFICATE|PUBLIC KEY)/.test(pem)) throw new Error("certificado de SNS ilegible");
  cacheCertificados.set(url, pem);
  return pem;
}

async function descargarPorDefecto(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`certificado de SNS: HTTP ${res.status}`);
  return res.text();
}

/**
 * Comprueba la firma. Devuelve `{ ok: true }` o `{ ok: false, motivo }`.
 * Nunca lanza: el webhook contesta 403 y sigue con su vida.
 *
 * `descargar(url) → Promise<string>` se puede inyectar en las pruebas.
 */
export async function firmaSnsValida(mensaje, { descargar = descargarPorDefecto } = {}) {
  try {
    if (!mensaje || typeof mensaje !== "object") return { ok: false, motivo: "cuerpo vacío" };
    if (!CAMPOS[mensaje.Type]) return { ok: false, motivo: `tipo desconocido: ${mensaje.Type}` };
    if (!mensaje.Signature || !mensaje.SigningCertURL) return { ok: false, motivo: "sin firma" };
    if (!urlDeCertificadoValida(mensaje.SigningCertURL)) {
      return { ok: false, motivo: "SigningCertURL no es de Amazon SNS" };
    }
    const version = String(mensaje.SignatureVersion ?? "1");
    const algoritmo = version === "2" ? "RSA-SHA256" : version === "1" ? "RSA-SHA1" : null;
    if (!algoritmo) return { ok: false, motivo: `SignatureVersion ${version} no soportada` };

    const pem = await certificado(mensaje.SigningCertURL, descargar);
    const verificador = createVerify(algoritmo);
    verificador.update(cadenaAFirmar(mensaje), "utf8");
    const ok = verificador.verify(pem, String(mensaje.Signature), "base64");
    return ok ? { ok: true } : { ok: false, motivo: "la firma no cuadra" };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

/** Solo para las pruebas: vacía la caché de certificados. */
export function _vaciarCacheCertificados() {
  cacheCertificados.clear();
}
