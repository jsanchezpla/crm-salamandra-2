// @prueba ligera
/**
 * _smoke-multipart.mjs — el cuerpo que sale hacia Whisper (08/09/2026).
 *
 * Es la vía por la que la reina del módulo clínico transcribe: si el cuerpo
 * saliera mal NO se rompería una transcripción de cada diez, se romperían las
 * diez. Por eso la prueba no mira cómo está escrito el código: arma el cuerpo y
 * se lo hace PARSEAR AL PROPIO MOTOR, que es el mismo que lo va a leer al otro
 * lado. Si vuelve entero, OpenAI no puede notar la diferencia.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { cuerpoMultipart } from "../lib/utils/multipart.js";

/** Lo que se manda, leído de vuelta con el mismo motor. */
async function deVuelta(form) {
  const { contentType, cuerpo } = await cuerpoMultipart(form);
  const leido = await new Response(cuerpo, { headers: { "content-type": contentType } }).formData();
  return { contentType, cuerpo, leido };
}

/** Los cuatro campos exactos que manda `transcribeAudio`. */
function formDeWhisper(fichero) {
  const form = new FormData();
  form.append("file", fichero, fichero.name || "audio");
  form.append("model", "whisper-1");
  form.append("language", "es");
  form.append("response_format", "verbose_json");
  return form;
}

test("los cuatro campos de Whisper vuelven enteros, y el audio byte a byte", async () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 250, 251, 252]);
  const audio = new File([bytes], "nota.m4a", { type: "audio/mp4" });
  const { leido } = await deVuelta(formDeWhisper(audio));

  assert.equal(leido.get("model"), "whisper-1");
  assert.equal(leido.get("language"), "es");
  assert.equal(leido.get("response_format"), "verbose_json");

  const vuelto = leido.get("file");
  assert.equal(vuelto.name, "nota.m4a");
  assert.equal(vuelto.type, "audio/mp4");
  assert.deepEqual(new Uint8Array(await vuelto.arrayBuffer()), bytes);
});

test("el Content-Type lleva la linde CON LA QUE se armó el cuerpo", async () => {
  // Si se separaran, el parser del otro lado no encontraría nada y la petición
  // moriría con un 400 de formato.
  const { contentType, cuerpo } = await cuerpoMultipart(formDeWhisper(new File([new Uint8Array([1])], "a.m4a")));
  const linde = /boundary=(.+)$/.exec(contentType)?.[1];
  assert.ok(linde, contentType);
  assert.match(contentType, /^multipart\/form-data; boundary=/);
  assert.ok(new TextDecoder().decode(cuerpo).includes(`--${linde}`), "la linde del cuerpo no es la del Content-Type");
});

test("CASO FEO: un nombre de fichero con comillas, punto y coma y un salto de línea", async () => {
  /*
   * Es lo que llega de WhatsApp o de un renombrado a mano. La comilla y el
   * salto NO pueden partir la cabecera ni abrir una linde falsa. Y lo que se
   * comprueba es la IDENTIDAD —vuelve exactamente igual—, no que se vea `%22`:
   * los escapes están en los BYTES, y el parser los deshace al leer.
   */
  const feo = 'Nota de voz "Ángela"; 12/09\r\n.m4a';
  const audio = new File([new Uint8Array([9, 9, 9])], feo, { type: "audio/mp4" });
  const { leido } = await deVuelta(formDeWhisper(audio));

  const vuelto = leido.get("file");
  assert.equal(vuelto.name, feo);
  assert.equal(leido.get("model"), "whisper-1", "el salto de línea ha partido el cuerpo");
  assert.deepEqual(new Uint8Array(await vuelto.arrayBuffer()), new Uint8Array([9, 9, 9]));
});

test("un audio que lleva dentro la pinta de una cabecera multipart no confunde al parser", async () => {
  const veneno = new TextEncoder().encode(
    '\r\n------\r\nContent-Disposition: form-data; name="model"\r\n\r\nrobado\r\n',
  );
  const audio = new File([veneno], "trampa.m4a", { type: "audio/mp4" });
  const { leido } = await deVuelta(formDeWhisper(audio));

  assert.equal(leido.get("model"), "whisper-1", "el contenido del audio ha pisado un campo");
  assert.deepEqual(new Uint8Array(await leido.get("file").arrayBuffer()), veneno);
});

test("un audio de 0 bytes sigue produciendo un cuerpo válido", async () => {
  // Quien decide que un audio vacío no vale es OpenAI, no esta función.
  const { leido } = await deVuelta(formDeWhisper(new File([], "vacio.m4a", { type: "audio/mp4" })));
  assert.equal(leido.get("file").size, 0);
  assert.equal(leido.get("model"), "whisper-1");
});

test("sin idioma van tres campos y no cuatro", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1])], "a.m4a"), "a.m4a");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const { leido } = await deVuelta(form);
  assert.equal(leido.get("language"), null);
  assert.equal(leido.get("response_format"), "verbose_json");
});

test("dos cuerpos seguidos no comparten linde", async () => {
  const a = await cuerpoMultipart(formDeWhisper(new File([new Uint8Array([1])], "a.m4a")));
  const b = await cuerpoMultipart(formDeWhisper(new File([new Uint8Array([1])], "a.m4a")));
  assert.notEqual(a.contentType, b.contentType);
});

test("lo que se manda es un Uint8Array, que es de lo que va todo esto", async () => {
  // Si volviera a viajar un stream, la carrera de undici seguiría ahí y la
  // prueba de arriba no lo notaría: el cuerpo se leería igual de bien.
  const { cuerpo } = await cuerpoMultipart(formDeWhisper(new File([new Uint8Array([1])], "a.m4a")));
  assert.ok(cuerpo instanceof Uint8Array, typeof cuerpo);
});
