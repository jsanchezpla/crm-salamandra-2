// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cita-de-diagnostico.mjs — la cita que es de un diagnóstico: lo que
 * lee el alta del cuerpo del POST, cuánto dura, cuándo el expediente la admite,
 * con qué dinero nace la entrevista y con qué plantilla se prepara su registro
 * (12/09/2026).
 *
 *   node --test scripts/_smoke-cita-de-diagnostico.mjs
 *
 * Fija `lib/clinica/citaDeDiagnostico.js` (la parte pura) y
 * `lib/clinica/plantillaDeLaCita.js`:
 *   · sin `diagnosticoId` el cuerpo es una cita de siempre (null) y `duration`
 *     ni se mira; con él, el tramo tiene que ser uno de los dos y la duración
 *     ir de media en media hora;
 *   · la entrevista dura 60 si no se dice otra cosa; las horas, lo pedido o la
 *     duración del tipo;
 *   · un expediente parado o cerrado no admite citas, y «horas» exige el bono;
 *   · la cita tiene que ser del paciente del expediente;
 *   · la entrevista nace «sin coste» con el texto de fábrica;
 *   · el tramo entrevista abre `entrevista_inicial` aunque el tipo sea
 *     DIAGNÓSTICO; el tramo horas abre `sesion_diagnostico` (12/09/2026); la
 *     valoración inicial del centro también la entrevista; el resto, nada.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MENSAJES,
  mensajeCerrado,
  leerCitaDeDiagnostico,
  duracionDeCitaDeDiagnostico,
  admiteCita,
  esDelPaciente,
  cobroDeLaCitaDeEntrevista,
  ATRIBUTOS_DE_HORAS,
} from "../lib/clinica/citaDeDiagnostico.js";
import { plantillaDeLaCita } from "../lib/clinica/plantillaDeLaCita.js";
import { ENTREVISTA, mensajeTope } from "../lib/clinica/diagnostico.js";
import { PLANTILLA_ENTREVISTA, PLANTILLA_SESION_DIAGNOSTICO } from "../lib/clinica/plantillas.js";

const ID = "3f2b9c1e-9d4a-4b1e-8c7d-1a2b3c4d5e6f";
const PACIENTE = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const BONO = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("leerCitaDeDiagnostico: lo que el alta dice del expediente", () => {
  it("sin diagnosticoId es una cita de siempre: null, y `duration` ni se mira", () => {
    assert.equal(leerCitaDeDiagnostico({}), null);
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: null }), null);
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: "" }), null);
    assert.equal(leerCitaDeDiagnostico({ duration: 45 }), null, "una duración suelta no es un error, es ruido");
    assert.equal(leerCitaDeDiagnostico(null), null);
  });

  it("con expediente hace falta el tramo, y tiene que ser entrevista u horas", () => {
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "entrevista" }), {
      diagnosticoId: ID,
      tramo: "entrevista",
      duracion: null,
    });
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: 90 }), {
      diagnosticoId: ID,
      tramo: "horas",
      duracion: 90,
    });
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: ID }), { error: MENSAJES.tramoInvalido });
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "informe" }), {
      error: MENSAJES.tramoInvalido,
    });
  });

  it("un id que no es uuid se rechaza con su frase", () => {
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: "123", diagnosticoTramo: "horas" }), {
      error: MENSAJES.idInvalido,
    });
    assert.deepEqual(leerCitaDeDiagnostico({ diagnosticoId: 42, diagnosticoTramo: "horas" }), {
      error: MENSAJES.idInvalido,
    });
  });

  it("la duración va de media en media hora, entre 30 y 480; «60» como texto vale, 45 no", () => {
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: "60" }).duracion, 60);
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: 480 }).duracion, 480);
    for (const mala of [45, 0, 15, 510, -30, "abc", 60.5]) {
      assert.deepEqual(
        leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: mala }),
        { error: MENSAJES.duracionInvalida },
        `duration=${mala}`
      );
    }
    // Vacía = no se dijo: la pone el servidor.
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: "" }).duracion, null);
    assert.equal(leerCitaDeDiagnostico({ diagnosticoId: ID, diagnosticoTramo: "horas", duration: null }).duracion, null);
  });
});

describe("duracionDeCitaDeDiagnostico", () => {
  it("la entrevista dura 60 si no se dice otra cosa; lo pedido manda si vale", () => {
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "entrevista" }), 60);
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "entrevista", porDefecto: 45 }), 60);
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "entrevista", duracion: 90 }), 90);
  });

  it("las horas duran lo pedido, o la duración del tipo, o 60 si el tipo no dice nada útil", () => {
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "horas", duracion: 120, porDefecto: 60 }), 120);
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "horas", porDefecto: 45 }), 45);
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "horas", duracion: 45, porDefecto: 50 }), 50, "45 no vale: cae al tipo");
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "horas", porDefecto: 0 }), 60);
    assert.equal(duracionDeCitaDeDiagnostico({ tramo: "horas" }), 60);
  });
});

