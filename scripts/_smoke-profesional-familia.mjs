// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-profesional-familia.mjs — el profesional de la FAMILIA llega a los
 * terapeutas de sus pacientes (31/08/2026).
 *
 *   node scripts/_smoke-profesional-familia.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Rodrigo asignó a una terapeuta en la ficha de la familia y el paciente
 * seguía «sin terapeuta» al registrar la sesión: eran dos campos que no se
 * hablaban. `terapeutaAPacientesDeFamilia` (lib/clients/profesionalFamilia.js)
 * es la regla compartida —la usan el PUT de la ficha de la familia y la
 * aceptación de la lista de espera— y dice:
 *
 *   1. el profesional llega SOLO a los pacientes sin terapeuta; uno puesto a
 *      propósito no se pisa desde fuera (familias con dos hijos y dos
 *      terapeutas distintos);
 *   2. sin módulo clínico (o sin id, o sin terapeuta) no toca nada;
 *   3. un schema a medias (42P01/42703) degrada en silencio; cualquier otro
 *      error SALE;
 *   4. devuelve a cuántos pacientes llegó, descontando a un terapeuta que ya
 *      no exista en el equipo (sincronizarTerapeutas lo descarta).
 *
 * Forma: `node:test` + `node:assert/strict`, dobles compartidos con
 * `_smoke-lista-espera-propaga.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { terapeutaAPacientesDeFamilia } from "../lib/clients/profesionalFamilia.js";

const T1 = "3f2a9c1e-7b4d-4e8a-9c2b-1d5e6f7a8b90";
const TX = { nombre: "transacción de prueba" };

function pacienteFalso(id, mainTherapistId = null) {
  const updates = [];
  return {
    updates,
    fila: {
      id,
      mainTherapistId,
      async update(datos, opts) {
        updates.push([datos, opts]);
        Object.assign(this, datos);
      },
    },
  };
}

function ctxFalso({
  pacientes = [],
  equipoIds = [T1],
  modulos = ["pacientes"],
  conTabla = false,
  falloAlLeer = null,
} = {}) {
  const llamadas = [];
  const creadas = [];
  const tenantModels = {
    Patient: {
      async findAll(opts) {
        llamadas.push(["Patient.findAll", opts]);
        if (falloAlLeer) throw falloAlLeer;
        return pacientes;
      },
    },
    PatientTherapist: {
      async findAll() {
        return [];
      },
      async create(datos) {
        creadas.push(datos);
        return datos;
      },
      async destroy() {},
    },
    TeamMember: {
      async findAll(opts) {
        const pedidos = opts?.where?.id?.[Op.in] ?? [];
        return equipoIds.filter((id) => pedidos.includes(id)).map((id) => ({ id }));
      },
    },
  };
  const tenantSequelize = {
    options: { schema: "crm_prueba" },
    async query() {
      return [[{ t: conTabla ? "crm_prueba.patient_therapists" : null }]];
    },
  };
  return {
    llamadas,
    creadas,
    ctx: { tenantModels, tenantSequelize, hasModule: (k) => modulos.includes(k) },
  };
}

describe("terapeutaAPacientesDeFamilia: llega a los pacientes sin terapeuta y cuenta", () => {
  it("dos pacientes sin terapeuta lo reciben como espejo y devuelve 2", async () => {
    const p1 = pacienteFalso("p-1");
    const p2 = pacienteFalso("p-2");
    const { ctx, llamadas } = ctxFalso({ pacientes: [p1.fila, p2.fila] });
    const n = await terapeutaAPacientesDeFamilia({ ctx, clientId: "c-1", terapeutaId: T1, transaction: TX });
    assert.equal(n, 2);
    assert.equal(p1.fila.mainTherapistId, T1);
    assert.equal(p2.fila.mainTherapistId, T1);
    // El filtro va en la query: los que YA tienen terapeuta ni se piden.
    const pedido = llamadas.find(([que]) => que === "Patient.findAll");
    assert.deepEqual(pedido[1].where, { clientId: "c-1", mainTherapistId: null });
    assert.equal(pedido[1].transaction, TX);
  });

  it("sin terapeuta o sin familia, 0 y sin consultar nada", async () => {
    const { ctx, llamadas } = ctxFalso();
    assert.equal(await terapeutaAPacientesDeFamilia({ ctx, clientId: "c-1", terapeutaId: null }), 0);
    assert.equal(await terapeutaAPacientesDeFamilia({ ctx, clientId: null, terapeutaId: T1 }), 0);
    assert.deepEqual(llamadas, []);
  });

  it("sin módulo clínico ni pacientes, 0 sin consultar (la puerta es el módulo, no el modelo)", async () => {
    const p = pacienteFalso("p-1");
    const { ctx, llamadas } = ctxFalso({ pacientes: [p.fila], modulos: ["clients", "team"] });
    assert.equal(await terapeutaAPacientesDeFamilia({ ctx, clientId: "c-1", terapeutaId: T1 }), 0);
    assert.deepEqual(llamadas, []);
    assert.equal(p.fila.mainTherapistId, null);
  });

  it("con la tabla presente escribe la fila por sincronizarTerapeutas; a un terapeuta que ya no está no lo cuenta", async () => {
    const conEquipo = ctxFalso({ pacientes: [pacienteFalso("p-1").fila], conTabla: true });
    assert.equal(await terapeutaAPacientesDeFamilia({ ctx: conEquipo.ctx, clientId: "c-1", terapeutaId: T1 }), 1);
    assert.equal(conEquipo.creadas.length, 1);
    assert.equal(conEquipo.creadas[0].teamMemberId, T1);

    const sinEquipo = ctxFalso({ pacientes: [pacienteFalso("p-2").fila], conTabla: true, equipoIds: [] });
    assert.equal(await terapeutaAPacientesDeFamilia({ ctx: sinEquipo.ctx, clientId: "c-1", terapeutaId: T1 }), 0);
    assert.deepEqual(sinEquipo.creadas, []);
  });

  it("un schema a medias (42P01/42703) degrada a 0; cualquier otro error SALE", async () => {
    const sinTabla = Object.assign(new Error("relation does not exist"), { parent: { code: "42P01" } });
    assert.equal(
      await terapeutaAPacientesDeFamilia({ ctx: ctxFalso({ falloAlLeer: sinTabla }).ctx, clientId: "c-1", terapeutaId: T1 }),
      0
    );
    const sinColumna = Object.assign(new Error("column does not exist"), { original: { code: "42703" } });
    assert.equal(
      await terapeutaAPacientesDeFamilia({ ctx: ctxFalso({ falloAlLeer: sinColumna }).ctx, clientId: "c-1", terapeutaId: T1 }),
      0
    );
    const otro = Object.assign(new Error("permission denied"), { parent: { code: "42501" } });
    await assert.rejects(
      terapeutaAPacientesDeFamilia({ ctx: ctxFalso({ falloAlLeer: otro }).ctx, clientId: "c-1", terapeutaId: T1 }),
      otro
    );
  });
});
