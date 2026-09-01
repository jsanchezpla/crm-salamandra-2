// @prueba ligera
/**
 * _smoke-documentos-lecturas.mjs — las reglas del «documento por leer»
 * (01/09/2026, Rodrigo).
 *
 * Fija lo que DEVUELVE `lib/documents/lecturas.js`, que es donde vive el
 * comportamiento que se reparte por cuatro pantallas:
 *
 *   · lo que llega del navegador se limpia (multipart manda texto, no arrays);
 *   · el resumen de un documento dice cuántos lo han leído y si me toca a mí;
 *   · reasignar lectores NO borra un acuse ya firmado.
 *
 * Esa última es la que de verdad hay que blindar: es una decisión de producto
 * («¿se enteró todo el mundo?» tiene que seguir teniendo respuesta) y se pierde
 * con un `destroy` mal filtrado que ninguna pantalla enseñaría.
 *
 * Los modelos son de mentira: aquí no hay base de datos ni servidor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizaLectores, resumenDeLecturas, sincronizaLectores, MAX_LECTORES } from "../lib/documents/lecturas.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

// ── normalizaLectores ───────────────────────────────────────────────────────

test("normalizaLectores acepta un array y quita repetidos", () => {
  assert.deepEqual(normalizaLectores([A, B, A]), [A, B]);
});

test("normalizaLectores entiende el JSON que llega por multipart", () => {
  assert.deepEqual(normalizaLectores(JSON.stringify([A, B])), [A, B]);
});

test("normalizaLectores tolera la lista separada por comas de un formulario", () => {
  assert.deepEqual(normalizaLectores(`${A},${B}`), [A, B]);
});

test("normalizaLectores tira lo que no es un UUID sin romperse", () => {
  assert.deepEqual(normalizaLectores([A, "todos", "", null, 7, B]), [A, B]);
});

test("normalizaLectores devuelve [] cuando no viene nada", () => {
  for (const vacio of [null, undefined, "", "  ", "{}", 42, {}]) {
    assert.deepEqual(normalizaLectores(vacio), [], `falla con ${JSON.stringify(vacio)}`);
  }
});

test("normalizaLectores corta en MAX_LECTORES", () => {
  const muchos = Array.from({ length: MAX_LECTORES + 20 }, (_, i) =>
    `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`
  );
  assert.equal(normalizaLectores(muchos).length, MAX_LECTORES);
});

// ── resumenDeLecturas ───────────────────────────────────────────────────────

test("resumenDeLecturas cuenta leídas y pendientes", () => {
  const r = resumenDeLecturas([
    { teamMemberId: A, readAt: new Date("2026-09-01T10:00:00Z") },
    { teamMemberId: B, readAt: null },
    { teamMemberId: C, readAt: null },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.leidas, 1);
  assert.equal(r.pendientes, 2);
});

test("resumenDeLecturas dice si me toca a mí y en qué estado", () => {
  const filas = [
    { teamMemberId: A, readAt: new Date("2026-09-01T10:00:00Z") },
    { teamMemberId: B, readAt: null },
  ];
  assert.equal(resumenDeLecturas(filas, A).mia.leida, true);
  assert.equal(resumenDeLecturas(filas, B).mia.leida, false);
  // A quien no se la han pedido, `mia` es null y NO un false: son cosas
  // distintas y la pantalla las pinta distinto.
  assert.equal(resumenDeLecturas(filas, C).mia, null);
});

test("resumenDeLecturas aguanta una lista vacía o inexistente", () => {
  assert.deepEqual(resumenDeLecturas([]), { total: 0, leidas: 0, pendientes: 0, mia: null });
  assert.deepEqual(resumenDeLecturas(null), { total: 0, leidas: 0, pendientes: 0, mia: null });
});

// ── sincronizaLectores ──────────────────────────────────────────────────────

// Modelos de mentira: guardan las filas en memoria y contestan lo justo.
function modelosFalsos(filasIniciales = [], equipo = [A, B, C]) {
  const filas = filasIniciales.map((f, i) => ({ id: `fila-${i}`, ...f }));
  const creadas = [];
  const borradas = [];
  return {
    filas,
    creadas,
    borradas,
    TeamMember: {
      findAll: async ({ where }) => {
        const pedidos = where.id[Object.getOwnPropertySymbols(where.id)[0]] ?? where.id.in ?? [];
        return equipo.filter((id) => pedidos.includes(id)).map((id) => ({ id }));
      },
    },
    DocumentRead: {
      findAll: async () => filas.map((f) => ({ ...f })),
      bulkCreate: async (nuevas) => { creadas.push(...nuevas); },
      destroy: async ({ where }) => {
        const ids = where.id[Object.getOwnPropertySymbols(where.id)[0]] ?? where.id.in ?? [];
        borradas.push(...ids);
        return ids.length;
      },
    },
  };
}

test("sincronizaLectores crea solo a los que faltan", async () => {
  const m = modelosFalsos([{ teamMemberId: A, readAt: null }]);
  const r = await sincronizaLectores({ tenantModels: m, documentId: "doc", teamMemberIds: [A, B] });
  assert.deepEqual(r.nuevos, [B]);
  assert.deepEqual(m.creadas.map((c) => c.teamMemberId), [B]);
  // A ya estaba: no se vuelve a crear, así que no se le vuelve a avisar.
  assert.equal(r.total, 2);
});

test("sincronizaLectores quita las pendientes que sobran", async () => {
  const m = modelosFalsos([{ teamMemberId: A, readAt: null }, { teamMemberId: B, readAt: null }]);
  const r = await sincronizaLectores({ tenantModels: m, documentId: "doc", teamMemberIds: [A] });
  assert.equal(r.quitados, 1);
  assert.deepEqual(m.borradas, ["fila-1"]);
});

test("sincronizaLectores NO borra un acuse ya firmado", async () => {
  const m = modelosFalsos([
    { teamMemberId: A, readAt: new Date("2026-09-01T10:00:00Z") },
    { teamMemberId: B, readAt: null },
  ]);
  // Se guarda la lista sin A ni B: la de B (pendiente) se va, la de A se queda.
  const r = await sincronizaLectores({ tenantModels: m, documentId: "doc", teamMemberIds: [C] });
  assert.deepEqual(m.borradas, ["fila-1"]);
  assert.equal(r.quitados, 1);
  assert.deepEqual(r.nuevos, [C]);
});

test("sincronizaLectores descarta a quien no está en el equipo", async () => {
  const m = modelosFalsos([], [A]);
  const r = await sincronizaLectores({ tenantModels: m, documentId: "doc", teamMemberIds: [A, B] });
  assert.deepEqual(r.nuevos, [A]);
  assert.equal(r.total, 1);
});

test("sincronizaLectores sin modelos no revienta", async () => {
  const r = await sincronizaLectores({ tenantModels: {}, documentId: "doc", teamMemberIds: [A] });
  assert.deepEqual(r, { nuevos: [], quitados: 0, total: 0 });
});
