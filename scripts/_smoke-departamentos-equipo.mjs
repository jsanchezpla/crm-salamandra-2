// @prueba ligera
/**
 * _smoke-departamentos-equipo.mjs — quién es «Administración» (01/09/2026).
 *
 * Fija lo que devuelve `lib/team/departamentos.js`, que es lo que decide a
 * quién quita el botón «Todos menos Administración» de los selectores de
 * equipo (encargo de Rodrigo).
 *
 * ── POR QUÉ ESTA PRUEBA EXISTE ─────────────────────────────────────────────
 * Porque el botón se pidió con dos nombres —«Administración (Olga y Rosa)»— y
 * en producción esas dos fichas NO comparten departamento: Olga es
 * «Administración» y Rosa, «Contabilidad» (comprobado sobre `crm_aumenta` el
 * 01/09/2026). Un botón que solo mirase «Administración» dejaría a Rosa dentro
 * de la selección y nadie se enteraría: la lista saldría con una persona de más
 * y parecería correcta.
 *
 * Y porque `department` es TEXTO LIBRE: en Aumenta ya conviven «Terapia
 * Ocupacional» y «Terapia ocupacional» como dos departamentos distintos.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { esAdministracion, idsDeAdministracion, DEPARTAMENTOS_ADMINISTRACION } from "../lib/team/departamentos.js";

test("Administración y Contabilidad son las dos administración", () => {
  // Las dos, y esto es lo que se rompería sin querer: ver la cabecera.
  assert.equal(esAdministracion("Administración"), true);
  assert.equal(esAdministracion("Contabilidad"), true);
  assert.equal(DEPARTAMENTOS_ADMINISTRACION.length, 2);
});

test("da igual cómo esté escrito: tildes, mayúsculas y espacios de más", () => {
  for (const escrito of ["administracion", "ADMINISTRACIÓN", "  Administracion  ", "administración"]) {
    assert.equal(esAdministracion(escrito), true, `falla con «${escrito}»`);
  }
});

test("dirección NO es administración", () => {
  // El encargo dice «Administración (Olga y Rosa)». Quitar además a dirección
  // sacaría de la selección justo a quien convoca las reuniones.
  assert.equal(esAdministracion("Dirección"), false);
});

test("los departamentos clínicos no son administración", () => {
  for (const d of ["Logopedia", "Psicología", "Neuropsicología", "Pedagogía", "Terapia Ocupacional"]) {
    assert.equal(esAdministracion(d), false, `falla con «${d}»`);
  }
});

test("sin departamento puesto, NO es administración", () => {
  for (const vacio of [null, undefined, "", "   "]) {
    assert.equal(esAdministracion(vacio), false, `falla con ${JSON.stringify(vacio)}`);
  }
});

test("idsDeAdministracion devuelve solo ids, y solo los de administración", () => {
  const fichas = [
    { id: "a", department: "Administración" },
    { id: "b", department: "Contabilidad" },
    { id: "c", department: "Logopedia" },
    { id: "d", department: null },
    { id: "e", department: "Dirección" },
  ];
  assert.deepEqual(idsDeAdministracion(fichas), ["a", "b"]);
});

test("idsDeAdministracion aguanta una lista vacía o inexistente", () => {
  assert.deepEqual(idsDeAdministracion([]), []);
  assert.deepEqual(idsDeAdministracion(null), []);
  assert.deepEqual(idsDeAdministracion([{ department: "Administración" }]), []); // sin id, no hay a quién quitar
});
