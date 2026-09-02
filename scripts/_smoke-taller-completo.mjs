// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-taller-completo.mjs — el audio y la IA en la sesión de TALLER
 * (03/09/2026, Rodrigo: «añade audio e IA a la sesión de taller»).
 *
 *   node scripts/_smoke-taller-completo.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 *
 * El registro de un taller lo comparten ocho familias, y la IA escribe en él
 * desde un audio en el que la profesional nombra a los niños. Un fallo aquí no
 * es un apartado vacío: es que la familia de siete lea lo de uno. Por eso:
 *
 *   1. Los BLOQUES salen de la misma lista para el prompt y para el reparto:
 *      el cuerpo común, UNA nota por asistente con nombre, las internas al
 *      final. Sin nombre no hay bloque (Claude no sabría de quién es).
 *   2. El PROMPT dice con todas las letras que lo de un niño va a su nota y
 *      que en el grupo no hay nombres.
 *   3. El REPARTO solo escribe una nota en la clave de ese asistente: una nota
 *      para un id que no está en la lista se tira, y la clave de la nota
 *      individual nunca entra como apartado común.
 *   4. Lo interno no cruza a lo común ni a las notas.
 *   5. La propuesta canned de local tiene la forma de los bloques que se piden.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BLOQUE_INTERNAS,
  asistentesLimpios,
  bloquesDelTaller,
  claveDeNota,
  escritoDelTaller,
  mensajeDeTaller,
  normalizarPropuestaDeTaller,
  pacienteDeClave,
  promptDeTaller,
  propuestaDemoTaller,
  repartirPropuestaDeTaller,
} from "../lib/clinica/tallerCompleto.js";
import { CLAVE_NOTA_INDIVIDUAL } from "../lib/clinica/tallerSesion.js";
import { APARTADOS_REGISTRO_BASE } from "../lib/clinica/plantillas.js";

const LEO = "11111111-1111-4111-8111-111111111111";
const MARTA = "22222222-2222-4222-8222-222222222222";
const ASISTENTES = [
  { patientId: LEO, nombre: "Leo Prueba" },
  { patientId: MARTA, nombre: "Marta Ejemplo" },
];
const PLANTILLA = [
  { key: "objectives", label: "Objetivos trabajados", tipo: "lista" },
  { key: "activities", label: "Actividades realizadas", tipo: "texto" },
  { key: "clima", label: "Cómo ha ido el grupo", tipo: "texto" },
];

