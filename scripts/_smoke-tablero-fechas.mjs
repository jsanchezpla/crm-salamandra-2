// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tablero-fechas.mjs — ordenar el Registro por cuándo se apuntó cada
 * tarea (26/08/2026).
 *
 *   node scripts/_smoke-tablero-fechas.mjs
 *   node --test-name-pattern="sin fecha" scripts/_smoke-tablero-fechas.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Jorge pidió poder ordenar por fecha («de momento solo está ordenado por
 * prioridad»). La fecha no sale del texto del Registro —el markdown no lleva
 * fechas— sino de `master.tablero_estado.apuntada_en`, que se pega a cada tarea
 * en `conEstado`. O sea que hay dos cosas que se pueden romper sin que se note:
 * que la fecha deje de llegar a la tarea, y que el orden mienta.
 *
 * Lo segundo es el que importa: un orden por fecha que se equivoca no da error,
 * da una lista plausible. Y el caso peligroso no es el de las fechas, es el de
 * las tareas SIN fecha — mientras no se haya sembrado el historial las hay, y
 * un `undefined` colándose en una resta las manda al principio de la lista, que
 * se lee como «esto es lo más antiguo que hay» cuando lo que quiere decir es
 * «no se sabe».
 *
 * Y va aquí también `fundirEstado`, que es de la misma familia: decide qué se
 * conserva cuando dos claves se juntan al reescribir un título. Sin ella,
 * reescribir un título desde el tablero borraría el tick, el reparto y la fecha
 * de verdad, y dejaría la tarea diciendo que se apuntó hoy.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conEstado, fundirEstado, ordenarTareas } from "../lib/tablero/estado.js";

/** Una tarea como la devuelve el troceador, con la fecha ya pegada. */
const tarea = (titulo, apuntadaEn = null) => ({ titulo, apuntadaEn });

/** Los títulos, que es lo único que hace falta mirar para saber el orden. */
const titulos = (lista) => lista.map((t) => t.titulo);

describe("ordenarTareas", () => {
  const lista = [
    tarea("del medio", "2026-08-20T10:00:00.000Z"),
    tarea("la más vieja", "2026-08-12T09:00:00.000Z"),
    tarea("la de hoy", "2026-08-26T08:00:00.000Z"),
  ];

  it("«prioridad» devuelve el orden del documento, sin tocar nada", () => {
    assert.deepEqual(titulos(ordenarTareas(lista, "prioridad")), [
      "del medio",
      "la más vieja",
      "la de hoy",
    ]);
  });

  it("un orden que no existe se comporta como «prioridad»", () => {
    assert.deepEqual(titulos(ordenarTareas(lista, "por-color")), titulos(lista));
    assert.deepEqual(titulos(ordenarTareas(lista, undefined)), titulos(lista));
  });

  it("«recientes» pone arriba lo último que entró", () => {
    assert.deepEqual(titulos(ordenarTareas(lista, "recientes")), [
      "la de hoy",
      "del medio",
      "la más vieja",
    ]);
  });

  it("«antiguas» pone arriba lo que lleva más tiempo esperando", () => {
    assert.deepEqual(titulos(ordenarTareas(lista, "antiguas")), [
      "la más vieja",
      "del medio",
      "la de hoy",
    ]);
  });

  it("no muerde el array que le dan: el orden del documento se conserva", () => {
    const original = [...lista];
    ordenarTareas(lista, "recientes");
    assert.deepEqual(titulos(lista), titulos(original));
  });

  it("dos tareas del mismo día se quedan como estaban (orden estable)", () => {
    const mismoDia = [
      tarea("primera", "2026-08-26T09:00:00.000Z"),
      tarea("segunda", "2026-08-26T09:00:00.000Z"),
      tarea("tercera", "2026-08-26T09:00:00.000Z"),
    ];
    assert.deepEqual(titulos(ordenarTareas(mismoDia, "recientes")), [
      "primera",
      "segunda",
      "tercera",
    ]);
  });
});

describe("las tareas sin fecha", () => {
  const mezcla = [
    tarea("sin fecha"),
    tarea("de ayer", "2026-08-25T10:00:00.000Z"),
    tarea("fecha ilegible", "el martes pasado"),
    tarea("de hace dos semanas", "2026-08-12T10:00:00.000Z"),
  ];

  it("van al final ordenando por «recientes»", () => {
    assert.deepEqual(titulos(ordenarTareas(mezcla, "recientes")), [
      "de ayer",
      "de hace dos semanas",
      "sin fecha",
      "fecha ilegible",
    ]);
  });

  it("y también al final ordenando por «antiguas», que es lo que no es obvio", () => {
    // «No se sabe cuándo se apuntó» no es «se apuntó hace muchísimo». Si se
    // colaran arriba, la lista de lo más antiguo empezaría por lo que no sabe.
    assert.deepEqual(titulos(ordenarTareas(mezcla, "antiguas")), [
      "de hace dos semanas",
      "de ayer",
      "sin fecha",
      "fecha ilegible",
    ]);
  });

  it("una lista entera sin fechas no se descoloca", () => {
    const ninguna = [tarea("una"), tarea("otra"), tarea("la tercera")];
    assert.deepEqual(titulos(ordenarTareas(ninguna, "antiguas")), ["una", "otra", "la tercera"]);
  });

  it("una lista vacía o nula no revienta", () => {
    assert.deepEqual(ordenarTareas([], "recientes"), []);
    assert.deepEqual(ordenarTareas(null, "recientes"), []);
  });
});

