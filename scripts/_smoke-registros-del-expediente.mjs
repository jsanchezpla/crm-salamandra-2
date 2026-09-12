// @prueba ligera — modelos falsos en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-registros-del-expediente.mjs — lo que la FICHA de un expediente de
 * diagnóstico pide a la base y cómo lo junta (12/09/2026, segunda entrega).
 *
 *   node --test scripts/_smoke-registros-del-expediente.mjs
 *
 * Fija `lib/clinica/registrosDelExpediente.js` con modelos falsos que apuntan
 * lo que se les pregunta:
 *   · `registrosDe` pide SIEMPRE `diagnosticoId` Y `patientId` (el candado de
 *     paciente), nunca las columnas internas (prep, notas internas,
 *     transcripción), y devuelve a quien firma ya resuelto;
 *   · `sesionesDeLasCitas` hace UNA consulta para todas las citas y, si dos
 *     sesiones apuntan a la misma, gana la tocada más recientemente;
 *   · `informeDe` limpia `informeId` cuando el informe ya no existe (o no es
 *     de este paciente) y devuelve null; con informe, su resumen y su URL;
 *   · `fichaDeExpediente` saca la fila de `filasDe` (barra, dinero y
 *     `cobroAlSeguir` con la entrevista descontada) más registros, citas con
 *     su registro, informe y `siguienteTitulo`, pasados por `extras`.
 *
 * Y, como texto (¿sigue el `if` donde estaba?), las tres rutas del reparto:
 * el POST de sesiones comprueba el paciente del diagnóstico, el PATCH lo
 * escribe con candado, `/unir` solo une registros terminados y solo guarda
 * `sourceSessionIds`, y `/informe` nace con la plantilla del diagnóstico.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { registrosDe, sesionesDeLasCitas, informeDe, fichaDeExpediente } from "../lib/clinica/registrosDelExpediente.js";

const PACIENTE = "9a8b7c6d-1111-4222-8333-444455556666";
const OTRO = "9a8b7c6d-9999-4222-8333-444455556666";
const EXPEDIENTE = "3f2b1a00-aaaa-4bbb-8ccc-ddddeeee5e6f";
const TERAPEUTA = "6c1f0000-aaaa-4bbb-8ccc-ddddeeee4b90";
const INFORME = "7d1e0000-aaaa-4bbb-8ccc-ddddeeee0001";

/** Un modelo falso que apunta las consultas y contesta lo que se le diga. */
function modelo({ findAll = [], findOne = null, findByPk = null } = {}) {
  const consultas = [];
  return {
    consultas,
    findAll: async (q) => {
      consultas.push({ tipo: "findAll", ...q });
      return typeof findAll === "function" ? findAll(q) : findAll;
    },
    findOne: async (q) => {
      consultas.push({ tipo: "findOne", ...q });
      return typeof findOne === "function" ? findOne(q) : findOne;
    },
    findByPk: async (id, q) => {
      consultas.push({ tipo: "findByPk", id, ...q });
      return typeof findByPk === "function" ? findByPk(id, q) : findByPk;
    },
  };
}

function expedienteFalso(extra = {}) {
  const fila = {
    id: EXPEDIENTE,
    patientId: PACIENTE,
    clientId: null,
    therapistId: TERAPEUTA,
    productoKey: "completo",
    productoNombre: "Diagnóstico completo",
    horasMax: 20,
    status: "entrevista",
    informeId: null,
    entrevistaPaymentId: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...extra,
    cambios: [],
  };
  fila.update = async (c) => {
    fila.cambios.push(c);
    Object.assign(fila, c);
    return fila;
  };
  fila.toJSON = () => {
    const { update, toJSON, cambios, ...j } = fila;
    return j;
  };
  return fila;
}

const SESION = (id, extra = {}) => ({
  id,
  patientId: PACIENTE,
  therapistId: TERAPEUTA,
  sessionDate: "2026-09-05T10:00:00.000Z",
  status: "registered",
  titulo: null,
  bookingId: null,
  diagnosticoId: EXPEDIENTE,
  contentSections: {},
  therapist: { id: TERAPEUTA, displayName: "Laura B." },
  toJSON() {
    const { toJSON, ...j } = this;
    return j;
  },
  ...extra,
});

