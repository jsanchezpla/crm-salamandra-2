// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-buzon-mensajes-resuelto.mjs — la pestaña «Mensajes» y «Enviar a
 * Resuelto» del Buzón (Rodrigo, 15/09/2026).
 *
 *   node scripts/_smoke-buzon-mensajes-resuelto.mjs
 *
 * Fija cuándo un aviso nuestro espera respuesta (y deja de hacerlo al
 * contestar), y que la entrada directa a Resuelto es un documento que
 * `comprobar` da por bueno: bajo la fecha de hoy, arriba, con ficha y con
 * «Cómo se arregló».
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entradaDeResuelto, notaDeCierre, tituloDeAviso } from "../lib/buzon/alRegistro.js";
import { esperaSuRespuesta, serializarAviso } from "../lib/buzon/buzon.js";
import { apuntarEnResuelto, cerrarTarea, crearTarea, localizar } from "../lib/tablero/editor.js";
import { comprobar, SECCIONES_BACKLOG } from "../lib/tablero/parser.js";

const HOY = new Date(2026, 8, 15, 18, 0);

function nuestro(extra = {}) {
  return {
    id: "av-144",
    numero: 144,
    tipo: "duda",
    estado: "nuevo",
    asunto: "Empezar desde lo que ya hay",
    cuerpo: "Hola Olga, te cuento cómo se hace.\n# esto no parte nada",
    tenantSlug: "aumenta",
    tenantNombre: "Aumenta",
    usuarioNombre: "Olga",
    contexto: { origen: "salamandra", firmante: "Rodrigo" },
    createdAt: "2026-09-15T10:00:00.000Z",
    clienteEscribioAt: null,
    mensajes: [],
    adjuntos: [],
    ...extra,
  };
}

const RESUELTO = ["# Resuelto", "", "## 14/09/2026", "", "### Algo de ayer · aumenta", "", "Hecho.", ""].join("\n");

describe("«Mensajes»: lo nuestro sin contestar", () => {
  it("un mensaje nuestro sin respuesta espera; en cuanto escribe, deja de esperar", () => {
    assert.equal(esperaSuRespuesta(nuestro()), true);
    assert.equal(esperaSuRespuesta(nuestro({ clienteEscribioAt: "2026-09-15T11:00:00.000Z" })), false);
  });

  it("lo que abre el cliente nunca está en Mensajes, y lo ya enviado o cerrado tampoco", () => {
    assert.equal(esperaSuRespuesta(nuestro({ contexto: {} })), false);
    assert.equal(esperaSuRespuesta(nuestro({ estado: "enviado" })), false);
    assert.equal(esperaSuRespuesta(nuestro({ estado: "cerrado" })), false);
  });

  it("la bandeja lo recibe marcado, y la pantalla del cliente no", () => {
    assert.equal(serializarAviso(nuestro(), { para: "salamandra" }).esperaSuRespuesta, true);
    assert.equal("esperaSuRespuesta" in serializarAviso(nuestro(), { para: "cliente" }), false);
  });
});

describe("Enviar a Resuelto", () => {
  it("un mensaje nuestro se titula como mensaje, no como la duda de nadie", () => {
    assert.equal(tituloDeAviso(nuestro()), "Buzón - Mensaje: Empezar desde lo que ya hay");
    assert.equal(tituloDeAviso(nuestro({ contexto: {} })), "Buzón - Duda: Empezar desde lo que ya hay");
  });

  it("sin nota pone una por defecto; con nota, la suya sin «#» que parta la entrada", () => {
    assert.match(notaDeCierre(nuestro(), ""), /mensaje nuestro/);
    assert.match(notaDeCierre(nuestro({ contexto: {} }), "  "), /Se contestó desde el Buzón/);
    assert.equal(notaDeCierre(nuestro(), "## Se le explicó"), "Se le explicó");
  });

  it("la entrada va bajo HOY, arriba del todo, con ficha, y el documento sigue siendo válido", () => {
    const entrada = entradaDeResuelto(nuestro(), { hoy: HOY, nota: "Se le mandó la guía." });
    const { texto, id } = apuntarEnResuelto(RESUELTO, entrada);
    assert.ok(texto.indexOf("## 15/09/2026") < texto.indexOf("## 14/09/2026"));
    assert.equal(comprobar(texto, "resuelto").errores.length, 0);
    const donde = localizar(texto, { id });
    assert.equal(donde.seccion.titulo, "15/09/2026");
    assert.match(donde.tarea.cuerpo, /\*\*Cómo se arregló\.\*\* Se le mandó la guía\./);
    assert.match(donde.tarea.cuerpo, /AV-0144, mensaje de Rodrigo a Olga \(Aumenta\)/);
  });

  it("dos veces el mismo aviso el mismo día se para, en vez de romper el documento", () => {
    const entrada = { ...entradaDeResuelto(nuestro(), { hoy: HOY }), senal: "AV-0144" };
    const { texto } = apuntarEnResuelto(RESUELTO, entrada);
    assert.throws(() => apuntarEnResuelto(texto, entrada), /ya hay en Resuelto/);
  });

  /*
   * Lo que no se repite es el AVISO, no el asunto: dos mensajes distintos con
   * el mismo título son dos entradas, cada una con su ficha. Antes se miraba el
   * título y el segundo no se podía enviar nunca (19/09/2026).
   */
  it("otro aviso con el mismo asunto sí entra, y el documento sigue siendo válido", () => {
    const uno = { ...entradaDeResuelto(nuestro(), { hoy: HOY }), senal: "AV-0144" };
    const { texto } = apuntarEnResuelto(RESUELTO, uno);
    const otro = {
      ...entradaDeResuelto(nuestro({ id: "av-145", numero: 145 }), { hoy: HOY }),
      senal: "AV-0145",
    };
    const segundo = apuntarEnResuelto(texto, otro);
    const r = comprobar(segundo.texto, "resuelto");
    assert.deepEqual(r.errores, []);
    assert.equal(localizar(segundo.texto, { id: segundo.id }).seccion.titulo, "15/09/2026");
  });

  it("lo del cliente lleva lo que contestamos (no las notas internas)", () => {
    const aviso = nuestro({
      contexto: {},
      mensajes: [
        { autorTipo: "salamandra", interno: true, cuerpo: "nota nuestra", createdAt: "2026-09-15T10:05:00Z" },
        { autorTipo: "salamandra", interno: false, cuerpo: "Se hace desde Ajustes.", createdAt: "2026-09-15T10:10:00Z" },
      ],
    });
    const { cuerpo } = entradaDeResuelto(aviso, { hoy: HOY });
    assert.match(cuerpo, /\*\*Lo que contestamos\.\*\* Se hace desde Ajustes\./);
    assert.doesNotMatch(cuerpo, /nota nuestra/);
  });

  it("si ya tenía tarea en el backlog, cerrarla la saca de allí y la deja en Resuelto con la misma ficha", () => {
    const backlog = ["# Registro", "", ...SECCIONES_BACKLOG.flatMap((s) => [`## ${s}`, ""])].join("\n");
    const { texto, id } = crearTarea(backlog, {
      seccion: "Sin comprobar",
      titulo: tituloDeAviso(nuestro({ contexto: {} })),
      quien: "aumenta",
      cuerpo: "*Se comprueba*: x\n*Comprobado en producción*: no",
    });
    const r = cerrarTarea(texto, RESUELTO, { id, comoSeArreglo: notaDeCierre(nuestro(), ""), fecha: HOY });
    assert.equal(localizar(r.backlog, { id }), null);
    assert.equal(localizar(r.resuelto, { id }).seccion.titulo, "15/09/2026");
  });
});
