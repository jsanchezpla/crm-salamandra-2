// @prueba ligera
// Fija lib/clinica/incidenciasDe.js: las incidencias «de esta persona» se
// miran en la tabla PIVOTE (todos los responsables), con caída al principal.
import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { whereIncidenciasDe } from "../lib/clinica/incidenciasDe.js";

test("con la pivote, el where trae las incidencias donde figura como responsable (2.º incluido)", async () => {
  const models = {
    IncidenciaAssignee: {
      findAll: async ({ where }) => {
        assert.equal(where.teamMemberId, "bea");
        return [{ incidenciaId: "i1" }, { incidenciaId: "i2" }];
      },
    },
  };
  const where = await whereIncidenciasDe(models, "bea");
  assert.deepEqual(where.id[Op.in], ["i1", "i2"]);
});

test("sin responsabilidades en la pivote, la lista queda vacía (no todas las incidencias)", async () => {
  const models = { IncidenciaAssignee: { findAll: async () => [] } };
  const where = await whereIncidenciasDe(models, "bea");
  assert.deepEqual(where.id[Op.in], []);
});

test("sin la pivote (tenant sin migrar), se cae al responsable principal", async () => {
  const where = await whereIncidenciasDe({}, "bea");
  assert.deepEqual(where, { assignedToId: "bea" });
});
