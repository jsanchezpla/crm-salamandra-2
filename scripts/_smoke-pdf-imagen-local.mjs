// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-pdf-imagen-local.mjs — de dónde puede sacar una imagen un PDF del CRM
 * (28/08/2026).
 *
 *   node scripts/_smoke-pdf-imagen-local.mjs
 *   node --test-name-pattern="SSRF" scripts/_smoke-pdf-imagen-local.mjs
 *
 * ── POR QUÉ ESTO TIENE PRUEBA PROPIA ───────────────────────────────────────
 *
 * `lib/pdf/imagenLocal.js` es un cerrojo de seguridad disfrazado de utilidad de
 * dibujo. El informe clínico rediseñado pinta el logo del centro, y el logo del
 * centro vive en `settings.brand.logoUrl`, que es TEXTO LIBRE de 500 caracteres
 * que escribe quien da de alta al cliente y que nadie valida.
 *
 * Si el generador hiciera `fetch` de ese valor, el CRM se convertiría en el
 * mensajero de cualquier petición que alguien escriba ahí — incluida
 * `http://169.254.169.254/`, que es la puerta de los metadatos del proveedor de
 * la nube. Así que solo se aceptan RUTAS LOCALES de `public/`, y esta prueba
 * fija exactamente cuáles: es la lista de lo que NO puede colarse.
 *
 * Lo segundo que fija es el formato. pdfkit solo entiende PNG y JPEG; con un
 * SVG o un WebP —los dos que más probablemente entregue un diseñador— lanza
 * `Unknown image format.`, y eso, dentro del generador, es un 500 sin
 * explicación y una familia sin su informe. Se miran los primeros bytes antes
 * de devolver nada.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  imagenLocal,
  esRutaLocalDeImagen,
  esImagenQuePdfkitEntiende,
  olvidarImagenes,
} from "../lib/pdf/imagenLocal.js";

// Un PNG de 1×1 transparente, en bytes. Va aquí dentro para no depender de
// ningún fichero del repo.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const JPEG_CABECERA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const WEBP = Buffer.from("RIFF____WEBPVP8 ");

describe("esRutaLocalDeImagen · lo que NO puede colarse", () => {
  it("rechaza una URL remota: nunca se sale a la red desde un generador de PDF", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data/",
      "https://aumentafuenlabrada.com/logo.png",
      "HTTPS://EJEMPLO.COM/x.png",
      "//evil.com/logo.png", // URL sin protocolo: parece una ruta y no lo es
    ]) {
      assert.equal(esRutaLocalDeImagen(u), false, `debería rechazar ${u}`);
    }
  });

  it("rechaza el salto de carpeta, que es como se leería un .env", () => {
    for (const r of ["/../.env", "/../../etc/passwd", "/logos/../../.env.production"]) {
      assert.equal(esRutaLocalDeImagen(r), false, `debería rechazar ${r}`);
    }
  });

  it("rechaza otros esquemas y las rutas relativas", () => {
    for (const r of ["data:image/png;base64,AAAA", "file:///C:/x.png", "logo.png", "./logo.png", "C:/x.png"]) {
      assert.equal(esRutaLocalDeImagen(r), false, `debería rechazar ${r}`);
    }
  });

  it("rechaza lo que ni siquiera es una cadena", () => {
    for (const r of [null, undefined, 42, {}, [], true]) assert.equal(esRutaLocalDeImagen(r), false);
  });

  it("acepta una ruta de public/, con espacios alrededor o sin ellos", () => {
    assert.equal(esRutaLocalDeImagen("/aumenta-logo.png"), true);
    assert.equal(esRutaLocalDeImagen("  /aumenta-logo.png  "), true);
    assert.equal(esRutaLocalDeImagen("/marcas/centro/logo.png"), true);
  });
});

