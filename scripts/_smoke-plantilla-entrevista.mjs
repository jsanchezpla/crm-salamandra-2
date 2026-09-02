// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-plantilla-entrevista.mjs — la entrevista inicial como registro de
 * sesión con sus 15 apartados (02/09/2026, AV-0017 de Aumenta; decidido por
 * Rodrigo: «la entrevista inicial va a ser un tipo especial de cita» cuyo
 * registro tiene estos campos y se rellena con IA como el resto).
 *
 *   node scripts/_smoke-plantilla-entrevista.mjs
 *
 * Fija cuatro cosas: que la plantilla existe para el REGISTRO y no para el
 * informe; que el centro puede sustituirla por la suya (misma clave) sin que
 * salgan dos; que la «pista» de cada apartado —los subpuntos de la entrevista—
 * sobrevive a la limpieza y llega al prompt de la IA; y que la cita marcada
 * como valoración inicial lleva la plantilla en el enlace de «Preparar
 * sesión» y el borrador nace con esa foto.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLANTILLA_ENTREVISTA,
  APARTADOS_ENTREVISTA_BASE,
  plantillasDe,
  plantillaDe,
  normalizarApartados,
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
} from "../lib/clinica/plantillas.js";
import { bloquesDelRegistro } from "../lib/clinica/registroCompleto.js";
import { colaDePreparacion, plantillaDePreparacion, payloadDePreparacion } from "../lib/clinica/prepararSesion.js";

describe("la plantilla «Entrevista inicial»", () => {
  it("tiene los 15 apartados de Rodrigo, en su orden, cada uno con su pista", () => {
    assert.equal(APARTADOS_ENTREVISTA_BASE.length, 15);
    assert.equal(APARTADOS_ENTREVISTA_BASE[0].label, "1. Datos de identificación");
    assert.equal(APARTADOS_ENTREVISTA_BASE[14].label, "15. Documentación aportada");
    for (const a of APARTADOS_ENTREVISTA_BASE) {
      assert.ok(a.key && a.label && a.tipo, a.label);
      assert.ok(typeof a.pista === "string" && a.pista.length > 0, `${a.label} sin pista`);
    }
    assert.equal(PLANTILLA_ENTREVISTA.key, "entrevista_inicial");
  });

  it("se ofrece siempre para el REGISTRO, detrás de la del centro, y nunca para el informe", () => {
    const sinNada = plantillasDe({ settings: {} }, "registro");
    assert.deepEqual(sinNada.map((p) => p.key), ["base", "entrevista_inicial"]);
    const conLaSuya = plantillasDe({ settings: { clinica: { plantillas: { registro: [{ key: "mia", name: "La mía", apartados: [{ key: "a", label: "A" }] }] } } } }, "registro");
    assert.deepEqual(conLaSuya.map((p) => p.key), ["mia", "entrevista_inicial"]);
    assert.equal(plantillasDe({ settings: {} }, "informe").some((p) => p.key === "entrevista_inicial"), false);
  });

  it("si el centro guarda su propia «entrevista_inicial», manda la suya y no salen dos", () => {
    const t = { settings: { clinica: { plantillas: { registro: [{ key: "entrevista_inicial", name: "Entrevista (Aumenta)", apartados: [{ key: "motivo", label: "Motivo" }] }] } } } };
    const lista = plantillasDe(t, "registro");
    assert.equal(lista.filter((p) => p.key === "entrevista_inicial").length, 1);
    assert.equal(plantillaDe(t, "registro", "entrevista_inicial").name, "Entrevista (Aumenta)");
  });

  it("la pista sobrevive a la limpieza (recortada) y no se inventa donde no la hay", () => {
    const [a, b] = normalizarApartados([
      { key: "x", label: "X", tipo: "texto", pista: "  qué va aquí  " },
      { key: "y", label: "Y", tipo: "lista", pista: "z".repeat(1000) },
    ]);
    assert.equal(a.pista, "qué va aquí");
    assert.equal(b.pista.length, 400);
    const [c] = normalizarApartados([{ key: "c", label: "C" }]);
    assert.equal("pista" in c, false);
  });

  it("los bloques que lee la IA llevan la pista de cada apartado", () => {
    const bloques = bloquesDelRegistro(APARTADOS_ENTREVISTA_BASE);
    const motivo = bloques.find((b) => b.key === "motivoConsulta");
    assert.ok(motivo, "falta el motivo de consulta");
    assert.match(motivo.pista, /Desde cuándo/);
  });
});

describe("de la cita de valoración inicial al registro", () => {
  it("el enlace de «Preparar sesión» lleva la plantilla, y solo si es una clave con forma de clave", () => {
    const cola = colaDePreparacion("2026-09-07T10:00:00.000Z", { bookingId: "11111111-1111-4111-8111-111111111111", plantilla: "entrevista_inicial" });
    assert.match(cola, /plantilla=entrevista_inicial/);
    assert.doesNotMatch(colaDePreparacion("2026-09-07T10:00:00.000Z", { plantilla: "no vale;drop" }), /plantilla=/);
    assert.doesNotMatch(colaDePreparacion("2026-09-07T10:00:00.000Z", {}), /plantilla=/);
    assert.equal(plantillaDePreparacion("entrevista_inicial"), "entrevista_inicial");
    assert.equal(plantillaDePreparacion("x y"), "");
    assert.equal(plantillaDePreparacion(null), "");
  });

  it("el borrador nace con la foto de la plantilla pedida, y sin plantilla no lleva foto", () => {
    const con = payloadDePreparacion({
      patientId: "p", therapistId: "t", fecha: new Date("2026-09-07T10:00:00.000Z"),
      plantilla: "entrevista_inicial", apartados: APARTADOS_ENTREVISTA_BASE,
    });
    assert.equal(con.contentSections[CLAVE_PLANTILLA], "entrevista_inicial");
    assert.equal(con.contentSections[CLAVE_APARTADOS].length, 15);
    const sin = payloadDePreparacion({ patientId: "p", therapistId: "t", fecha: new Date("2026-09-07T10:00:00.000Z") });
    assert.equal("contentSections" in sin, false);
  });
});
