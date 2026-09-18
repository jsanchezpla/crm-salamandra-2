// @prueba ligera — lee una constante de /lib y el fuente de la migración; sin base, sin servidor.
/**
 * _smoke-incidencias-enum.mjs — que el desplegable de categorías y el tipo de
 * PostgreSQL no puedan volver a decir cosas distintas (18/09/2026, AV-0203).
 *
 *   node scripts/_smoke-incidencias-enum.mjs
 *
 * Qué pasó: el modal ofrecía diez categorías y el enum de la base tenía ocho,
 * porque la migración las llevaba escritas A MANO y solo actuaba cuando el tipo
 * no existía. Elegir «Otros» pasaba la validación del endpoint y reventaba en
 * el INSERT: «Error interno del servidor» para quien apuntaba la incidencia, en
 * los ocho schemas del CRM.
 *
 * Aquí no se prueba SQL —eso hay que verlo contra la base—, sino lo único que
 * puede volver a desincronizarse: que la migración siga leyendo la lista de
 * `lib/clinica/incidencias.js` en vez de tener la suya.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { INCIDENCIA_CATEGORIES } from "../lib/clinica/incidencias.js";

const migracion = readFileSync(new URL("./migrate-incidencias-module.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("las categorías de incidencia y el enum de la base", () => {
  it("la migración lee la lista de /lib, no la suya", () => {
    assert.match(migracion, /import \{ INCIDENCIA_CATEGORIES \} from "\.\.\/lib\/clinica\/incidencias\.js"/);
    assert.match(migracion, /name: "enum_incidencias_category", values: INCIDENCIA_CATEGORIES\.map\(\(c\) => c\.key\)/);
  });

  it("a un enum que YA existe se le añade lo que falte", () => {
    // Sin esto, un tenant antiguo se queda con los valores del día que se creó
    // — que es exactamente lo que pasó.
    assert.match(migracion, /ADD VALUE IF NOT EXISTS/);
  });

  it("ninguna categoría lleva algo que no valga dentro de un ALTER TYPE", () => {
    // Los valores se interpolan (un parámetro no vale ahí), así que la forma
    // importa: letras minúsculas, números y guion bajo.
    for (const c of INCIDENCIA_CATEGORIES) {
      assert.match(c.key, /^[a-z0-9_]+$/, `la clave «${c.key}» no vale como valor de enum`);
    }
    assert.match(migracion, /!\/\^\[a-z0-9_\]\+\$\/\.test\(v\)/);
  });

  it("siguen estando las dos que faltaban, para que la prueba cuente esta historia", () => {
    const claves = INCIDENCIA_CATEGORIES.map((c) => c.key);
    assert.ok(claves.includes("otros"), "«Otros» es la categoría que reventaba");
    assert.ok(claves.includes("solicitud_laboral"), "«Solicitud laboral» reventaba igual");
    assert.ok(claves.length >= 10);
  });
});
