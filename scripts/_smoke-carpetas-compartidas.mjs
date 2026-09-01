// @prueba ligera
/**
 * _smoke-carpetas-compartidas.mjs — quién ve una carpeta del archivo
 * (01/09/2026, Rodrigo: «las carpetas creadas en Documentos tienen que poder
 * ser vistas por quien se quiera»).
 *
 * Esto es un ACL, así que lo que hay que fijar no es que ABRA, sino que no abra
 * de más. Las tres que de verdad importan:
 *
 *   · una carpeta privada de OTRO sigue sin verse si no me la han compartido;
 *   · «Mis documentos» sigue siendo solo mío — lo que me comparten sale por el
 *     lado de «Compartido», no mezclado con lo mío;
 *   · compartir da LECTURA: ni renombrar, ni borrar, ni subir. Eso no se prueba
 *     aquí porque no se tocó una sola línea de esos caminos, y esa es
 *     justamente la garantía.
 *
 * Modelos de mentira: aquí no hay base de datos ni servidor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import {
  canView,
  canViewFolder,
  canViewDocument,
  whereCarpetasVisibles,
  whereDocumentosVisibles,
} from "../lib/documents/helpers.js";
import { sincronizaMiembrosDeCarpeta } from "../lib/documents/carpetasCompartidas.js";

const YO = "user-yo";
const OTRA = "user-otra";

// ── canViewFolder ───────────────────────────────────────────────────────────

test("una carpeta privada de otra persona sigue sin verse", () => {
  const ajena = { id: "f1", visibility: "private", ownerUserId: OTRA };
  assert.equal(canViewFolder(ajena, YO, []), false);
  assert.equal(canViewFolder(ajena, YO, ["otra-carpeta"]), false);
});

test("una carpeta privada de otra persona SÍ se ve si me la han compartido", () => {
  const ajena = { id: "f1", visibility: "private", ownerUserId: OTRA };
  assert.equal(canViewFolder(ajena, YO, ["f1"]), true);
});

test("lo de siempre sigue igual: la mía y la de todo el centro", () => {
  assert.equal(canViewFolder({ id: "f2", visibility: "private", ownerUserId: YO }, YO, []), true);
  assert.equal(canViewFolder({ id: "f3", visibility: "shared", ownerUserId: OTRA }, YO, []), true);
});

// ── canViewDocument ─────────────────────────────────────────────────────────

test("un documento privado de otro se ve solo si su carpeta está compartida conmigo", () => {
  const doc = { id: "d1", folderId: "f1", visibility: "private", ownerUserId: OTRA };
  assert.equal(canViewDocument(doc, YO, []), false);
  assert.equal(canViewDocument(doc, YO, ["f1"]), true);
  // Compartirme OTRA carpeta no destapa esta.
  assert.equal(canViewDocument(doc, YO, ["f9"]), false);
});

test("un documento suelto (sin carpeta) no lo destapa ninguna lista", () => {
  const doc = { id: "d2", folderId: null, visibility: "private", ownerUserId: OTRA };
  assert.equal(canViewDocument(doc, YO, ["f1", "f2"]), false);
});

test("canView, el de siempre, no ha cambiado de comportamiento", () => {
  assert.equal(canView({ visibility: "shared" }, YO), true);
  assert.equal(canView({ visibility: "private", ownerUserId: YO }, YO), true);
  assert.equal(canView({ visibility: "private", ownerUserId: OTRA }, YO), false);
  assert.equal(canView(null, YO), false);
});

// ── Los `where` ─────────────────────────────────────────────────────────────

test("«Mis documentos» NO trae lo que me han compartido", () => {
  // La pestaña privada significa «lo mío». Si lo compartido se colara aquí,
  // dejaría de poder decirse eso.
  const w = whereCarpetasVisibles(YO, "private", ["f1", "f2"]);
  assert.deepEqual(w, { visibility: "private", ownerUserId: YO });
  const wd = whereDocumentosVisibles(YO, "private", ["f1"]);
  assert.deepEqual(wd, { visibility: "private", ownerUserId: YO });
});

test("«Compartido» trae lo del centro Y lo que me han compartido", () => {
  const ramas = whereCarpetasVisibles(YO, "shared", ["f1"])[Op.or];
  assert.deepEqual(ramas, [{ visibility: "shared" }, { id: { [Op.in]: ["f1"] } }]);
});

test("en documentos la rama compartida mira la CARPETA, no el documento", () => {
  const ramas = whereDocumentosVisibles(YO, "shared", ["f1"])[Op.or];
  assert.deepEqual(ramas, [{ visibility: "shared" }, { folderId: { [Op.in]: ["f1"] } }]);
});

test("sin nada compartido, el where es exactamente el de antes", () => {
  const antes = { [Op.or]: [{ visibility: "shared" }, { visibility: "private", ownerUserId: YO }] };
  assert.deepEqual(whereCarpetasVisibles(YO, "all", [])[Op.or], antes[Op.or]);
  assert.deepEqual(whereDocumentosVisibles(YO, "all", null)[Op.or], antes[Op.or]);
  assert.deepEqual(whereCarpetasVisibles(YO, "shared", [])[Op.or], [{ visibility: "shared" }]);
});

// ── sincronizaMiembrosDeCarpeta ─────────────────────────────────────────────

function modelosFalsos(filasIniciales = [], equipo = ["tm1", "tm2", "tm3"]) {
  const filas = filasIniciales.map((f, i) => ({ id: `fila-${i}`, ...f }));
  const creadas = [];
  const borradas = [];
  const idsDe = (where) => where.id[Object.getOwnPropertySymbols(where.id)[0]] ?? [];
  return {
    creadas,
    borradas,
    TeamMember: {
      findAll: async ({ where }) => equipo.filter((id) => idsDe(where).includes(id)).map((id) => ({ id })),
    },
    DocumentFolderMember: {
      findAll: async () => filas.map((f) => ({ ...f })),
      bulkCreate: async (nuevas) => { creadas.push(...nuevas); },
      destroy: async ({ where }) => { const ids = idsDe(where); borradas.push(...ids); return ids.length; },
    },
  };
}

test("compartir con alguien nuevo crea su fila y respeta las que ya estaban", async () => {
  const m = modelosFalsos([{ folderId: "f1", teamMemberId: "tm1" }]);
  const r = await sincronizaMiembrosDeCarpeta({ tenantModels: m, folderId: "f1", teamMemberIds: ["tm1", "tm2"] });
  assert.deepEqual(m.creadas.map((c) => c.teamMemberId), ["tm2"]);
  assert.equal(m.borradas.length, 0);
  assert.deepEqual(r.miembros, ["tm1", "tm2"]);
});

test("quitar a alguien de la lista le retira el acceso de verdad", async () => {
  // Aquí SÍ se borra sin miramientos, al revés que en las lecturas de un
  // documento: no hay ningún acuse que conservar, quitar es quitar.
  const m = modelosFalsos([
    { folderId: "f1", teamMemberId: "tm1" },
    { folderId: "f1", teamMemberId: "tm2" },
  ]);
  const r = await sincronizaMiembrosDeCarpeta({ tenantModels: m, folderId: "f1", teamMemberIds: ["tm1"] });
  assert.deepEqual(m.borradas, ["fila-1"]);
  assert.equal(r.quitados, 1);
});

test("dejar la lista vacía devuelve la carpeta a ser solo del dueño", async () => {
  const m = modelosFalsos([{ folderId: "f1", teamMemberId: "tm1" }]);
  const r = await sincronizaMiembrosDeCarpeta({ tenantModels: m, folderId: "f1", teamMemberIds: [] });
  assert.deepEqual(r.miembros, []);
  assert.equal(r.quitados, 1);
});

test("un id que no es del equipo no entra en la lista", async () => {
  const m = modelosFalsos([], ["tm1"]);
  const r = await sincronizaMiembrosDeCarpeta({ tenantModels: m, folderId: "f1", teamMemberIds: ["tm1", "inventado"] });
  assert.deepEqual(r.miembros, ["tm1"]);
  assert.deepEqual(m.creadas.map((c) => c.teamMemberId), ["tm1"]);
});

test("sin modelos no revienta", async () => {
  const r = await sincronizaMiembrosDeCarpeta({ tenantModels: {}, folderId: "f1", teamMemberIds: ["tm1"] });
  assert.deepEqual(r, { miembros: [], quitados: 0 });
});
