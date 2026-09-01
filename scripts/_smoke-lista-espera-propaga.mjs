// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-lista-espera-propaga.mjs — al ACEPTAR una entrada de la cola de
 * admisión, el terapeuta asignado esperando llega a donde el CRM lo mira
 * (31/08/2026).
 *
 *   node scripts/_smoke-lista-espera-propaga.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El 31/08/2026 Rodrigo asignó una terapeuta en la lista de espera, aceptó la
 * entrada («¿ya tiene plaza?») y al ir a registrar la sesión el CRM le dijo
 * «el paciente no tiene terapeuta asignado»: la asignación se quedaba en la
 * entrada convertida y nadie la volvía a leer. `propagarTerapeutaAlAceptar`
 * (lib/clients/listaEspera.js) es el arreglo, y sus reglas son estas:
 *
 *   1. sin terapeuta o sin familia no toca NADA;
 *   2. el «Profesional de referencia» de la familia solo se pone si estaba
 *      vacío — una asignación hecha a mano no se pisa desde una cola;
 *   3. a los pacientes SIN terapeuta se les pone por `sincronizarTerapeutas`
 *      (la misma puerta que la ficha); los que ya tienen no se tocan;
 *   4. sin módulo clínico solo se toca la familia, y si la tabla `patients`
 *      no está en ese schema (42P01) degrada en silencio;
 *   5. un terapeuta que ya no existe en el equipo se descarta y no se cuenta.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-clients-lista-espera.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { propagarTerapeutaAlAceptar } from "../lib/clients/listaEspera.js";

const T1 = "3f2a9c1e-7b4d-4e8a-9c2b-1d5e6f7a8b90";
const OTRA = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";
const TX = { nombre: "transacción de prueba" };

// ── Dobles ──────────────────────────────────────────────────────────────────

/** Una familia de mentira que apunta sus updates. */
function familiaFalsa(asignado = null) {
  const updates = [];
  return {
    updates,
    fila: {
      id: "c-1",
      assignedTeamMemberId: asignado,
      async update(datos, opts) {
        updates.push([datos, opts]);
        Object.assign(this, datos);
      },
    },
  };
}

/** Un paciente de mentira, con su espejo y sus updates apuntados. */
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

/**
 * Un ctx como el de withTenant. `conTabla` decide qué contesta el to_regclass
 * de `hayTablaTerapeutas`: sin tabla, `sincronizarTerapeutas` cae al espejo
 * (solo la columna), que es el modo más simple de comprobar la propagación;
 * con tabla, entran el diff y la validación contra el equipo.
 */
