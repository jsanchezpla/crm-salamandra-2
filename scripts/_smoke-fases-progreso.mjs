// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fases-progreso.mjs — cuánto lleva hecha cada fase de un proyecto
 * (01/09/2026, Rodrigo: «una vista para ver todas las fases en orden de
 * porcentaje de compleción»).
 *
 *   node scripts/_smoke-fases-progreso.mjs
 *
 * Prueba `lib/projects/faseProgreso.js`, que es de donde sale TODO el número
 * que se enseña en la vista de Fases: el porcentaje, lo que va con retraso, el
 * estado de cada fase y el orden de la lista.
 *
 * Lo que se fija aquí —y por qué importa cada cosa—:
 *
 *   · UNA FASE VACÍA NO ESTÁ AL 0%, está a `null`. Un 0% dice «sin empezar» y
 *     un 100% dice «hecho»; una fase sin nada no dice ninguna de las dos, y
 *     pintarla al 0% la mete la primera en la lista de lo urgente sin que
 *     nadie haya prometido nada.
 *   · TAREAS Y ENTREGABLES CUENTAN IGUAL. 8 tareas + 2 entregables = 10
 *     unidades al 10% cada una. Un porcentaje que no se puede recalcular a
 *     mano deja de ser un dato.
 *   · «HECHA» ES LA COLUMNA `isDoneColumn`, nunca el nombre de la columna:
 *     cada centro llama a la suya como quiere.
 *   · LO QUE NO TIENE FASE SE VE. Es trabajo real sin colocar, que es justo lo
 *     que hay que colocar; esconderlo sería enseñar un proyecto más ordenado
 *     de lo que está.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resumenDeFase,
  resumenSinFase,
  ordenarFases,
  avanceGlobal,
  ORDENES_FASE,
} from "../lib/projects/faseProgreso.js";

const HOY = "2026-09-01";

const HECHO = { id: "col-done", name: "Terminado", isDoneColumn: true };
const CURSO = { id: "col-wip", name: "En curso", isDoneColumn: false };

const FASE_A = { id: "f1", name: "Preparación", color: "#3B82F6", order: 0, startDate: "2026-08-01", endDate: "2026-08-31" };
const FASE_B = { id: "f2", name: "Ejecución", color: "#22C55E", order: 1, startDate: "2026-09-01", endDate: "2026-10-31" };
const FASE_VACIA = { id: "f3", name: "Cierre", order: 2, endDate: "2026-11-30" };

function tarea(id, phaseId, columna, extra = {}) {
  return { id, phaseId, title: id, boardColumn: columna, assignees: [], ...extra };
}
function entregable(id, phaseId, status, dueDate = null) {
  return { id, phaseId, name: id, status, dueDate };
}

/* ── El porcentaje ────────────────────────────────────────────────────────── */

describe("resumenDeFase · el porcentaje", () => {
  it("tareas y entregables pesan lo mismo: 8 + 2 con 5 hechas = 50%", () => {
    const tareas = [
      ...Array.from({ length: 4 }, (_, i) => tarea(`t${i}`, "f1", HECHO)),
      ...Array.from({ length: 4 }, (_, i) => tarea(`p${i}`, "f1", CURSO)),
    ];
    const entregables = [entregable("e1", "f1", "completed"), entregable("e2", "f1", "pending")];
    const r = resumenDeFase(FASE_A, { tareas, entregables, hoy: HOY });
    assert.equal(r.totales.unidades, 10);
    assert.equal(r.totales.hechas, 5);
    assert.equal(r.porcentaje, 50);
  });

  it("una fase VACÍA está a null, no a 0 ni a 100", () => {
    const r = resumenDeFase(FASE_VACIA, { tareas: [], entregables: [], hoy: HOY });
    assert.equal(r.porcentaje, null);
    assert.equal(r.estado.clave, "vacia");
  });

  it("solo cuenta lo suyo: las tareas de otra fase no la mueven", () => {
    const tareas = [tarea("t1", "f1", HECHO), tarea("t2", "f2", CURSO), tarea("t3", null, CURSO)];
    const r = resumenDeFase(FASE_A, { tareas, entregables: [], hoy: HOY });
    assert.equal(r.totales.tareas, 1);
    assert.equal(r.porcentaje, 100);
  });

  it("«hecha» es isDoneColumn, no el nombre de la columna", () => {
    const disfrazada = { id: "x", name: "Hecho", isDoneColumn: false };
    const r = resumenDeFase(FASE_A, { tareas: [tarea("t1", "f1", disfrazada)], entregables: [], hoy: HOY });
    assert.equal(r.porcentaje, 0);
  });

  it("una tarea sin columna no está hecha", () => {
    const r = resumenDeFase(FASE_A, { tareas: [tarea("t1", "f1", undefined)], entregables: [], hoy: HOY });
    assert.equal(r.porcentaje, 0);
  });
});

