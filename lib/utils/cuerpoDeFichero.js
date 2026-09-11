/**
 * lib/utils/cuerpoDeFichero.js — un fichero del disco como cuerpo de una
 * `Response`, sin que el FINAL de la descarga tumbe el proceso (11/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * `docker logs` de producción del 10/09/2026: seis `uncaughtException` con
 * «TypeError: Invalid state: ReadableStream is already closed» y ninguna traza
 * útil («at ignore-listed frames»). Salieron con el arreglo de
 * `multipart.js` ya desplegado, así que aquel diagnóstico no lo cubría todo.
 * Cruzadas con el `access.log` de nginx (Next no apunta las peticiones), las
 * seis caen en el MISMO segundo en que termina un
 * `GET /api/pacientes/…/documents/…/download` con 200 y el fichero entero:
 * 6 de las 8 descargas de documentos de ese día. No eran ni la IA ni el Buzón,
 * que solo estaban cerca en el log.
 *
 * ── EL MECANISMO, CON LAS LÍNEAS ───────────────────────────────────────────
 * Las rutas hacían `new Response(createReadStream(abs))`. undici (6.28.0 en
 * el Node 22.23.2 del contenedor) convierte un stream de Node con
 * `ReadableStreamFrom` (undici.js 1612-1640): un stream `type: "bytes"` cuyo
 * `pull` hace `await iterator.next()` y, cuando el fichero se acaba, cierra
 * con `queueMicrotask(() => controller.close())` SIN try/catch. Es la misma
 * carrera que `multipart.js` cazó en el FormData saliente, pero en el camino
 * de TODAS las descargas:
 *
 *   1. Next escribe el último trozo y vuelve a leer: ese `pull` se queda
 *      esperando el EOF, que es una lectura más al disco (devuelve 0 bytes).
 *   2. nginx ya tiene `Content-Length` bytes y cierra la conexión con Node.
 *      Next lo ve (`res` emite 'close' sin `writableFinished`) y cancela el
 *      stream (`pipeToNodeResponse` → `pipeTo` con `signal`): estado `closed`.
 *   3. Llega el EOF: `close()` sobre un stream ya cerrado lanza desde el
 *      microtask, fuera de toda promesa. Eso es el `uncaughtException`.
 *
 * Reproducido DENTRO del contenedor con un fichero de 200 KB y esa secuencia:
 * 100 de 100 con `new Response(createReadStream(abs))`, 0 de 100 con esto.
 * La prueba (`scripts/_smoke-cuerpo-de-fichero.mjs`) repite las dos cosas.
 *
 * ── POR QUÉ ESTO LO ARREGLA ────────────────────────────────────────────────
 * `Readable.toWeb()` es de Node, no de undici, y monta el stream con el
 * controlador por defecto: `cancel` apunta `wasCanceled` y destruye el stream
 * de Node; al terminar solo llama a `close()` si nadie canceló, y un error
 * posterior va a `controller.error()`, que sobre un stream cerrado no hace
 * nada (`lib/internal/webstreams/adapters.js`,
 * `newReadableStreamFromStreamReadable`). Y undici acepta un `ReadableStream`
 * tal cual («object instanceof ReadableStream ? object :
 * ReadableStreamFrom(object)»), así que el rodeo desaparece entero.
 *
 * El día que undici proteja ese `close()` como ya protege el de su propia
 * respuesta (`readableStreamClose`), esto puede volver a ser
 * `createReadStream(abs)`: la prueba de CONTROL avisará, porque dejará de
 * fallar.
 */

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/**
 * @param {string} rutaAbsoluta
 * @returns {ReadableStream<Uint8Array>} listo para `new Response(cuerpo, …)`.
 *   Un fichero que no existe no lanza aquí: la primera lectura rechaza con
 *   ENOENT. Quien quiera contestar 404 antes de empezar hace `stat` primero,
 *   como ya hacen los helpers de almacenamiento.
 */
export function cuerpoDeFichero(rutaAbsoluta) {
  return Readable.toWeb(createReadStream(rutaAbsoluta));
}
