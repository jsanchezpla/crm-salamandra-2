// @prueba ligera — funciones puras de /lib y lectura del código; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-horario-propio.mjs — el interruptor «sin horario propio» de
 * Citas (03/09/2026, Aumenta).
 *
 *   node scripts/_smoke-citas-horario-propio.mjs
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 * Rodrigo pidió quitar «Mi horario» a Aumenta: sus terapeutas no tienen hora
 * fija y las citas se las coloca administración. Se hizo con un interruptor
 * (`lib/citas/horarioPropio.js`) que leen CUATRO sitios —el menú, la ficha de
 * Equipo, `/api/team` y la agenda pública— y lo que se rompe en silencio es
 * que uno de los cuatro deje de leerlo: el menú lo esconde pero la ficha lo
 * pinta, o al revés. La prueba fija lo que devuelve la función y que cada
 * lector sigue mirando la MISMA regla.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  conHorarioPropio,
  FLAG_SIN_HORARIO_PROPIO,
  MODULO_HORARIO_PROPIO,
  HIJOS_OCULTOS_SIN_HORARIO_PROPIO,
} from "../lib/citas/horarioPropio.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(raiz, rel), "utf8");

describe("conHorarioPropio — sin bandera, horario propio; con ella, no", () => {
  test("sin featureFlags (null/undefined/{}) → true: nadie lo pierde por defecto", () => {
    assert.equal(conHorarioPropio(undefined), true);
    assert.equal(conHorarioPropio(null), true);
    assert.equal(conHorarioPropio({}), true);
    assert.equal(conHorarioPropio({ autoConfirmPublicBookings: false }), true);
  });

  test("solo `true` estricto lo quita: una cadena o un 1 no valen", () => {
    assert.equal(conHorarioPropio({ [FLAG_SIN_HORARIO_PROPIO]: true }), false);
    assert.equal(conHorarioPropio({ [FLAG_SIN_HORARIO_PROPIO]: "true" }), true);
    assert.equal(conHorarioPropio({ [FLAG_SIN_HORARIO_PROPIO]: 1 }), true);
    assert.equal(conHorarioPropio({ [FLAG_SIN_HORARIO_PROPIO]: false }), true);
  });

  test("con el hasFeatureFlag(moduleKey, flag) del contexto pregunta por `citas`", () => {
    const preguntas = [];
    const hasFeatureFlag = (mod, flag) => { preguntas.push([mod, flag]); return mod === "citas" && flag === FLAG_SIN_HORARIO_PROPIO; };
    assert.equal(conHorarioPropio(hasFeatureFlag), false);
    assert.deepEqual(preguntas, [[MODULO_HORARIO_PROPIO, FLAG_SIN_HORARIO_PROPIO]]);
    assert.equal(conHorarioPropio(() => false), true);
  });

  test("la bandera vive en la fila `citas` y se llama sinHorarioPropio", () => {
    assert.equal(MODULO_HORARIO_PROPIO, "citas");
    assert.equal(FLAG_SIN_HORARIO_PROPIO, "sinHorarioPropio");
  });
});

describe("los cuatro lectores miran la misma regla", () => {
  test("el menú: esconde exactamente hijos que existen bajo Citas", () => {
    const sidebar = leer("components/layout/Sidebar.jsx");
    assert.match(sidebar, /import \{ conHorarioPropio, HIJOS_OCULTOS_SIN_HORARIO_PROPIO \} from "\.\.\/\.\.\/lib\/citas\/horarioPropio\.js"/);
    assert.match(sidebar, /ocultos\.push\(\.\.\.HIJOS_OCULTOS_SIN_HORARIO_PROPIO\)/);
    assert.deepEqual(HIJOS_OCULTOS_SIN_HORARIO_PROPIO, ["citas-mi-horario"]);
    for (const key of HIJOS_OCULTOS_SIN_HORARIO_PROPIO) {
      assert.match(sidebar, new RegExp(`key: "${key}"`), `el hijo ${key} ya no existe en el menú`);
    }
  });

  test("/api/team: no calcula tieneHorario sin horario propio y lo dice en horarioPropio", () => {
    const ruta = leer("app/api/team/route.js");
    assert.match(ruta, /const horarioPropio = conHorarioPropio\(hasFeatureFlag\)/);
    assert.match(ruta, /tieneHorario: horarioPropio \? conHorario\.has\(String\(m\.id\)\) : null/);
    assert.match(ruta, /^\s*horarioPropio,\s*$/m);
  });

  test("la ficha de Equipo lee horarioPropio de la lista y con él pinta el editor", () => {
    const pagina = leer("app/(dashboard)/equipo/page.jsx");
    assert.match(pagina, /setHorarioPropio\(json\.data\?\.horarioPropio !== false\)/);
    assert.match(pagina, /\{horarioPropio && \(\s*<div className="pt-2">\s*<div[^>]*>Horario de trabajo<\/div>\s*<TeamHoursEditor/);
  });

  test("la agenda pública pasa horarioPropio al recorte en las dos rutas", () => {
    for (const rel of [
      "app/api/public/c/[tenantSlug]/availability/route.js",
      "app/api/public/c/[tenantSlug]/availability/month/route.js",
    ]) {
      const ruta = leer(rel);
      assert.match(ruta, /const horarioPropio = conHorarioPropio\(hasFeatureFlag\)/, rel);
      assert.match(ruta, /recortarSiTieneProfesional\([\s\S]*?\{ horarioPropio \}/, rel);
    }
    const qp = leer("lib/citas/quienPregunta.js");
    assert.match(qp, /if \(!profesionalId \|\| !horarioPropio\) return aplicables;/);
  });

  test("los avisos de «sin horario» solo saltan con `tieneHorario === false`, nunca con null", () => {
    for (const rel of ["components/clients/ClientProfesionalSection.jsx", "modules/formularios/FormulariosModule.jsx"]) {
      const src = leer(rel);
      assert.ok(src.includes("tieneHorario === false"), `${rel}: el aviso tiene que comparar con === false`);
      assert.ok(!/!\w+\.tieneHorario\b/.test(src), `${rel}: un !tieneHorario avisaría también con null`);
    }
  });
});
