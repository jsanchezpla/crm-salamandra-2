// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-buzon-al-registro.mjs — el botón «Enviar al registro» del Buzón
 * (02/09/2026, Rodrigo: «el objetivo de una tarea del buzón es enviarlo al
 * registro para que ahí se arregle»).
 *
 *   node scripts/_smoke-buzon-al-registro.mjs
 *
 * Fija la tarea que sale de un aviso (`lib/buzon/alRegistro.js`): título con
 * el prefijo por tipo, sección «Sin comprobar», el slug como cliente, lo que
 * cuenta el cliente sin nada que parta la tarea, y que el bloque entra por la
 * misma puerta que el tablero (`crearTarea`) y se vuelve a encontrar por su
 * ficha. Y los dos estados del Buzón, con la lectura de los tres nombres viejos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PREFIJO_POR_TIPO,
  ddmmaaaa,
  sinEstructura,
  tituloDeAviso,
  tareaDesdeAviso,
  yaEstaEnElRegistro,
  capturasQueViajan,
  lineaDeCapturas,
} from "../lib/buzon/alRegistro.js";
import {
  ESTADOS,
  ESTADOS_ANTIGUOS,
  estadoActual,
  estadoTrasMensaje,
  validarCambio,
  serializarAviso,
} from "../lib/buzon/buzon.js";
import { crearTarea, localizar, MAX_TITULO, SIN_COMPROBAR } from "../lib/tablero/editor.js";
import { trocearTodo, SECCIONES_BACKLOG } from "../lib/tablero/parser.js";

const HOY = new Date("2026-09-02T18:30:00.000Z");

function aviso(extra = {}) {
  return {
    id: "av-1",
    numero: 31,
    tipo: "error",
    asunto: "No se guarda la cita cuando cambio la hora",
    cuerpo: "Cambio la hora desde el modal y al guardar vuelve a la hora de antes.\n\nMe pasa con cualquier paciente.",
    bloquea: true,
    tenantSlug: "aumenta",
    tenantNombre: "Aumenta",
    usuarioNombre: "Olga",
    pantalla: "/citas",
    createdAt: "2026-09-02T09:15:00.000Z",
    mensajes: [],
    ...extra,
  };
}

/** Un backlog vacío con las cinco secciones, como el de verdad. */
const BACKLOG = ["# Registro", "", ...SECCIONES_BACKLOG.flatMap((s) => [`## ${s}`, ""])].join("\n");

describe("tituloDeAviso", () => {
  it("prefijo por tipo, en una línea, sin el «·» que parte la cabecera", () => {
    assert.equal(tituloDeAviso(aviso()), "Buzón - Fallo: No se guarda la cita cuando cambio la hora");
    assert.equal(tituloDeAviso(aviso({ tipo: "duda", asunto: "  ¿Cómo\n imprimo? " })), "Buzón - Duda: ¿Cómo imprimo?");
    assert.equal(tituloDeAviso(aviso({ tipo: "mejora", asunto: "Agenda · por colores" })), "Buzón - Mejora: Agenda - por colores");
    assert.equal(tituloDeAviso(aviso({ tipo: "raro", asunto: "" })), "Buzón - Aviso: (sin asunto)");
    assert.deepEqual(Object.keys(PREFIJO_POR_TIPO), ["error", "duda", "mejora"]);
  });

  it("cabe en el tope del Registro aunque el asunto sea larguísimo", () => {
    const t = tituloDeAviso(aviso({ asunto: "x".repeat(400) }));
    assert.equal(t.length, MAX_TITULO);
    assert.ok(t.endsWith("…"));
  });
});

describe("sinEstructura y ddmmaaaa", () => {
  it("una línea con «#» o una ficha dentro del texto del cliente no parten la tarea", () => {
    assert.equal(sinEstructura("## Título\r\n\r\n\r\n### otro\n<!--id:abc-->"), "Título\n\notro\n<!- -id:abc-->");
    assert.equal(sinEstructura(null), "");
  });

  it("la fecha sale dd/mm/aaaa en hora de Madrid, y no revienta sin fecha", () => {
    assert.equal(ddmmaaaa("2026-09-02T22:30:00.000Z"), "03/09/2026");
    assert.equal(ddmmaaaa(HOY), "02/09/2026");
    assert.equal(ddmmaaaa(null), "fecha desconocida");
    assert.equal(ddmmaaaa("no es fecha"), "fecha desconocida");
  });
});

