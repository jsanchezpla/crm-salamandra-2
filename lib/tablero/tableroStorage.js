/**
 * lib/tablero/tableroStorage.js — las capturas que se cuelgan de una tarea del
 * Registro.
 *
 * (Fichero nuevo en /lib, regla #2.) Clona el enfoque de
 * `lib/buzon/buzonStorage.js`, que a su vez usa los helpers genéricos de
 * `lib/documents/documentStorage.js` — ese no se toca.
 *
 * ── POR QUÉ NO SE REUTILIZA `buzonStorage.js` TAL CUAL ────────────────────
 * Porque su layout en disco es `buzon/{tenantSlug}/{avisoUUID}/…` y sus rutas
 * las valida un regex que empieza por `buzon/`. Meter aquí las capturas del
 * Registro obligaría a inventarse un slug de tenant que no existe (el Registro
 * es NUESTRO, no de un cliente) y a aflojar ese regex, que es justo la pieza que
 * impide que una ruta guardada en base apunte a cualquier sitio del disco. Se
 * copia el enfoque —que ya trae resueltos los golpes— y no el fichero.
 *
 * Layout (ruta RELATIVA a UPLOADS_ROOT, siempre con "/"):
 *   tablero/{ficha}/{adjuntoUUID}.{ext}
 *
 * Por FICHA y no por título: el título se reescribe y la ficha no. Lo largo de
 * ese porqué está en `models/master/TableroAdjunto.model.js`.
 *
 * ── LOS LÍMITES, Y DE DÓNDE SALE EL NÚMERO ────────────────────────────────
 * 3 ficheros de 10 MB. No es una cifra elegida por gusto: nginx corta el cuerpo
 * de la petición en 30 MB, y pasarse no devuelve el JSON de `apiResponse` sino
 * una página HTML de error de nginx — en pantalla eso se ve como «no ha pasado
 * nada», que es la peor forma posible de fallar. Con 3 × 10 no se llega. Es el
 * mismo número que el Buzón y Soporte, y por el mismo motivo.
 *
 * Se escriben AQUÍ y no se importan del Buzón a propósito: comparten el motivo,
 * no la decisión. Si algún día el Buzón necesita otro tope porque los clientes
 * fotografían el monitor, eso no tiene por qué cambiar lo que nos subimos
 * nosotros.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import {
  getUploadsRoot,
  sanitizeFileName,
  extFromFileName,
  extensionPorContenido,
} from "../documents/documentStorage.js";
import { ES_FICHA } from "./parser.js";

export const MAX_FICHEROS = 3;
export const MAX_BYTES_POR_FICHERO = 10 * 1024 * 1024;
export const MB_POR_FICHERO = Math.round(MAX_BYTES_POR_FICHERO / (1024 * 1024));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// tablero/{ficha}/{uuid}.{ext} — la ficha es minúsculas y números, de 4 a 32.
const RUTA_RE = /^tablero\/[a-z0-9]{4,32}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i;

export { sanitizeFileName, extFromFileName };

/**
 * De ruta relativa a ruta absoluta, comprobando la forma ANTES de tocar el
 * disco. Es la única puerta: todo lo que abre, escribe o borra pasa por aquí, así
 * que una fila con la ruta manipulada no puede salirse de `uploads/tablero/`.
 */
function absoluta(ruta) {
  if (!RUTA_RE.test(String(ruta || ""))) throw new Error("ruta de adjunto inválida");
  return path.join(getUploadsRoot(), ...ruta.split("/"));
}