/* ── El retraso y el estado ───────────────────────────────────────────────── */

describe("resumenDeFase · qué va con retraso", () => {
  it("cuenta la tarea vencida y sin hacer, no la vencida y hecha", () => {
    const tareas = [
      tarea("tarde", "f1", CURSO, { dueDate: "2026-08-20" }),
      tarea("tarde-pero-hecha", "f1", HECHO, { dueDate: "2026-08-20" }),
      tarea("a-tiempo", "f1", CURSO, { dueDate: "2026-09-30" }),
    ];
    const r = resumenDeFase(FASE_A, { tareas, entregables: [], hoy: HOY });
    assert.equal(r.totales.tareasVencidas, 1);
    assert.equal(r.estado.clave, "retrasada");
  });

  it("un entregable «missed» cuenta como vencido aunque no tuviera fecha", () => {
    const r = resumenDeFase(FASE_B, { tareas: [], entregables: [entregable("e", "f2", "missed")], hoy: HOY });
    assert.equal(r.totales.entregablesVencidos, 1);
    assert.equal(r.estado.clave, "retrasada");
  });

  it("la fase con la fecha de fin pasada va retrasada aunque nada lo esté", () => {
    const r = resumenDeFase(FASE_A, { tareas: [tarea("t", "f1", CURSO)], entregables: [], hoy: HOY });
    assert.equal(r.totales.vencidas, 0);
    assert.equal(r.estado.clave, "retrasada"); // endDate 31/08 < hoy 01/09
  });

  it("completada gana a retrasada: terminar tarde sigue siendo terminar", () => {
    const r = resumenDeFase(FASE_A, { tareas: [tarea("t", "f1", HECHO, { dueDate: "2026-08-01" })], entregables: [], hoy: HOY });
    assert.equal(r.porcentaje, 100);
    assert.equal(r.estado.clave, "completada");
  });

  it("`completedAt` marca la fase como completada aunque queden tareas", () => {
    const cerrada = { ...FASE_B, completedAt: "2026-08-30T10:00:00Z" };
    const r = resumenDeFase(cerrada, { tareas: [tarea("t", "f2", CURSO)], entregables: [], hoy: HOY });
    assert.equal(r.completada, true);
    assert.equal(r.estado.clave, "completada");
  });

  it("sin nada hecho y sin nada vencido: sin empezar", () => {
    const r = resumenDeFase(FASE_B, { tareas: [tarea("t", "f2", CURSO)], entregables: [], hoy: HOY });
    assert.equal(r.estado.clave, "sinEmpezar");
  });
});

/* ── Horas y personas ─────────────────────────────────────────────────────── */

describe("resumenDeFase · horas y personas", () => {
  it("suma las horas estimadas de sus tareas y aguanta las que no tienen", () => {
    const tareas = [
      tarea("a", "f1", CURSO, { estimatedHours: 3 }),
      tarea("b", "f1", CURSO, { estimatedHours: "2.5" }),
      tarea("c", "f1", CURSO, { estimatedHours: null }),
    ];
    assert.equal(resumenDeFase(FASE_A, { tareas, hoy: HOY }).totales.horasEstimadas, 5.5);
  });

  it("lista a cada persona UNA vez aunque lleve varias tareas", () => {
    const ana = { teamMemberId: "tm1", displayName: "Ana" };
    const bea = { teamMemberId: "tm2", displayName: "Bea" };
    const tareas = [
      tarea("a", "f1", CURSO, { assignees: [ana, bea] }),
      tarea("b", "f1", CURSO, { assignees: [ana] }),
    ];
    const r = resumenDeFase(FASE_A, { tareas, hoy: HOY });
    assert.equal(r.personas.length, 2);
    assert.deepEqual(r.personas.map((p) => p.displayName).sort(), ["Ana", "Bea"]);
  });
});

