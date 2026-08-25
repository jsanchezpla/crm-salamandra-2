// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin
// servidor, sin .env. Importa `Op` de sequelize pero no abre ninguna conexión.
/**
 * _smoke-clinica-terapeutas.mjs — varios terapeutas por paciente (25/08/2026).
 *
 *   node scripts/_smoke-clinica-terapeutas.mjs
 *   node --test-name-pattern="no borra" scripts/_smoke-clinica-terapeutas.mjs
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 *
 * Lau (Aumenta, 14/08/2026): «en los pacientes que tienen dos terapias, cómo
 * meter a los 2 terapeutas». En producción ya hay 15 pacientes con citas de dos
 * o tres profesionales distintos.
 *
 * ── QUÉ FIJA, Y POR QUÉ ESTAS COSAS Y NO OTRAS ─────────────────────────────
 *
 * Cada `it` de aquí abajo sale de un fallo concreto que una revisión adversaria
 * encontró en el diseño ANTES de escribirlo. No son casos inventados:
 *
 * · `mainTherapistId` suelto NO puede borrar al resto. La pantalla de alta manda
 *   hoy ese campo; tratarlo como «esta es la lista entera» habría borrado al
 *   segundo terapeuta de un paciente cada vez que alguien guardara desde una
 *   pantalla vieja.
 * · El guardado es un DIFF, no un arrasar y volver a crear. Si arrasara, cada
 *   guardado pisaría el `assignedAt` («desde cuándo la lleva») y la `specialty`
 *   de los que siguen — y eso no se ve en la pantalla, solo en la tabla.
 * · `null` y `[]` no son lo mismo al leer el cuerpo: `[]` es «quítalos todos» y
 *   `null` es «no me has preguntado».
 * · El invariante: el espejo `main_therapist_id` es el PRIMERO de la lista, y
 *   null si y solo si la lista queda vacía. Es lo único que permite que
 *   `lib/clients/urgentes.js` siga sin tocarse.
 * · La caída al espejo: un paciente sin filas se lee como «tiene al de la
 *   columna». Es lo que permite desplegar sin rellenar ni una fila.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  terapeutasDe,
  referenciaDe,
  conReferencia,
  terapeutasEfectivos,
  sincronizarTerapeutas,
  hayTablaTerapeutas,
  olvidarTabla,
  MAX_TERAPEUTAS,
} from "../lib/clinica/terapeutas.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

// ── Modelos de mentira ──────────────────────────────────────────────────────
// Lo justo para que el escritor crea que habla con Sequelize. Guardan las filas
// en un array y apuntan qué operaciones han recibido, que es lo que se mira.

function fakeSequelize({ hayTabla = true, esquema = "crm_prueba" } = {}) {
  const s = {
    options: { schema: esquema },
    sqls: [],
    async query(sql) {
      s.sqls.push(sql);
      if (sql.includes("to_regclass")) return [[{ t: hayTabla ? "patient_therapists" : null }]];
      return [[]];
    },
  };
  olvidarTabla(s);
  return s;
}

function fakeModels({ filas = [], equipo = [A, B, C] } = {}) {
  const almacen = filas.map((f, i) => ({ id: `fila-${i}`, specialty: null, ...f }));
  const registro = { creados: [], borrados: [], actualizados: [] };
  return {
    registro,
    almacen,
    PatientTherapist: {
      async findAll({ where }) {
        if (where?.teamMemberId) return almacen.filter((f) => f.teamMemberId === where.teamMemberId);
        return almacen.map((f) => ({ ...f }));
      },
      async create(valores) {
        const fila = { id: `nueva-${registro.creados.length}`, assignedAt: new Date("2030-01-01"), ...valores };
        almacen.push(fila);
        registro.creados.push(valores.teamMemberId);
        return fila;
      },
      async destroy({ where }) {
        const ids = where.id?.[Object.getOwnPropertySymbols(where.id)[0]] ?? [];
        for (const id of ids) {
          const i = almacen.findIndex((f) => f.id === id);
          if (i >= 0) { registro.borrados.push(almacen[i].teamMemberId); almacen.splice(i, 1); }
        }
      },
      async update(valores, { where }) {
        const fila = almacen.find((f) => f.id === where.id);
        if (fila) { Object.assign(fila, valores); registro.actualizados.push(fila.teamMemberId); }
      },
    },
    TeamMember: {
      async findAll({ where }) {
        const pedidos = where.id?.[Object.getOwnPropertySymbols(where.id)[0]] ?? [];
        return pedidos.filter((id) => equipo.includes(id)).map((id) => ({ id }));
      },
    },
  };
}

function fakePaciente(mainTherapistId = null) {
  return {
    id: "paciente-1",
    mainTherapistId,
    async update(valores) { Object.assign(this, valores); },
  };
}

// ── Lo que llega del formulario ─────────────────────────────────────────────

describe("terapeutasDe — leer el cuerpo", () => {
  test("«no me has preguntado» (null) no es «quítalos todos» ([])", () => {
    assert.equal(terapeutasDe({}), null);
    assert.equal(terapeutasDe({ firstName: "Ana" }), null);
    assert.deepEqual(terapeutasDe({ therapistIds: [] }), []);
    assert.deepEqual(terapeutasDe({ therapists: [] }), []);
  });

  test("acepta las dos formas y respeta el orden", () => {
    assert.deepEqual(terapeutasDe({ therapistIds: [B, A] }), [
      { id: B, specialty: undefined },
      { id: A, specialty: undefined },
    ]);
    assert.deepEqual(terapeutasDe({ therapists: [{ id: A, specialty: "logopedia" }] }), [
      { id: A, specialty: "logopedia" },
    ]);
  });

  test("tira lo que no es UUID y los repetidos, sin reventar", () => {
    assert.deepEqual(terapeutasDe({ therapistIds: [A, "undefined", A, null, 7, B] }), [
      { id: A, specialty: undefined },
      { id: B, specialty: undefined },
    ]);
  });

  test("una especialidad inventada se guarda como «sin precisar», no se cuela", () => {
    assert.deepEqual(terapeutasDe({ therapists: [{ id: A, specialty: "brujeria" }] }), [
      { id: A, specialty: null },
    ]);
  });

  test("especialidad AUSENTE viaja como undefined, para poder conservarla", () => {
    // Es la diferencia que impide que guardar la ficha borre las especialidades:
    // undefined = «no me has dicho nada», null = «bórrala».
    const [uno] = terapeutasDe({ therapists: [{ id: A }] });
    assert.equal(uno.specialty, undefined);
    const [dos] = terapeutasDe({ therapists: [{ id: A, specialty: null }] });
    assert.equal(dos.specialty, null);
  });

  test("hay tope, para que un cuerpo enorme no monte mil filas", () => {
    const muchos = Array.from({ length: 50 }, (_, i) =>
      `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    assert.equal(terapeutasDe({ therapistIds: muchos }).length, MAX_TERAPEUTAS);
  });
});

describe("referenciaDe + conReferencia — el campo viejo", () => {
  test("ausente no toca nada", () => {
    assert.equal(referenciaDe({}), undefined);
    assert.deepEqual(conReferencia([{ id: A }, { id: B }], undefined), [{ id: A }, { id: B }]);
  });

  test("EL FALLO CARO: mainTherapistId suelto NO borra a los demás", () => {
    // La pantalla de alta manda hoy este campo. Si se tratara como «la lista
    // entera», guardar desde ahí dejaría al paciente con un solo terapeuta.
    const salida = conReferencia([{ id: A }, { id: B }], C);
    assert.equal(salida.length, 3);
    assert.equal(salida[0].id, C, "el pedido pasa a ser el de referencia");
    assert.deepEqual(salida.slice(1).map((e) => e.id), [A, B], "y nadie se cae");
  });

  test("subir a alguien que ya estaba lo mueve, no lo duplica", () => {
    const salida = conReferencia([{ id: A, specialty: "logopedia" }, { id: B }], B);
    assert.deepEqual(salida.map((e) => e.id), [B, A]);
    assert.equal(salida.length, 2);
  });

  test("y le conserva la especialidad al moverlo", () => {
    const salida = conReferencia([{ id: A }, { id: B, specialty: "psicologia" }], B);
    assert.equal(salida[0].specialty, "psicologia");
  });

  test("null solo vacía si no había nadie más", () => {
    assert.deepEqual(conReferencia([{ id: A }], null), []);
    // Con dos apuntados, borrar el de referencia a ciegas sería tirar el trabajo
    // de otra persona: se deja la lista como estaba.
    assert.deepEqual(conReferencia([{ id: A }, { id: B }], null), [{ id: A }, { id: B }]);
  });
});

// ── La lista que se enseña ──────────────────────────────────────────────────

describe("terapeutasEfectivos — la caída al espejo", () => {
  test("sin filas pero con columna, el de la columna (por esto no hace falta rellenar nada)", () => {
    const salida = terapeutasEfectivos({ mainTherapistId: A }, []);
    assert.equal(salida.length, 1);
    assert.equal(salida[0].teamMemberId, A);
  });

  test("sin filas y sin columna, nadie", () => {
    assert.deepEqual(terapeutasEfectivos({ mainTherapistId: null }, []), []);
    assert.deepEqual(terapeutasEfectivos({ mainTherapistId: null }, undefined), []);
  });

  test("con filas, el de referencia va primero aunque no lo esté en la tabla", () => {
    const filas = [{ teamMemberId: A }, { teamMemberId: B }];
    assert.deepEqual(
      terapeutasEfectivos({ mainTherapistId: B }, filas).map((f) => f.teamMemberId),
      [B, A]
    );
  });

  test("coge el nombre del include cuando cae al espejo, para no pintar un UUID", () => {
    const salida = terapeutasEfectivos(
      { mainTherapistId: A, mainTherapist: { displayName: "Araceli", avatarColor: "#abc" } },
      []
    );
    assert.equal(salida[0].displayName, "Araceli");
  });
});

// ── El escritor ─────────────────────────────────────────────────────────────

describe("sincronizarTerapeutas — guardar", () => {
  let seq;
  beforeEach(() => { seq = fakeSequelize(); });

  test("EL DIFF: a quien sigue no se le toca la fila", async () => {
    const models = fakeModels({ filas: [{ teamMemberId: A, specialty: "logopedia" }] });
    const p = fakePaciente(A);
    await sincronizarTerapeutas({
      models, sequelize: seq, paciente: p,
      entradas: [{ id: A, specialty: undefined }, { id: B, specialty: undefined }],
    });
    assert.deepEqual(models.registro.creados, [B], "solo se inserta el que falta");
    assert.deepEqual(models.registro.borrados, [], "no se borra a nadie");
    assert.deepEqual(models.registro.actualizados, [], "y no se pisa la fila del que sigue");
  });

  test("la especialidad no se borra al guardar sin mencionarla", async () => {
    const models = fakeModels({ filas: [{ teamMemberId: A, specialty: "logopedia" }] });
    await sincronizarTerapeutas({
      models, sequelize: seq, paciente: fakePaciente(A),
      entradas: [{ id: A, specialty: undefined }],
    });
    assert.equal(models.almacen.find((f) => f.teamMemberId === A).specialty, "logopedia");
  });

  test("pero un valor explícito sí la cambia", async () => {
    const models = fakeModels({ filas: [{ teamMemberId: A, specialty: "logopedia" }] });
    await sincronizarTerapeutas({
      models, sequelize: seq, paciente: fakePaciente(A),
      entradas: [{ id: A, specialty: "psicologia" }],
    });
    assert.equal(models.almacen.find((f) => f.teamMemberId === A).specialty, "psicologia");
    assert.deepEqual(models.registro.actualizados, [A]);
  });

  test("EL INVARIANTE: el espejo es el primero de la lista", async () => {
    const models = fakeModels();
    const p = fakePaciente(null);
    await sincronizarTerapeutas({ models, sequelize: seq, paciente: p, entradas: [{ id: B }, { id: A }] });
    assert.equal(p.mainTherapistId, B);
  });

  test("EL INVARIANTE: null si y solo si la lista queda vacía", async () => {
    // Es lo que deja que «Pacientes sin terapeuta» de urgentes.js siga siendo
    // `main_therapist_id IS NULL` sin tocar una línea de aquel fichero.
    const models = fakeModels({ filas: [{ teamMemberId: A }] });
    const p = fakePaciente(A);
    await sincronizarTerapeutas({ models, sequelize: seq, paciente: p, entradas: [] });
    assert.equal(p.mainTherapistId, null);
    assert.deepEqual(models.registro.borrados, [A]);
  });

  test("quien no existe como ficha de equipo no entra", async () => {
    const models = fakeModels({ equipo: [A] });
    const p = fakePaciente(null);
    await sincronizarTerapeutas({ models, sequelize: seq, paciente: p, entradas: [{ id: A }, { id: B }] });
    assert.deepEqual(models.registro.creados, [A]);
    assert.equal(p.mainTherapistId, A, "el espejo no puede quedarse apuntando a un fantasma");
  });

  test("si el PRIMERO no existe, el espejo es el primero que sí", async () => {
    const models = fakeModels({ equipo: [B] });
    const p = fakePaciente(null);
    await sincronizarTerapeutas({ models, sequelize: seq, paciente: p, entradas: [{ id: A }, { id: B }] });
    assert.equal(p.mainTherapistId, B);
  });

  test("devuelve de quién a quién, para que la auditoría lo pueda contar", async () => {
    const models = fakeModels({ filas: [{ teamMemberId: A }] });
    const r = await sincronizarTerapeutas({
      models, sequelize: seq, paciente: fakePaciente(A), entradas: [{ id: B }],
    });
    assert.deepEqual(r.antes, [A]);
    assert.deepEqual(r.despues, [B]);
    assert.equal(r.cambio, true);
  });
});

describe("sin la tabla todavía — el rato entre desplegar y migrar", () => {
  test("no revienta: guarda al de referencia como se hacía antes", async () => {
    // Entre que sube la imagen y alguien corre la migración, esto es lo que
    // separa «funciona igual que ayer» de «500 en cada guardado de ficha».
    const seq = fakeSequelize({ hayTabla: false });
    const models = fakeModels();
    const p = fakePaciente(null);
    const r = await sincronizarTerapeutas({
      models, sequelize: seq, paciente: p, entradas: [{ id: A }, { id: B }],
    });
    assert.equal(p.mainTherapistId, A);
    assert.deepEqual(models.registro.creados, [], "no se intenta escribir en una tabla que no está");
    assert.deepEqual(r.despues, [A]);
  });

  test("hayTablaTerapeutas dice que no y no lanza", async () => {
    const seq = fakeSequelize({ hayTabla: false });
    assert.equal(await hayTablaTerapeutas(seq), false);
  });

  test("EL FALLO DE VERDAD: la sonda pregunta CON el schema delante", async () => {
    /*
     * El `searchPath` que se le pasa a Sequelize no llega a las consultas
     * crudas: salen con el `search_path` de la conexión, que es `public`.
     * Preguntando `to_regclass('patient_therapists')` a secas, la respuesta era
     * null en TODOS los tenants, la tabla parecía no existir nunca y todo caía
     * al espejo en silencio — la lista no se guardaba y el filtro no encontraba
     * nada. Los modelos de mentira no lo cazaban porque contestaban que sí
     * mirara donde mirara la sonda; se vio probando el ciclo en el navegador.
     */
    const seq = fakeSequelize({ esquema: "crm_aumenta" });
    await hayTablaTerapeutas(seq);
    const sonda = seq.sqls.find((q) => q.includes("to_regclass"));
    assert.ok(sonda.includes('"crm_aumenta"'), `la sonda salió sin schema: ${sonda}`);
  });

  test("y sin schema en las opciones, pregunta a secas en vez de romperse", async () => {
    const seq = fakeSequelize({ esquema: undefined });
    assert.equal(await hayTablaTerapeutas(seq), true);
  });

  test("y si la consulta revienta, tampoco lanza", async () => {
    const roto = { async query() { throw new Error("42P01"); } };
    olvidarTabla(roto);
    assert.equal(await hayTablaTerapeutas(roto), false);
  });

  test("el sí se recuerda; el no se vuelve a preguntar al minuto", async () => {
    let veces = 0;
    const seq = {
      async query() { veces++; return [[{ t: null }]]; },
    };
    olvidarTabla(seq);
    await hayTablaTerapeutas(seq, 1_000);
    await hayTablaTerapeutas(seq, 1_500);
    assert.equal(veces, 1, "dentro del minuto no se vuelve a preguntar");
    await hayTablaTerapeutas(seq, 70_000);
    assert.equal(veces, 2, "pasado el minuto sí, para enterarse de que ya migró");
  });
});
