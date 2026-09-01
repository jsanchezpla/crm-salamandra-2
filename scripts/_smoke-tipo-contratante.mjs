// @prueba ligera — funciones puras de /lib y texto del código; sin base, sin servidor.
/**
 * _smoke-tipo-contratante.mjs — el «Tipo» de un contratante se puede poner,
 * corregir y borrar desde la ficha (01/09/2026).
 *
 *   node scripts/_smoke-tipo-contratante.mjs
 *   node --test-name-pattern="borra" scripts/_smoke-tipo-contratante.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * `customFields.categoria` nació el 24/08/2026 con la importación de los 210
 * contactos de Laura Úbeda, y la pantalla aprendió a FILTRAR por él y a
 * pintarlo en su columna. Lo que no aprendió nadie fue a ESCRIBIRLO: un
 * contratante dado de alta a mano nacía sin tipo y no había ningún sitio donde
 * ponérselo. Rodrigo, 01/09/2026: «no puedo añadir Tipo a los contratantes,
 * debería dejarme en Editar ficha».
 *
 * Las tres cosas que se prueban aquí son las tres que, si se rompen, NO dan
 * error en pantalla:
 *
 *   1. el campo desaparece del formulario y nadie se entera (vuelve el fallo);
 *   2. lo que se puede ELEGIR deja de ser lo que se puede FILTRAR, y entonces
 *      un contratante marcado se cae de su propio filtro;
 *   3. el formulario deja de sembrar el tipo al abrirse — y como manda el
 *      objeto entero, corregir un teléfono BORRA el tipo que ya estaba.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORIAS,
  CLAVES_CATEGORIA,
  opcionesCategoria,
  categoriaONull,
  rotuloCategoria,
} from "../lib/booking/categorias.js";
import { camposCliente, PERFIL_COMERCIAL, PERFIL_SALUD } from "../lib/clients/formularioAlta.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(raiz, rel), "utf8");

describe("el campo Tipo en el formulario", () => {
  it("sale en un contratante y es un desplegable, no una caja de texto", () => {
    const campo = camposCliente(PERFIL_COMERCIAL, { conCategoria: true }).find((c) => c.key === "categoria");
    assert.ok(campo, "sin este campo vuelve el fallo del 01/09/2026");
    assert.equal(campo.label, "Tipo", "es como se llama la columna de la lista");
    assert.equal(campo.type, "select", "escrito a mano cada uno pondría lo suyo y el filtro no lo encontraría");
    assert.ok(campo.opciones?.length, "un select sin opciones es un desplegable vacío");
  });

  it("no sale donde no significa nada", () => {
    const claves = (perfil, opts) => camposCliente(perfil, opts).map((c) => c.key);
    assert.equal(claves(PERFIL_COMERCIAL).includes("categoria"), false, "un cliente comercial sin booking");
    assert.equal(claves(PERFIL_SALUD, { conPacientes: true }).includes("categoria"), false, "una clínica");
  });

  it("va después de Empresa y antes del correo, como en la lista", () => {
    const claves = camposCliente(PERFIL_COMERCIAL, { conCategoria: true }).map((c) => c.key);
    assert.ok(claves.indexOf("categoria") > claves.indexOf("name"));
    assert.ok(claves.indexOf("categoria") < claves.indexOf("email"));
  });
});

describe("lo que se elige es lo que se filtra", () => {
  it("las opciones del desplegable son las once categorías más el hueco", () => {
    const opciones = opcionesCategoria();
    assert.equal(opciones[0].valor, "", "«Sin especificar» va la primera y vacía");
    assert.deepEqual(
      opciones.slice(1).map((o) => o.valor),
      CLAVES_CATEGORIA,
      "si divergen, se puede marcar un tipo por el que no se puede filtrar"
    );
    assert.deepEqual(
      opciones.slice(1).map((o) => o.label),
      CATEGORIAS.map((c) => c.label),
      "el desplegable y la columna tienen que decir lo mismo"
    );
  });

  it("cada opción elegible se lee luego con su rótulo humano", () => {
    for (const { valor, label } of opcionesCategoria().slice(1)) {
      assert.equal(rotuloCategoria(valor), label);
    }
  });
});

describe("lo que guarda el endpoint", () => {
  it("acepta una clave de la lista", () => {
    assert.equal(categoriaONull("sala"), "sala");
    assert.equal(categoriaONull("ayuntamiento"), "ayuntamiento");
  });

  it("borra con el hueco: «Sin especificar» es la marcha atrás", () => {
    assert.equal(categoriaONull(""), null);
  });

  it("no deja entrar un tipo inventado", () => {
    // Entraría en la base y se caería del filtro y de la columna sin decir nada.
    assert.equal(categoriaONull("sala2"), null);
    assert.equal(categoriaONull("Sala / club"), null, "el rótulo no es la clave");
    assert.equal(categoriaONull(undefined), null);
    assert.equal(categoriaONull(null), null);
  });
});

describe("el formulario no borra lo que no pregunta", () => {
  // Los dos sitios mandan el objeto entero en el PUT: lo que no se siembra al
  // abrir viaja vacío y pisa lo que hubiera.
  for (const fichero of [
    "app/(dashboard)/clientes/ClientesClient.jsx",
    "modules/default/ClientDetailModule.jsx",
  ]) {
    it(`${fichero} siembra el tipo al abrir la edición`, () => {
      assert.match(leer(fichero), /categoria: client\.customFields\?\.categoria/);
    });
  }

  it("el PUT solo toca el tipo si viene en el cuerpo", () => {
    // Sin este `in`, el botón que avanza el estado —que manda {status}— le
    // borraría el tipo a la ficha de paso.
    assert.match(leer("app/api/clients/[id]/route.js"), /"categoria" in body/);
  });
});

describe("el Excel dice lo que la pantalla filtra", () => {
  // El Excel filtraba por tipo desde el 28/08/2026 y no lo sacaba: bajabas
  // «festivales» y el fichero no decía de ninguna fila que lo fuera.
  const exportacion = leer("app/api/clients/export/route.js");

  it("saca la columna Tipo, no solo el filtro", () => {
    assert.match(exportacion, /header: "Tipo"/);
    assert.match(exportacion, /searchParams\.get\("categoria"\)/, "y sigue filtrando por él");
  });

  it("la columna va gateada por booking", () => {
    assert.match(exportacion, /hasModule\("booking"\)/, "una columna vacía en una clínica es ruido");
  });

  it("escribe el rótulo humano y no la clave", () => {
    assert.match(exportacion, /rotuloCategoria\(/);
  });
});
