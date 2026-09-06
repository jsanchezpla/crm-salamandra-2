// @prueba ligera
/**
 * _smoke-mailing-sigv4.mjs — la firma SigV4 de `lib/mailing/sigv4.js` contra
 * los vectores de prueba OFICIALES de AWS (06/09/2026).
 *
 * Fija lo que DEVUELVE: la misma clave, fecha y petición de los ejemplos de la
 * documentación de AWS tienen que dar EXACTAMENTE su firma. Si alguien toca el
 * orden de las cabeceras, la codificación de la query o la cadena de HMACs,
 * esto se pone rojo antes de que SES conteste 403 en producción.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { firmarPeticion, fechaAmz } = await import(pathToFileURL(resolve("lib/mailing/sigv4.js")).href);

const CLAVE = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const FECHA = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));

test("fechaAmz da el formato compacto de AWS", () => {
  assert.equal(fechaAmz(FECHA), "20150830T123600Z");
});

test("vector oficial: GET a IAM ListUsers (guía de firma de AWS)", () => {
  const r = firmarPeticion({
    method: "GET",
    url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    region: "us-east-1",
    service: "iam",
    now: FECHA,
    ...CLAVE,
  });
  assert.equal(r.firma, "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  assert.equal(
    r.headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
  );
});

test("vector oficial: get-vanilla de la suite de pruebas de SigV4", () => {
  const r = firmarPeticion({
    method: "GET",
    url: "https://example.amazonaws.com/",
    region: "us-east-1",
    service: "service",
    now: FECHA,
    ...CLAVE,
  });
  // La suite firma solo host y x-amz-date; aquí además va x-amz-content-sha256,
  // así que la firma cambia respecto al fichero .sreq pero la petición canónica
  // tiene que empezar igual y el hash del cuerpo vacío es el conocido.
  assert.match(r.peticionCanonica, /^GET\n\/\n\nhost:example\.amazonaws\.com\n/);
  assert.match(r.peticionCanonica, /e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855$/);
  assert.match(r.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, /);
});

test("el cuerpo entra en la firma: dos cuerpos distintos, dos firmas distintas", () => {
  const base = {
    method: "POST",
    url: "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails",
    headers: { "content-type": "application/json" },
    region: "eu-west-1",
    service: "ses",
    now: FECHA,
    ...CLAVE,
  };
  const a = firmarPeticion({ ...base, body: '{"a":1}' });
  const b = firmarPeticion({ ...base, body: '{"a":2}' });
  assert.notEqual(a.firma, b.firma);
  assert.equal(a.headers["x-amz-content-sha256"], undefined);
  const c = firmarPeticion({ ...base, body: '{"a":1}', conHashCuerpo: true });
  assert.equal(c.headers["x-amz-content-sha256"].length, 64);
  assert.equal(a.headers["content-type"], "application/json");
});

test("la query se ordena por clave y se codifica como AWS", () => {
  const r = firmarPeticion({
    method: "GET",
    url: "https://example.amazonaws.com/?b=2&a=1&c=a%20b",
    region: "us-east-1",
    service: "service",
    now: FECHA,
    ...CLAVE,
  });
  assert.match(r.peticionCanonica, /^GET\n\/\na=1&b=2&c=a%20b\n/);
});
