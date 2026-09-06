import { createHash, createHmac } from "node:crypto";

/**
 * lib/mailing/sigv4.js — firma AWS Signature Version 4, a mano.
 *
 * (Fichero nuevo en /lib, regla #2: el módulo de Mailing habla con Amazon SES
 * y el CRM no lleva el SDK de AWS. Meter `@aws-sdk/client-sesv2` son ~15 MB de
 * node_modules y un `npm ci` largo en cada despliegue para firmar tres
 * peticiones HTTPS. La firma son ochenta líneas de `node:crypto` y no cambia
 * desde 2014; se escribe una vez y se fija con los vectores de prueba
 * oficiales de AWS en `scripts/_smoke-mailing-sigv4.mjs`.)
 *
 * Solo firma lo que el módulo usa: peticiones con cuerpo JSON o sin cuerpo,
 * cabeceras `host`, `x-amz-date` y `content-type` (y `x-amz-content-sha256`
 * si se pide).
 * No firma query strings con caracteres raros ni cabeceras multilínea: no
 * hacen falta para la API v2 de SES.
 *
 * Referencia: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20150830T123600Z` a partir de una fecha. */
export function fechaAmz(fecha = new Date()) {
  return fecha.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Codificación URI de AWS: como encodeURIComponent, pero además codifica los
 * caracteres que JS deja pasar y AWS no (`!'()*`).
 */
function uriEncode(texto) {
  return encodeURIComponent(texto).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** La query string canónica: pares ordenados por clave y codificados. */
function queryCanonica(searchParams) {
  const pares = [];
  for (const [k, v] of searchParams.entries()) pares.push([uriEncode(k), uriEncode(v)]);
  pares.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pares.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * Firma una petición y devuelve las cabeceras a mandar (las de entrada más
 * `x-amz-date`, `x-amz-content-sha256` y `Authorization`).
 *
 * @param {{
 *   method: string, url: string, headers?: Record<string,string>, body?: string,
 *   region: string, service: string, accessKeyId: string, secretAccessKey: string,
 *   sessionToken?: string|null, now?: Date, conHashCuerpo?: boolean,
 * }} p
 */
export function firmarPeticion(p) {
  const url = new URL(p.url);
  const method = String(p.method || "GET").toUpperCase();
  const body = p.body ?? "";
  const ahora = p.now ?? new Date();
  const amzDate = fechaAmz(ahora);
  const fechaCorta = amzDate.slice(0, 8);
  const hashCuerpo = sha256Hex(body);

  // Cabeceras a firmar, en minúsculas y con el valor recortado.
  const cabeceras = {};
  for (const [k, v] of Object.entries(p.headers || {})) {
    cabeceras[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  }
  cabeceras.host = url.host;
  cabeceras["x-amz-date"] = amzDate;
  // El hash del cuerpo en cabecera solo lo exige S3; SES no lo pide y los
  // vectores oficiales de la guía de AWS no lo llevan. Opt-in.
  if (p.conHashCuerpo) cabeceras["x-amz-content-sha256"] = hashCuerpo;
  if (p.sessionToken) cabeceras["x-amz-security-token"] = p.sessionToken;

  const nombres = Object.keys(cabeceras).sort();
  const cabecerasCanonicas = nombres.map((n) => `${n}:${cabeceras[n]}\n`).join("");
  const firmadas = nombres.join(";");

  // La ruta se manda ya normalizada (sin `..`, cada segmento codificado una vez).
  const ruta = url.pathname || "/";
  const peticionCanonica = [
    method,
    ruta,
    queryCanonica(url.searchParams),
    cabecerasCanonicas,
    firmadas,
    hashCuerpo,
  ].join("\n");

  const alcance = `${fechaCorta}/${p.region}/${p.service}/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", amzDate, alcance, sha256Hex(peticionCanonica)].join("\n");

  const kFecha = hmac(`AWS4${p.secretAccessKey}`, fechaCorta);
  const kRegion = hmac(kFecha, p.region);
  const kServicio = hmac(kRegion, p.service);
  const kFirma = hmac(kServicio, "aws4_request");
  const firma = createHmac("sha256", kFirma).update(aFirmar, "utf8").digest("hex");

  const salida = { ...(p.headers || {}) };
  salida["x-amz-date"] = amzDate;
  if (p.conHashCuerpo) salida["x-amz-content-sha256"] = hashCuerpo;
  if (p.sessionToken) salida["x-amz-security-token"] = p.sessionToken;
  salida.Authorization = `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`;

  return { headers: salida, firma, peticionCanonica, aFirmar };
}