/* ── Lo que no tiene fase ─────────────────────────────────────────────────── */

describe("resumenSinFase", () => {
  it("recoge lo que nadie ha colocado, y solo eso", () => {
    const tareas = [tarea("suelta", null, CURSO), tarea("colocada", "f1", CURSO)];
    const entregables = [entregable("suelto", null, "pending"), entregable("colocado", "f1", "pending")];
    const r = resumenSinFase({ tareas, entregables, hoy: HOY });
    assert.equal(r.id, null);
    assert.equal(r.tareas.length, 1);
    assert.equal(r.entregables.length, 1);
    assert.equal(r.tareas[0].id, "suelta");
    assert.equal(r.entregables[0].id, "suelto");
  });

  it("sin huérfanos queda vacía, y la vista puede decidir no pintarla", () => {
    const r = resumenSinFase({ tareas: [tarea("t", "f1", CURSO)], entregables: [], hoy: HOY });
    assert.equal(r.totales.unidades, 0);
  });
});

/* ── El orden ─────────────────────────────────────────────────────────────── */

describe("ordenarFases", () => {
  const resumenes = [
    { id: "a", orden: 0, porcentaje: 80, endDate: "2026-12-01", totales: { vencidas: 0 } },
    { id: "b", orden: 1, porcentaje: 20, endDate: "2026-09-15", totales: { vencidas: 3 } },
    { id: "c", orden: 2, porcentaje: null, endDate: null, totales: { vencidas: 0 } },
    { id: "d", orden: 3, porcentaje: 50, endDate: "2026-10-01", totales: { vencidas: 1 } },
  ];
  const ids = (clave) => ordenarFases(resumenes, clave).map((r) => r.id);

  it("«plan» respeta el orden del proyecto", () => {
    assert.deepEqual(ids("plan"), ["a", "b", "c", "d"]);
  });

  it("«avance» pone la menos avanzada primero y la vacía al final", () => {
    assert.deepEqual(ids("avance"), ["b", "d", "a", "c"]);
  });

  it("«avanceDesc» lo pone al revés, y la vacía SIGUE al final", () => {
    assert.deepEqual(ids("avanceDesc"), ["a", "d", "b", "c"]);
  });

  it("«fecha» ordena por fecha de fin y manda al final la que no tiene", () => {
    assert.deepEqual(ids("fecha"), ["b", "d", "a", "c"]);
  });

  it("«retraso» pone delante lo que más se está pasando de fecha", () => {
    assert.deepEqual(ids("retraso"), ["b", "d", "a", "c"]);
  });

  it("una clave desconocida no revienta: cae al orden del plan", () => {
    assert.deepEqual(ids("lo-que-sea"), ["a", "b", "c", "d"]);
  });

  it("no toca la lista que le dan", () => {
    const copia = [...resumenes];
    ordenarFases(resumenes, "avance");
    assert.deepEqual(resumenes, copia);
  });

  it("los criterios que ofrece la pantalla existen todos", () => {
    for (const o of ORDENES_FASE) {
      assert.equal(typeof o.etiqueta, "string");
      assert.doesNotThrow(() => ordenarFases(resumenes, o.clave));
    }
  });
});

/* ── El total del proyecto ────────────────────────────────────────────────── */

describe("avanceGlobal", () => {
  it("suma las unidades de todas las fases, no la media de sus porcentajes", () => {
    // Una fase con 1 de 1 (100%) y otra con 1 de 9 (11%) NO son el 55%: son
    // 2 de 10, o sea el 20%. La media de porcentajes miente cuando las fases
    // tienen tamaños distintos, que es siempre.
    const resumenes = [
      { porcentaje: 100, completada: true, totales: { unidades: 1, hechas: 1, vencidas: 0 } },
      { porcentaje: 11, completada: false, totales: { unidades: 9, hechas: 1, vencidas: 2 } },
    ];
    const g = avanceGlobal(resumenes);
    assert.equal(g.porcentaje, 20);
    assert.equal(g.vencidas, 2);
    assert.equal(g.fasesCompletadas, 1);
  });

  it("un proyecto sin nada tiene porcentaje null, no 0", () => {
    assert.equal(avanceGlobal([]).porcentaje, null);
  });
});
