// @prueba ligera
/**
 * _smoke-mailing-tokens-sns.mjs — los tokens de los enlaces del mailing
 * (`lib/mailing/bajaToken.js`) y la firma de los avisos de SNS
 * (`lib/mailing/snsFirma.js`), 06/09/2026.
 *
 * Fija lo que DEVUELVEN: un token de baja abre solo en el cliente que lo
 * firmó, una letra cambiada lo invalida, el correo se normaliza antes de
 * firmar (mayúsculas y espacios no dan tokens distintos), y el webhook no
 * descarga certificados de fuera de Amazon ni acepta firmas que no cuadran.
 * La firma buena se comprueba con un par de claves RSA generado en la propia
 * prueba: no hace falta hablar con AWS.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";

process.env.MAILING_TOKEN_SECRET = "secreto-de-pruebas";
const tokens = await import(pathToFileURL(resolve("lib/mailing/bajaToken.js")).href);
const sns = await import(pathToFileURL(resolve("lib/mailing/snsFirma.js")).href);

test("baja: ida y vuelta, normalizando el correo", () => {
  const t = tokens.tokenDeBaja("aumenta", "  Ana@Centro.COM ");
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", t), "ana@centro.com");
  assert.equal(tokens.tokenDeBaja("aumenta", "ana@centro.com"), t);
});

test("baja: otro cliente, otra firma; un carácter cambiado, token inválido", () => {
  const t = tokens.tokenDeBaja("aumenta", "ana@centro.com");
  assert.equal(tokens.emailDeTokenDeBaja("nutri_laura", t), null);
  const roto = t.slice(0, -1) + (t.endsWith("a") ? "b" : "a");
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", roto), null);
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", "basura"), null);
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", ""), null);
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", null), null);
});

test("baja y confirmación no son intercambiables", () => {
  const t = tokens.tokenDeConfirmacion("aumenta", "ana@centro.com");
  assert.equal(tokens.emailDeTokenDeConfirmacion("aumenta", t), "ana@centro.com");
  assert.equal(tokens.emailDeTokenDeBaja("aumenta", t), null);
});

test("clic: lleva el envío y el índice del enlace", () => {
  const t = tokens.tokenDeClic("demo", "5b1a0a5e-0000-4000-8000-000000000001", 3);
  assert.deepEqual(tokens.datosDeTokenDeClic("demo", t), { sendId: "5b1a0a5e-0000-4000-8000-000000000001", indice: 3 });
  assert.equal(tokens.datosDeTokenDeClic("otro", t), null);
});

test("envío: el token del píxel devuelve el id del envío", () => {
  const t = tokens.tokenDeEnvio("demo", "abc");
  assert.equal(tokens.sendIdDeToken("demo", t), "abc");
  assert.equal(tokens.sendIdDeToken("demo", t + "x"), null);
});

test("sns: solo se descargan certificados https de sns.<región>.amazonaws.com", () => {
  assert.equal(sns.urlDeCertificadoValida("https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem"), true);
  assert.equal(sns.urlDeCertificadoValida("https://sns.cn-north-1.amazonaws.com.cn/x.pem"), true);
  assert.equal(sns.urlDeCertificadoValida("http://sns.eu-west-1.amazonaws.com/x.pem"), false);
  assert.equal(sns.urlDeCertificadoValida("https://sns.eu-west-1.amazonaws.com.evil.com/x.pem"), false);
  assert.equal(sns.urlDeCertificadoValida("https://evil.com/sns.eu-west-1.amazonaws.com/x.pem"), false);
  assert.equal(sns.urlDeCertificadoValida("https://sns.eu-west-1.amazonaws.com/x.txt"), false);
});

test("sns: la cadena a firmar sigue el orden y omite Subject si no viene", () => {
  const s = sns.cadenaAFirmar({ Type: "Notification", Message: "m", MessageId: "id", Timestamp: "t", TopicArn: "arn" });
  assert.equal(s, "Message\nm\nMessageId\nid\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
  assert.equal(sns.cadenaAFirmar({ Type: "Raro" }), null);
});

// ── Una firma de verdad, con un par RSA hecho aquí mismo ────────────────────
// Node no fabrica certificados X.509; `createVerify` acepta la clave pública
// en PEM, y el módulo la admite justo para esto (lo que protege es la URL).
let clavePrivada;
let pem;
before(() => {
  const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
  clavePrivada = par.privateKey;
  pem = par.publicKey.export({ type: "spki", format: "pem" });
});

function mensajeFirmado(campos, version = "1") {
  const m = { ...campos, SignatureVersion: version, SigningCertURL: "https://sns.eu-west-1.amazonaws.com/cert.pem" };
  const firmador = createSign(version === "2" ? "RSA-SHA256" : "RSA-SHA1");
  firmador.update(sns.cadenaAFirmar(m), "utf8");
  m.Signature = firmador.sign(clavePrivada, "base64");
  return m;
}


test("sns: una notificación bien firmada pasa (v1 y v2), y una alterada no", async () => {
  sns._vaciarCacheCertificados();
  const base = { Type: "Notification", Message: '{"notificationType":"Bounce"}', MessageId: "1", Timestamp: "2026-09-06T10:00:00Z", TopicArn: "arn:aws:sns:eu-west-1:1:t" };
  const descargarClave = async () => pem;
  const v1 = mensajeFirmado(base, "1");
  const r1 = await sns.firmaSnsValida(v1, { descargar: descargarClave });
  assert.equal(r1.ok, true, r1.motivo);
  sns._vaciarCacheCertificados();
  const v2 = mensajeFirmado(base, "2");
  const r2 = await sns.firmaSnsValida(v2, { descargar: descargarClave });
  assert.equal(r2.ok, true, r2.motivo);
  const alterado = { ...v2, Message: '{"notificationType":"Complaint"}' };
  const r3 = await sns.firmaSnsValida(alterado, { descargar: descargarClave });
  assert.equal(r3.ok, false);
  assert.match(r3.motivo, /no cuadra/);
});

test("sns: sin firma, con URL ajena o con tipo raro se rechaza sin descargar nada", async () => {
  let descargas = 0;
  const contar = async () => {
    descargas++;
    return pem;
  };
  assert.equal((await sns.firmaSnsValida(null, { descargar: contar })).ok, false);
  assert.equal((await sns.firmaSnsValida({ Type: "Notification" }, { descargar: contar })).ok, false);
  const ajena = { Type: "Notification", Message: "m", MessageId: "1", Timestamp: "t", TopicArn: "a", Signature: "x", SigningCertURL: "https://evil.com/c.pem" };
  const r = await sns.firmaSnsValida(ajena, { descargar: contar });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Amazon SNS/);
  assert.equal(descargas, 0);
});
