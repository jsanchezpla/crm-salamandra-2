// @prueba ligera
// El orden de las áreas del menú (15/09/2026, AV-0132 de Aumenta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ordenarSecciones, esMenuClinico } from "../lib/layout/ordenDelMenu.js";

const SECCIONES = ["", "Comercial", "Tareas", "Gestión", "Salud", "Educación", "Operaciones"].map((label) => ({ label }));
const conModulos = (...ks) => (k) => ks.includes(k);
const labels = (xs) => xs.map((s) => s.label);

test("un centro clínico abre por Salud, Tareas y Gestión, y Comercial después", () => {
  assert.deepEqual(labels(ordenarSecciones(SECCIONES, conModulos("clients", "pacientes", "clinica", "citas"))), [
    "", "Salud", "Tareas", "Gestión", "Comercial", "Educación", "Operaciones",
  ]);
});

test("en un centro clínico Tareas abre por Citas, y Proyectos va detrás", () => {
  const con = SECCIONES.map((s) =>
    s.label === "Tareas" ? { ...s, items: [{ key: "projects" }, { key: "calendar" }, { key: "otra" }, { key: "citas" }] } : s,
  );
  const tareas = ordenarSecciones(con, conModulos("clinica")).find((s) => s.label === "Tareas");
  assert.deepEqual(tareas.items.map((i) => i.key), ["citas", "calendar", "projects", "otra"]);
});

test("con solo `pacientes` también es clínico", () => {
  assert.equal(esMenuClinico(conModulos("pacientes")), true);
});

test("un centro comercial conserva el orden de siempre, y es el mismo array", () => {
  const r = ordenarSecciones(SECCIONES, conModulos("clients", "leads"));
  assert.equal(r, SECCIONES);
});

test("nutrición sola NO reordena: sus pacientes son Clientes, en Comercial", () => {
  assert.equal(ordenarSecciones(SECCIONES, conModulos("clients", "nutricion")), SECCIONES);
});

test("no pierde ni duplica secciones, y una desconocida va al final", () => {
  const con = [...SECCIONES, { label: "Nueva" }];
  const r = ordenarSecciones(con, conModulos("clinica"));
  assert.equal(r.length, con.length);
  assert.equal(r.at(-1).label, "Nueva");
});

test("el menú pinta las secciones ya ordenadas", () => {
  const menu = readFileSync(new URL("../components/layout/Sidebar.jsx", import.meta.url), "utf8");
  assert.match(menu, /ordenarSecciones\(navigation,/);
  assert.doesNotMatch(menu, /\{navigation\.map\(/);
});
