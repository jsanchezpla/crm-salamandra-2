// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clientes-volver.mjs — a dónde vuelve la flecha de una ficha (26/08/2026).
 *
 *   node scripts/_smoke-clientes-volver.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Lau (Aumenta) el 14/08/2026: «cada vez que quiero ir de nuevo a FICHAS A
 * COMPLETAR se me va a PACIENTES». Las cuatro flechas de las dos fichas estaban
 * clavadas a su listado, y la regla nueva vive en `lib/clients/volver.js`.
 *
 * Lo que hay que sostener son dos cosas que se rompen de formas distintas:
 *
 *   · **Que no cambie nada para quien no viene de ahí.** Una ficha abierta desde
 *     el listado, desde el buscador o desde un enlace pegado tiene que seguir
 *     volviendo a su listado. Si `desde` desconocido no cayera al valor por
 *     defecto, la flecha se quedaría sin destino en la pantalla que más se usa.
 *   · **Que `desde` no sea un salto a donde diga la URL.** Llega por la barra de
 *     direcciones, o sea que lo escribe cualquiera: sin lista blanca, un enlace
 *     con `?desde=https://…` convertiría la flecha de volver en un enlace a
 *     donde quiera quien lo mande. Por eso la lista es cerrada y esto se prueba.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colaDeVuelta, enlaceDeVuelta, SITIOS_DE_VUELTA } from "../lib/clients/volver.js";

const PACIENTES = { href: "/pacientes", texto: "Pacientes" };
const CLIENTES = { href: "/clientes", texto: "clientes" };

describe("enlaceDeVuelta", () => {
  it("sin «desde» devuelve el listado de siempre", () => {
    assert.deepEqual(enlaceDeVuelta(null, null, PACIENTES), PACIENTES);
    assert.deepEqual(enlaceDeVuelta(undefined, undefined, CLIENTES), CLIENTES);
    assert.deepEqual(enlaceDeVuelta("", "", PACIENTES), PACIENTES);
  });

  it("desde «Fichas a completar» vuelve a Fichas a completar", () => {
    const v = enlaceDeVuelta("urgentes", null, PACIENTES);
    assert.equal(v.href, "/clientes/urgentes");
    assert.equal(v.texto, "Fichas a completar");
  });

  it("y con la carpeta puesta, para no tener que buscarla otra vez", () => {
    const v = enlaceDeVuelta("urgentes", "sin_contacto", CLIENTES);
    assert.equal(v.href, "/clientes/urgentes?carpeta=sin_contacto");
  });

  it("los espacios de sobra no rompen el destino", () => {
    assert.equal(
      enlaceDeVuelta("  urgentes  ", " muda ", PACIENTES).href,
      "/clientes/urgentes?carpeta=muda"
    );
  });
});

describe("«desde» viene de la URL, así que no puede llevar a cualquier sitio", () => {
  const intentos = [
    "https://otro-sitio.example/roba",
    "//otro-sitio.example",
    "/admin/tablero",
    "../../etc",
    "javascript:alert(1)",
    "URGENTES",
  ];

  for (const malo of intentos) {
    it(`«${malo}» cae al listado por defecto`, () => {
      assert.deepEqual(enlaceDeVuelta(malo, null, PACIENTES), PACIENTES);
    });
  }

  it("una carpeta rara se ignora pero el destino conocido se respeta", () => {
    // La carpeta es adorno: que venga mal no puede tirar la vuelta entera, pero
    // tampoco colarse en la URL.
    const v = enlaceDeVuelta("urgentes", "?otra=cosa&x=1", PACIENTES);
    assert.equal(v.href, "/clientes/urgentes");
    assert.equal(v.texto, "Fichas a completar");
  });

  it("la lista de sitios es cerrada y hoy tiene uno solo", () => {
    assert.deepEqual(Object.keys(SITIOS_DE_VUELTA), ["urgentes"]);
  });
});

describe("colaDeVuelta — lo que se le cuelga al enlace de la fila", () => {
  it("lleva de dónde sale y qué carpeta", () => {
    assert.equal(colaDeVuelta("urgentes", "muda"), "?desde=urgentes&carpeta=muda");
  });

  it("sin carpeta, solo de dónde sale", () => {
    assert.equal(colaDeVuelta("urgentes", null), "?desde=urgentes");
  });

  it("desde un sitio que no está en la lista no cuelga nada", () => {
    // Si colgara la cola igualmente, la ficha recibiría un «desde» que luego
    // ignora: la URL diría una cosa y la flecha haría otra.
    assert.equal(colaDeVuelta("inventado", "muda"), "");
    assert.equal(colaDeVuelta(null, null), "");
  });

  it("ida y vuelta: lo que cuelga el listado es lo que entiende la ficha", () => {
    const cola = colaDeVuelta("urgentes", "sin_contacto");
    const q = new URLSearchParams(cola);
    const v = enlaceDeVuelta(q.get("desde"), q.get("carpeta"), PACIENTES);
    assert.equal(v.href, "/clientes/urgentes?carpeta=sin_contacto");
  });
});
