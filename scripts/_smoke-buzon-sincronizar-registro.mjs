// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-buzon-sincronizar-registro.mjs — las pestañas del Buzón siguen al
 * Registro (Rodrigo, 15/09/2026).
 *
 *   node scripts/_smoke-buzon-sincronizar-registro.mjs
 *
 * Fija `cambiosPorElRegistro`: cerrar la tarea pasa el aviso a Resuelto,
 * reabrirla lo devuelve a En el registro, lo Activo no se toca; y que un
 * mensaje del cliente reabre lo Resuelto (`estadoTrasMensaje`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cambiosPorElRegistro } from "../lib/buzon/sincronizarConRegistro.js";
import { estadoTrasMensaje } from "../lib/buzon/buzon.js";
import { cerrarTarea, crearTarea } from "../lib/tablero/editor.js";
import { SECCIONES_BACKLOG } from "../lib/tablero/parser.js";

const HOY = new Date(2026, 8, 15, 18, 0);
const BACKLOG = ["# Registro", "", ...SECCIONES_BACKLOG.flatMap((s) => [`## ${s}`, ""])].join("\n");
const RESUELTO = ["# Resuelto", "", "## 14/09/2026", "", "### Algo de ayer · aumenta", "", "Hecho.", ""].join("\n");

function conTarea(backlog, titulo) {
  return crearTarea(backlog, {
    seccion: "Sin comprobar",
    titulo,
    quien: "aumenta",
    cuerpo: "*Se comprueba*: x\n*Comprobado en producción*: no",
  });
}

const aviso = (extra) => ({ id: "a", numero: 42, estado: "enviado", registroFicha: null, ...extra });

describe("cambiosPorElRegistro", () => {
  it("con la tarea abierta en el backlog, nada cambia", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    assert.deepEqual(cambiosPorElRegistro([aviso({ registroFicha: id })], { backlog: texto, resuelto: RESUELTO }), []);
  });

  it("al cerrar la tarea, el aviso pasa a Resuelto", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    const r = cerrarTarea(texto, RESUELTO, { id, comoSeArreglo: "Arreglado.", fecha: HOY });
    const cambios = cambiosPorElRegistro([aviso({ registroFicha: id })], { backlog: r.backlog, resuelto: r.resuelto });
    assert.deepEqual(cambios.map((c) => [c.id, c.a]), [["a", "cerrado"]]);
  });

  it("a mitad de cerrar (Resuelto ya publicado, backlog aún no) no se mueve nada", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    const r = cerrarTarea(texto, RESUELTO, { id, comoSeArreglo: "Arreglado.", fecha: HOY });
    const avisos = [aviso({ registroFicha: id }), aviso({ id: "b", estado: "cerrado", registroFicha: id })];
    assert.deepEqual(cambiosPorElRegistro(avisos, { backlog: texto, resuelto: r.resuelto }), []);
  });

  it("si el backlog aún cita su AV-#### (tarea reescrita sin ficha), sigue en el registro", () => {
    const { texto } = conTarea(BACKLOG, "Buzón - Fallo: no carga (AV-0042)");
    assert.deepEqual(cambiosPorElRegistro([aviso({ registroFicha: "zzzz99" })], { backlog: texto, resuelto: RESUELTO }), []);
  });

  it("una tarea de seguimiento que cita AV-0042 no mantiene abierto el 42 si su tarea ya está en Resuelto", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    const r = cerrarTarea(texto, RESUELTO, { id, comoSeArreglo: "Arreglado.", fecha: HOY });
    const { texto: conSeguimiento } = conTarea(r.backlog, "Lo que queda de AV-0042");
    const cambios = cambiosPorElRegistro([aviso({ registroFicha: id })], { backlog: conSeguimiento, resuelto: r.resuelto });
    assert.deepEqual(cambios.map((c) => c.a), ["cerrado"]);
  });

  it("sin ficha (anterior al botón): solo si Resuelto cita la referencia, y AV-0042 no es AV-00421", () => {
    const resueltoCon = RESUELTO.replace("Hecho.", "Hecho (AV-0042).");
    assert.equal(cambiosPorElRegistro([aviso()], { backlog: BACKLOG, resuelto: resueltoCon })[0].a, "cerrado");
    assert.deepEqual(cambiosPorElRegistro([aviso()], { backlog: BACKLOG, resuelto: RESUELTO }), []);
    const otro = RESUELTO.replace("Hecho.", "Hecho (AV-00421).");
    assert.deepEqual(cambiosPorElRegistro([aviso()], { backlog: BACKLOG, resuelto: otro }), []);
  });

  it("los nombres viejos que se leen como enviado también se cierran", () => {
    const resueltoCon = RESUELTO.replace("Hecho.", "AV-0042");
    const cambios = cambiosPorElRegistro([aviso({ estado: "en_curso" })], { backlog: BACKLOG, resuelto: resueltoCon });
    assert.deepEqual(cambios.map((c) => [c.de, c.a]), [["en_curso", "cerrado"]]);
  });

  it("una tarea reabierta (su ficha vuelve al backlog) devuelve el aviso a En el registro", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    const cambios = cambiosPorElRegistro([aviso({ estado: "cerrado", registroFicha: id })], { backlog: texto, resuelto: RESUELTO });
    assert.deepEqual(cambios.map((c) => c.a), ["enviado"]);
  });

  it("lo Activo no se toca, y una tarea nueva que cita AV-0042 no reabre un Resuelto", () => {
    const { texto, id } = conTarea(BACKLOG, "Otra cosa, relacionado con AV-0042");
    const avisos = [aviso({ estado: "nuevo", registroFicha: id }), aviso({ id: "b", estado: "cerrado" })];
    assert.deepEqual(cambiosPorElRegistro(avisos, { backlog: texto, resuelto: RESUELTO }), []);
  });
});

describe("si vuelven a escribir", () => {
  it("un mensaje del cliente pasa a Activo lo que estaba en Resuelto o En el registro; el nuestro no", () => {
    assert.equal(estadoTrasMensaje("cerrado", "cliente"), "activo");
    assert.equal(estadoTrasMensaje("enviado", "cliente"), "activo");
    assert.equal(estadoTrasMensaje("cerrado", "salamandra"), "cerrado");
    assert.equal(estadoTrasMensaje("nuevo", "cliente"), "nuevo");
  });

  it("lo Activo no lo mueve el Registro, tenga la ficha donde la tenga", () => {
    const { texto, id } = conTarea(BACKLOG, "Buzón - Fallo: no carga");
    const r = cerrarTarea(texto, RESUELTO, { id, comoSeArreglo: "Arreglado.", fecha: HOY });
    const avisos = [aviso({ estado: "activo", registroFicha: id })];
    assert.deepEqual(cambiosPorElRegistro(avisos, { backlog: texto, resuelto: RESUELTO }), []);
    assert.deepEqual(cambiosPorElRegistro(avisos, { backlog: r.backlog, resuelto: r.resuelto }), []);
  });
});