/** Escribe el binario y devuelve la ruta relativa que se guarda en BD. */
export async function guardarFichero(ficha, adjuntoId, buffer, ext) {
  if (!ES_FICHA.test(String(ficha || ""))) throw new Error(`Ficha inválida: ${ficha}`);
  if (!UUID_RE.test(adjuntoId)) throw new Error("id inválido para adjunto");
  // La extensión la decidimos NOSOTROS a partir del nombre, y si no se reconoce
  // se guarda como `.bin`. Nunca se usa el tipo que declara el navegador: es
  // texto que manda quien sube, y de ahí a servir un `.svg` como imagen —con su
  // script dentro— hay un paso.
  const extSegura = /^[a-z0-9]{1,10}$/i.test(ext || "") ? ext.toLowerCase() : "bin";
  const rel = `tablero/${String(ficha).toLowerCase()}/${adjuntoId}.${extSegura}`;
  const abs = absoluta(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return rel;
}

/** Stream + tamaño real, para servir la descarga sin doblar la memoria. */
export async function abrirFichero(ruta) {
  const abs = absoluta(ruta);
  const stat = await fs.stat(abs);
  return { stream: createReadStream(abs), size: stat.size };
}

/** Best-effort: si ya no está, no pasa nada. */
export async function borrarFichero(ruta) {
  try {
    await fs.unlink(absoluta(ruta));
  } catch {
    /* ya no estaba */
  }
}

/** La carpeta entera de una tarea, al podarla. */
export async function borrarCarpeta(ficha) {
  if (!ES_FICHA.test(String(ficha || ""))) return;
  try {
    await fs.rm(path.join(getUploadsRoot(), "tablero", String(ficha).toLowerCase()), {
      recursive: true,
      force: true,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Lee los ficheros de un formulario multipart y los deja en disco.
 *
 * Devuelve las fichas que hay que insertar en `tablero_adjuntos`. Si algo falla a
 * medias, lo ya escrito se borra: es preferible perder la captura a dejar
 * ficheros sueltos que no apunta ninguna fila — que es exactamente el problema
 * que esta tabla viene a evitar.
 */
export async function guardarCapturasDelFormulario({ form, ficha, documento, subidoPor, yaTiene = 0 }) {
  const ficheros = form.getAll("capturas").filter((f) => f && typeof f.arrayBuffer === "function");
  if (!ficheros.length) return { filas: [], error: "No has elegido ningún fichero." };
  if (yaTiene + ficheros.length > MAX_FICHEROS) {
    return {
      filas: [],
      error: `Como mucho ${MAX_FICHEROS} capturas por tarea, y esta ya tiene ${yaTiene}.`,
    };
  }

  const filas = [];
  const escritas = [];
  try {
    for (const f of ficheros) {
      if (f.size > MAX_BYTES_POR_FICHERO) {
        // Se dice el tope Y lo que pesa la suya: si no, hay que ir probando.
        const pesa = (f.size / (1024 * 1024)).toFixed(1);
        throw new Error(`«${f.name}» pesa ${pesa} MB y el tope son ${MB_POR_FICHERO} MB.`);
      }
      const adjuntoId = crypto.randomUUID();
      const buffer = Buffer.from(await f.arrayBuffer());
      /*
       * La extensión sale de los BYTES, y solo si no se reconocen, del nombre.
       *
       * El nombre lo escribe quien sube, igual que el `Content-Type`: fiarse de
       * él era el agujero. Chrome en Windows guarda JPEGs como `.jfif`, y con eso
       * una captura normal se guardaba con una extensión que la lista blanca de
       * lo que se enseña en pantalla no conoce — imagen pintada como «fichero».
       * Mirando los bytes, un JPEG es un JPEG se llame como se llame.
       */
      const ext = extensionPorContenido(buffer) ?? extFromFileName(f.name);
      const ruta = await guardarFichero(ficha, adjuntoId, buffer, ext);
      escritas.push(ruta);
      filas.push({
        id: adjuntoId,
        ficha,
        documento: documento ?? null,
        nombre: sanitizeFileName(f.name),
        ruta,
        bytes: f.size,
        mime: f.type || null,
        subidoPor,
      });
    }
    return { filas, error: null };
  } catch (e) {
    await Promise.all(escritas.map(borrarFichero));
    return { filas: [], error: e.message || "No se han podido guardar las capturas." };
  }
}
