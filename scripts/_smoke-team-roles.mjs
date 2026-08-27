// @prueba ligera
/**
 * _smoke-team-roles.mjs — las dos listas de roles de Equipo, que NO son la misma.
 *
 * El 27/08/2026 se permitió CREAR cuentas de administrador desde Equipo, y a la
 * vez se dejó cerrado poder EDITARLAS. Es fácil que alguien «arregle» esa
 * asimetría metiendo `admin` en `MANAGEABLE_ROLES` de un tirón, y con eso
 * cualquier admin podría cambiarle la contraseña a otra dirección desde una
 * pantalla de RRHH y entrar como ella. Esta prueba está para que ese cambio
 * tenga que ser deliberado.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MANAGEABLE_ROLES,
  ROLES_CREABLES,
  modulosSegunRol,
  normalizeUsername,
} from "../lib/team/access.js";

test("un admin se puede crear desde Equipo", () => {
  assert.ok(ROLES_CREABLES.has("admin"));
  assert.ok(ROLES_CREABLES.has("user"));
});

test("un admin NO se puede editar desde Equipo — la guarda del secuestro", () => {
  assert.ok(!MANAGEABLE_ROLES.has("admin"));
  assert.ok(!MANAGEABLE_ROLES.has("superadmin"));
  assert.ok(MANAGEABLE_ROLES.has("user"));
  assert.ok(MANAGEABLE_ROLES.has("manager"));
});

test("superadmin no se reparte desde el Equipo de un cliente", () => {
  assert.ok(!ROLES_CREABLES.has("superadmin"));
});

test("un admin nace con todos los módulos; los demás, con los marcados", () => {
  assert.deepEqual(modulosSegunRol("admin", ["clients"]), ["all"]);
  assert.deepEqual(modulosSegunRol("user", ["clients", "citas"]), ["clients", "citas"]);
});

test("el usuario se sufija con el slug, como las terapeutas de Aumenta", () => {
  assert.equal(normalizeUsername("Laura", "aumenta").username, "laura_aumenta");
  // Ya sufijado: no se duplica.
  assert.equal(normalizeUsername("laura_aumenta", "aumenta").username, "laura_aumenta");
  // Un correo de verdad se respeta tal cual.
  assert.equal(normalizeUsername("Laura@Centro.com", "aumenta").username, "laura@centro.com");
});
