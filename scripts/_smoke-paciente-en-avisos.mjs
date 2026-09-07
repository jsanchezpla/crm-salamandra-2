// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-paciente-en-avisos.mjs — el nombre del paciente delante de una
 * incidencia en la campana, en Mi trabajo y en el aviso de comentario
 * (07/09/2026, AV-0052 de Aumenta).
 *
 *   node scripts/_smoke-paciente-en-avisos.mjs
 *
 * La regla vive en `lib/clinica/pacienteEnAvisos.js`. Y de paso se comprueba
 * que el endpoint del visto importa `cierraAlMarcarTodas`: desde el 05/09 lo
 * llamaba sin importarlo y marcar una incidencia como vista devolvía un 500
 * con el visto ya escrito, y ninguna se cerraba sola.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { nombrePaciente, conPaciente } from "../lib/clinica/pacienteEnAvisos.js";

describe("nombrePaciente", () => {
  it("junta nombre y apellidos, recortando espacios", () => {
    assert.equal(nombrePaciente({ firstName: " Lucía ", lastName: "Ruiz Pérez" }), "Lucía Ruiz Pérez");
    assert.equal(nombrePaciente({ firstName: "Lucía", lastName: null }), "Lucía");
  });
  it("acepta la forma de la API (`name`) y una instancia con toJSON", () => {
    assert.equal(nombrePaciente({ name: "Lucía Ruiz" }), "Lucía Ruiz");
    assert.equal(nombrePaciente({ toJSON: () => ({ firstName: "Ana", lastName: "Gil" }) }), "Ana Gil");
  });
  it("sin paciente, cadena vacía (nunca «undefined undefined»)", () => {
    assert.equal(nombrePaciente(null), "");
    assert.equal(nombrePaciente({}), "");
    assert.equal(nombrePaciente({ firstName: "", lastName: "" }), "");
  });
});

describe("conPaciente", () => {
  it("paciente · texto", () => {
    assert.equal(conPaciente("Se solapan dos citas", { firstName: "Lucía", lastName: "Ruiz" }), "Lucía Ruiz · Se solapan dos citas");
  });
  it("sin paciente el texto va tal cual: una incidencia laboral no lleva niño", () => {
    assert.equal(conPaciente("Falta material", null), "Falta material");
    assert.equal(conPaciente("Falta material", {}), "Falta material");
  });
  it("sin texto, solo el nombre", () => {
    assert.equal(conPaciente("", { firstName: "Ana", lastName: "Gil" }), "Ana Gil");
  });
});

describe("el endpoint del visto importa lo que llama", () => {
  it("cada función de vistoIncidencia.js que usa la ruta está en su import", () => {
    const src = readFileSync(new URL("../app/api/clinica/incidencias/[id]/route.js", import.meta.url), "utf8");
    const imp = src.match(/import\s*\{([^}]+)\}\s*from\s*"[^"]*vistoIncidencia\.js"/);
    assert.ok(imp, "falta el import de vistoIncidencia.js");
    const importadas = new Set(imp[1].split(",").map((s) => s.trim()).filter(Boolean));
    for (const fn of ["esActualizacion", "aQuienSeLeReabre", "vistoDe", "repasoDelEquipo", "cierraAlMarcarTodas"]) {
      const usada = new RegExp(`\\b${fn}\\(`).test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
      if (usada) assert.ok(importadas.has(fn), `${fn} se llama en la ruta pero no se importa`);
    }
  });
});
