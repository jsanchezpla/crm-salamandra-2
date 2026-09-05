// @prueba ligera — texto del fuente y una función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clientes-editar-ficha-pacientes.mjs — desde el listado de Clientes
 * se puede crear el paciente de una ficha (03/09/2026, AV-0032 de Aumenta).
 *
 *   node scripts/_smoke-clientes-editar-ficha-pacientes.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Una admin del centro dio de alta a una adulta sin rellenar el bloque de
 * paciente («no puse nada en paciente porque es el mismo»). La agenda solo da
 * hora a pacientes, así que no pudo citarla; volvió a Clientes → «Editar
 * ficha» a «meter paciente» y ese panel no tenía por dónde. Tuvo que hacerlo
 * alguien de Salamandra a mano.
 *
 * Lo que fija esta prueba, por texto (CLAUDE.md lo admite para «¿sigue el if
 * donde estaba?»):
 *   1. El panel «Editar ficha» del listado monta la sección de pacientes, y
 *      solo donde hay módulo `pacientes` (en una agencia no tiene sentido).
 *   2. La sección de pacientes ofrece «el paciente es el propio cliente», con
 *      el MISMO parentesco y el MISMO partidor de nombre que el alta del
 *      mostrador: si divergieran, la misma persona saldría de dos formas.
 *   3. `partirNombre` hace lo que la casilla promete.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PARENTESCO_ES_EL_CLIENTE, PARENTESCOS, partirNombre } from "../lib/clients/formularioAlta.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const lee = (rel) => readFileSync(join(RAIZ, rel), "utf8");

test("el panel «Editar ficha» del listado monta la sección de pacientes, gateada por `conPacientes`", () => {
  const src = lee("app/(dashboard)/clientes/ClientesClient.jsx");
  assert.ok(src.includes("import ClientPatientsSection from"), "el listado no importa la sección de pacientes");
  assert.ok(
    /\{conPacientes && \([\s\S]{0,600}<ClientPatientsSection clientId=\{selected\.id\} \/>/.test(src),
    "la sección tiene que montarse dentro de `conPacientes && (…)` con el id de la ficha abierta"
  );
});

test("la sección de pacientes ofrece «el paciente es el propio cliente» con las piezas del alta", () => {
  const src = lee("components/clients/ClientPatientsSection.jsx");
  assert.ok(src.includes("El paciente es el propio cliente"), "falta la casilla");
  assert.ok(src.includes("relationship: PARENTESCO_ES_EL_CLIENTE"), "la casilla no pone el parentesco compartido");
  assert.ok(src.includes("...partirNombre(clienteNombre)"), "la casilla no copia el nombre de la ficha con `partirNombre`");
  assert.ok(src.includes("{PARENTESCOS.map("), "los parentescos tienen que ser los de formularioAlta.js, no una lista propia");
  assert.ok(!src.includes("const RELATIONSHIPS"), "sigue la lista propia de parentescos");
});

test("PARENTESCOS incluye el del propio cliente y `partirNombre` parte nombre y apellidos", () => {
  assert.ok(PARENTESCOS.includes(PARENTESCO_ES_EL_CLIENTE));
  assert.deepEqual(partirNombre("Ana Pérez López"), { firstName: "Ana", lastName: "Pérez López" });
  assert.deepEqual(partirNombre("  Ana  "), { firstName: "Ana", lastName: "" });
  assert.deepEqual(partirNombre(""), { firstName: "", lastName: "" });
});

/*
 * Y LA OTRA PUERTA SE CERRÓ (05/09/2026, AV-0047 de Aumenta: «en el apartado
 * de Clínica, Pacientes, eliminar la posibilidad de crear nuevo paciente»).
 *
 * Clínica → Pacientes tenía un «Nuevo paciente» que creaba la ficha SUELTA:
 * el formulario ni siquiera preguntaba por la familia, así que el paciente
 * nacía sin pagador —y sin cuota, sin cobros y sin tutores—. Con el alta
 * viviendo en la ficha de la familia (arriba), esa puerta sobraba y hacía
 * daño: 1 de los 1.183 pacientes de Aumenta se coló por ahí.
 */
test("Clínica → Pacientes ya no da de alta: solo enlaza a Clientes", () => {
  const src = lee("app/(dashboard)/pacientes/page.jsx");
  assert.ok(!/showCreate/.test(src), "sigue el estado del modal de alta");
  assert.ok(!/submitCreate/.test(src), "sigue el envío del alta suelta");
  assert.ok(!/method: "POST"[\s\S]{0,80}\/api\/pacientes/.test(src), "la pantalla sigue creando pacientes por su cuenta");
  assert.ok(/href="\/clientes"/.test(src), "no queda por dónde ir a dar de alta");
});
