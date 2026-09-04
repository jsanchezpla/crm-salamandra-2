// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-apartados-propuestos.mjs — la IA puede proponer apartados que NO
 * existen, y el informe se dicta como el registro (04/09/2026, Rodrigo).
 *
 *   node scripts/_smoke-apartados-propuestos.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * El encargo tiene dos mitades y las dos se pueden romper en silencio:
 *
 *  1. «Que la transcripción de Claude observe los campos existentes y añada
 *     nuevos automáticamente si así lo decide.» El prompt lleva desde siempre
 *     «una clave por apartado y ninguna más», que es lo que hace que la
 *     propuesta caiga donde debe — y lo que hacía que lo dictado y no previsto
 *     se TIRARA sin avisar. Ahora hay una excepción, `nuevos`, y hay que fijar
 *     sus dos cerrojos: que jamás pise la clave de un apartado que ya existe
 *     (le borraría el texto al guardar) y que un apartado vacío no entre.
 *
 *  2. «La pantalla de crear un informe debería ser como la del Registro, con su
 *     IA, sus notas y sus campos.» El informe se dicta con las MISMAS piezas
 *     que el registro (`informeMaterial.js` sobre `registroCompleto.js`): si un
 *     día el prompt del informe deja de casar con el parseo, la propuesta
 *     saldría vacía sin un solo error por ninguna parte.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  apartadosPropuestos,
  cabenNuevos,
  CLAVE_NUEVOS,
  INSTRUCCION_NUEVOS,
  MAX_NUEVOS,
} from "../lib/clinica/apartadosPropuestos.js";
import { bloquesDelRegistro, moldeDeBloques, normalizarPropuesta, promptDeRegistro } from "../lib/clinica/registroCompleto.js";
import { bloquesDelInforme, mensajeDeInforme, promptDeInforme } from "../lib/clinica/informeMaterial.js";
import { APARTADOS_INFORME_BASE, MAX_APARTADOS } from "../lib/clinica/plantillas.js";

/* ═══ 1 · Los apartados que se inventa el modelo ══════════════════════════ */

describe("Apartados nuevos: lo que el modelo propone crear", () => {
  const bloques = [
    { key: "objectives", label: "Objetivos", tipo: "lista" },
    { key: "performance", label: "Desempeño", tipo: "texto" },
  ];

  it("lee título, tipo y contenido, y calcula una clave estable", () => {
    const nuevos = apartadosPropuestos(
      { [CLAVE_NUEVOS]: [{ titulo: "Entorno familiar", tipo: "párrafo", contenido: "Vive con su madre." }] },
      bloques
    );
    assert.deepEqual(nuevos, [
      { key: "entorno_familiar", label: "Entorno familiar", tipo: "texto", valor: "Vive con su madre." },
    ]);
  });

  it("las listas llegan como una línea por viñeta, que es lo que teclea la pantalla", () => {
    const [nuevo] = apartadosPropuestos(
      { [CLAVE_NUEVOS]: [{ titulo: "Material aportado", tipo: "lista", contenido: ["Informe del colegio", "Analítica"] }] },
      bloques
    );
    assert.equal(nuevo.tipo, "lista");
    assert.equal(nuevo.valor, "Informe del colegio\nAnalítica");
  });

  it("NUNCA pisa la clave de un apartado que ya existe", () => {
    // Un apartado nuevo que se quedara con `objectives` le borraría el texto al
    // apartado de verdad en cuanto se guardara.
    const [nuevo] = apartadosPropuestos(
      { [CLAVE_NUEVOS]: [{ titulo: "Objectives", contenido: "algo" }] },
      [{ key: "objectives", label: "Objetivos", tipo: "lista" }]
    );
    assert.notEqual(nuevo.key, "objectives");
    assert.match(nuevo.key, /^objectives_2$/);
  });

  it("descarta el que repita un título que ya está, aunque cambie la capitalización", () => {
    const nuevos = apartadosPropuestos(
      { [CLAVE_NUEVOS]: [{ titulo: "desempeño", contenido: "algo" }] },
      bloques
    );
    assert.deepEqual(nuevos, []);
  });

  it("un apartado propuesto SIN contenido no entra: sería una casilla vacía más", () => {
    const nuevos = apartadosPropuestos(
      { [CLAVE_NUEVOS]: [{ titulo: "Observaciones", contenido: "   " }, { titulo: "", contenido: "algo" }] },
      bloques
    );
    assert.deepEqual(nuevos, []);
  });

  it("no se rompe con basura y respeta el tope de la pasada", () => {
    assert.deepEqual(apartadosPropuestos(null, bloques), []);
    assert.deepEqual(apartadosPropuestos({ [CLAVE_NUEVOS]: "no soy un array" }, bloques), []);
    const muchos = Array.from({ length: MAX_NUEVOS + 3 }, (_, i) => ({ titulo: `Apartado ${i}`, contenido: "x" }));
    assert.equal(apartadosPropuestos({ [CLAVE_NUEVOS]: muchos }, bloques).length, MAX_NUEVOS);
  });

  it("no caben más de MAX_APARTADOS en un documento, y se dice cuántos se quedan fuera", () => {
    const tres = [{ key: "a" }, { key: "b" }, { key: "c" }];
    assert.deepEqual(cabenNuevos(tres, MAX_APARTADOS - 1, MAX_APARTADOS), { entran: [{ key: "a" }], fuera: 2 });
    assert.deepEqual(cabenNuevos(tres, MAX_APARTADOS, MAX_APARTADOS), { entran: [], fuera: 3 });
    assert.deepEqual(cabenNuevos(tres, 0, MAX_APARTADOS).entran.length, 3);
  });

  it("`nuevos` NO se cuela en la propuesta: son cosas distintas", () => {
    // `normalizarPropuesta` solo reparte por los bloques que existen. Si un día
    // dejara pasar la clave `nuevos`, se guardaría un array como si fuera el
    // cuerpo de un apartado.
    const propuesta = normalizarPropuesta(
      { objectives: ["Atención"], [CLAVE_NUEVOS]: [{ titulo: "X", contenido: "y" }] },
      bloques
    );
    assert.deepEqual(Object.keys(propuesta).sort(), ["objectives", "performance"]);
  });
});

