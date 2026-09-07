// @prueba ligera — node:test sobre lib/billing/marcaImagen.js + regex.
/**
 * _smoke-marca-imagen.mjs — el logo y el SELLO se suben desde el ordenador
 * (07/09/2026, AV-0069 de Aumenta).
 *
 *   node scripts/_smoke-marca-imagen.mjs
 *
 * Rosa: «NO SALE EL SELLO DE AUMENTA EN LAS FACTURAS. ESTÁ REFLEJADO PERO NI
 * PUESTO NI QUITADO EL CLICK». No era que no se pintara: los tres campos de
 * marca eran cajas de texto que pedían la dirección de una imagen ya publicada
 * en internet, y los OCHO centros con facturación los tenían vacíos.
 *
 * Lo que se fija aquí, y el orden no es casual:
 *
 *   · que `cargarLogo` entienda la imagen subida — si no, se habría hecho un
 *     botón de subir y la factura seguiría saliendo SIN SELLO, en silencio,
 *     que es la trampa entera de este encargo;
 *   · que la rama esté DENTRO de `cargarLogo` y no en quien la llama: son
 *     siete llamadas en seis endpoints y una olvidada significa que el sello
 *     sale en la descarga y no en el correo;
 *   · que solo entren PNG y JPEG, porque pdfkit no sabe dibujar nada más y un
 *     SVG tumbaría la generación del PDF;
 *   · que el tipo se decida por los BYTES y no por lo que diga el navegador;
 *   · y que un centro no pueda apuntar a la imagen de otro, comprobado al
 *     ESCRIBIR, que es donde está el cerrojo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  esRefDeMarca,
  slugDeRef,
  refValidaPara,
  leerImagenDeMarca,
  TIPOS_MARCA,
  MAX_MARCA_BYTES,
  CAMPOS_MARCA,
} from "../lib/billing/marcaImagen.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const REF = "/marca/aumenta/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b.png";

describe("qué es una imagen de marca nuestra", () => {
  it("reconoce la referencia bien formada", () => {
    assert.equal(esRefDeMarca(REF), true);
    assert.equal(slugDeRef(REF), "aumenta");
    assert.equal(esRefDeMarca(REF.replace(".png", ".jpg")), true);
  });

  it("y rechaza todo lo que no lo sea", () => {
    for (const malo of [
      "https://ejemplo.com/logo.png",       // una URL de fuera: no es una ref
      "/marca/aumenta/../../.env",          // subir de carpeta
      "/marca/aumenta/logo.png",            // el nombre lo pone el servidor, es un uuid
      "/marca/aumenta/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b.svg", // pdfkit no lo dibuja
      "/marca//0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b.png",
      "/otracarpeta/aumenta/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b.png",
      "", null, undefined, 42,
    ]) {
      assert.equal(esRefDeMarca(malo), false, `«${String(malo)}» no debería valer`);
    }
  });

  it("solo PNG y JPEG: es lo único que sabe dibujar el PDF", () => {
    assert.deepEqual(Object.values(TIPOS_MARCA).sort(), ["jpg", "png"]);
    assert.ok(!Object.values(TIPOS_MARCA).includes("webp"), "pdfkit no entiende webp");
    assert.ok(!Object.values(TIPOS_MARCA).includes("gif"));
  });

  it("los tres sitios donde puede ir una imagen, con su columna", () => {
    assert.deepEqual(CAMPOS_MARCA, { logo: "logoUrl", sello: "stampUrl", logoPresupuesto: "quoteLogoUrl" });
  });

  it("leer una referencia que no existe devuelve null, no revienta", () => {
    assert.equal(leerImagenDeMarca(REF), null);
    assert.equal(leerImagenDeMarca("/marca/aumenta/../../etc/passwd"), null);
    assert.equal(leerImagenDeMarca(null), null);
  });
});

describe("un centro no puede apuntar a la imagen de otro", () => {
  it("su propia referencia sí", () => {
    assert.equal(refValidaPara("aumenta", REF), true);
  });

  it("la de otro centro NO", () => {
    assert.equal(refValidaPara("nutri_laura", REF), false);
    assert.equal(refValidaPara("aumenta", "/marca/otro/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b.png"), false);
  });

  it("una URL de internet o el campo vacío pasan, que es lo de siempre", () => {
    assert.equal(refValidaPara("aumenta", "https://ejemplo.com/logo.png"), true);
    assert.equal(refValidaPara("aumenta", ""), true);
    assert.equal(refValidaPara("aumenta", null), true);
  });

  it("y una ruta que EMPIEZA por /marca pero está mal formada se rechaza", () => {
    // Si esto pasara, el cerrojo se saltaría escribiendo `/marca/../algo`.
    assert.equal(refValidaPara("aumenta", "/marca/aumenta/../../.env"), false);
    assert.equal(refValidaPara("aumenta", "/marca/"), false);
  });

  it("el tope son 2 MB", () => {
    assert.equal(MAX_MARCA_BYTES, 2 * 1024 * 1024);
  });
});

describe("la imagen subida llega de verdad al PDF", () => {
  const membrete = lee("../lib/billing/logoMembrete.js");
  const ajustes = lee("../app/api/billing/settings/route.js");
  const subida = lee("../app/api/billing/settings/imagen/route.js");
  const pantalla = lee("../app/(dashboard)/facturacion/configuracion/page.jsx");

  it("la rama va DENTRO de cargarLogo, no en quien la llama", () => {
    // Aquí está la trampa del encargo: `cargarLogo` exige https y sale a la
    // red. Sin esta línea, subir el sello no habría cambiado nada.
    assert.match(membrete, /export async function cargarLogo\(url\) \{\s*\n\s*if \(esRefDeMarca\(url\)\) return leerImagenDeMarca\(url\);/);
    assert.match(membrete, /import \{ esRefDeMarca, leerImagenDeMarca \} from "\.\/marcaImagen\.js";/);
  });

  it("y se comprueba ANTES de la valla del https, no después", () => {
    const i = membrete.indexOf("esRefDeMarca(url)");
    const j = membrete.indexOf("^https:");
    assert.ok(i > 0 && j > i, "si el https va primero, la referencia nuestra nunca llega");
  });

  it("el cerrojo de a quién pertenece está al GUARDAR los ajustes", () => {
    assert.match(ajustes, /import \{ CAMPOS_MARCA, refValidaPara \}/);
    assert.match(ajustes, /if \(columna in updates && !refValidaPara\(tenant\.slug, updates\[columna\]\)\)/);
  });

  it("la subida guarda el ajuste ella misma y borra la anterior", () => {
    assert.match(subida, /await row\.update\(\{ \[columna\]: guardada\.ref \}\)/);
    assert.match(subida, /if \(esRefDeMarca\(anterior\) && anterior !== guardada\.ref\) await borrarImagenDeMarca\(anterior\)/);
    const iBorra = subida.indexOf("borrarImagenDeMarca(anterior)");
    const iGuarda = subida.indexOf("row.update({ [columna]");
    assert.ok(iGuarda < iBorra, "primero se guarda la nueva y solo después se borra la vieja");
  });

  it("la demo no puede subir: es pública y con sesión de admin", () => {
    assert.match(subida, /if \(isDemoTenant\(tenant\)\)/);
  });

  it("hay por dónde VERLA, o la pantalla enseñaría un icono roto", () => {
    // El PDF lee del disco, pero el <img> de Configuración necesita una ruta
    // servida: sin esto, subir el sello bien acababa con una imagen rota.
    assert.match(subida, /export const GET = withTenant/);
    assert.match(subida, /slugDeRef\(ref\) !== tenant\.slug/, "solo la imagen del propio centro");
    assert.match(subida, /"X-Content-Type-Options": "nosniff"/);
    assert.match(pantalla, /src=\{`\/api\/billing\/settings\/imagen\?ref=\$\{encodeURIComponent\(valor\)\}`\}/);
  });

  it("la pantalla ofrece subir en los tres campos", () => {
    for (const campo of ["logo", "sello", "logoPresupuesto"]) {
      assert.match(pantalla, new RegExp(`campo="${campo}"`), `falta el de ${campo}`);
    }
    assert.match(pantalla, /accept="image\/png,image\/jpeg"/);
    assert.ok(!/URL del sello del centro/.test(pantalla), "el campo de solo texto ya no debería estar");
  });
});
