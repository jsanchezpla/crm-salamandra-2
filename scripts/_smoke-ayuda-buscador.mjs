// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-ayuda-buscador.mjs — el buscador de la lista de /ayuda (11/09/2026,
 * AV-0118 de Aumenta, Olga: «dentro de las incidencias que te enviamos
 * podríamos poner un buscador»).
 *
 *   node scripts/_smoke-ayuda-buscador.mjs
 *   node --test-name-pattern="referencia" scripts/_smoke-ayuda-buscador.mjs
 *
 * Fija lo que DEVUELVE `filtrarAvisos` (`lib/buzon/buscarAvisos.js`): por qué
 * campos se busca (asunto, texto, quién lo escribió y referencia, y nada más),
 * que da igual la tilde y la mayúscula, que la referencia se encuentra escrita
 * de cualquier forma, y que el texto y el estado se COMBINAN en vez de pisarse
 * —que fue el fallo de la bandeja del back-office—. Y que la lista de entrada
 * no se toca: es la que cuenta el punto del menú.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filtrarAvisos, coincideAviso, camposBuscables, TODOS } from "../lib/buzon/buscarAvisos.js";
import { referencia } from "../lib/buzon/buzon.js";

// Con la forma que les da `serializarAviso(..., { para: "cliente" })`: la
// referencia ya calculada y el estado ya en el vocabulario de hoy.
function aviso(numero, extra = {}) {
  return {
    id: `id-${numero}`,
    numero,
    ref: referencia(numero),
    tipo: "error",
    asunto: "Un asunto cualquiera",
    cuerpo: "Un cuerpo cualquiera con más de diez letras.",
    estado: "nuevo",
    estadoLabel: "Nuevo",
    usuarioNombre: "Alguien",
    mensajes: [],
    adjuntos: [],
    ...extra,
  };
}

const LISTA = [
  aviso(118, {
    asunto: "Buscador en Ayuda",
    cuerpo: "Dentro de las incidencias podríamos poner un buscador.",
    usuarioNombre: "Begoña",
    estado: "nuevo",
  }),
  aviso(101, {
    asunto: "Facturación: la factura sale sin paciente",
    cuerpo: "Al imprimir no aparece el paciente.",
    usuarioNombre: "Ramón",
    estado: "enviado",
    estadoLabel: "Enviado al registro",
  }),
  aviso(77, {
    asunto: "Agenda a cuartos",
    cuerpo: "Que los huecos sean de quince minutos.",
    usuarioNombre: "Inés Muñoz",
    estado: "enviado",
    estadoLabel: "Enviado al registro",
  }),
  aviso(9, {
    asunto: "No se abre la ficha",
    cuerpo: "Al pulsar en un cliente no pasa nada.",
    usuarioNombre: null,
    estado: "nuevo",
  }),
];

const refs = (lista) => lista.map((a) => a.ref);
const busca = (texto, estado) => refs(filtrarAvisos(LISTA, { texto, estado }));

describe("camposBuscables — por dónde se busca", () => {
  it("la referencia (con y sin guion), el asunto, el texto y quién lo escribió; nada más", () => {
    const a = aviso(123, { asunto: "A", cuerpo: "B", usuarioNombre: "C" });
    assert.deepEqual(camposBuscables(a), ["AV-0123", "AV0123", "A", "B", "C"]);
  });

  it("sin aviso, nada", () => {
    assert.deepEqual(camposBuscables(null), []);
    assert.deepEqual(camposBuscables(undefined), []);
  });
});

