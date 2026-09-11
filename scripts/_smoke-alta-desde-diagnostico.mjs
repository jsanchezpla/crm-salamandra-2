// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-alta-desde-diagnostico.mjs — el contrato entre Diagnósticos y la
 * agenda: la URL con la que se abre una cita ya preparada y cómo la lee Citas
 * (12/09/2026).
 *
 *   node --test scripts/_smoke-alta-desde-diagnostico.mjs
 *
 * Fija `lib/citas/altaDesdeDiagnostico.js`: el formato exacto de la URL, que
 * ida y vuelta devuelven lo mismo, que la entrevista dura siempre 60 min, que
 * una duración que no va de media en media se descarta, y que `/citas` sin
 * estos parámetros (el 100 % de las veces) devuelve null.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  urlDeAltaDesdeDiagnostico,
  leerAltaDesdeDiagnostico,
  TRAMOS,
  TRAMO_ENTREVISTA,
  TRAMO_HORAS,
  DURACION_ENTREVISTA_MIN,
} from "../lib/citas/altaDesdeDiagnostico.js";

const ID = "3f2b9c1e-9d4a-4b1e-8c7d-1a2b3c4d5e6f";
const PACIENTE = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

describe("urlDeAltaDesdeDiagnostico", () => {
  it("la entrevista: /citas?nueva=1&diagnostico=<id>&tramo=entrevista&paciente=<id>&duracion=60", () => {
    assert.equal(
      urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: TRAMO_ENTREVISTA, patientId: PACIENTE }),
      `/citas?nueva=1&diagnostico=${ID}&tramo=entrevista&paciente=${PACIENTE}&duracion=60`
    );
  });

  it("la entrevista dura 60 min se pida lo que se pida", () => {
    const url = urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "entrevista", patientId: PACIENTE, duracion: 90 });
    assert.match(url, /&duracion=60$/);
    assert.equal(DURACION_ENTREVISTA_MIN, 60);
  });

  it("añadir horas: lleva la duración elegida si va de media en media; si no viene o no vale, no la lleva", () => {
    assert.equal(
      urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: TRAMO_HORAS, patientId: PACIENTE, duracion: 90 }),
      `/citas?nueva=1&diagnostico=${ID}&tramo=horas&paciente=${PACIENTE}&duracion=90`
    );
    assert.equal(
      urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "horas", patientId: PACIENTE }),
      `/citas?nueva=1&diagnostico=${ID}&tramo=horas&paciente=${PACIENTE}`
    );
    assert.doesNotMatch(urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "horas", duracion: 45 }), /duracion/);
    assert.doesNotMatch(urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "horas", duracion: 510 }), /duracion/);
  });

  it("sin paciente la URL sigue valiendo (la agenda lo pedirá); sin expediente o con un tramo raro, lanza", () => {
    assert.equal(urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "horas" }), `/citas?nueva=1&diagnostico=${ID}&tramo=horas`);
    assert.throws(() => urlDeAltaDesdeDiagnostico({ tramo: "horas" }), TypeError);
    assert.throws(() => urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "informe" }), TypeError);
    assert.throws(() => urlDeAltaDesdeDiagnostico(), TypeError);
  });

  it("los tramos son exactamente entrevista y horas", () => {
    assert.deepEqual(TRAMOS, ["entrevista", "horas"]);
  });
});

describe("leerAltaDesdeDiagnostico", () => {
  it("ida y vuelta: lo que escribe la lista es lo que lee la agenda", () => {
    const url = urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "horas", patientId: PACIENTE, duracion: 120 });
    assert.deepEqual(leerAltaDesdeDiagnostico(url), { diagnosticoId: ID, tramo: "horas", patientId: PACIENTE, duracion: 120 });
    const entrevista = urlDeAltaDesdeDiagnostico({ diagnosticoId: ID, tramo: "entrevista", patientId: PACIENTE });
    assert.deepEqual(leerAltaDesdeDiagnostico(entrevista), {
      diagnosticoId: ID,
      tramo: "entrevista",
      patientId: PACIENTE,
      duracion: 60,
    });
  });

  it("acepta URLSearchParams (useSearchParams), la cadena con o sin «?» y el objeto plano de una página de servidor", () => {
    const esperado = { diagnosticoId: ID, tramo: "horas", patientId: PACIENTE, duracion: 60 };
    const q = `nueva=1&diagnostico=${ID}&tramo=horas&paciente=${PACIENTE}&duracion=60`;
    assert.deepEqual(leerAltaDesdeDiagnostico(new URLSearchParams(q)), esperado);
    assert.deepEqual(leerAltaDesdeDiagnostico(`?${q}`), esperado);
    assert.deepEqual(leerAltaDesdeDiagnostico(q), esperado);
    assert.deepEqual(
      leerAltaDesdeDiagnostico({ nueva: "1", diagnostico: ID, tramo: "horas", paciente: PACIENTE, duracion: "60" }),
      esperado
    );
    assert.deepEqual(
      leerAltaDesdeDiagnostico({ diagnostico: [ID, "otro"], tramo: ["horas"], paciente: PACIENTE, duracion: ["60"] }),
      esperado,
      "un parámetro repetido llega como array: se lee el primero"
    );
  });

  it("/citas de siempre —sin diagnóstico, o con un tramo que no existe— devuelve null", () => {
    assert.equal(leerAltaDesdeDiagnostico(new URLSearchParams("")), null);
    assert.equal(leerAltaDesdeDiagnostico("?nueva=1"), null);
    assert.equal(leerAltaDesdeDiagnostico(`?diagnostico=${ID}`), null, "sin tramo no se sabe qué abrir");
    assert.equal(leerAltaDesdeDiagnostico(`?diagnostico=${ID}&tramo=informe`), null);
    assert.equal(leerAltaDesdeDiagnostico(`?tramo=horas`), null);
    assert.equal(leerAltaDesdeDiagnostico(null), null);
    assert.equal(leerAltaDesdeDiagnostico(undefined), null);
  });

  it("sin paciente, patientId es null; una duración que no vale sale como null (la agenda pone la del tipo)", () => {
    assert.deepEqual(leerAltaDesdeDiagnostico(`?diagnostico=${ID}&tramo=horas&duracion=45`), {
      diagnosticoId: ID,
      tramo: "horas",
      patientId: null,
      duracion: null,
    });
    assert.deepEqual(leerAltaDesdeDiagnostico(`?diagnostico=${ID}&tramo=horas`), {
      diagnosticoId: ID,
      tramo: "horas",
      patientId: null,
      duracion: null,
    });
  });

  it("no exige nueva=1: es la señal de abrir el cajón, no parte del encargo", () => {
    assert.notEqual(leerAltaDesdeDiagnostico(`?diagnostico=${ID}&tramo=entrevista`), null);
  });
});
