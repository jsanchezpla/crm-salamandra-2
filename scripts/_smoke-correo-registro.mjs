// @prueba ligera
/**
 * _smoke-correo-registro.mjs — el correo que resume la sesión para la familia
 * (04/09/2026).
 *
 * Fija `lib/clinica/correoRegistro.js`. Lo que de verdad hay que asegurar aquí
 * no es la redacción: es **qué no puede salir por correo**. Las notas internas,
 * la preparación y la transcripción del audio son del equipo, y un correo se
 * reenvía y no se puede retirar. La lista blanca se comprueba metiéndolas todas
 * en la sesión a propósito y exigiendo que no aparezcan.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  propuestaDeCorreo,
  limpiarCorreo,
  motivoParaNoAvisar,
  fechaLegible,
  APARTADOS_DEL_CORREO,
  NUNCA_POR_CORREO,
} from "../lib/clinica/correoRegistro.js";

/** Un centro cuya plantilla de registro tiene «Devolución a la familia». */
const tenantConDevolucion = {
  settings: {
    clinica: {
      plantillas: {
        registro: [
        {
          key: "base",
          name: "Registro de sesión",
          apartados: [
            { key: "objectives", label: "Objetivos", tipo: "lista" },
            { key: "activities", label: "Actividades", tipo: "texto" },
            { key: "performance", label: "Desempeño", tipo: "texto" },
            { key: "devolucionFamilia", label: "Devolución a la familia", tipo: "texto" },
            ],
          },
        ],
      },
    },
  },
};

const SECRETOS = {
  internalNotes: "OJO: sospecha de conflicto en casa, hablarlo en equipo",
  prepText: "Preparar material de la semana pasada",
  aiTranscription: "Transcripción literal de los 45 minutos de sesión",
  parentFeedback: "La madre cuenta que duerme mal",
};

const sesionCompleta = {
  sessionDate: "2026-09-04",
  activities: "Hemos trabajado con pictogramas y un juego de turnos.",
  performance: "Muy participativo toda la sesión.",
  contentSections: { devolucionFamilia: "Hugo ha estado muy participativo. En casa podéis practicar los turnos con juegos de mesa." },
  ...SECRETOS,
};

test("el resumen sale de la Devolución a la familia", () => {
  const p = propuestaDeCorreo({ sesion: sesionCompleta, tenant: tenantConDevolucion, patientName: "Hugo Gómez" });
  assert.equal(p.fuente, "devolucion");
  assert.match(p.texto, /muy participativo/i);
  assert.match(p.texto, /juegos de mesa/);
  // Y con la devolución escrita NO se añaden actividades ni desempeño: ya se
  // ha redactado algo para ellos, y repetirlo sería contarlo dos veces.
  assert.equal(p.texto.includes("pictogramas"), false);
});

test("⚠️ NADA del equipo sale por correo", () => {
  const p = propuestaDeCorreo({ sesion: sesionCompleta, tenant: tenantConDevolucion, patientName: "Hugo Gómez" });
  for (const [campo, valor] of Object.entries(SECRETOS)) {
    assert.equal(p.texto.includes(valor), false, `${campo} NO puede salir por correo`);
  }
  // Y la lista de prohibidos está escrita, para que quitarla sea un acto.
  for (const campo of Object.keys(SECRETOS)) assert.ok(NUNCA_POR_CORREO.includes(campo));
});

test("sin devolución escrita, cae a lo que la familia ya recibe en el PDF", () => {
  const { contentSections, ...sinDevolucion } = sesionCompleta;
  const p = propuestaDeCorreo({ sesion: sinDevolucion, tenant: tenantConDevolucion, patientName: "Hugo Gómez" });
  assert.equal(p.fuente, "registro");
  assert.match(p.texto, /pictogramas/);
  assert.match(p.texto, /Muy participativo/);
  // Sigue sin colarse nada del equipo.
  for (const valor of Object.values(SECRETOS)) assert.equal(p.texto.includes(valor), false);
});

test("un registro sin nada escrito da un aviso, no un correo inventado", () => {
  const p = propuestaDeCorreo({
    sesion: { sessionDate: "2026-09-04", ...SECRETOS },
    tenant: tenantConDevolucion,
    patientName: "Hugo Gómez",
  });
  assert.equal(p.fuente, "aviso");
  assert.match(p.texto, /área privada/);
  for (const valor of Object.values(SECRETOS)) assert.equal(p.texto.includes(valor), false);
});

test("el asunto lleva al paciente y la fecha", () => {
  const p = propuestaDeCorreo({ sesion: sesionCompleta, tenant: tenantConDevolucion, patientName: "Hugo Gómez" });
  assert.match(p.asunto, /Hugo Gómez/);
  assert.match(p.asunto, /4 de septiembre de 2026/);
});

test("sin paciente ni fecha el correo sigue teniendo asunto", () => {
  const p = propuestaDeCorreo({ sesion: {}, tenant: tenantConDevolucion });
  assert.ok(p.asunto.length > 0);
  assert.equal(p.fuente, "aviso");
});

test("la lista blanca es corta y está declarada", () => {
  assert.deepEqual(APARTADOS_DEL_CORREO, ["devolucionFamilia", "activities", "performance"]);
});

test("la fecha se lee en Madrid y en cristiano", () => {
  assert.equal(fechaLegible("2026-09-04"), "4 de septiembre de 2026");
  assert.equal(fechaLegible(null), null);
  assert.equal(fechaLegible("no es una fecha"), null);
});

test("no se manda un correo vacío", () => {
  assert.ok(limpiarCorreo({ asunto: "X", texto: "   " }).error);
  assert.ok(limpiarCorreo({}).error);
  assert.ok(limpiarCorreo().error);
  const bueno = limpiarCorreo({ asunto: "Sesión de Hugo", texto: "Hola:\n\nTodo bien." });
  assert.equal(bueno.asunto, "Sesión de Hugo");
  assert.match(bueno.texto, /Todo bien/);
});

test("sin asunto se pone uno, y los textos largos se recortan", () => {
  const r = limpiarCorreo({ texto: "x".repeat(6000) });
  assert.equal(r.asunto, "Registro de sesión");
  assert.equal(r.texto.length, 5000);
});

test("sin correo en la ficha se dice por qué no se avisa", () => {
  assert.match(motivoParaNoAvisar({ email: "" }), /no tiene correo/);
  assert.match(motivoParaNoAvisar({}), /no tiene correo/);
  assert.equal(motivoParaNoAvisar({ email: "familia@ejemplo.com" }), null);
});
