// @prueba ligera — funciones puras de /lib y lectura del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-editar-nota.mjs — corregir una entrada de la historia clínica
 * (04/09/2026, AV-0040 de Laura).
 *
 *   node scripts/_smoke-editar-nota.mjs
 *
 * En la pestaña «Historia clínica» de la ficha cada entrada solo tenía
 * «Borrar»: una errata costaba tirar la anotación entera y volver a
 * escribirla, con lo que la fecha original se perdía. Ahora se corrige en su
 * sitio (PATCH /api/clients/:id/notes/:noteId) y la entrada queda marcada
 * «(editada)» con la fecha del cambio.
 *
 * Se fijan las dos cosas que, si se rompen, se rompen en silencio:
 *   1. la marca «(editada)» — `fueEditada`: ni la pone en todas (una entrada
 *      recién creada tiene las dos fechas casi iguales) ni deja de ponerla en
 *      la que se ha corregido;
 *   2. que el endpoint sigue sin volcar el TEXTO de la nota en la auditoría:
 *      `master.audit_logs` lo comparten todos los clientes y ahí hay datos de
 *      salud (CLAUDE.md → Seguridad → Auditoría).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fueEditada, filasParaEditar, MARGEN_EDICION_MS } from "../lib/clients/notas.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_ENDPOINT = join(RAIZ, "app/api/clients/[id]/notes/[noteId]/route.js");
const RUTA_PANEL = join(RAIZ, "components/clients/ClientNotesPanel.jsx");

/** Una nota nacida en `t` y tocada `msDespues` más tarde. */
function nota(msDespues) {
  const t = Date.parse("2026-09-04T08:47:00.000Z");
  return {
    createdAt: new Date(t).toISOString(),
    updatedAt: new Date(t + msDespues).toISOString(),
  };
}

describe("fueEditada — cuándo sale la marca «(editada)»", () => {
  it("una entrada recién escrita NO sale editada, aunque las fechas no coincidan al milisegundo", () => {
    assert.equal(fueEditada(nota(0)), false);
    assert.equal(fueEditada(nota(1)), false);
    assert.equal(fueEditada(nota(MARGEN_EDICION_MS)), false);
  });

  it("una entrada corregida sí, desde el primer milisegundo pasado el margen", () => {
    assert.equal(fueEditada(nota(MARGEN_EDICION_MS + 1)), true);
    assert.equal(fueEditada(nota(60_000)), true);
    assert.equal(fueEditada(nota(30 * 24 * 3600 * 1000)), true);
  });

  it("sin fechas, o con fechas que no lo son, no se inventa la marca", () => {
    assert.equal(fueEditada(null), false);
    assert.equal(fueEditada({}), false);
    assert.equal(fueEditada({ createdAt: "2026-09-04T08:47:00.000Z" }), false);
    assert.equal(fueEditada({ createdAt: "ayer", updatedAt: "hoy" }), false);
  });

  it("acepta Date además de texto ISO (el panel pinta lo que devuelve la API, pero no siempre)", () => {
    const creada = new Date("2026-09-04T08:47:00.000Z");
    const tocada = new Date("2026-09-04T09:10:00.000Z");
    assert.equal(fueEditada({ createdAt: creada, updatedAt: tocada }), true);
    assert.equal(fueEditada({ createdAt: creada, updatedAt: creada }), false);
  });
});

describe("filasParaEditar — el textarea se abre a la altura del texto", () => {
  it("nunca menos de 4 filas ni más de 24", () => {
    assert.equal(filasParaEditar(""), 4);
    assert.equal(filasParaEditar(null), 4);
    assert.equal(filasParaEditar("una línea"), 4);
    assert.equal(filasParaEditar("a\n".repeat(200)), 24);
  });

  it("una entrada de sesión entera se abre entera, no en tres líneas", () => {
    assert.equal(filasParaEditar("a\nb\nc\nd\ne"), 6);
  });
});

describe("el endpoint de la entrada", () => {
  const codigo = readFileSync(RUTA_ENDPOINT, "utf8");

  it("expone PATCH además de DELETE", () => {
    assert.match(codigo, /export const PATCH = withTenant/);
    assert.match(codigo, /export const DELETE = withTenant/);
  });

  it("exige el módulo `clients` y acota la nota a SU ficha", () => {
    assert.match(codigo, /hasModule\("clients"\)/);
    assert.match(codigo, /where: \{ id: noteId, clientId: id \}/);
  });

  it("no guarda vacíos: content obligatorio", () => {
    assert.match(codigo, /content es obligatorio/);
  });

  it("audita la edición sin volcar el texto de la nota", () => {
    assert.match(codigo, /action: "client\.note\.updated"/);
    // El resumen que va a master solo lleva de quién es la ficha y quién la
    // escribió. Si algún día alguien mete `content` aquí, esto se pone rojo.
    const auditoria = codigo.slice(codigo.indexOf("client.note.updated"));
    assert.ok(
      !/resumen\(row, \[[^\]]*content/.test(auditoria),
      "el contenido de la nota no puede entrar en master.audit_logs"
    );
  });
});

describe("el panel de la ficha", () => {
  const jsx = readFileSync(RUTA_PANEL, "utf8");

  it("ofrece Editar junto a Borrar", () => {
    assert.match(jsx, />\s*Editar\s*</);
    assert.match(jsx, />\s*Borrar\s*</);
  });

  it("guarda por PATCH contra la entrada, no por POST contra la lista", () => {
    assert.match(jsx, /notes\/\$\{noteId\}`,\s*\{\s*method: "PATCH"/);
  });

  it("la marca «editada» sale de lib, no de un if suelto en el JSX", () => {
    assert.match(jsx, /from "\.\.\/\.\.\/lib\/clients\/notas\.js"/);
    assert.match(jsx, /fueEditada\(n\)/);
  });
});
