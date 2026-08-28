/**
 * lib/pdf/imagenLocal.js — una imagen del propio servidor, lista para pdfkit.
 *
 * (Fichero nuevo en /lib, regla #2: lo van a necesitar todos los generadores de
 * PDF que quieran pintar el logo del cliente —el informe clínico es el primero,
 * la factura es la siguiente— y la parte delicada es la que NO se ve: decidir
 * qué rutas se aceptan. Eso quiere un sitio con nombre y con prueba, no una
 * línea repetida en cuatro generadores.)
 *
 * ── POR QUÉ NO SE DESCARGA `brand.logoUrl` ─────────────────────────────────
 * La tentación es evidente: el logo del cliente ya vive en
 * `settings.brand.logoUrl`, así que bastaría con que el servidor lo bajase al
 * generar el PDF. No se hace, y por tres motivos que no son de estilo:
 *
 *   1. Ese campo es texto libre de 500 caracteres que escribe quien da de alta
 *      al cliente, y NADIE valida que sea una imagen (los colores hermanos sí
 *      se validan; este no). Un `fetch` del servidor a un valor que viene de
 *      fuera es exactamente la forma de un SSRF: `http://169.254.169.254/…` y
 *      el CRM se convierte en el mensajero.
 *   2. Latencia y caída ajena. Si el host del cliente no responde, el informe
 *      de una familia se queda esperando o revienta por algo que no es nuestro.
 *   3. Ningún generador del CRM sale hoy a la red para dibujar, y no conviene
 *      estrenarlo aquí.
 *
 * Así que el fichero se commitea a `public/` (precedente:
 * `public/laura-ubeda-logo.png`) y en la base se guarda la RUTA
 * (`/aumenta-logo.png`). El `Dockerfile` copia `public/` a la imagen, así que
 * llega a producción. Cuando haga falta que el cliente lo suba él mismo, se
 * añade su almacén y esta función gana una rama; quien la llama no se entera.
 *
 * ── PDFKIT SOLO SABE PNG Y JPEG ────────────────────────────────────────────
 * Con cualquier otra cosa lanza `Unknown image format.` — y un diseñador
 * entrega un SVG o un WebP la mitad de las veces. Aquí se miran los primeros
 * bytes ANTES de devolver nada: si no es uno de los dos, `null`. Vale más una
 * portada sin logo que un 500 sin explicación.
 */

import fs from "node:fs";
import path from "node:path";

// Se lee UNA vez por proceso y se reutiliza, igual que las fuentes
// (`lib/pdf/fonts.js`). `null` guardado = ya se intentó y no había nada, para
// no volver a tocar el disco en cada informe.
const cache = new Map();

const PNG = [0x89, 0x50, 0x4e, 0x47]; // \x89PNG
const JPEG = [0xff, 0xd8, 0xff];

const empieza = (buf, magic) => magic.every((b, i) => buf[i] === b);

/** ¿Es un PNG o un JPEG de verdad, mirando sus primeros bytes? */
export function esImagenQuePdfkitEntiende(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  return empieza(buf, PNG) || empieza(buf, JPEG);
}

/**
 * ¿Es una ruta local que se puede servir? Solo se acepta lo que empieza por
 * `/`, sin `..` y sin protocolo. Se exporta aparte porque es la regla de
 * seguridad y es lo que de verdad hay que poder probar.
 */
export function esRutaLocalDeImagen(ruta) {
  if (typeof ruta !== "string") return false;
  const t = ruta.trim();
  if (!t.startsWith("/")) return false;   // deja fuera http(s):, data:, file: y las relativas
  if (t.startsWith("//")) return false;   // //evil.com es una URL sin protocolo, no una ruta
  if (t.includes("..")) return false;     // /../../.env
  if (t.includes("\0")) return false;
  return true;
}

/**
 * La imagen de `public/` que corresponde a esa ruta, como Buffer, o `null`.
 *
 * NUNCA lanza y NUNCA sale a la red: quien la llama puede usar el resultado
 * directamente en un `doc.image()` dentro de un `if`, y si no hay imagen el
 * documento se dibuja sin ella. Un informe clínico no puede dejar de generarse
 * porque falte un logo.
 */
export function imagenLocal(ruta) {
  if (!esRutaLocalDeImagen(ruta)) return null;
  const clave = ruta.trim();
  if (cache.has(clave)) return cache.get(clave);

  let buf = null;
  try {
    const publico = path.join(process.cwd(), "public");
    const destino = path.resolve(publico, "." + clave);
    // Segundo cerrojo, por si el primero se queda corto algún día: el fichero
    // resuelto TIENE que caer dentro de public/.
    if (destino === publico || !destino.startsWith(publico + path.sep)) {
      cache.set(clave, null);
      return null;
    }
    const leido = fs.readFileSync(destino);
    if (esImagenQuePdfkitEntiende(leido)) buf = leido;
  } catch {
    buf = null; // no está, no se puede leer, es una carpeta… da igual: sin logo.
  }
  cache.set(clave, buf);
  return buf;
}

/** Para las pruebas: olvida lo leído. */
export function olvidarImagenes() {
  cache.clear();
}
