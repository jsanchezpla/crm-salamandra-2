// @prueba ligera — lee código fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-buscador-archivadas.mjs — dónde se puede esconder una ficha
 * archivada, y dónde no (25/08/2026).
 *
 *   node scripts/_smoke-citas-buscador-archivadas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Ese día la ficha de familia estrenó «Archivar ficha». Al revisarlo salió que
 * `app/api/citas/clientes` —el buscador del alta manual de citas— empezaba su
 * `where` por `status <> 'inactive'`, así que una familia archivada
 * desaparecía de él.
 *
 * Suena razonable hasta que se junta con la salida a mano que ese buscador
 * tiene a propósito: se archiva a una familia, vuelve a los dos meses a pedir
 * hora, recepción teclea el nombre, no sale nadie, lo escribe a mano y la cita
 * nace con `client_id = null` — suelta de su ficha, que es EXACTAMENTE el fallo
 * que ese buscador vino a arreglar en julio de 2026.
 *
 * ── LA REGLA QUE SE FIJA AQUÍ ──────────────────────────────────────────────
 *
 * Archivar esconde la ficha en UN sitio y solo uno: «Fichas a completar»
 * (`lib/clients/urgentes.js`), que es justo lo que se pidió y tiene su casilla
 * para volver a verlas. En cualquier otro sitio, una ficha archivada se sigue
 * encontrando.
 *
 * ── POR QUÉ REGEX SOBRE EL FUENTE ──────────────────────────────────────────
 *
 * Porque lo que hay que vigilar ES texto: que no vuelva a aparecer un filtro
 * por estado en la consulta de este buscador. No hay función pura que probar
 * —es el `where` de un route handler— y montarlo con base de datos convertiría
 * una prueba de un segundo en una pesada.
 *
 * ── Y POR QUÉ NO HAY BARRIDO DE TODO EL REPO ───────────────────────────────
 *
 * Se intentó, y no se puede hacer honradamente a este nivel. Un barrido que
 * busque «un fichero que consulte fichas Y filtre algo por estado» saca 19
 * ficheros, y en casi todos el `status` es de OTRA cosa: el de una factura
 * (`draft`/`sent`), el de una cita (`confirmed`/`cancelled`), el de un pedido,
 * el de un ticket. Un regex por fichero no sabe de quién es cada `status`, y
 * afinar por valores tampoco vale: `active` e `inactive` los usan la ficha, el
 * paciente, el empleado y el proyecto.
 *
 * La salida fácil sería una lista blanca de 19 entradas diciendo «este no es el
 * estado de la ficha». Eso no es una red: es una lista que nadie mantiene y que
 * acaba desactivada la primera vez que estorba. Así que esta prueba comprueba
 * lo que puede comprobar de verdad —este buscador, con nombre y apellidos— y la
 * regla general vive escrita en `docs/modules/clients.md`, no fingida aquí.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(import.meta.dirname, "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

const BUSCADOR_API = "app/api/citas/clientes/route.js";
const BUSCADOR_UI = "components/citas/BuscadorPaciente.jsx";

describe("el buscador del alta de citas ofrece las fichas archivadas", () => {
  it("las pide EXPLÍCITAMENTE, y no confiando en un orden", () => {
    /*
     * La primera versión traía todo junto con las archivadas al final del
     * ORDER BY. Con tope 20 y 1.083 fichas, teclear un apellido común llena las
     * 20 plazas con familias vivas y la archivada no entra nunca: el mismo
     * agujero, con más pasos. Por eso se exige la consulta aparte.
     */
    const src = leer(BUSCADOR_API);
    assert.match(src, /buscar\(\s*"inactive"\s*,/,
      "ya no se pide a las archivadas por su cuenta: si vuelven a competir por el mismo tope," +
      " la archivada de apellido común deja de salir y su cita nace sin ficha");
    assert.match(src, /CUPO_ARCHIVADAS/, "las archivadas se han quedado sin cupo propio");
  });

  it("devuelve `status`, que es lo que pinta el distintivo", () => {
    const src = leer(BUSCADOR_API);
    const todos = src.match(/attributes:\s*\[[^\]]*\]/g) ?? [];
    const deFichas = todos.find((a) => a.includes('"name"'));
    assert.ok(deFichas, `no encuentro los atributos de la ficha entre: ${JSON.stringify(todos)}`);
    assert.match(deFichas, /"status"/, `sin status en los atributos no hay distintivo: «${deFichas}»`);
  });

  it("avisa cuando hay más resultados de los que caben", () => {
    // Una lista llena y una lista completa se ven igual; sin aviso, quien no
    // encuentra a alguien da por hecho que no está y tira de la salida a mano.
    assert.match(leer(BUSCADOR_API), /hayMas:/, "el endpoint ya no dice si ha recortado");
    assert.match(leer(BUSCADOR_UI), /hayMas/, "el desplegable ya no avisa de que hay más");
  });

  it("y el desplegable marca las archivadas", () => {
    const src = leer(BUSCADOR_UI);
    assert.match(src, /c\.status === "inactive"/, "ya no pinta el distintivo «Archivada»");
    assert.match(src, />\s*Archivada\s*</, "falta el texto del distintivo");
  });

  it("el `where` compartido no toca el estado", () => {
    /*
     * Las dos consultas parten del mismo `where` y cada una le pone SU estado
     * encima. Si alguien vuelve a meter el estado en el compartido —da igual
     * cómo: `const where = { status: … }`, `where.status = …`, un
     * `Op.in: ["active","prospect"]`— la consulta de archivadas se queda sin
     * resultados y volvemos al principio, esta vez en silencio.
     */
    const src = leer(BUSCADOR_API);
    const hasta = src.indexOf("const CUPO_ARCHIVADAS");
    assert.ok(hasta > 0, "no encuentro el reparto de cupos: el buscador ha cambiado de forma");
    const antesDeLasConsultas = src.slice(0, hasta);
    const sinComentarios = antesDeLasConsultas
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(sinComentarios, /\bstatus\b/,
      "el `where` compartido del buscador vuelve a mirar el estado: eso deja sin resultados a la" +
      " consulta de archivadas y las esconde otra vez, sin que se note");
  });
});
