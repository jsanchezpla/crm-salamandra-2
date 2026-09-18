// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-choque.mjs — qué choque se puede forzar al crear una cita, y qué
 * se le dice a quien la apunta (18/09/2026, AV-0166 de Aumenta).
 *
 *   node scripts/_smoke-citas-choque.mjs
 *   node --test-name-pattern="solape" scripts/_smoke-citas-choque.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Aumenta: «al crear una cita y te pone el mensaje de (Ese hueco está
 * bloqueado) si le dan a Crearla igualmente no hace nada, convendría saber el
 * funcionamiento que hace cuando sale ese mensaje».
 *
 * El alta manual devuelve 409 por TRES motivos y solo DOS se perdonan. AV-0167
 * ya quitó el botón muerto del solape, pero la regla se quedó en el JSX
 * olfateando el texto del error, el festivo no mandaba motivo (y salía como
 * «hueco bloqueado»), y el aviso del bloqueo no decía qué pasa si se crea
 * igualmente. Esta prueba fija lo que DEVUELVEN las funciones, no cómo están
 * escritas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MOTIVO_FESTIVO,
  MOTIVO_BLOQUEO,
  MOTIVO_SOLAPE,
  motivoDelChoque,
  esForzable,
  perdonDelChoque,
  perdonesDeSerie,
  avisoDeChoque,
} from "../lib/citas/choqueAlCrear.js";

test("el solape NO se puede forzar, y lo que no se reconoce tampoco", () => {
  assert.equal(esForzable(MOTIVO_SOLAPE), false);
  for (const raro of [undefined, null, "", "otra_cosa", 0]) {
    assert.equal(esForzable(raro), false, `"${raro}" no debería ser forzable`);
  }
  assert.deepEqual(perdonDelChoque(MOTIVO_SOLAPE), {});
  assert.deepEqual(perdonDelChoque("otra_cosa"), {});
});

test("festivo y bloqueo sí, y cada uno tiene SU perdón", () => {
  assert.equal(esForzable(MOTIVO_FESTIVO), true);
  assert.equal(esForzable(MOTIVO_BLOQUEO), true);
  assert.deepEqual(perdonDelChoque(MOTIVO_FESTIVO), { permitirFestivo: true });
  assert.deepEqual(perdonDelChoque(MOTIVO_BLOQUEO), { permitirBloqueo: true });
});

test("el perdón que se devuelve es una copia: nadie puede tocar la lista", () => {
  const p = perdonDelChoque(MOTIVO_BLOQUEO);
  p.permitirBloqueo = false;
  p.colado = true;
  assert.deepEqual(perdonDelChoque(MOTIVO_BLOQUEO), { permitirBloqueo: true });
});

test("un 409 sin `motivo` se reconoce por el texto, y solo hacia el solape", () => {
  // La red de seguridad: respuestas de antes del 18/09/2026, o de otro sitio.
  assert.equal(motivoDelChoque({ error: "Solapa con otra cita activa el 3/10" }), MOTIVO_SOLAPE);
  // Hacia «forzable» NUNCA se adivina: eso devolvería el botón muerto.
  assert.equal(esForzable(motivoDelChoque({ error: "Ese tramo está bloqueado (X)." })), false);
  assert.equal(motivoDelChoque({ error: "cualquier otra cosa" }), null);
  assert.equal(motivoDelChoque({}), null);
  // El `motivo` explícito manda sobre el texto.
  assert.equal(motivoDelChoque({ motivo: MOTIVO_BLOQUEO, error: "Solapa con otra cita" }), MOTIVO_BLOQUEO);
  // Un motivo inventado no cuela como forzable.
  assert.equal(esForzable(motivoDelChoque({ motivo: "permitirTodo" })), false);
});

