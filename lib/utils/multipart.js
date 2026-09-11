/**
 * lib/utils/multipart.js — un `FormData` convertido en bytes antes de mandarlo
 * (08/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Mirando los logs de producción del 08/09/2026: mientras Aumenta transcribía
 * sesiones, el proceso lanzaba `TypeError: Invalid state: ReadableStream is
 * already closed` y Next lo registraba como **uncaughtException**. Medido en
 * tres horas de trabajo real: 21 transcripciones y 4 apariciones del error, 2
 * de ellas sin capturar. Una de cada diez. Nadie se quejó porque no se pierde
 * ninguna transcripción — y esa es justo la razón de arreglarlo: mientras esté
 * ahí, cualquier fallo de verdad en esa ruta se mezcla con este ruido.
 *
 * ── NO ERA EL CUERPO QUE ENTRA, ERA EL QUE SALE ────────────────────────────
 * La sospecha razonable era `await request.formData()` cortado por un navegador
 * que se va. **Es falsa, y el propio mensaje lo delata**: ese texto solo lo
 * lanza un `ReadableByteStreamController` (streams `type: "bytes"`), y el
 * cuerpo entrante que monta Next usa un controlador por defecto, que diría
 * «Controller is already closed». Además las seis rutas que reciben audio ya
 * envuelven esa línea en try/catch, y `withTenant` vuelve a envolver el handler.
 *
 * El único stream de bytes de este camino es el multipart SALIENTE. undici
 * serializa un `FormData` con un `pull` que, al terminar, llama a
 * `controller.close()` dentro de un `queueMicrotask` **sin try/catch**
 * (undici 5749-5755): si el despachador cancela el cuerpo justo cuando acaba de
 * escribirlo, ese close lanza fuera de toda promesa. Que es una carrera conocida
 * lo dice el propio undici, que para SU respuesta usa el helper
 * `readableStreamClose` (4778-4787), el cual se traga exactamente estas dos
 * frases. El camino del multipart se quedó sin esa red.
 *
 * ── POR QUÉ ESTO LO ARREGLA ────────────────────────────────────────────────
 * Mandando el cuerpo ya serializado en un `Uint8Array` **sigue habiendo un
 * stream de bytes** —undici lo monta igual—, pero ese cierra con el helper
 * protegido. Es la diferencia entera, y conviene que quede escrita: quien lea
 * «sin stream no hay carrera» dentro de un año lo comprobará, verá que sí lo
 * hay y dará el arreglo por infundado.
 *
 * La serialización la hace la PLATAFORMA (`new Response(form)`), no nosotros.
 * Copiar a mano las reglas de escapado del `filename` para ahorrarse una vuelta
 * sería cambiar un fallo de uno de cada diez por el riesgo de romper las diez.
 *
 * ── LO QUE ESTO NO CUBRÍA (11/09/2026) ────────────────────────────────────
 * Con esto desplegado el error siguió saliendo: seis veces el 10/09/2026, y
 * las seis en el segundo en que terminaba una DESCARGA de documento. El mismo
 * `close()` sin red vive en `ReadableStreamFrom` (undici 1612-1640), por
 * donde pasaba `new Response(createReadStream(abs))`. Ese camino lo cubre
 * `lib/utils/cuerpoDeFichero.js`; este fichero sigue haciendo falta para el
 * multipart, que es otro stream distinto.
 */

/**
 * Los bytes de un `FormData` y el `Content-Type` que los describe.
 *
 * @param {FormData} form
 * @returns {Promise<{ contentType: string, cuerpo: Uint8Array }>}
 */
export async function cuerpoMultipart(form) {
  const r = new Response(form);
  const contentType = r.headers.get("content-type");
  // Leer aquí es seguro: la carrera de undici salta cuando ALGO CANCELA el
  // cuerpo a medio camino, y una lectura local no la cancela nadie.
  const cuerpo = new Uint8Array(await r.arrayBuffer());
  return { contentType, cuerpo };
}