describe("tareaDesdeAviso", () => {
  it("va a «Sin comprobar», con el slug como cliente y las tres líneas de rigor", () => {
    const t = tareaDesdeAviso(aviso(), { hoy: HOY });
    assert.equal(t.seccion, SIN_COMPROBAR);
    assert.equal(t.quien, "aumenta");
    assert.equal(t.titulo, "Buzón - Fallo: No se guarda la cita cuando cambio la hora");
    assert.match(t.cuerpo, /^\*\*Lo que nos cuentan\.\*\* Cambio la hora desde el modal/);
    assert.match(t.cuerpo, /\n\nMe pasa con cualquier paciente\.\n/);
    assert.match(t.cuerpo, /AV-0031 de Aumenta, escrito por Olga el 02\/09\/2026; dice que le impide trabajar\./);
    assert.match(t.cuerpo, /Enviado al Registro desde el Buzón el 02\/09\/2026\./);
    assert.match(t.cuerpo, /\n\*Se comprueba\*: /);
    assert.match(t.cuerpo, /\n\*Dónde\*: `\/citas`, la pantalla desde la que escribió\./);
    assert.match(t.cuerpo, /\n\*Comprobado en producción\*: sin comprobar; entró desde el Buzón el 02\/09\/2026/);
  });

  it("sin pantalla, sin nombre y sin bloquear lo dice; el hilo cuenta solo los mensajes que ve el cliente", () => {
    const t = tareaDesdeAviso(
      aviso({
        pantalla: null,
        usuarioNombre: "",
        bloquea: false,
        tenantNombre: null,
        mensajes: [{ interno: false }, { interno: true }, { interno: false }],
      }),
      { hoy: HOY }
    );
    assert.match(
      t.cuerpo,
      /AV-0031 de aumenta, escrito por alguien del centro el 02\/09\/2026; no marcó que le impida trabajar\. El hilo lleva 2 mensajes/
    );
    assert.match(t.cuerpo, /\*Dónde\*: no dijo desde qué pantalla\./);
    assert.equal(tareaDesdeAviso(aviso({ tenantSlug: " " }), { hoy: HOY }).quien, "varios");
  });

  it("el bloque entra por la misma puerta que el tablero y se vuelve a encontrar por su ficha, en «Sin comprobar»", () => {
    const t = tareaDesdeAviso(aviso({ cuerpo: "# esto parecería un título\n\ny <!--id:zzzz--> una ficha" }), { hoy: HOY });
    const { texto, id } = crearTarea(BACKLOG, t);
    const donde = localizar(texto, { id });
    assert.ok(donde, "la tarea no se encuentra por su ficha");
    assert.equal(donde.seccion.titulo, SIN_COMPROBAR);
    assert.equal(donde.tarea.titulo, t.titulo);
    assert.equal(donde.tarea.quien, "aumenta");
    // Y una sola tarea en el documento, con sus cinco secciones: nada de lo
    // que escribió el cliente se ha leído como estructura.
    const troceado = trocearTodo(texto);
    assert.equal(troceado.secciones.flatMap((s) => s.tareas).length, 1);
    assert.equal(troceado.secciones.length, SECCIONES_BACKLOG.length);
    assert.equal(troceado.huerfanas.length, 0);
  });
});