test("la serie arrastra la decisión que ya se tomó (AV-0105)", () => {
  assert.deepEqual(perdonesDeSerie({}), {});
  assert.deepEqual(perdonesDeSerie({ insistio: true }), {
    permitirFestivo: true,
    permitirBloqueo: true,
  });
  // Una cita que viene a sustituir a un bloqueo perdona ese bloqueo, pero no el
  // festivo: sobre el festivo no se decidió nada (AV-0059).
  assert.deepEqual(perdonesDeSerie({ desdeBloqueo: true }), { permitirBloqueo: true });
});

test("el aviso del bloqueo dice de quién es y qué pasa si se crea igualmente", () => {
  const delCentro = avisoDeChoque({
    motivo: MOTIVO_BLOQUEO,
    error: "Ese tramo está bloqueado (REUNIÓN EQUIPO).",
    deQuien: "centro",
  });
  assert.equal(delCentro.forzable, true);
  assert.equal(delCentro.confirmar, "Crearla igualmente");
  assert.match(delCentro.texto, /REUNIÓN EQUIPO/);
  assert.match(delCentro.texto, /bloqueo del centro/i);
  // Las dos consecuencias que nadie sabía y que se pidió explicar.
  assert.match(delCentro.texto, /bloqueo SE QUEDA/);
  assert.match(delCentro.texto, /no se le ofrece a nadie/);
  assert.match(delCentro.texto, /Citas → Bloqueos/);

  const deElla = avisoDeChoque({
    motivo: MOTIVO_BLOQUEO,
    error: "Ese tramo está bloqueado (LIBRE PACIENTES).",
    deQuien: "profesional",
    profesional: "Olga",
  });
  assert.match(deElla.texto, /bloqueo de Olga/);
  // Sin nombre no se inventa ninguno, pero se sigue diciendo de quién es.
  const sinNombre = avisoDeChoque({ motivo: MOTIVO_BLOQUEO, deQuien: "profesional" });
  assert.match(sinNombre.texto, /la persona que atiende/);
});

test("el festivo tiene su propio título: un día cerrado no es un hueco bloqueado", () => {
  const a = avisoDeChoque({ motivo: MOTIVO_FESTIVO, error: "Ese día está marcado como festivo." });
  assert.equal(a.forzable, true);
  assert.match(a.titulo, /cerrado/i);
  assert.doesNotMatch(a.titulo, /bloqueado/i);
  assert.match(a.texto, /cierre SE QUEDA/);
});

test("el solape suelto no ofrece forzar; con serie detrás ofrece seguir", () => {
  const suelto = avisoDeChoque({ motivo: MOTIVO_SOLAPE, error: "Solapa con otra cita activa el 3/10" });
  assert.equal(suelto.forzable, false);
  // Sin botón: si lo hubiera, la pantalla podría pintarlo.
  assert.equal(suelto.confirmar, undefined);
  assert.match(suelto.texto, /Solapa con otra cita activa el 3\/10/);
  assert.match(suelto.texto, /no es algo que se pueda forzar/);

  const enSerie = avisoDeChoque({ motivo: MOTIVO_SOLAPE, error: "Solapa…", enSerie: true, cuantas: 39 });
  assert.equal(enSerie.forzable, false);
  assert.equal(enSerie.confirmar, "Probar con las otras 39");
  assert.match(enSerie.texto, /otras 39/);
  // Una sola repetición se dice en singular.
  const una = avisoDeChoque({ motivo: MOTIVO_SOLAPE, enSerie: true, cuantas: 1 });
  assert.equal(una.confirmar, "Probar con la otra");
});

test("ningún aviso deja pegado un 'undefined' ni un doble salto de más", () => {
  for (const motivo of [MOTIVO_FESTIVO, MOTIVO_BLOQUEO, MOTIVO_SOLAPE, "raro", undefined]) {
    const a = avisoDeChoque({ motivo });
    assert.doesNotMatch(a.texto, /undefined|null/, `motivo ${motivo}`);
    // Sin frase del servidor, el texto no empieza con los saltos del hueco.
    assert.doesNotMatch(a.texto, /^\n/, `motivo ${motivo}`);
    assert.ok(a.titulo && a.texto.trim().length > 0);
  }
});