/* ═══ 2 · El prompt lo pide, y el molde lo enseña ═════════════════════════ */

describe("El prompt: la excepción se explica y se ve en el molde", () => {
  const bloques = bloquesDelRegistro([{ key: "objectives", label: "Objetivos", tipo: "lista" }]);

  it("el registro pide `nuevos` y dice que lo normal es no proponer ninguno", () => {
    const prompt = promptDeRegistro(bloques);
    assert.ok(prompt.includes(INSTRUCCION_NUEVOS), "falta la instrucción de los apartados nuevos");
    assert.ok(prompt.includes(`"${CLAVE_NUEVOS}": []`), "no dice cómo se devuelve cuando no hace falta ninguno");
  });

  it("el molde solo la lleva cuando se pide (el taller NO la admite)", () => {
    assert.ok(!moldeDeBloques(bloques).includes(`"${CLAVE_NUEVOS}"`));
    assert.ok(moldeDeBloques(bloques, { conNuevos: true }).includes(`"${CLAVE_NUEVOS}"`));
  });
});

/* ═══ 3 · El informe se dicta con las piezas del registro ═════════════════ */

describe("El informe dictado: prompt y parseo salen de la misma lista", () => {
  const apartados = [
    { key: "motiveOfIntervention", label: "Motivo de intervención", tipo: "texto" },
    { key: "evolution", label: "Evolución", tipo: "lista" },
  ];

  it("sin apartados caen los del informe de fábrica, no una lista vacía", () => {
    assert.deepEqual(
      bloquesDelInforme(null).map((b) => b.key),
      APARTADOS_INFORME_BASE.map((a) => a.key)
    );
  });

  it("el informe NO lleva envoltorio: ni preparación, ni devolución, ni notas internas", () => {
    const claves = bloquesDelInforme(apartados).map((b) => b.key);
    assert.deepEqual(claves, ["motiveOfIntervention", "evolution"]);
    for (const fuera of ["prepText", "parentFeedback", "internalNotes"]) {
      assert.ok(!claves.includes(fuera), `${fuera} no es un apartado del informe`);
    }
  });

  it("el prompt nombra TODAS las claves que luego se van a leer", () => {
    const bloques = bloquesDelInforme(apartados);
    const prompt = promptDeInforme(bloques, { tipo: "discharge" });
    for (const b of bloques) {
      assert.ok(prompt.includes(`"${b.key}"`), `el prompt no nombra ${b.key}`);
    }
    // Y lo que de verdad distingue a un informe de un registro: quién lo lee.
    assert.match(prompt, /lo lee la familia/i);
    assert.ok(prompt.includes(INSTRUCCION_NUEVOS));
  });

  it("el nombre del documento entra en la cabecera, para que sepa qué escribe", () => {
    assert.match(promptDeInforme(bloquesDelInforme(apartados), { tipo: "discharge" }), /informe de alta/i);
  });

  it("del paciente NO viaja el nombre, ni por el mensaje ni por el prompt", () => {
    // La regla la fija `estiloClinico.js`: al modelo van la edad y las áreas,
    // nunca el nombre. El mensaje solo lleva material y lo ya escrito.
    const bloques = bloquesDelInforme(apartados);
    const mensaje = mensajeDeInforme({
      transcription: "Le doy el alta.",
      escrito: { motiveOfIntervention: "Dificultades de lectura." },
      bloques,
    });
    assert.match(mensaje, /Le doy el alta\./);
    assert.match(mensaje, /Dificultades de lectura\./);
    assert.ok(!/PACIENTE:/.test(mensaje), "el mensaje no debe llevar la ficha del paciente");
  });
});
