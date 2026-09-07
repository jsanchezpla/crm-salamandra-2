// @prueba ligera — funciones puras de /lib y una regex sobre el fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-alta-por-paciente.mjs — el alta que empieza por el paciente
 * (07/09/2026, AV-0051 de Aumenta por Rodrigo: «solo para Aumenta»).
 *
 *   node scripts/_smoke-alta-por-paciente.mjs
 *
 * Lo que se fija:
 *   · sin bandera, el alta de siempre (empieza por la familia); con
 *     `pacientes.altaPorPaciente = true`, empieza por el paciente;
 *   · los textos del alta cambian con la bandera y el «Nombre» de la ficha pasa
 *     a decir de quién es (padre, madre o tutor);
 *   · sin paciente con nombre y apellidos, el alta por paciente no vale;
 *   · y que `POST /api/clients` gatea pacientes y progenitores por los
 *     módulos del CENTRO (`tenantHasModule`), no por el acceso del usuario:
 *     con `hasModule` se descartaban en silencio (fallo de base visto el
 *     07/09/2026).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FLAG_ALTA_POR_PACIENTE,
  MODULO_ALTA_POR_PACIENTE,
  altaEmpiezaPorElPaciente,
  textosDelAlta,
  hayPacienteConNombre,
} from "../lib/clients/altaPorPaciente.js";
import { camposCliente, PERFIL_SALUD } from "../lib/clients/formularioAlta.js";

describe("la bandera", () => {
  it("vive en el módulo pacientes y sin ella el alta empieza por la familia", () => {
    assert.equal(MODULO_ALTA_POR_PACIENTE, "pacientes");
    assert.equal(altaEmpiezaPorElPaciente(undefined), false);
    assert.equal(altaEmpiezaPorElPaciente({}), false);
    assert.equal(altaEmpiezaPorElPaciente({ [FLAG_ALTA_POR_PACIENTE]: "sí" }), false);
    assert.equal(altaEmpiezaPorElPaciente({ [FLAG_ALTA_POR_PACIENTE]: true }), true);
  });
  it("acepta el hasFeatureFlag del contexto", () => {
    const flags = (mod, key) => mod === "pacientes" && key === "altaPorPaciente";
    assert.equal(altaEmpiezaPorElPaciente(flags), true);
    assert.equal(altaEmpiezaPorElPaciente(() => false), false);
  });
});

describe("los textos del alta", () => {
  it("por la familia: los de siempre, con el singular del centro", () => {
    const t = textosDelAlta({ porPaciente: false, singular: "cliente" });
    assert.equal(t.titulo, "Nuevo cliente");
    assert.equal(t.boton, "Crear cliente");
    assert.equal(t.cabeceraFamilia, null);
    assert.equal(t.sinPaciente, null);
  });
  it("por el paciente: paciente primero, y la familia con cabecera", () => {
    const t = textosDelAlta({ porPaciente: true });
    assert.match(t.titulo, /paciente/i);
    assert.equal(t.boton, "Crear paciente");
    assert.ok(t.cabeceraFamilia?.titulo);
    assert.match(t.sinPaciente, /paciente/i);
    assert.match(t.sinNombreTitular, /padre|madre|tutor/i);
  });
  it("el «Nombre» de la ficha dice de quién es cuando el titular es un progenitor", () => {
    const normal = camposCliente(PERFIL_SALUD, { conPacientes: true });
    const porPaciente = camposCliente(PERFIL_SALUD, { conPacientes: true, titularEsProgenitor: true });
    assert.equal(normal[0].label, "Nombre *");
    assert.equal(porPaciente[0].key, "name");
    assert.match(porPaciente[0].label, /padre, madre o tutor/i);
    // El resto de campos no cambia: mismas claves en el mismo orden.
    assert.deepEqual(normal.map((c) => c.key), porPaciente.map((c) => c.key));
  });
});

describe("hayPacienteConNombre", () => {
  it("nombre Y apellidos en al menos uno", () => {
    assert.equal(hayPacienteConNombre([{ firstName: "Lucía", lastName: "Ruiz" }]), true);
    assert.equal(hayPacienteConNombre([{ firstName: "", lastName: "" }, { firstName: "Ana", lastName: " Gil " }]), true);
    assert.equal(hayPacienteConNombre([{ firstName: "Lucía", lastName: "" }]), false);
    assert.equal(hayPacienteConNombre([]), false);
    assert.equal(hayPacienteConNombre(null), false);
  });
});

describe("POST /api/clients gatea por el centro, no por el usuario", () => {
  it("pacientes y progenitores se normalizan con tenantHasModule(\"pacientes\")", () => {
    const src = readFileSync(new URL("../app/api/clients/route.js", import.meta.url), "utf8");
    const post = src.slice(src.indexOf("export const POST"));
    assert.match(post, /tenantHasModule\("pacientes"\)\s*\?\s*normalizarPacientes/);
    assert.match(post, /tenantHasModule\("pacientes"\)\s*\?\s*normalizarProgenitores/);
    assert.doesNotMatch(post, /\bhasModule\("pacientes"\)\s*\?\s*normalizar/);
  });
});