describe("los bloques del taller", () => {
  it("son los comunes de la plantilla, una nota por asistente y las internas al final", () => {
    const b = bloquesDelTaller({ apartados: PLANTILLA, asistentes: ASISTENTES, etiquetaNota: "Nota de hoy" });
    assert.deepEqual(
      b.map((x) => [x.key, x.grupo]),
      [
        ["objectives", "comun"],
        ["activities", "comun"],
        ["clima", "comun"],
        [claveDeNota(LEO), "nota"],
        [claveDeNota(MARTA), "nota"],
        ["internalNotes", "interno"],
      ]
    );
    const leo = b.find((x) => x.key === claveDeNota(LEO));
    assert.equal(leo.label, "Nota de hoy · Leo Prueba");
    assert.equal(leo.patientId, LEO);
    assert.match(leo.pista, /Leo Prueba/);
    assert.equal(b[b.length - 1].interno, true);
  });

  it("sin apartados cae a los de fábrica del registro; sin asistentes no hay notas", () => {
    const b = bloquesDelTaller({ apartados: null, asistentes: [] });
    const comunes = b.filter((x) => x.grupo === "comun").map((x) => x.key);
    assert.deepEqual(comunes, APARTADOS_REGISTRO_BASE.map((a) => a.key));
    assert.equal(b.filter((x) => x.grupo === "nota").length, 0);
    assert.equal(b[b.length - 1].key, BLOQUE_INTERNAS.key);
  });

  it("la clave de la nota individual NUNCA es un apartado común, ni una clave de nota o de internas", () => {
    const b = bloquesDelTaller({
      apartados: [
        ...PLANTILLA,
        { key: CLAVE_NOTA_INDIVIDUAL, label: "Colada", tipo: "texto" },
        { key: "internalNotes", label: "Robada", tipo: "texto" },
        { key: claveDeNota(LEO), label: "Robada 2", tipo: "texto" },
      ],
      asistentes: ASISTENTES,
    });
    const comunes = b.filter((x) => x.grupo === "comun").map((x) => x.key);
    // La nota individual y las internas no entran como comunes. La clave de
    // una nota («nota:<id>») ni siquiera es una clave válida de apartado:
    // `normalizarApartados` le pone otra a partir del título («robada_2»), y
    // por eso no puede chocar con la del asistente.
    assert.deepEqual(comunes, ["objectives", "activities", "clima", "robada_2"]);
    assert.equal(comunes.includes(CLAVE_NOTA_INDIVIDUAL), false);
    assert.equal(comunes.includes(claveDeNota(LEO)), false);
    assert.equal(b.filter((x) => x.key === "internalNotes").length, 1);
    assert.equal(b.filter((x) => x.key === claveDeNota(LEO)).length, 1);
    assert.equal(b.find((x) => x.key === claveDeNota(LEO)).grupo, "nota");
  });

  it("un asistente sin nombre o sin id no tiene bloque, y los repetidos salen una vez", () => {
    assert.deepEqual(
      asistentesLimpios([{ patientId: LEO, nombre: "Leo" }, { patientId: LEO, nombre: "Leo otra vez" }, { patientId: MARTA }, { nombre: "Nadie" }, null]),
      [{ patientId: LEO, nombre: "Leo" }]
    );
    assert.equal(pacienteDeClave(claveDeNota(MARTA)), MARTA);
    assert.equal(pacienteDeClave("objectives"), null);
    assert.equal(pacienteDeClave("nota:"), null);
  });
});

describe("el prompt", () => {
  it("nombra a los asistentes, separa las tres partes y prohíbe nombres en el grupo", () => {
    const b = bloquesDelTaller({ apartados: PLANTILLA, asistentes: ASISTENTES });
    const p = promptDeTaller(b);
    assert.match(p, /SESIÓN DE TALLER EN GRUPO/);
    assert.match(p, /REGISTRO DEL GRUPO/);
    assert.match(p, /NOTA INDIVIDUAL DE CADA ASISTENTE \(Leo Prueba, Marta Ejemplo\)/);
    assert.match(p, /NOTAS INTERNAS/);
    assert.match(p, /va SOLO a su nota individual/);
    assert.match(p, /NO INVENTES/);
    // El molde lleva todas las claves, la de cada niño incluida.
    assert.match(p, new RegExp(`"${claveDeNota(LEO)}": "…"`));
    assert.match(p, /\[INTERNO — la familia no lo lee NUNCA\]/);
  });

  it("el mensaje lleva lo ya escrito como contexto, por el título del bloque", () => {
    const b = bloquesDelTaller({ apartados: PLANTILLA, asistentes: ASISTENTES });
    const m = mensajeDeTaller({ transcription: "Hoy hemos jugado.", escrito: { clima: "Bien", [claveDeNota(LEO)]: "Atento" }, bloques: b });
    assert.match(m, /TRANSCRIPCIÓN DE LA NOTA DE VOZ DEL TALLER/);
    assert.match(m, /- Cómo ha ido el grupo: Bien/);
    assert.match(m, /- Nota individual · Leo Prueba: Atento/);
    assert.doesNotMatch(mensajeDeTaller({ transcription: "x", bloques: b }), /YA HABÍA ESCRITO/);
  });
});

