/**
 * _smoke-citas-familias.mjs — buscar por el nombre del hijo y encontrar a su familia.
 *
 * @prueba ligera
 *
 * Prueba lo que DEVUELVEN las funciones, no cómo están escritas. Lo que vigila
 * son las cuatro formas de equivocarse aquí, todas invisibles hasta que pasan
 * en producción: un paciente sin familia que rompe la consulta, dos hermanos
 * que se pisan, un apellido vacío que deja el nombre a medias, y una lista de
 * ids vacía que se cargaría la búsqueda por nombre de la familia.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  nombreDePaciente,
  agruparPorFamilia,
  conPacientes,
  idsDeFamilia,
} from "../lib/citas/familiasDePacientes.js";

const p = (id, firstName, lastName, clientId) => ({ id, firstName, lastName, clientId });

describe("el nombre que se enseña", () => {
  it("junta nombre y apellidos", () => {
    assert.equal(nombreDePaciente(p("1", "Thiago", "Santos Ejome", "f1")), "Thiago Santos Ejome");
  });

  it("sin apellidos, solo el nombre — y sin espacio de más", () => {
    assert.equal(nombreDePaciente(p("1", "Thiago", "", "f1")), "Thiago");
    assert.equal(nombreDePaciente(p("1", "Thiago", null, "f1")), "Thiago");
  });

  it("entiende también las filas en crudo, con nombres de columna", () => {
    assert.equal(nombreDePaciente({ first_name: "Ana", last_name: "Gómez" }), "Ana Gómez");
  });

  it("no revienta con una fila vacía", () => {
    assert.equal(nombreDePaciente(null), "");
    assert.equal(nombreDePaciente({}), "");
  });
});

describe("agrupar por familia", () => {
  it("cada paciente arrastra a su familia", () => {
    const m = agruparPorFamilia([p("p1", "Thiago", "Santos", "f1")]);
    assert.deepEqual(m.get("f1"), [{ id: "p1", nombre: "Thiago Santos" }]);
  });

  it("dos hermanos caen juntos en la misma familia", () => {
    const m = agruparPorFamilia([
      p("p1", "Thiago", "Santos", "f1"),
      p("p2", "Alma", "Santos", "f1"),
    ]);
    assert.equal(m.size, 1);
    assert.deepEqual(m.get("f1").map((x) => x.nombre), ["Thiago Santos", "Alma Santos"]);
  });

  it("un paciente SIN familia no arrastra a nadie", () => {
    // Es lo que pasa con quien todavía no está enlazado a una ficha: ofrecerlo
    // no serviría de nada, porque el buscador ofrece FICHAS DE CLIENTE.
    const m = agruparPorFamilia([p("p1", "Suelto", "Sin Ficha", null)]);
    assert.equal(m.size, 0);
  });

  it("un paciente sin nombre tampoco", () => {
    assert.equal(agruparPorFamilia([p("p1", "", "", "f1")]).size, 0);
  });

  it("el mismo paciente dos veces se pinta una", () => {
    const m = agruparPorFamilia([p("p1", "Thiago", "Santos", "f1"), p("p1", "Thiago", "Santos", "f1")]);
    assert.equal(m.get("f1").length, 1);
  });

  it("no revienta sin nada que agrupar", () => {
    assert.equal(agruparPorFamilia(null).size, 0);
    assert.equal(agruparPorFamilia([]).size, 0);
  });
});

describe("colgar los pacientes de cada ficha", () => {
  const mapa = agruparPorFamilia([p("p1", "Thiago", "Santos", "f1")]);

  it("la ficha que salió por su hijo lo lleva colgado", () => {
    const [c] = conPacientes([{ id: "f1", name: "Familia Santos" }], mapa);
    assert.deepEqual(c.pacientes, [{ id: "p1", nombre: "Thiago Santos" }]);
  });

  it("la ficha que salió por su propio nombre se queda sin nada que explicar", () => {
    const [c] = conPacientes([{ id: "f2", name: "Álvaro Fraile" }], mapa);
    assert.deepEqual(c.pacientes, []);
  });

  it("no toca el objeto de entrada", () => {
    const original = { id: "f1", name: "Familia Santos" };
    conPacientes([original], mapa);
    assert.equal(original.pacientes, undefined);
  });

  it("no revienta sin fichas ni sin mapa", () => {
    assert.deepEqual(conPacientes([], mapa), []);
    assert.deepEqual(conPacientes(null, null), []);
    assert.deepEqual(conPacientes([{ id: "x" }], null), [{ id: "x", pacientes: [] }]);
  });
});

describe("los ids que se le piden a la base", () => {
  it("salen los de las familias encontradas", () => {
    const m = agruparPorFamilia([p("p1", "A", "A", "f1"), p("p2", "B", "B", "f2")]);
    assert.deepEqual(idsDeFamilia(m).sort(), ["f1", "f2"]);
  });

  it("sin coincidencias, la lista viene VACÍA y quien llama no debe añadir la condición", () => {
    // Un `IN ()` vacío no devuelve nada: si se añadiera igual, buscar por el
    // nombre de la familia dejaría de funcionar.
    assert.deepEqual(idsDeFamilia(agruparPorFamilia([])), []);
    assert.deepEqual(idsDeFamilia(null), []);
  });
});