describe("las capturas viajan con la tarea (03/09/2026)", () => {
  const adj = (nombre, createdAt, extra = {}) => ({
    id: `id-${nombre}`,
    nombre,
    ruta: `buzon/aumenta/av-1/${nombre}`,
    bytes: 1000,
    createdAt,
    ...extra,
  });

  it("sin capturas no se escribe ninguna línea de capturas", () => {
    assert.deepEqual(capturasQueViajan(aviso()), { viajan: [], quedan: 0 });
    assert.equal(lineaDeCapturas({ viajan: [], quedan: 0 }), null);
    assert.doesNotMatch(tareaDesdeAviso(aviso(), { hoy: HOY }).cuerpo, /Capturas/);
  });

  it("van por orden de llegada, también las del hilo, y como mucho tres; el resto se dice", () => {
    const a = aviso({
      adjuntos: [
        adj("tres.png", "2026-09-02T09:20:00.000Z", { mensajeId: "m1" }),
        adj("uno.png", "2026-09-02T09:15:00.000Z"),
        adj("cuatro.jpg", "2026-09-02T10:00:00.000Z", { mensajeId: "m2" }),
        adj("dos.png", "2026-09-02T09:16:00.000Z"),
        { id: "rota", nombre: "sin-ruta.png", ruta: null, createdAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const { viajan, quedan } = capturasQueViajan(a);
    assert.deepEqual(
      viajan.map((x) => x.nombre),
      ["uno.png", "dos.png", "tres.png"]
    );
    assert.equal(quedan, 1);
    const t = tareaDesdeAviso(a, { hoy: HOY });
    assert.match(t.cuerpo, /\n\*\*Capturas\.\*\* Lleva 3 capturas del Buzón \(«uno\.png», «dos\.png», «tres\.png»\), colgadas de esta tarea en el Registro/);
    assert.match(t.cuerpo, /registro\.mjs capturas <ficha>/);
    assert.match(t.cuerpo, /Otra captura se queda en el Buzón porque una tarea admite 3: se ven en \/admin\/buzon\./);
    // La línea va entre «De dónde sale» y las tres de rigor, y el bloque sigue
    // siendo UNA tarea para el troceador.
    assert.ok(t.cuerpo.indexOf("**De dónde sale.**") < t.cuerpo.indexOf("**Capturas.**"));
    assert.ok(t.cuerpo.indexOf("**Capturas.**") < t.cuerpo.indexOf("*Se comprueba*"));
    const { texto } = crearTarea(BACKLOG, t);
    assert.equal(trocearTodo(texto).secciones.flatMap((s) => s.tareas).length, 1);
  });

  it("con una sola lo dice en singular, y un nombre con salto de línea se aplana", () => {
    const t = tareaDesdeAviso(aviso({ adjuntos: [adj("foto\ndel móvil.jpg", "2026-09-02T09:15:00.000Z")] }), { hoy: HOY });
    assert.match(t.cuerpo, /\*\*Capturas\.\*\* Lleva 1 captura del Buzón \(«foto del móvil\.jpg»\)/);
    assert.doesNotMatch(t.cuerpo, /se queda/);
  });
});

describe("yaEstaEnElRegistro", () => {
  it("encuentra la referencia exacta y no una que solo empieza igual", () => {
    assert.equal(yaEstaEnElRegistro("… (AV-0031, Aumenta) …", 31), true);
    assert.equal(yaEstaEnElRegistro("… AV-00310 …", 31), false);
    assert.equal(yaEstaEnElRegistro("… AV-0003 …", 31), false);
    assert.equal(yaEstaEnElRegistro("", 31), false);
    assert.equal(yaEstaEnElRegistro("AV-????", null), false);
  });
});

describe("los dos estados del Buzón (02/09/2026)", () => {
  it("nuevo → enviado, y los tres nombres viejos se leen como hoy", () => {
    assert.deepEqual(
      ESTADOS.map((e) => e.key),
      ["nuevo", "enviado"]
    );
    assert.deepEqual(ESTADOS_ANTIGUOS, { en_curso: "enviado", esperando: "nuevo", resuelto: "enviado" });
    assert.equal(estadoActual("en_curso"), "enviado");
    assert.equal(estadoActual("esperando"), "nuevo");
    assert.equal(estadoActual("resuelto"), "enviado");
    assert.equal(estadoActual("nuevo"), "nuevo");
  });

  it("los viejos ya no se pueden ESCRIBIR desde el panel; «resuelto» tampoco, el Buzón acaba en el Registro", () => {
    assert.equal(validarCambio({ estado: "en_curso" }).ok, false);
    assert.equal(validarCambio({ estado: "esperando" }).ok, false);
    assert.equal(validarCambio({ estado: "resuelto" }).ok, false);
    assert.equal(validarCambio({ estado: "enviado" }).ok, true);
    assert.equal(validarCambio({ estado: "nuevo" }).ok, true);
  });

  it("una fila vieja sale serializada con el nombre de hoy, y la ficha del Registro solo la vemos nosotros", () => {
    const fila = {
      ...aviso(),
      estado: "en_curso",
      adjuntos: [],
      registroFicha: "abc123",
      registroEnviadoAt: "2026-09-02T18:00:00.000Z",
    };
    const nuestro = serializarAviso(fila, { para: "salamandra" });
    assert.equal(nuestro.estado, "enviado");
    assert.equal(nuestro.estadoLabel, "Enviado al registro");
    assert.equal(nuestro.estadoNivel, "blue");
    assert.equal(nuestro.registroFicha, "abc123");
    assert.equal(nuestro.registroEnviadoAt, "2026-09-02T18:00:00.000Z");
    const suyo = serializarAviso(fila, { para: "cliente" });
    assert.equal(suyo.estado, "enviado");
    assert.equal(suyo.estadoLabel, "Enviado al registro");
    assert.equal("registroFicha" in suyo, false);
  });

  it("un mensaje no mueve nada: el estado solo dice si está en el Registro", () => {
    const tabla = {};
    for (const estado of ["nuevo", "enviado", "resuelto", "en_curso", "esperando", "archivado"]) {
      tabla[estado] = {
        salamandra: estadoTrasMensaje(estado, "salamandra"),
        cliente: estadoTrasMensaje(estado, "cliente"),
      };
    }
    assert.deepEqual(tabla, {
      nuevo: { salamandra: "nuevo", cliente: "nuevo" },
      enviado: { salamandra: "enviado", cliente: "enviado" },
      resuelto: { salamandra: "enviado", cliente: "enviado" },
      en_curso: { salamandra: "enviado", cliente: "enviado" },
      esperando: { salamandra: "nuevo", cliente: "nuevo" },
      archivado: { salamandra: "nuevo", cliente: "nuevo" },
    });
  });
});