describe("el reparto de la propuesta", () => {
  const bloques = bloquesDelTaller({ apartados: PLANTILLA, asistentes: ASISTENTES });

  it("cada nota va a SU asistente, lo común a lo común y lo interno a lo interno", () => {
    const propuesta = normalizarPropuestaDeTaller(
      JSON.stringify({
        objectives: ["Esperar el turno", "Pedir ayuda"],
        activities: "Juego cooperativo.",
        clima: "",
        [claveDeNota(LEO)]: "Leo ha esperado su turno.",
        [claveDeNota(MARTA)]: "",
        internalNotes: "La madre de Marta está de mudanza.",
      }),
      bloques
    );
    assert.equal(propuesta.objectives, "Esperar el turno\nPedir ayuda");
    const r = repartirPropuestaDeTaller(propuesta, bloques);
    assert.deepEqual(r.comunes, { objectives: "Esperar el turno\nPedir ayuda", activities: "Juego cooperativo." });
    assert.deepEqual(r.notas, { [LEO]: "Leo ha esperado su turno." });
    assert.equal(r.internalNotes, "La madre de Marta está de mudanza.");
  });

  it("una nota para alguien que no está en la lista se tira, y una clave desconocida también", () => {
    const otro = "33333333-3333-4333-8333-333333333333";
    const propuesta = normalizarPropuestaDeTaller(
      { [claveDeNota(otro)]: "Lo de otro niño", [CLAVE_NOTA_INDIVIDUAL]: "Colada", inventado: "x", activities: "Juego." },
      bloques
    );
    assert.equal(propuesta[claveDeNota(otro)], undefined);
    assert.equal(propuesta[CLAVE_NOTA_INDIVIDUAL], undefined);
    const r = repartirPropuestaDeTaller(propuesta, bloques);
    assert.deepEqual(r.notas, {});
    assert.deepEqual(r.comunes, { activities: "Juego." });
    assert.equal(CLAVE_NOTA_INDIVIDUAL in r.comunes, false);
  });

  it("lo interno no cruza: nunca aparece en los comunes ni en las notas", () => {
    const r = repartirPropuestaDeTaller({ internalNotes: "SECRETO", activities: "Juego." }, bloques);
    assert.equal(JSON.stringify(r.comunes).includes("SECRETO"), false);
    assert.equal(JSON.stringify(r.notas).includes("SECRETO"), false);
    assert.equal(r.internalNotes, "SECRETO");
  });

  it("una respuesta rota da propuesta vacía sin romper", () => {
    const r = repartirPropuestaDeTaller(normalizarPropuestaDeTaller("esto no es json", bloques), bloques);
    assert.deepEqual(r, { comunes: {}, notas: {}, internalNotes: "" });
  });
});

describe("lo ya escrito y la demo", () => {
  it("escritoDelTaller pone cada cosa en su clave y deja fuera lo vacío", () => {
    const e = escritoDelTaller({
      valores: { activities: "Juego.", clima: "  " },
      asistentes: [{ patientId: LEO, nota: "Atento" }, { patientId: MARTA, nota: "" }],
      internalNotes: "Ojo con la mudanza",
    });
    assert.deepEqual(e, { activities: "Juego.", [claveDeNota(LEO)]: "Atento", internalNotes: "Ojo con la mudanza" });
  });

  it("la propuesta de demostración tiene la forma de los bloques pedidos", () => {
    const b = bloquesDelTaller({ apartados: PLANTILLA, asistentes: ASISTENTES });
    const p = propuestaDemoTaller(b);
    assert.deepEqual(Object.keys(p), b.map((x) => x.key));
    assert.match(p[claveDeNota(LEO)], /Leo Prueba/);
    assert.match(p[claveDeNota(MARTA)], /Marta Ejemplo/);
    assert.match(p.internalNotes, /Marta Ejemplo/);
    // El apartado propio del centro sale vacío, como haría el modelo.
    assert.equal(p.clima, "");
    const r = repartirPropuestaDeTaller(p, b);
    assert.deepEqual(Object.keys(r.notas).sort(), [LEO, MARTA].sort());
    // Y en lo común no hay ningún nombre.
    assert.doesNotMatch(JSON.stringify(r.comunes), /Leo|Marta/);
  });
});
