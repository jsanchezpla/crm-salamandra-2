/**
 * _smoke-ficheros-soltados.mjs — qué se acepta al SOLTAR un fichero.
 *
 * @prueba ligera
 *
 * Prueba lo que DEVUELVE `aceptaFichero` / `repartirSoltados`, no cómo están
 * escritas. Lo que vigila de verdad es la forma de equivocarse que motivó el
 * fichero: que soltar algo que no es un audio sobre la zona del audio se lo
 * trague en silencio y quede guardado como si fuera la grabación.
 *
 * El caso de Lau (nota de voz de WhatsApp, `.ogg`, a veces sin `type`) tiene su
 * prueba propia: es el que hay que no romper.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aceptaFichero, repartirSoltados, avisoDeRechazo } from "../lib/utils/ficherosSoltados.js";

// El `accept` real de las dos zonas de /pacientes/[id]/sesiones/nueva.
const AUDIO = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4";
const PREP = "image/*,audio/*,application/pdf";

const f = (name, type = "") => ({ name, type });

describe("la nota de voz de WhatsApp, que es el caso que lo motivó", () => {
  it("entra por su tipo", () => {
    assert.equal(aceptaFichero(f("WhatsApp Ptt 2026-08-28.ogg", "audio/ogg"), AUDIO), true);
  });

  it("entra también si el navegador no sabe decir el tipo", () => {
    // Pasa según de dónde se arrastre: el `type` llega vacío y solo queda el nombre.
    assert.equal(aceptaFichero(f("WhatsApp Ptt 2026-08-28.ogg", ""), AUDIO), true);
  });

  it("y en mayúsculas, que es como las escribe media Windows", () => {
    assert.equal(aceptaFichero(f("AUDIO.OGG", ""), AUDIO), true);
    assert.equal(aceptaFichero(f("Sesion.M4A", ""), AUDIO), true);
  });
});

describe("lo que NO puede colarse como audio", () => {
  it("un PDF soltado en la zona del audio se rechaza", () => {
    assert.equal(aceptaFichero(f("informe.pdf", "application/pdf"), AUDIO), false);
  });

  it("una foto tampoco", () => {
    assert.equal(aceptaFichero(f("foto.jpg", "image/jpeg"), AUDIO), false);
  });

  it("ni un fichero sin tipo ni extensión conocida", () => {
    assert.equal(aceptaFichero(f("apuntes", ""), AUDIO), false);
    assert.equal(aceptaFichero(f("hoja.xlsx", ""), AUDIO), false);
  });

  it("un tipo vacío no cuela por la regla de tipo exacto", () => {
    // `application/pdf` no puede casar con un fichero cuyo `type` es "".
    assert.equal(aceptaFichero(f("cosa", ""), "application/pdf"), false);
  });
});

describe("la zona de Preparación admite las tres familias", () => {
  it("imagen, audio y PDF", () => {
    assert.equal(aceptaFichero(f("foto.jpg", "image/jpeg"), PREP), true);
    assert.equal(aceptaFichero(f("nota.ogg", "audio/ogg"), PREP), true);
    assert.equal(aceptaFichero(f("pauta.pdf", "application/pdf"), PREP), true);
  });

  it("pero no una hoja de cálculo", () => {
    assert.equal(
      aceptaFichero(f("datos.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), PREP),
      false
    );
  });
});

describe("el reparto", () => {
  it("separa los buenos de los malos manteniendo el orden", () => {
    const { aceptados, rechazados } = repartirSoltados(
      [f("a.ogg", "audio/ogg"), f("b.pdf", "application/pdf"), f("c.mp3", "audio/mpeg")],
      AUDIO
    );
    assert.deepEqual(aceptados.map((x) => x.name), ["a.ogg", "c.mp3"]);
    assert.deepEqual(rechazados.map((x) => x.name), ["b.pdf"]);
  });

  it("no revienta sin nada que repartir", () => {
    assert.deepEqual(repartirSoltados(null, AUDIO), { aceptados: [], rechazados: [] });
    assert.deepEqual(repartirSoltados([], AUDIO), { aceptados: [], rechazados: [] });
  });

  it("sin `accept`, todo vale (es lo que hace un input sin el atributo)", () => {
    const { aceptados } = repartirSoltados([f("x.zip", "application/zip")], "");
    assert.equal(aceptados.length, 1);
  });
});

describe("el aviso", () => {
  it("no dice nada si no hay nada que rechazar", () => {
    assert.equal(avisoDeRechazo([], "un audio"), null);
    assert.equal(avisoDeRechazo(null, "un audio"), null);
  });

  it("nombra el fichero y qué se esperaba", () => {
    const aviso = avisoDeRechazo([f("informe.pdf")], "un audio");
    assert.ok(aviso.includes("informe.pdf"));
    assert.ok(aviso.includes("un audio"));
  });

  it("con muchos, no vomita la lista entera", () => {
    const aviso = avisoDeRechazo([f("1.pdf"), f("2.pdf"), f("3.pdf"), f("4.pdf"), f("5.pdf")], "un audio");
    assert.ok(aviso.includes("y 2 más"));
    assert.ok(!aviso.includes("5.pdf"));
  });
});
