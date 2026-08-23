// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fake-n8n.mjs — el n8n de mentira comprueba la firma de verdad.
 *
 * `_fake-n8n.mjs` existe para que la rama de scraping de
 * `_smoke-outreach-e2e.mjs` pueda comprobar que el CRM firma el webhook. Si ese
 * falso se relajara —contestando que sí a cualquier firma— la prueba grande
 * seguiría saliendo verde sin mirar nada, que es exactamente el agujero que
 * venía a tapar. Así que lo que se fija aquí es su parte dura: cuándo dice que
 * una firma vale y cuándo no.
 *
 * Lo segundo que se fija son las tres empresas que devuelve: de ellas salen los
 * números que la prueba grande da por buenos (una se inserta, una ya la
 * teníamos, una se descarta). Si alguien las toca sin querer, o si cambia el
 * seed al que copia la repetida, aquí se ve antes que allí.
 *
 * Se lanza sola con `npm test`, o suelta:
 *   node --test scripts/_smoke-fake-n8n.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EMPRESAS, firmaValida } from "./_fake-n8n.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));

const SECRETO = "secreto-de-prueba";
// El mismo cuerpo que arma `lib/outreach/scraping.js` antes de firmarlo.
const CUERPO = JSON.stringify({ sector: "Ópticas", location: "Salamanca", sources: ["paginas_amarillas"] });
const firmar = (secreto, cuerpo) => createHmac("sha256", secreto).update(cuerpo).digest("hex");

describe("firmaValida: solo pasa la firma de ESE cuerpo hecha con ESE secreto", () => {
  it("la firma que produce el CRM vale", () => {
    assert.equal(firmaValida(SECRETO, CUERPO, firmar(SECRETO, CUERPO)), true);
  });

  it("da igual que el cuerpo llegue como Buffer o como texto: es la misma firma", () => {
    const firma = firmar(SECRETO, CUERPO);
    assert.equal(firmaValida(SECRETO, Buffer.from(CUERPO, "utf8"), firma), true);
  });

  it("si cambia un solo carácter del cuerpo, la firma deja de valer", () => {
    const firma = firmar(SECRETO, CUERPO);
    const manipulado = CUERPO.replace("Salamanca", "Salamancb");
    assert.equal(firmaValida(SECRETO, manipulado, firma), false);
  });

  it("la firma se hace sobre el crudo: el mismo objeto con las claves en otro orden no cuela", () => {
    // Es lo que pasaría si alguien firmara el JSON reparseado en vez del cuerpo
    // que sale por el cable. Mismos datos, otros bytes, otro hash.
    const reordenado = JSON.stringify({ sources: ["paginas_amarillas"], location: "Salamanca", sector: "Ópticas" });
    assert.equal(firmaValida(SECRETO, CUERPO, firmar(SECRETO, reordenado)), false);
  });

  it("una firma hecha con otro secreto no vale", () => {
    assert.equal(firmaValida(SECRETO, CUERPO, firmar("otro-secreto", CUERPO)), false);
  });

  it("sin firma, con basura o a medias, tampoco", () => {
    const firma = firmar(SECRETO, CUERPO);
    for (const mala of [undefined, null, "", "no-es-hexadecimal", firma.slice(0, 63), `${firma}00`, firma.toUpperCase()]) {
      assert.equal(firmaValida(SECRETO, CUERPO, mala), false, `debería rechazar ${JSON.stringify(mala)}`);
    }
  });

  it("sin secreto no da nada por bueno, ni siquiera una firma hecha sin secreto", () => {
    assert.equal(firmaValida("", CUERPO, firmar("", CUERPO)), false);
    assert.equal(firmaValida(undefined, CUERPO, firmar(SECRETO, CUERPO)), false);
  });
});

describe("EMPRESAS: tres, y cada una entra por una rama distinta del dedupe", () => {
  const nombreDe = (e) => String(e.nombre ?? e.name ?? "").trim();

  it("son tres: dos con nombre y una sin él", () => {
    assert.equal(EMPRESAS.length, 3);
    assert.equal(EMPRESAS.filter((e) => nombreDe(e) !== "").length, 2);
    assert.equal(EMPRESAS.filter((e) => nombreDe(e) === "").length, 1);
  });

  it("la nueva es la del Mirador, que es por la que la prueba grande la busca para borrarla", () => {
    assert.equal(EMPRESAS.filter((e) => nombreDe(e).includes("Mirador")).length, 1);
  });

  it("la repetida copia la terna (nombre, ubicación, fuente) con la que deduplica persistLeads", () => {
    const repetida = EMPRESAS.find((e) => e.name === "Asesoría Ledesma & Asociados");
    assert.ok(repetida, "falta la empresa repetida: sin ella no se prueba el dedupe");
    assert.equal(repetida.location, "Zamora");
    assert.equal(repetida.source, "paginas_amarillas");
  });

  it("y esa terna es la que siembra seed-outreach.js: si el seed cambia, el duplicado deja de serlo", () => {
    const seed = readFileSync(join(AQUI, "seed-outreach.js"), "utf8");
    const desde = seed.indexOf('name: "Asesoría Ledesma & Asociados"');
    assert.ok(desde > 0, "seed-outreach.js ya no siembra «Asesoría Ledesma & Asociados»");
    // La ventana se corta donde acaba ESE objeto y no a tantos caracteres: la
    // empresa que el seed siembra a continuación está a 445, así que un bloque
    // fijo la incluía y esto podía salir verde con el duplicado ya roto —bastaba
    // con que la vecina fuese de Zamora y de páginas amarillas.
    const hasta = seed.indexOf("\n  },", desde);
    assert.ok(hasta > desde, "no se encuentra el final del objeto de «Ledesma» en el seed");
    const bloque = seed.slice(desde, hasta);
    assert.ok(bloque.includes('location: "Zamora"'), "la empresa sembrada ya no está en Zamora");
    assert.ok(bloque.includes('source: "paginas_amarillas"'), "la empresa sembrada ya no viene de páginas amarillas");
  });
});