describe("filtrarAvisos — el texto", () => {
  it("sin texto devuelve todo, y en una lista NUEVA (la original cuenta el punto del menú)", () => {
    const salida = filtrarAvisos(LISTA);
    assert.deepEqual(refs(salida), refs(LISTA));
    assert.notEqual(salida, LISTA);
    assert.equal(filtrarAvisos(LISTA, { texto: "   " }).length, LISTA.length);
  });

  it("por el asunto", () => {
    assert.deepEqual(busca("buscador"), ["AV-0118"]);
  });

  it("por el texto del aviso", () => {
    assert.deepEqual(busca("quince"), ["AV-0077"]);
  });

  it("por quién lo escribió", () => {
    assert.deepEqual(busca("ramon"), ["AV-0101"]);
  });

  it("sin tildes ni mayúsculas: «facturacion» encuentra «Facturación»", () => {
    assert.deepEqual(busca("facturacion"), ["AV-0101"]);
    assert.deepEqual(busca("FACTURACIÓN"), ["AV-0101"]);
  });

  it("la eñe tampoco hace falta: «munoz» encuentra «Muñoz»", () => {
    assert.deepEqual(busca("munoz"), ["AV-0077"]);
    assert.deepEqual(busca("Muñoz"), ["AV-0077"]);
  });

  it("varias palabras, cada una en un campo distinto y en cualquier orden", () => {
    assert.deepEqual(busca("begoña buscador"), ["AV-0118"]);
    assert.deepEqual(busca("buscador begona"), ["AV-0118"]);
  });

  it("todas las palabras tienen que estar: una que no esté deja la lista vacía", () => {
    assert.deepEqual(busca("buscador factura"), []);
    assert.deepEqual(busca("xyzzy"), []);
  });

  it("un aviso sin nombre de quien lo escribió no revienta y se sigue encontrando", () => {
    assert.deepEqual(busca("ficha"), ["AV-0009"]);
  });

  it("NO busca en el estado ni en el hilo: solo lo que el equipo nos mandó", () => {
    const con = [
      aviso(1, {
        estado: "enviado",
        estadoLabel: "Enviado al registro",
        mensajes: [{ id: "m1", cuerpo: "palabraunica en la respuesta" }],
      }),
    ];
    assert.deepEqual(filtrarAvisos(con, { texto: "registro" }), []);
    assert.deepEqual(filtrarAvisos(con, { texto: "palabraunica" }), []);
  });
});

describe("filtrarAvisos — la referencia, escrita como se escriba", () => {
  for (const forma of ["AV-0118", "av-0118", "AV0118", "av 0118", "0118", "118"]) {
    it(`«${forma}» encuentra AV-0118`, () => {
      assert.deepEqual(busca(forma), ["AV-0118"]);
    });
  }

  it("a medias vale, y saca todas las que empiezan así", () => {
    assert.deepEqual(busca("AV-01"), ["AV-0118", "AV-0101"]);
  });
});

describe("filtrarAvisos — el estado, combinado con el texto", () => {
  it("«todos», vacío o sin decir nada no filtra", () => {
    assert.equal(filtrarAvisos(LISTA, { estado: TODOS }).length, LISTA.length);
    assert.equal(filtrarAvisos(LISTA, { estado: "" }).length, LISTA.length);
    assert.equal(filtrarAvisos(LISTA, { estado: undefined }).length, LISTA.length);
  });

  it("solo los nuevos / solo los enviados", () => {
    assert.deepEqual(busca("", "nuevo"), ["AV-0118", "AV-0009"]);
    assert.deepEqual(busca("", "enviado"), ["AV-0101", "AV-0077"]);
  });

  it("texto y estado a la vez: se suman, no se pisan", () => {
    assert.deepEqual(busca("ficha", "nuevo"), ["AV-0009"]);
    assert.deepEqual(busca("ficha", "enviado"), []);
    assert.deepEqual(busca("a", "enviado"), ["AV-0101", "AV-0077"]);
  });

  it("un estado que no existe no casa con nada", () => {
    assert.deepEqual(busca("", "resuelto"), []);
  });
});

describe("robustez", () => {
  it("lo que no es una lista sale como lista vacía", () => {
    assert.deepEqual(filtrarAvisos(null, { texto: "a" }), []);
    assert.deepEqual(filtrarAvisos(undefined), []);
    assert.deepEqual(filtrarAvisos("no", { texto: "a" }), []);
  });

  it("coincideAviso: sin aviso no casa; sin texto casa siempre", () => {
    assert.equal(coincideAviso(null, "algo"), false);
    assert.equal(coincideAviso(aviso(1), ""), true);
    assert.equal(coincideAviso(aviso(1), undefined), true);
  });
});