describe("esImagenQuePdfkitEntiende · PNG y JPEG, nada más", () => {
  it("dice que sí a un PNG y a un JPEG de verdad", () => {
    assert.equal(esImagenQuePdfkitEntiende(PNG_1x1), true);
    assert.equal(esImagenQuePdfkitEntiende(JPEG_CABECERA), true);
  });

  it("dice que no a un SVG y a un WebP, que son los que entrega un diseñador", () => {
    assert.equal(esImagenQuePdfkitEntiende(SVG), false);
    assert.equal(esImagenQuePdfkitEntiende(WEBP), false);
  });

  it("dice que no a lo vacío, lo corto y lo que no es un Buffer", () => {
    for (const b of [Buffer.alloc(0), Buffer.from([0x89]), null, undefined, "PNG", []]) {
      assert.equal(esImagenQuePdfkitEntiende(b), false);
    }
  });
});

describe("imagenLocal · lo que devuelve de verdad", () => {
  it("una URL remota devuelve null SIN salir a la red", () => {
    olvidarImagenes();
    assert.equal(imagenLocal("https://aumentafuenlabrada.com/logo.png"), null);
    assert.equal(imagenLocal("http://169.254.169.254/"), null);
  });

  it("un fichero que no existe devuelve null, no lanza", () => {
    olvidarImagenes();
    assert.doesNotThrow(() => imagenLocal("/no-existe-de-verdad-12345.png"));
    assert.equal(imagenLocal("/no-existe-de-verdad-12345.png"), null);
  });

  it("null y undefined devuelven null", () => {
    olvidarImagenes();
    assert.equal(imagenLocal(null), null);
    assert.equal(imagenLocal(undefined), null);
  });

  it("lee de verdad un PNG que esté en public/", () => {
    olvidarImagenes();
    const publico = path.join(process.cwd(), "public");
    const nombre = "_prueba-imagen-local.png";
    const destino = path.join(publico, nombre);
    fs.writeFileSync(destino, PNG_1x1);
    try {
      const buf = imagenLocal(`/${nombre}`);
      assert.ok(Buffer.isBuffer(buf), "tendría que devolver un Buffer");
      assert.deepEqual(buf, PNG_1x1);
    } finally {
      fs.rmSync(destino, { force: true });
      olvidarImagenes();
    }
  });

  it("un fichero de public/ que NO es PNG ni JPEG devuelve null", () => {
    olvidarImagenes();
    const publico = path.join(process.cwd(), "public");
    const nombre = "_prueba-imagen-local.svg";
    const destino = path.join(publico, nombre);
    fs.writeFileSync(destino, SVG);
    try {
      assert.equal(imagenLocal(`/${nombre}`), null, "un SVG haría reventar a pdfkit");
    } finally {
      fs.rmSync(destino, { force: true });
      olvidarImagenes();
    }
  });

  it("no se sale de public/ ni con una ruta rebuscada", () => {
    olvidarImagenes();
    // Un fichero real FUERA de public/, para que el fallo sería leerlo.
    const fuera = path.join(os.tmpdir(), "_prueba-fuera-de-public.png");
    fs.writeFileSync(fuera, PNG_1x1);
    try {
      for (const r of ["/../package.json", "/..%2F..%2Fpackage.json", "/./../package.json"]) {
        assert.equal(imagenLocal(r), null, `no debería leer ${r}`);
      }
    } finally {
      fs.rmSync(fuera, { force: true });
      olvidarImagenes();
    }
  });

  it("recuerda lo leído, para no tocar el disco en cada informe", () => {
    olvidarImagenes();
    const publico = path.join(process.cwd(), "public");
    const nombre = "_prueba-cache.png";
    const destino = path.join(publico, nombre);
    fs.writeFileSync(destino, PNG_1x1);
    const primera = imagenLocal(`/${nombre}`);
    fs.rmSync(destino, { force: true });
    const segunda = imagenLocal(`/${nombre}`);
    olvidarImagenes();
    assert.ok(Buffer.isBuffer(primera));
    assert.deepEqual(segunda, primera, "la segunda sale de la caché aunque el fichero ya no esté");
    assert.equal(imagenLocal(`/${nombre}`), null, "y tras olvidar, vuelve a mirar el disco");
  });
});
