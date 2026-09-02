// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-borrador-de-cita.mjs — el registro preparado de una cita que no se da
 * (02/09/2026, AV-0026 de Aumenta).
 *
 *   node scripts/_smoke-borrador-de-cita.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Una terapeuta preparó la sesión desde la cita a las 14:18, el paciente no
 * vino y a las 16:17 marcó la falta injustificada. La cita quedó bien
 * (`no_show` + incidencia), pero el borrador siguió vivo y la ficha del
 * paciente le pedía completar la sesión de hoy. La regla que decide qué
 * borrador se retira y cuál se conserva vive en `lib/clinica/borradorDeCita.js`;
 * esta prueba fija lo que DEVUELVE, porque retirar uno con texto dentro es
 * perder el trabajo de alguien.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { borradorVacio, rotuloDeBorrador, citaNoSeDio, estadoDeLasCitas } from "../lib/clinica/borradorDeCita.js";

/** Un borrador tal como lo crea «Preparar sesión» sin escribir nada. */
const EN_BLANCO = {
  status: "draft",
  prepText: null,
  prepFiles: [],
  objectives: [],
  activities: null,
  performance: null,
  observations: { familyComments: "", nextSessionNotes: "", homeworkTasks: "", incidents: "" },
  contentSections: { apartados: [{ key: "objetivos", titulo: "Objetivos" }], plantilla: "registro" },
  parentFeedback: null,
  internalNotes: null,
  aiTranscription: null,
  aiStructured: null,
  duration: 45,
  sessionDate: "2026-09-02T14:30:00.000Z",
};

describe("borradorVacio", () => {
  it("un borrador recién preparado, sin escribir nada, está en blanco", () => {
    assert.equal(borradorVacio(EN_BLANCO), true);
  });

  it("la foto de la plantilla dentro de contentSections no cuenta como contenido", () => {
    assert.equal(borradorVacio({ ...EN_BLANCO, contentSections: { apartados: [{ key: "a" }], plantilla: "x" } }), true);
    assert.equal(borradorVacio({ ...EN_BLANCO, contentSections: {} }), true);
    assert.equal(borradorVacio({ ...EN_BLANCO, contentSections: null }), true);
  });

  it("cualquier cosa escrita lo conserva: preparación, adjuntos, cuerpo, apartados, notas, IA", () => {
    const casos = {
      prepText: "Repasar la r vibrante",
      prepFiles: [{ id: "f1", name: "foto.jpg" }],
      objectives: ["Objetivo 1"],
      activities: "Juego de mesa",
      performance: "Bien",
      observations: { familyComments: "", nextSessionNotes: "traer el cuaderno", homeworkTasks: "", incidents: "" },
      contentSections: { apartados: [], plantilla: "registro", objetivos: "Escrito a mano" },
      parentFeedback: "La madre comenta…",
      internalNotes: "Padres poco implicados",
      aiTranscription: "…",
      aiStructured: { objetivos: ["x"] },
    };
    for (const [campo, valor] of Object.entries(casos)) {
      assert.equal(borradorVacio({ ...EN_BLANCO, [campo]: valor }), false, `con ${campo} escrito NO está en blanco`);
    }
  });

  it("solo un draft puede estar en blanco: una sesión registrada o publicada nunca se retira", () => {
    assert.equal(borradorVacio({ ...EN_BLANCO, status: "registered" }), false);
    assert.equal(borradorVacio({ ...EN_BLANCO, status: "published" }), false);
    assert.equal(borradorVacio({ ...EN_BLANCO, status: "ai_pending" }), false);
  });

  it("acepta una instancia de Sequelize (toJSON) y rechaza lo que no es una sesión", () => {
    assert.equal(borradorVacio({ toJSON: () => ({ ...EN_BLANCO }) }), true);
    assert.equal(borradorVacio(null), false);
    assert.equal(borradorVacio("draft"), false);
  });
});

describe("rotuloDeBorrador", () => {
  it("un borrador cuya cita fue falta o se canceló deja de llamarse «Borrador»", () => {
    assert.equal(rotuloDeBorrador({ status: "draft", bookingStatus: "no_show" }), "Preparada · el paciente no vino");
    assert.equal(rotuloDeBorrador({ status: "draft", bookingStatus: "cancelled" }), "Preparada · cita cancelada");
  });

  it("en cualquier otro caso devuelve null y la pantalla pinta su etiqueta de siempre", () => {
    assert.equal(rotuloDeBorrador({ status: "draft", bookingStatus: "confirmed" }), null);
    assert.equal(rotuloDeBorrador({ status: "draft", bookingStatus: null }), null);
    assert.equal(rotuloDeBorrador({ status: "draft" }), null);
    assert.equal(rotuloDeBorrador({ status: "registered", bookingStatus: "no_show" }), null);
    assert.equal(rotuloDeBorrador(null), null);
  });
});

describe("citaNoSeDio", () => {
  it("falta (justificada o no) y cancelada son citas que no se dieron; el resto, no", () => {
    assert.equal(citaNoSeDio({ status: "no_show" }), true);
    assert.equal(citaNoSeDio({ status: "no_show", noShowJustified: true }), true);
    assert.equal(citaNoSeDio("cancelled"), true);
    assert.equal(citaNoSeDio({ status: "confirmed" }), false);
    assert.equal(citaNoSeDio({ status: "completed" }), false);
    assert.equal(citaNoSeDio(null), false);
    assert.equal(citaNoSeDio({ status: "hasOwnProperty" }), false);
  });
});

describe("estadoDeLasCitas", () => {
  it("pregunta una sola vez por las citas distintas y devuelve su estado; sin modelo, mapa vacío", async () => {
    const pedidas = [];
    const Booking = {
      findAll: async ({ where }) => {
        pedidas.push(where.id);
        return where.id.map((id) => ({ id, status: id === "b1" ? "no_show" : "confirmed" }));
      },
    };
    const mapa = await estadoDeLasCitas({ Booking, sesiones: [{ bookingId: "b1" }, { bookingId: "b1" }, { bookingId: "b2" }, { bookingId: null }, {}] });
    assert.deepEqual(pedidas, [["b1", "b2"]]);
    assert.equal(mapa.get("b1"), "no_show");
    assert.equal(mapa.get("b2"), "confirmed");
    assert.equal((await estadoDeLasCitas({ Booking: null, sesiones: [{ bookingId: "b1" }] })).size, 0);
    assert.equal((await estadoDeLasCitas({ Booking, sesiones: [] })).size, 0);
    assert.equal(pedidas.length, 1, "sin citas que preguntar no se consulta");
  });
});