describe("registrosDe: los registros del expediente, con candado de paciente", () => {
  it("pide diagnosticoId Y patientId, ordena ASC y resuelve a quien firma", async () => {
    const ClinicSession = modelo({ findAll: [SESION("s1"), SESION("s2", { therapist: null, therapistId: null })] });
    const TeamMember = modelo();
    const filas = await registrosDe({ ClinicSession, TeamMember }, expedienteFalso());
    const q = ClinicSession.consultas[0];
    assert.deepEqual(q.where, { diagnosticoId: EXPEDIENTE, patientId: PACIENTE });
    assert.deepEqual(q.order, [["sessionDate", "ASC"], ["createdAt", "ASC"]]);
    assert.equal(q.include[0].as, "therapist");
    assert.deepEqual(filas.map((f) => f.id), ["s1", "s2"]);
    assert.deepEqual(filas[0].terapeuta, { id: TERAPEUTA, nombre: "Laura B." });
    assert.equal(filas[1].terapeuta, null);
    assert.equal("therapist" in filas[0], false);
  });

  it("nunca pide las columnas internas del registro", async () => {
    const ClinicSession = modelo({ findAll: [] });
    await registrosDe({ ClinicSession }, expedienteFalso());
    const atributos = ClinicSession.consultas[0].attributes;
    for (const interna of ["prepText", "prepFiles", "internalNotes", "aiTranscription"]) {
      assert.equal(atributos.includes(interna), false, `pide ${interna}`);
    }
    for (const necesaria of ["titulo", "status", "contentSections", "parentFeedback", "sessionDate"]) {
      assert.equal(atributos.includes(necesaria), true, `no pide ${necesaria}`);
    }
  });

  it("sin tabla, sin expediente o sin paciente: lista vacía, no un 500", async () => {
    assert.deepEqual(await registrosDe({}, expedienteFalso()), []);
    assert.deepEqual(await registrosDe({ ClinicSession: modelo() }, { id: EXPEDIENTE, patientId: null }), []);
    const sinTabla = modelo({
      findAll: () => {
        const e = new Error("relation does not exist");
        e.parent = { code: "42P01" };
        throw e;
      },
    });
    assert.deepEqual(await registrosDe({ ClinicSession: sinTabla }, expedienteFalso()), []);
  });
});

