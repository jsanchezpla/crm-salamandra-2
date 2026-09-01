// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-calendario-categorias.mjs — el catálogo de categorías del Calendario
 * (01/09/2026, Rodrigo: «poder poner categorías en el Calendario con el mismo
 * estilo de los tipos de cita»).
 *
 *   node scripts/_smoke-calendario-categorias.mjs
 *
 * Prueba `lib/calendar/categorias.js`, que es el ÚNICO filtro entre lo que
 * escribe el navegador y la tabla `calendar_categories`: lo comparten el POST,
 * el PATCH y —para el color— el serializador de eventos.
 *
 * Lo que se fija aquí:
 *
 *   · CREAR y EDITAR no son lo mismo. Al crear, el nombre es obligatorio y el
 *     color se rellena solo; al editar solo se tocan las claves que VIENEN, y
 *     por eso el interruptor «activa» de la tabla puede mandar `{active}` a
 *     secas sin borrarle de paso el color y la descripción.
 *   · UN COLOR MAL ESCRITO SE RECHAZA, no se guarda. Un `color` inválido en la
 *     base pinta el evento de nada y no hay forma de verlo desde la pantalla:
 *     es más barato un 422 que un calendario medio invisible.
 *   · `colorDeCategoria` NUNCA devuelve basura: lo que salga de aquí va a un
 *     `style` del navegador, así que o es un hex de siete caracteres o es null.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizarCategoria,
  colorDeCategoria,
  PALETA_CATEGORIAS,
} from "../lib/calendar/categorias.js";

describe("normalizarCategoria · al crear", () => {
  it("el nombre es obligatorio", () => {
    assert.equal(normalizarCategoria({}, { creando: true }).error, "El nombre de la categoría es obligatorio");
    assert.equal(normalizarCategoria({ name: "   " }, { creando: true }).error, "El nombre de la categoría es obligatorio");
    assert.equal(normalizarCategoria({ name: 7 }, { creando: true }).error, "El nombre de la categoría es obligatorio");
  });

  it("sin color elegido se pone el primero de la paleta, no null", () => {
    const { valores, error } = normalizarCategoria({ name: "Reunión" }, { creando: true });
    assert.equal(error, null);
    assert.equal(valores.name, "Reunión");
    assert.equal(valores.color, PALETA_CATEGORIAS[0]);
  });

  it("el color se guarda en mayúsculas, para poder compararlo", () => {
    const { valores } = normalizarCategoria({ name: "X", color: "#3f6e5b" }, { creando: true });
    assert.equal(valores.color, "#3F6E5B");
  });

  it("el nombre se recorta y se acota a 80 caracteres", () => {
    const { valores } = normalizarCategoria({ name: `  ${"a".repeat(120)}  ` }, { creando: true });
    assert.equal(valores.name.length, 80);
  });
});

describe("normalizarCategoria · al editar", () => {
  it("solo toca lo que viene: mandar {active} no borra color ni descripción", () => {
    const { valores, error } = normalizarCategoria({ active: false });
    assert.equal(error, null);
    assert.deepEqual(valores, { active: false });
  });

  it("`active` solo es false cuando se dice false explícito", () => {
    assert.equal(normalizarCategoria({ active: false }).valores.active, false);
    assert.equal(normalizarCategoria({ active: true }).valores.active, true);
    // Cualquier otra cosa que venga se lee como «sí»: el interruptor de la
    // pantalla manda booleanos, y un undefined no puede desactivar nada.
    assert.equal(normalizarCategoria({ active: "sí" }).valores.active, true);
  });

  it("una descripción vacía se guarda como null, no como cadena vacía", () => {
    assert.equal(normalizarCategoria({ description: "   " }).valores.description, null);
    assert.equal(normalizarCategoria({ description: "Para las reuniones" }).valores.description, "Para las reuniones");
  });

  it("quitar el color al editar sí deja null (a diferencia de al crear)", () => {
    assert.equal(normalizarCategoria({ color: "" }).valores.color, null);
  });

  it("el orden acepta una cadena numérica y descarta lo que no lo es", () => {
    assert.equal(normalizarCategoria({ order: "3" }).valores.order, 3);
    assert.equal(normalizarCategoria({ order: 2.7 }).valores.order, 2);
    assert.equal(normalizarCategoria({ order: "el tercero" }).valores.order, 0);
  });
});

describe("normalizarCategoria · el color mal escrito se rechaza", () => {
  for (const malo of ["rojo", "#FFF", "3F6E5B", "#GGGGGG", "#3F6E5B ; background:url(x)"]) {
    it(`«${malo}» no entra`, () => {
      const { valores, error } = normalizarCategoria({ name: "X", color: malo }, { creando: true });
      assert.equal(error, "El color tiene que ser un hexadecimal tipo #3F6E5B");
      assert.deepEqual(valores, {});
    });
  }
});

describe("colorDeCategoria", () => {
  it("devuelve el hex en mayúsculas cuando vale", () => {
    assert.equal(colorDeCategoria({ color: "#3f6e5b" }), "#3F6E5B");
    assert.equal(colorDeCategoria({ color: "  #2563EB " }), "#2563EB");
  });

  it("null en todo lo demás — nunca una cadena rara en un style", () => {
    assert.equal(colorDeCategoria(null), null);
    assert.equal(colorDeCategoria({}), null);
    assert.equal(colorDeCategoria({ color: "" }), null);
    assert.equal(colorDeCategoria({ color: "azul" }), null);
    assert.equal(colorDeCategoria({ color: 123 }), null);
  });
});

describe("PALETA_CATEGORIAS", () => {
  it("son diez colores distintos y todos hexadecimales válidos", () => {
    assert.equal(PALETA_CATEGORIAS.length, 10);
    assert.equal(new Set(PALETA_CATEGORIAS).size, 10);
    for (const c of PALETA_CATEGORIAS) assert.equal(colorDeCategoria({ color: c }), c);
  });

  it("ninguno coincide con los de prioridad: son dos lecturas distintas", () => {
    const prioridad = new Set(["#EF4444", "#F97316", "#22C55E"]);
    for (const c of PALETA_CATEGORIAS) assert.equal(prioridad.has(c.toUpperCase()), false);
  });
});