describe("admiteCita: cuándo el expediente deja apuntar una cita", () => {
  it("en entrevista admite la entrevista; en curso con bono admite horas", () => {
    assert.deepEqual(admiteCita({ status: "entrevista", packId: null }, "entrevista"), { ok: true, error: null });
    assert.deepEqual(admiteCita({ status: "en_curso", packId: BONO }, "horas"), { ok: true, error: null });
    // Una segunda entrevista (la primera se canceló tarde) en un expediente en
    // curso también pasa: el tope de horas la acota, no el estado.
    assert.equal(admiteCita({ status: "en_curso", packId: BONO }, "entrevista").ok, true);
  });

  it("«horas» sin bono no: hay que pulsar «Seguir» antes", () => {
    assert.deepEqual(admiteCita({ status: "entrevista", packId: null }, "horas"), { ok: false, error: MENSAJES.sinBono });
    assert.deepEqual(admiteCita({ status: "en_curso", packId: null }, "horas"), { ok: false, error: MENSAJES.sinBono });
  });

  it("parado o cerrado no admite nada, y la frase dice en qué estado está", () => {
    assert.deepEqual(admiteCita({ status: "no_continua", packId: null }, "entrevista"), {
      ok: false,
      error: "Este diagnóstico está en «No continúa»: no admite más citas",
    });
    assert.deepEqual(admiteCita({ status: "cerrado", packId: BONO }, "horas"), {
      ok: false,
      error: mensajeCerrado("cerrado"),
    });
    assert.equal(mensajeCerrado("cerrado"), "Este diagnóstico está en «Cerrado»: no admite más citas");
    assert.deepEqual(admiteCita(null, "horas"), { ok: false, error: MENSAJES.noExiste });
  });
});

describe("esDelPaciente", () => {
  it("solo si la cita lleva EL paciente del expediente", () => {
    assert.equal(esDelPaciente({ patientId: PACIENTE }, PACIENTE), true);
    assert.equal(esDelPaciente({ patientId: PACIENTE }, ID), false);
    assert.equal(esDelPaciente({ patientId: PACIENTE }, null), false, "sin paciente no es suya");
    assert.equal(esDelPaciente({ patientId: PACIENTE }, ""), false);
    assert.equal(esDelPaciente({ patientId: null }, PACIENTE), false);
    assert.equal(esDelPaciente(null, PACIENTE), false);
  });
});

describe("el dinero y la barra", () => {
  it("la entrevista nace sin coste, con el texto de fábrica y sin concepto", () => {
    assert.deepEqual(cobroDeLaCitaDeEntrevista(), {
      modo: "sin_coste",
      conceptId: null,
      texto: "Diagnóstico: el cobro nace al decidir si sigue",
      importe: 0,
    });
    assert.equal(cobroDeLaCitaDeEntrevista().texto, ENTREVISTA.cobroTexto);
  });

  it("la frase del tope es la misma que enseña la lista de Diagnósticos", () => {
    assert.equal(mensajeTope(10), "El diagnóstico ya tiene sus 10 h: desbloquéalas desde Diagnósticos");
  });

  it("los atributos que se piden para contar horas son los que lee `horasDe`", () => {
    for (const a of ["status", "scheduledAt", "cancelledAt", "noShowJustified", "duration", "diagnosticoTramo"]) {
      assert.ok(ATRIBUTOS_DE_HORAS.includes(a), a);
    }
  });
});

describe("plantillaDeLaCita: con qué plantilla se prepara el registro", () => {
  it("el tramo entrevista de un diagnóstico abre entrevista_inicial aunque el tipo sea DIAGNÓSTICO", () => {
    const cita = {
      diagnosticoId: ID,
      diagnosticoTramo: "entrevista",
      eventType: { name: "DIAGNÓSTICO", isInitialAssessment: false, informeTipo: "diagnostico" },
    };
    assert.equal(plantillaDeLaCita(cita), "entrevista_inicial");
    assert.equal(plantillaDeLaCita(cita), PLANTILLA_ENTREVISTA.key);
  });

  it("las horas de un diagnóstico abren sesion_diagnostico (segunda entrega, 12/09/2026)", () => {
    const cita = { diagnosticoId: ID, diagnosticoTramo: "horas", eventType: { name: "DIAGNÓSTICO", isInitialAssessment: false, informeTipo: "diagnostico" } };
    assert.equal(plantillaDeLaCita(cita), "sesion_diagnostico");
    assert.equal(plantillaDeLaCita(cita), PLANTILLA_SESION_DIAGNOSTICO.key);
    // Y aunque el tipo fuera la valoración inicial del centro: el tramo manda.
    assert.equal(
      plantillaDeLaCita({ diagnosticoId: ID, diagnosticoTramo: "horas", eventType: { isInitialAssessment: true } }),
      "sesion_diagnostico"
    );
  });

  it("un tramo horas sin expediente no cuenta: es un dato suelto", () => {
    assert.equal(plantillaDeLaCita({ diagnosticoTramo: "horas", eventType: { isInitialAssessment: false } }), null);
  });

  it("la valoración inicial del centro sigue abriendo la entrevista, como desde el 02/09/2026", () => {
    assert.equal(plantillaDeLaCita({ eventType: { isInitialAssessment: true } }), "entrevista_inicial");
    assert.equal(plantillaDeLaCita({ eventType: { isInitialAssessment: false } }), null);
    assert.equal(plantillaDeLaCita({ eventType: null }), null);
    assert.equal(plantillaDeLaCita({}), null);
    assert.equal(plantillaDeLaCita(null), null);
  });

  it("un tramo entrevista sin expediente no cuenta: es un dato suelto", () => {
    assert.equal(plantillaDeLaCita({ diagnosticoTramo: "entrevista", eventType: { isInitialAssessment: false } }), null);
  });

  it("acepta una fila de Sequelize (con toJSON)", () => {
    const fila = { toJSON: () => ({ diagnosticoId: ID, diagnosticoTramo: "entrevista" }) };
    assert.equal(plantillaDeLaCita(fila), "entrevista_inicial");
  });
});