describe("sesionesDeLasCitas: qué citas ya tienen registro", () => {
  it("una consulta para todas las citas; gana la sesión más reciente de cada una", async () => {
    const ClinicSession = modelo({
      findAll: [
        { id: "s-nueva", bookingId: "c1", updatedAt: "2026-09-05T12:00:00Z" },
        { id: "s-vieja", bookingId: "c1", updatedAt: "2026-09-05T10:00:00Z" },
        { id: "s-otra", bookingId: "c2", updatedAt: "2026-09-04T10:00:00Z" },
      ],
    });
    const mapa = await sesionesDeLasCitas({ ClinicSession }, [{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    assert.equal(ClinicSession.consultas.length, 1);
    assert.deepEqual(ClinicSession.consultas[0].order, [["updatedAt", "DESC"]]);
    assert.equal(mapa.get("c1"), "s-nueva");
    assert.equal(mapa.get("c2"), "s-otra");
    assert.equal(mapa.has("c3"), false);
  });

  it("sin citas no consulta nada", async () => {
    const ClinicSession = modelo();
    const mapa = await sesionesDeLasCitas({ ClinicSession }, []);
    assert.equal(mapa.size, 0);
    assert.equal(ClinicSession.consultas.length, 0);
  });
});

describe("informeDe: el informe del expediente, o null limpiando la columna", () => {
  it("con informe: resumen con rótulo y URL, pedido por id Y paciente", async () => {
    const ClinicalReport = modelo({ findOne: { id: INFORME, status: "draft", reportDate: "2026-09-12" } });
    const e = expedienteFalso({ informeId: INFORME });
    const informe = await informeDe({ ClinicalReport }, e);
    assert.deepEqual(ClinicalReport.consultas[0].where, { id: INFORME, patientId: PACIENTE });
    assert.deepEqual(informe, { id: INFORME, status: "draft", statusLabel: "Borrador", reportDate: "2026-09-12", url: `/clinica/informes/${INFORME}` });
    assert.deepEqual(e.cambios, []);
  });

  it("informe borrado: null y la columna se limpia", async () => {
    const ClinicalReport = modelo({ findOne: null });
    const e = expedienteFalso({ informeId: INFORME });
    assert.equal(await informeDe({ ClinicalReport }, e), null);
    assert.deepEqual(e.cambios, [{ informeId: null }]);
    assert.equal(e.informeId, null);
  });

  it("sin columna escrita o sin tabla de informes: null sin tocar nada", async () => {
    const ClinicalReport = modelo();
    const e = expedienteFalso();
    assert.equal(await informeDe({ ClinicalReport }, e), null);
    assert.equal(ClinicalReport.consultas.length, 0);
    assert.equal(await informeDe({}, expedienteFalso({ informeId: INFORME })), null);
  });
});

describe("fichaDeExpediente: la fila de la ficha con todo", () => {
  const CITA_ENTREVISTA = "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeee0001";
  const CITA_HORAS = "c2c2c2c2-aaaa-4bbb-8ccc-ddddeeee0002";
  const COBRO = "pay00000-aaaa-4bbb-8ccc-ddddeeee0001";

  function modelos({ informe = null } = {}) {
    return {
      Booking: modelo({
        findAll: [
          { id: CITA_ENTREVISTA, diagnosticoId: EXPEDIENTE, diagnosticoTramo: "entrevista", status: "completed", scheduledAt: "2026-09-01T10:00:00.000Z", duration: 60, teamMemberId: TERAPEUTA },
          { id: CITA_HORAS, diagnosticoId: EXPEDIENTE, diagnosticoTramo: "horas", status: "confirmed", scheduledAt: "2026-09-20T10:00:00.000Z", duration: 60, teamMemberId: TERAPEUTA },
        ],
      }),
      Payment: modelo({ findAll: [{ id: COBRO, packId: null, patientId: PACIENTE, amount: "50.00", status: "completed", refundedAt: null, createdAt: "2026-09-02T10:00:00.000Z" }] }),
      ClinicSession: modelo({
        findAll: (q) => {
          if (q.where.bookingId) return [{ id: "s-entrevista", bookingId: CITA_ENTREVISTA, updatedAt: "2026-09-01T11:00:00Z" }];
          return [
            SESION("s-entrevista", { bookingId: CITA_ENTREVISTA, sessionDate: "2026-09-01T10:00:00.000Z", contentSections: { plantilla: "entrevista_inicial" } }),
            SESION("s-h1", { sessionDate: "2026-09-05T10:00:00.000Z" }),
          ];
        },
      }),
      ClinicalReport: modelo({ findOne: informe }),
      Patient: modelo({ findAll: [{ id: PACIENTE, firstName: "Lea", lastName: "P." }] }),
      TeamMember: modelo({ findAll: [{ id: TERAPEUTA, displayName: "Laura B." }] }),
    };
  }

  it("junta registros, citas con su registro, informe, título siguiente y el cobro al seguir con la entrevista descontada", async () => {
    const e = expedienteFalso({ entrevistaPaymentId: COBRO });
    const fila = await fichaDeExpediente({ tenant: { settings: {} }, tenantModels: modelos(), expediente: e, puedeDecidir: true });

    assert.deepEqual(fila.paciente, { id: PACIENTE, nombre: "Lea P." });
    assert.deepEqual(fila.terapeuta, { id: TERAPEUTA, nombre: "Laura B." });
    assert.deepEqual(fila.registros.map((r) => [r.id, r.titulo, r.esEntrevista, r.terapeuta?.nombre]), [
      ["s-entrevista", "Entrevista inicial", true, "Laura B."],
      ["s-h1", "Sesión de diagnóstico 1", false, "Laura B."],
    ]);
    assert.equal(fila.registros[1].url, `/pacientes/${PACIENTE}/sesiones/s-h1`);
    assert.equal(fila.siguienteTitulo, "Sesión de diagnóstico 2");
    assert.equal(fila.informe, null);
    assert.equal(fila.urls.informe, null);
    assert.equal(fila.urls.expediente, `/clinica/diagnosticos/${EXPEDIENTE}`);
    assert.match(fila.urls.nuevoRegistro, /plantilla=sesion_diagnostico&diagnostico=/);
    assert.match(fila.urls.nuevoRegistro, /titulo=Sesi%C3%B3n\+de\+diagn%C3%B3stico\+2/);

    // Las citas: la entrevista ya tiene registro; la de horas, enlace a estrenar uno con `cita=`.
    assert.equal(fila.citas.length, 2);
    assert.equal(fila.citas[0].sessionId, "s-entrevista");
    assert.equal(fila.citas[0].urls.registro, `/pacientes/${PACIENTE}/sesiones/s-entrevista`);
    assert.equal(fila.citas[1].sessionId, null);
    assert.match(fila.citas[1].urls.registro, new RegExp(`cita=${CITA_HORAS}`));

    // El dinero de ESTE expediente: la entrevista cobrada, y «Seguir» con los 50 € descontados.
    assert.deepEqual(fila.dinero.entrevista, { id: COBRO, importe: 50, status: "completed" });
    assert.equal(fila.entrevistaPaymentId, COBRO);
    assert.equal(fila.cobroAlSeguir.importe, 600);
    assert.equal(fila.cobroAlSeguir.descuento, 50);
    assert.match(fila.cobroAlSeguir.texto, /descontada la entrevista inicial de 50 €/);
    assert.equal(fila.acciones.seguir, true);
  });

  it("con informe: sale resuelto y con su URL; sin entrevista cobrada, «Seguir» vale el producto entero", async () => {
    const e = expedienteFalso({ status: "en_curso", informeId: INFORME });
    const fila = await fichaDeExpediente({
      tenant: { settings: {} },
      tenantModels: modelos({ informe: { id: INFORME, status: "reviewed", reportDate: "2026-09-12" } }),
      expediente: e,
    });
    assert.deepEqual(fila.informe, { id: INFORME, status: "reviewed", statusLabel: "Revisado", reportDate: "2026-09-12", url: `/clinica/informes/${INFORME}` });
    assert.equal(fila.informeId, INFORME);
    assert.equal(fila.urls.informe, `/clinica/informes/${INFORME}`);
    assert.equal(fila.dinero.entrevista, null);
    assert.equal(fila.cobroAlSeguir.importe, 650);
    assert.equal(fila.cobroAlSeguir.descuento, 0);
  });

  it("un expediente de otro paciente no ve estos registros (el candado va en la consulta)", async () => {
    const m = modelos();
    await fichaDeExpediente({ tenant: { settings: {} }, tenantModels: m, expediente: expedienteFalso({ patientId: OTRO }) });
    const deRegistros = m.ClinicSession.consultas.find((q) => q.where?.diagnosticoId);
    assert.equal(deRegistros.where.patientId, OTRO);
  });
});

describe("las rutas del reparto (texto: ¿sigue el if donde estaba?)", () => {
  const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");

  it("POST /api/clinica/sessions: la cita manda y el cuerpo se comprueba contra el paciente", () => {
    const src = leer("../app/api/clinica/sessions/route.js");
    assert.match(src, /Ese diagnóstico no es de este paciente/);
    // La cita manda, pero solo si es de ESTE paciente (revisión 12/09/2026:
    // `bookingId` no se comprueba contra el paciente en ningún otro sitio).
    assert.match(src, /cita\?\.diagnosticoId && String\(cita\.patientId \?\? ""\) === String\(patientId\)/);
    assert.match(src, /return \{ diagnosticoId: cita\.diagnosticoId \}/);
    assert.match(src, /titulo: limpiarTitulo\(body\.titulo\)/);
    assert.match(src, /where\.diagnosticoId = diagnosticoId/);
  });

  it("PATCH /api/clinica/sessions/[id]: diagnosticoId con candado, título libre", () => {
    const src = leer("../app/api/clinica/sessions/[id]/route.js");
    assert.match(src, /if \(String\(s\.diagnosticoId \?\? ""\)\.trim\(\) \|\| !UUID_RE\.test\(nuevo\)\) delete updates\.diagnosticoId;/);
    assert.match(src, /Ese diagnóstico no es de este paciente/);
    assert.match(src, /updates\.titulo = limpiarTitulo\(updates\.titulo\)/);
  });

  it("PATCH /api/clinica/reports/[id]: la firma solo a alguien del equipo", () => {
    const src = leer("../app/api/clinica/reports/[id]/route.js");
    assert.match(src, /"therapistId"\]/);
    assert.match(src, /Ese profesional no es del centro/);
  });

  it("/informe nace con la plantilla del diagnóstico y sus registros terminados; /unir solo guarda sourceSessionIds", () => {
    const informe = leer("../app/api/clinica/diagnosticos/[id]/informe/route.js");
    assert.match(informe, /\[CLAVE_PLANTILLA\]: TIPO_DIAGNOSTICO, sourceSessionIds, diagnosticoId: expediente\.id/);
    assert.match(informe, /ESTADOS_TERMINADOS\.includes\(r\.status\)/);
    assert.match(informe, /"diagnostico\.informe_creado"/);

    const unir = leer("../app/api/clinica/diagnosticos/[id]/unir/route.js");
    assert.match(unir, /assertNotDemoPaidCall\(ctx/);
    assert.match(unir, /ESTADOS_TERMINADOS\.includes\(r\.status\)/);
    assert.match(unir, /materialDeLosRegistros\(terminados, \{ plantillasDelCentro: plantillasDe\(tenant, "registro"\) \}\)/);
    assert.match(unir, /material\.length > MAX_TRANSCRIPCION/);
    assert.match(unir, /informe\.update\(\{ contentSections: \{ \.\.\.cs, sourceSessionIds \} \}\)/);
    assert.equal((unir.match(/informe\.update\(/g) ?? []).length, 1, "/unir solo hace una escritura: sourceSessionIds");
    assert.match(unir, /"diagnostico\.informe_unido"/);
  });
});