function ctxFalso({
  familia = null,
  pacientes = [],
  equipoIds = [T1],
  modulos = ["pacientes"],
  conTabla = false,
  falloAlLeerPacientes = null,
} = {}) {
  const llamadas = [];
  const creadas = [];
  const tenantModels = {
    Client: familia && {
      async findByPk(id, opts) {
        llamadas.push(["Client.findByPk", id, opts]);
        return familia;
      },
    },
    Patient: {
      async findAll(opts) {
        llamadas.push(["Patient.findAll", opts]);
        if (falloAlLeerPacientes) throw falloAlLeerPacientes;
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
      // `sincronizarTerapeutas` pregunta quién existe con `id: { [Op.in]: [...] }`.
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
  const ctx = {
    tenantModels,
    tenantSequelize,
    hasModule: (k) => modulos.includes(k),
  };
  return { ctx, llamadas, creadas };
}

// ── Sin nada que propagar ───────────────────────────────────────────────────

describe("propagarTerapeutaAlAceptar: sin terapeuta o sin familia no toca nada", () => {
  it("sin terapeuta, {0, false} sin consultar", async () => {
    const { fila } = familiaFalsa();
    const { ctx, llamadas } = ctxFalso({ familia: fila });
    assert.deepEqual(
      await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: null }),
      { pacientes: 0, familia: false }
    );
    assert.deepEqual(llamadas, []);
  });

  it("sin clientId (una entrada de la cola sin ficha), lo mismo", async () => {
    const { ctx, llamadas } = ctxFalso();
    assert.deepEqual(
      await propagarTerapeutaAlAceptar({ ctx, clientId: null, terapeutaId: T1 }),
      { pacientes: 0, familia: false }
    );
    assert.deepEqual(llamadas, []);
  });
});

// ── La familia ──────────────────────────────────────────────────────────────

describe("el profesional de referencia de la familia: solo si estaba vacío", () => {
  it("vacío → se pone y familia=true, dentro de la transacción", async () => {
    const { fila, updates } = familiaFalsa(null);
    const { ctx } = ctxFalso({ familia: fila, modulos: [] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1, transaction: TX });
    assert.equal(r.familia, true);
    assert.deepEqual(updates, [[{ assignedTeamMemberId: T1 }, { transaction: TX }]]);
  });

  it("ya asignado (aunque sea otra persona) → NO se pisa y familia=false", async () => {
    const { fila, updates } = familiaFalsa(OTRA);
    const { ctx } = ctxFalso({ familia: fila, modulos: [] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.familia, false);
    assert.deepEqual(updates, []);
    assert.equal(fila.assignedTeamMemberId, OTRA);
  });

  it("sin modelo Client en el tenant, no revienta: sigue con los pacientes", async () => {
    const p = pacienteFalso("p-1");
    const { ctx } = ctxFalso({ familia: null, pacientes: [p.fila] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.familia, false);
    assert.equal(r.pacientes, 1);
  });
});

// ── Los pacientes ───────────────────────────────────────────────────────────

describe("los pacientes sin terapeuta lo heredan; los demás ni se piden", () => {
  it("dos pacientes sin terapeuta reciben el espejo (modo sin tabla) y se cuentan", async () => {
    const p1 = pacienteFalso("p-1");
    const p2 = pacienteFalso("p-2");
    const { ctx, llamadas } = ctxFalso({ pacientes: [p1.fila, p2.fila] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1, transaction: TX });
    assert.equal(r.pacientes, 2);
    assert.equal(p1.fila.mainTherapistId, T1);
    assert.equal(p2.fila.mainTherapistId, T1);
    // Y se pidieron SOLO los que no tienen terapeuta: el filtro va en la query.
    const pedido = llamadas.find(([que]) => que === "Patient.findAll");
    assert.deepEqual(pedido[1].where, { clientId: "c-1", mainTherapistId: null });
    assert.equal(pedido[1].transaction, TX);
  });

  it("con la tabla presente, la fila se crea por sincronizarTerapeutas y se cuenta", async () => {
    const p = pacienteFalso("p-1");
    const { ctx, creadas } = ctxFalso({ pacientes: [p.fila], conTabla: true });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.pacientes, 1);
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].teamMemberId, T1);
    assert.equal(p.fila.mainTherapistId, T1);
  });

  it("un terapeuta que ya no está en el equipo se descarta y NO se cuenta (con tabla)", async () => {
    const p = pacienteFalso("p-1");
    const { ctx, creadas } = ctxFalso({ pacientes: [p.fila], conTabla: true, equipoIds: [] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.pacientes, 0);
    assert.deepEqual(creadas, []);
    assert.equal(p.fila.mainTherapistId, null);
  });

  it("sin módulo clínico ni pacientes, la lista ni se consulta (el modelo siempre está registrado: la puerta es el módulo)", async () => {
    const { fila } = familiaFalsa(null);
    const { ctx, llamadas } = ctxFalso({ familia: fila, modulos: [] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.familia, true);
    assert.equal(r.pacientes, 0);
    assert.equal(llamadas.some(([que]) => que === "Patient.findAll"), false);
  });

  it("con módulo `clinica` (sin `pacientes`) también propaga: el gate acepta cualquiera de los dos", async () => {
    const p = pacienteFalso("p-1");
    const { ctx } = ctxFalso({ pacientes: [p.fila], modulos: ["clinica"] });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.pacientes, 1);
  });
});

// ── Degradación ─────────────────────────────────────────────────────────────

describe("schemas a medias: la tabla que falta degrada, un fallo de verdad sale", () => {
  it("42P01 al leer pacientes → la familia sí, los pacientes 0, sin reventar", async () => {
    const err = Object.assign(new Error("relation does not exist"), { parent: { code: "42P01" } });
    const { fila } = familiaFalsa(null);
    const { ctx } = ctxFalso({ familia: fila, falloAlLeerPacientes: err });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.deepEqual(r, { pacientes: 0, familia: true });
  });

  it("42703 (columna que falta) degrada igual", async () => {
    const err = Object.assign(new Error("column does not exist"), { original: { code: "42703" } });
    const { ctx } = ctxFalso({ falloAlLeerPacientes: err });
    const r = await propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 });
    assert.equal(r.pacientes, 0);
  });

  it("cualquier otro error SALE: la transacción del endpoint hace rollback y la entrada sigue en la cola", async () => {
    const err = Object.assign(new Error("permission denied"), { parent: { code: "42501" } });
    const { ctx } = ctxFalso({ falloAlLeerPacientes: err });
    await assert.rejects(
      propagarTerapeutaAlAceptar({ ctx, clientId: "c-1", terapeutaId: T1 }),
      err
    );
  });
});
