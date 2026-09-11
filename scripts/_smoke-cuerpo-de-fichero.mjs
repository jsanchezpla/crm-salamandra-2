// @prueba ligera
/**
 * _smoke-cuerpo-de-fichero.mjs — el final de una descarga no tumba el proceso
 * (11/09/2026).
 *
 * Seis `uncaughtException` «Invalid state: ReadableStream is already closed»
 * en producción el 10/09/2026, las seis en el segundo en que acababa una
 * descarga de documento. La carrera: Next escribe el último trozo y vuelve a
 * leer (el `pull` espera el EOF del fichero), nginx cierra al tener
 * Content-Length bytes, Next cancela el stream, y entonces llega el EOF y
 * undici cierra un stream ya cerrado desde un microtask sin try/catch.
 *
 * La prueba no lee cómo está escrito el helper: monta esa misma secuencia
 * sobre un fichero de verdad. Primero con `new Response(createReadStream())`
 * en un proceso hijo, que tiene que MORIR con esa frase (el día que deje de
 * morir, undici lo ha arreglado y `cuerpoDeFichero` puede volver a ser un
 * `createReadStream`); después con `cuerpoDeFichero`, en este mismo proceso,
 * donde una excepción no capturada haría fallar la prueba.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { cuerpoDeFichero } from "../lib/utils/cuerpoDeFichero.js";

const TAM = 200 * 1024; // tres trozos de 64 KB y uno de 8: el EOF es una lectura más
const fichero = path.join(os.tmpdir(), `cuerpo-de-fichero-${process.pid}.bin`);
const contenido = Buffer.alloc(TAM, 65);

test.before(() => fs.writeFile(fichero, contenido));
test.after(() => fs.rm(fichero, { force: true }));

/** Lo que hace Next al final de una descarga cuando el cliente cierra antes del EOF. */
async function finalDeDescargaConCierre(cuerpo) {
  const reader = cuerpo.getReader();
  let leidos = 0;
  while (leidos < TAM) {
    const { value, done } = await reader.read();
    if (done) break;
    leidos += value.byteLength;
  }
  const pendiente = reader.read(); // Next vuelve a leer: el pull se queda esperando el EOF
  await new Promise((r) => process.nextTick(r)); // el pull ya está dentro de iterator.next()
  await reader.cancel(); // nginx cerró la conexión: Next cancela el stream
  await pendiente;
  await new Promise((r) => setTimeout(r, 10)); // y ahora llega el EOF
  return leidos;
}

test("CONTROL: con new Response(createReadStream()) el proceso muere con esa frase", () => {
  const codigo = `
    import { createReadStream } from "node:fs";
    const TAM = ${TAM};
    ${finalDeDescargaConCierre.toString()}
    for (let i = 0; i < 20; i++) {
      await finalDeDescargaConCierre(new Response(createReadStream(${JSON.stringify(fichero)})).body);
    }
    console.log("sin fallo");
  `;
  const hijo = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8" });
  assert.notEqual(
    hijo.status,
    0,
    `undici ya cierra protegido: cuerpoDeFichero puede volver a createReadStream.\n${hijo.stdout}${hijo.stderr}`,
  );
  assert.match(hijo.stderr, /ReadableStream is already closed/);
});

test("con cuerpoDeFichero la misma secuencia no lanza nada, 25 veces seguidas", async () => {
  for (let i = 0; i < 25; i++) {
    const leidos = await finalDeDescargaConCierre(cuerpoDeFichero(fichero));
    assert.equal(leidos, TAM);
  }
});

test("una descarga normal entrega el fichero entero, byte a byte", async () => {
  const res = new Response(cuerpoDeFichero(fichero), { headers: { "Content-Length": String(TAM) } });
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), contenido);
});

test("un fichero que no existe rechaza al leer con ENOENT, no revienta el proceso", async () => {
  const res = new Response(cuerpoDeFichero(path.join(os.tmpdir(), "no-existe-seguro.bin")));
  await assert.rejects(res.arrayBuffer(), (e) => e.code === "ENOENT");
});