describe("la fecha llega a la tarea desde el estado guardado", () => {
  const suelta = { titulo: "Una tarea cualquiera", cuerpo: "" };

  it("se pega la de su fila", () => {
    const estados = new Map([["una-tarea-cualquiera", { apuntadaEn: "2026-08-20T10:00:00.000Z" }]]);
    assert.equal(conEstado(suelta, estados, "backlog").apuntadaEn, "2026-08-20T10:00:00.000Z");
  });

  it("sin fila guardada es null, no undefined", () => {
    // `undefined` desaparece al serializar a JSON y la pantalla recibiría una
    // tarea SIN el campo, que no es lo mismo que una tarea sin fecha.
    assert.equal(conEstado(suelta, new Map(), "backlog").apuntadaEn, null);
  });

  it("una fila que existe pero sin fecha también es null", () => {
    const estados = new Map([["una-tarea-cualquiera", { asignadoA: "jorge" }]]);
    const t = conEstado(suelta, estados, "backlog");
    assert.equal(t.apuntadaEn, null);
    assert.equal(t.asignadoA, "jorge");
  });
});

describe("fundirEstado — reescribir un título junta dos filas", () => {
  /** La fila que traía la tarea con su título de antes: lo sabe todo. */
  const vieja = {
    asignadoA: "rodrigo",
    resuelta: true,
    tocadaPor: "jorge@salamandrasolutions.com",
    solucion: "Se arregla mirando el WHERE",
    apuntadaEn: "2026-08-12T10:00:00.000Z",
  };
  /** La que acaba de crear `sellarAltas` al publicar el título nuevo. */
  const reciennacida = { apuntadaEn: "2026-08-26T09:00:00.000Z" };

  it("la nueva se queda con todo lo de la vieja", () => {
    const funde = fundirEstado(vieja, reciennacida);
    assert.equal(funde.asignadoA, "rodrigo");
    assert.equal(funde.resuelta, true);
    assert.equal(funde.tocadaPor, "jorge@salamandrasolutions.com");
    assert.equal(funde.solucion, "Se arregla mirando el WHERE");
  });

  it("y con la fecha MÁS ANTIGUA: cambiar el nombre no la rejuvenece", () => {
    const funde = fundirEstado(vieja, reciennacida);
    assert.equal(funde.apuntadaEn.toISOString(), "2026-08-12T10:00:00.000Z");
  });

  it("lo que la nueva ya tiene puesto, manda ella", () => {
    const nueva = { asignadoA: "jorge", apuntadaEn: "2026-08-26T09:00:00.000Z" };
    const funde = fundirEstado(vieja, nueva);
    assert.equal("asignadoA" in funde, false);
    assert.equal(funde.solucion, "Se arregla mirando el WHERE");
  });

  it("«reabierta a mano» (resuelta: false) es un valor, no un hueco", () => {
    // Si se tratara como vacío, la nueva heredaría el `true` de la vieja y la
    // tarea se marcharía a Resuelto por haberle cambiado el título.
    const nueva = { resuelta: false };
    assert.equal("resuelta" in fundirEstado(vieja, nueva), false);
  });

  it("si la vieja no tiene fecha, no se toca la de la nueva", () => {
    const funde = fundirEstado({ asignadoA: "jorge" }, reciennacida);
    assert.equal("apuntadaEn" in funde, false);
    assert.equal(funde.asignadoA, "jorge");
  });

  it("si la nueva no tiene fecha, hereda la de la vieja", () => {
    const funde = fundirEstado(vieja, {});
    assert.equal(funde.apuntadaEn.toISOString(), "2026-08-12T10:00:00.000Z");
  });

  it("dos filas vacías no dan nada que escribir", () => {
    assert.deepEqual(fundirEstado({}, {}), {});
    assert.deepEqual(fundirEstado(null, null), {});
  });

  it("si la nueva ya es la más antigua, se queda como está", () => {
    const funde = fundirEstado({ apuntadaEn: "2026-08-26T09:00:00.000Z" }, vieja);
    assert.equal("apuntadaEn" in funde, false);
  });
});
