// @prueba ligera
// La entrevista inicial que no hace falta deja de reclamarse (15/09/2026, AV-0141).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pendientesPorProfesional } from "../lib/clinica/pendientesClinicos.js";

const AHORA = new Date("2026-09-15T12:00:00Z");

test("un paciente nuevo marcado «no hace falta» no sale; los demás siguen", () => {
  const r = pendientesPorProfesional({
    citas: [
      { patientId: "nuevo", teamMemberId: "t1" },
      { patientId: "sinEntrevista", teamMemberId: "t1" },
      { patientId: "sinEntrevista", teamMemberId: "t2" },
    ],
    altaDelPaciente: new Map([
      ["nuevo", "2026-09-01T10:00:00Z"],
      ["sinEntrevista", "2026-09-02T10:00:00Z"],
    ]),
    noNecesitanEntrevista: new Set(["sinEntrevista"]),
    ahora: AHORA,
  });
  assert.deepEqual(r.get("t1").entrevistas.map((e) => e.patientId), ["nuevo"]);
  assert.deepEqual(r.get("t2").entrevistas, []);
});

test("sin el conjunto se comporta como siempre", () => {
  const r = pendientesPorProfesional({
    citas: [{ patientId: "nuevo", teamMemberId: "t1" }],
    altaDelPaciente: new Map([["nuevo", "2026-09-01T10:00:00Z"]]),
    ahora: AHORA,
  });
  assert.equal(r.get("t1").entrevistas.length, 1);
});

test("la Bandeja lee la marca y el endpoint deja rastro con su frase", () => {
  const bandeja = readFileSync(new URL("../app/api/clinica/bandeja/route.js", import.meta.url), "utf8");
  assert.match(bandeja, /noNecesitanEntrevista:/);
  assert.match(bandeja, /"entrevistaNoNecesaria"/);
  const etiquetas = readFileSync(new URL("../lib/actividad/etiquetas.js", import.meta.url), "utf8");
  assert.match(etiquetas, /"patient\.entrevista\.no_necesaria"/);
  assert.match(etiquetas, /"patient\.entrevista\.necesaria"/);
});
