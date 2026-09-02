// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-objetivos-ia.mjs — los objetivos del plan redactados con IA
 * (02/09/2026, Aumenta por el buzón: AV-0019, Laura).
 *
 *   node scripts/_smoke-objetivos-ia.mjs
 *
 * Lo que pidió el centro: «que al meter ideas clave para trabajar esos
 * objetivos la IA elabore los objetivos de intervención reales adaptados a
 * cada paciente». Se fija lo que NO puede romperse sin que nadie lo vea:
 *
 *   · que al modelo no viaja el nombre del paciente ni el de la familia;
 *   · que lo que contesta se lee con vallas de markdown y sin ellas, y que la
 *     basura da una lista vacía y no un 500;
 *   · que no se repiten objetivos que el plan ya tiene;
 *   · que la demo tiene propuesta sin gastar IA.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OBJETIVOS,
  edadDe,
  contextoDelPaciente,
  promptObjetivos,
  parsearObjetivos,
  objetivosDeEnsayo,
} from "../lib/clinica/objetivosIa.js";

const HOY = new Date("2026-09-02T10:00:00Z");

describe("la edad", () => {
  it("sale de la fecha de nacimiento, contando si ya ha cumplido", () => {
    assert.equal(edadDe({ birthDate: "2018-09-01" }, HOY), 8);
    assert.equal(edadDe({ birthDate: "2018-09-03" }, HOY), 7);
  });
  it("sin fecha cae a la edad guardada; sin nada, null", () => {
    assert.equal(edadDe({ age: 6 }, HOY), 6);
    assert.equal(edadDe({ age: "x" }, HOY), null);
    assert.equal(edadDe({}, HOY), null);
    assert.equal(edadDe({ birthDate: "no es fecha", age: 9 }, HOY), 9);
  });
});

describe("lo que viaja del paciente", () => {
  it("es una lista CERRADA: ni nombre ni familia", () => {
    const ctx = contextoDelPaciente(
      {
        firstName: "Hugo",
        lastName: "Castro",
        birthDate: "2019-01-15",
        specialties: ["logopedia", "psicología"],
        educationLevel: "2º Primaria",
        careType: "terapia",
        clientId: "c-1",
      },
      HOY
    );
    assert.deepEqual(ctx, {
      edad: 7,
      especialidades: ["logopedia", "psicología"],
      nivelEducativo: "2º Primaria",
      tipo: "terapia",
    });
  });
});

describe("el prompt", () => {
  const paciente = { firstName: "Hugo", lastName: "Castro Díaz", birthDate: "2019-01-15", specialties: ["logopedia"] };
  const plan = {
    diagnosis: "TEL",
    consultationReasons: "Dificultades de lenguaje expresivo",
    objectives: ["Ampliar vocabulario"],
  };
  const { system, user } = promptObjetivos({ ideas: "turnos de palabra, frases de 3 elementos", plan, paciente });

  it("pide SOLO JSON con la forma {objetivos: [...]}", () => {
    assert.match(system, /SOLO con un objeto JSON/);
    assert.match(system, /\{"objetivos": \[string, \.\.\.\]\}/);
    assert.match(system, new RegExp(`${MAX_OBJETIVOS} objetivos`));
  });
  it("lleva las ideas, el plan y la edad, y NO el nombre del paciente", () => {
    assert.match(user, /turnos de palabra, frases de 3 elementos/);
    assert.match(user, /7 años/);
    assert.match(user, /logopedia/);
    assert.match(user, /TEL/);
    assert.match(user, /no los repitas\):\n- Ampliar vocabulario/);
    assert.doesNotMatch(user, /Hugo/);
    assert.doesNotMatch(user, /Castro/);
    assert.doesNotMatch(system, /Hugo/);
  });
  it("sin nada del plan ni edad sigue teniendo forma", () => {
    const { user: u } = promptObjetivos({ ideas: "atención", plan: {}, paciente: {} });
    assert.match(u, /edad no indicada/);
    assert.match(u, /Ideas clave de la terapeuta:\natención/);
    assert.doesNotMatch(u, /Diagnóstico/);
  });
});

describe("leer lo que contesta", () => {
  const frase = "Respetar el turno de palabra en juego de mesa con un recordatorio verbal como mucho.";
  it("con vallas de markdown y sin ellas", () => {
    assert.deepEqual(parsearObjetivos(JSON.stringify({ objetivos: [frase] })), [frase]);
    assert.deepEqual(parsearObjetivos("```json\n" + JSON.stringify({ objetivos: [frase] }) + "\n```"), [frase]);
    assert.deepEqual(parsearObjetivos(JSON.stringify([frase])), [frase]);
  });
  it("la basura da lista vacía, nunca revienta", () => {
    assert.deepEqual(parsearObjetivos("no soy json"), []);
    assert.deepEqual(parsearObjetivos(""), []);
    assert.deepEqual(parsearObjetivos(null), []);
    assert.deepEqual(parsearObjetivos(JSON.stringify({ otra: 1 })), []);
    assert.deepEqual(parsearObjetivos(JSON.stringify({ objetivos: [1, null, "", "  "] })), []);
  });
  it("quita repetidos (sin tildes ni mayúsculas) y los que el plan ya tiene", () => {
    const r = parsearObjetivos(
      JSON.stringify({
        objetivos: [
          "Ampliar vocabulario",
          "ampliar VOCABULARIO",
          "Producir frases de tres elementos",
          "Producir frases de tres elementos.",
        ],
      }),
      { yaTiene: ["Ampliar vocabulario"] }
    );
    assert.deepEqual(r, ["Producir frases de tres elementos", "Producir frases de tres elementos."]);
  });
  it("corta a MAX_OBJETIVOS y a 300 caracteres", () => {
    const muchos = Array.from({ length: 20 }, (_, i) => `Objetivo ${i}`);
    assert.equal(parsearObjetivos(JSON.stringify({ objetivos: muchos })).length, MAX_OBJETIVOS);
    const largo = "x".repeat(500);
    assert.equal(parsearObjetivos(JSON.stringify([largo]))[0].length, 300);
  });
});

describe("la demo", () => {
  it("propone una frase por idea sin gastar IA, y nada con nada", () => {
    const r = objetivosDeEnsayo("Atención sostenida, turnos de palabra\nFrases de 3 elementos");
    assert.equal(r.length, 3);
    assert.match(r[0], /^Trabajar atención sostenida/);
    assert.deepEqual(objetivosDeEnsayo(""), []);
    assert.deepEqual(objetivosDeEnsayo("ab"), []);
  });
});
