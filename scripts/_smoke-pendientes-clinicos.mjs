// @prueba ligera
// Planes a completar y entrevistas sin registrar por profesional (15/09/2026, AV-0078).
import { test } from "node:test";
import assert from "node:assert/strict";

import { loQueFaltaAlPlan, pendientesPorProfesional } from "../lib/clinica/pendientesClinicos.js";

const AHORA = new Date("2026-09-15T12:00:00Z");

test("un plan completo no reclama nada; sin plan, reclama el plan", () => {
  assert.deepEqual(loQueFaltaAlPlan({ diagnosis: "TEA", consultationReasons: "lenguaje", objectives: [{ texto: "x" }] }), []);
  assert.deepEqual(loQueFaltaAlPlan(null), ["plan"]);
});

test("dice qué le falta, y un objetivo en blanco no cuenta", () => {
  assert.deepEqual(loQueFaltaAlPlan({ diagnosis: " ", consultationReasons: "", objectives: [{ texto: "" }, "  "] }), [
    "diagnóstico", "motivo de consulta", "objetivos",
  ]);
  assert.deepEqual(loQueFaltaAlPlan({ diagnosis: "a", consultationReasons: "b", objectives: ["legado"] }), []);
});

test("reparte por la profesional de la cita, sin repetir paciente, y a las dos si son dos", () => {
  const r = pendientesPorProfesional({
    citas: [
      { patientId: "p1", teamMemberId: "t1", scheduledAt: "2026-09-10" },
      { patientId: "p1", teamMemberId: "t1", scheduledAt: "2026-09-12" },
      { patientId: "p1", teamMemberId: "t2", scheduledAt: "2026-09-11" },
      { patientId: "p2", teamMemberId: "t1", scheduledAt: "2026-09-11" },
    ],
    planes: [{ patientId: "p2", diagnosis: "a", consultationReasons: "b", objectives: ["c"] }],
    ahora: AHORA,
  });
  assert.equal(r.get("t1").planes.length, 1);
  assert.equal(r.get("t1").planes[0].patientId, "p1");
  assert.equal(r.get("t2").planes.length, 1);
});

test("la entrevista se pide solo a pacientes NUEVOS por su fecha de alta, y no si ya está", () => {
  const r = pendientesPorProfesional({
    citas: [
      { patientId: "nuevo", teamMemberId: "t1" },
      { patientId: "antiguo", teamMemberId: "t1" },
      { patientId: "nuevoConEntrevista", teamMemberId: "t1" },
    ],
    altaDelPaciente: new Map([
      ["nuevo", "2026-09-01T10:00:00Z"],
      ["antiguo", "2025-01-10T10:00:00Z"],
      ["nuevoConEntrevista", "2026-09-05T10:00:00Z"],
    ]),
    conEntrevista: new Set(["nuevoConEntrevista"]),
    ahora: AHORA,
  });
  assert.deepEqual(r.get("t1").entrevistas.map((e) => e.patientId), ["nuevo"]);
});
