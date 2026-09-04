// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-estilo-clinico.mjs — lo que la IA clínica PUEDE y NO PUEDE escribir
 * (04/09/2026).
 *
 *   node scripts/_smoke-estilo-clinico.mjs
 *   node --test-name-pattern="diagnos" scripts/_smoke-estilo-clinico.mjs
 *
 * ── DE QUÉ ENCARGO NACE ────────────────────────────────────────────────────
 * Rodrigo, 04/09/2026: «la IA de los informes es muy básica, simple y poco
 * técnica; solo reescribe un poco lo que le envían. Tiene que completar más,
 * diagnosticar y escribir más párrafos». `lib/clinica/estiloClinico.js` es la
 * respuesta: un solo sitio donde se dice qué es elaboración clínica legítima
 * (nombrar procesos, relacionar observaciones, plantear hipótesis) y qué sigue
 * siendo inventar (una cifra, una fecha, una prueba… y una ETIQUETA
 * DIAGNÓSTICA).
 *
 * Aquí se fija lo que no se puede perder de vista al retocar ese prompt:
 *
 *   · que la prohibición de diagnosticar sigue estando, con esas palabras. Es
 *     lo único de este módulo que no tiene arreglo después: un informe firmado
 *     por una colegiada que dice «TDAH» porque lo dedujo un modelo ya ha salido
 *     del centro cuando alguien se da cuenta;
 *   · qué apartados se elaboran a partir del conjunto y cuáles no. Uno de puro
 *     dato —lo que refiere la familia, las incidencias— que se colara en la
 *     lista se rellenaría solo, que es exactamente lo que no puede pasar;
 *   · que al modelo NO le llega el nombre del paciente por esta puerta.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLAVES_SINTESIS,
  esApartadoDeSintesis,
  estiloClinico,
  haySintesis,
  lineaDePaciente,
  SINTESIS,
} from "../lib/clinica/estiloClinico.js";

describe("el prompt de la casa", () => {
  it("prohíbe diagnosticar, y lo dice con la palabra", () => {
    const p = estiloClinico();
    assert.match(p, /PROHIBIDO/);
    assert.match(p, /DIAGNOSTICAR/);
    // Las etiquetas se nombran a propósito: es lo que el modelo escribiría solo.
    for (const etiqueta of ["TDAH", "TEA", "dislexia"]) {
      assert.ok(p.includes(etiqueta), `falta el ejemplo «${etiqueta}»`);
    }
  });

  it("pero deja hacer lo que sí es de una profesional", () => {
    const p = estiloClinico();
    assert.match(p, /hip[oó]tesis/i);
    assert.match(p, /perfil funcional/i);
    // La elaboración es una orden, no un permiso a regañadientes.
    assert.match(p, /ELABORACI[ÓO]N CL[ÍI]NICA es TU trabajo/i);
  });

  it("sigue cerrando la puerta a los datos inventados", () => {
    const p = estiloClinico();
    assert.match(p, /cifras/i);
    assert.match(p, /fechas/i);
    assert.match(p, /pron[oó]sticos/i);
    assert.match(p, /no los tienes/i); // los nombres propios
  });

  it("solo habla de apartados de síntesis cuando el documento los tiene", () => {
    assert.ok(!estiloClinico().includes(SINTESIS));
    assert.ok(estiloClinico({ sintesis: true }).includes(SINTESIS));
  });

  it("mete el contexto del paciente donde se le dice", () => {
    const p = estiloClinico({ contexto: "EL PACIENTE: 9 años" });
    assert.match(p, /EL PACIENTE: 9 a[ñn]os/);
  });
});

describe("el paciente que viaja al modelo", () => {
  const PACIENTE = {
    firstName: "Marta",
    lastName: "Ruiz Ponce",
    birthDate: "2017-03-12",
    specialties: ["logopedia", "psicopedagogía"],
    educationLevel: "3º Primaria",
    careType: "terapia",
  };

  it("no lleva el nombre por ningún lado", () => {
    const linea = lineaDePaciente(PACIENTE, new Date("2026-09-04T00:00:00Z"));
    assert.ok(!linea.includes("Marta"), linea);
    assert.ok(!linea.includes("Ruiz"), linea);
  });

  it("lleva la edad, las áreas y el nivel, que es lo que cambia cómo se escribe", () => {
    const linea = lineaDePaciente(PACIENTE, new Date("2026-09-04T00:00:00Z"));
    assert.match(linea, /9 años/);
    assert.match(linea, /logopedia/);
    assert.match(linea, /3º Primaria/);
  });

  it("sin paciente, o sin nada que decir de él, no ensucia el prompt", () => {
    assert.equal(lineaDePaciente(null), "");
    assert.equal(lineaDePaciente({}), "");
  });
});

describe("qué apartados se elaboran a partir del conjunto", () => {
  it("los de fábrica, por clave", () => {
    for (const key of ["impresionClinica", "propuestaActuacion", "achievements", "continuityProposal"]) {
      assert.ok(esApartadoDeSintesis({ key, label: "lo que sea" }), key);
      assert.ok(CLAVES_SINTESIS.has(key));
    }
  });

  it("y los que se monte el centro, por su título", () => {
    const propios = [
      "Impresión diagnóstica",
      "Orientaciones para el aula",
      "Propuesta de intervención",
      "Conclusiones",
    ];
    for (const label of propios) {
      assert.ok(esApartadoDeSintesis({ key: "ap_propio", label }), label);
    }
  });

  it("NO lo son los apartados que son puro dato", () => {
    const datos = [
      { key: "familyComments", label: "Comentarios familiares" },
      { key: "incidents", label: "Incidencias" },
      { key: "antecedentesFamiliares", label: "4. Antecedentes familiares" },
      { key: "identificacion", label: "1. Datos de identificación" },
      { key: "documentacionAportada", label: "15. Documentación aportada" },
      { key: "activities", label: "Actividades realizadas" },
    ];
    for (const b of datos) {
      assert.ok(!esApartadoDeSintesis(b), b.label);
    }
  });

  it("ni las notas internas del equipo, que las escribe ella", () => {
    assert.ok(!esApartadoDeSintesis({ key: "internalNotes", label: "Notas internas", interno: true }));
    // Ni siquiera si el centro las llama de una manera que suena a síntesis.
    assert.ok(!esApartadoDeSintesis({ key: "internalNotes", label: "Conclusiones del equipo", interno: true }));
  });

  it("haySintesis mira la lista entera", () => {
    assert.ok(haySintesis([{ key: "activities", label: "Actividades" }, { key: "achievements", label: "Logros" }]));
    assert.ok(!haySintesis([{ key: "activities", label: "Actividades" }]));
    assert.ok(!haySintesis(null));
  });
});
