// @prueba ligera — lee ficheros del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-dictar-el-plan.mjs — el botón de dictar el Plan se ve SIN abrir antes
 * el panel de la IA (05/09/2026).
 *
 *   node scripts/_smoke-dictar-el-plan.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * AV-0050 (Aumenta, Silvia Pérez, 04/09/2026): «aún no nos sale la opción de
 * poder grabar audio en el apartado de plan, dentro de la ficha del paciente».
 * Y sí salía: estaba desplegado, con la clave de OpenAI puesta y el build de
 * esa misma tarde. Lo que pasaba es que los botones «● Dictar» y «Añadir
 * audio» vivían DENTRO del panel «Redactar objetivos con IA», y con el panel
 * plegado —que es como se abre la pestaña Plan— lo único visible era un enlace
 * de texto que no habla de micrófonos. Una función entregada que nadie
 * encuentra es una función que no está.
 *
 * Es colocación en el JSX, o sea texto, así que se fija con regex sobre el
 * código, que es para lo que CLAUDE.md las reserva: si alguien vuelve a meter
 * el micrófono dentro del panel, esto lo dice antes de que Silvia lo vuelva a
 * escribir.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FUENTE = readFileSync(new URL("../components/clinica/InterventionPlanSection.jsx", import.meta.url), "utf8");

/** El bloque que se pinta con el panel PLEGADO (`if (!abierto) { … }`). */
function ramaPlegada() {
  const desde = FUENTE.indexOf("if (!abierto) {");
  assert.notEqual(desde, -1, "ya no existe la rama del panel plegado: revisa esta prueba");
  const hasta = FUENTE.indexOf("const marcados", desde);
  assert.notEqual(hasta, -1, "no encuentro el final de la rama plegada");
  return FUENTE.slice(desde, hasta);
}

test("con el panel plegado hay un botón de dictar, no solo el enlace de la IA", () => {
  const plegado = ramaPlegada();
  assert.match(plegado, /● Dictar/, "el botón de dictar no se ve sin abrir el panel de la IA");
  assert.match(plegado, /✨ Redactar objetivos con IA/, "se ha perdido el enlace de la IA");
});

test("ese botón abre el panel Y empieza a grabar, en el mismo clic", () => {
  const plegado = ramaPlegada();
  assert.match(plegado, /setAbierto\(true\);\s*grabadora\.empezar\(\)/,
    "dictar desde fuera tiene que abrir el panel y arrancar la grabadora a la vez");
});

test("solo sale donde el navegador sabe grabar", () => {
  const plegado = ramaPlegada();
  assert.match(plegado, /grabadora\.soportado &&/,
    "sin comprobar `soportado` saldría un botón muerto en los navegadores que no graban");
});

test("la grabadora se pide ANTES del corte por `abierto` (orden de hooks)", () => {
  const hook = FUENTE.indexOf("useGrabadora({");
  const corte = FUENTE.indexOf("if (!abierto) {");
  assert.notEqual(hook, -1, "ya no se usa useGrabadora en el plan");
  assert.ok(hook < corte, "useGrabadora tiene que llamarse antes del return anticipado, o React se queja");
});

test("dentro del panel siguen estando dictar y añadir audio", () => {
  assert.match(FUENTE, /■ Parar/, "se ha perdido el botón de parar la grabación");
  assert.match(FUENTE, /Añadir audio/, "se ha perdido el selector de archivo de audio");
});
