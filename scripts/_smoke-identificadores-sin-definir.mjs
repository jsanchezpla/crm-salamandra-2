// @prueba ligera
/**
 * _smoke-identificadores-sin-definir.mjs — que `npm run lint:undef` se pase
 * SOLO, en cada `npm test` (08/09/2026).
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * El chequeo existía desde el 28/08/2026 (`eslint.undef.mjs`, del día de los
 * apellidos) y era bueno: caza un identificador que no está definido, que en
 * JavaScript no se ve hasta que esa línea se ejecuta. Pero había que acordarse
 * de lanzarlo, y no se lanzaba. El 08/09/2026 tenía TRES errores, los tres
 * fallos de verdad y dos de ellos ya desplegados:
 *
 *   · `setError` en Cuotas: dar de baja con una fecha mal escrita reventaba la
 *     pantalla en vez de enseñar el aviso;
 *   · `Patient`/`TeamMember` al enviar un informe clínico: iban DESPUÉS del
 *     envío, así que el correo salía y el endpoint contestaba 500 — la
 *     pantalla decía que había fallado algo que sí se había hecho;
 *   · `confirmar` en el bloqueo rápido de la agenda, metido esa misma noche
 *     por quien escribe esto, tres horas antes.
 *
 * El tercero es el argumento: no basta con que el chequeo exista, tiene que
 * estar en la puerta por la que se pasa siempre. `npm test` va antes de cada
 * push y de cada deploy, así que aquí es donde vive.
 *
 * ── POR QUÉ ES UNA PRUEBA Y NO UNA LÍNEA EN `package.json` ─────────────────
 * Porque `scripts/pruebas.mjs` ya lanza cada `_smoke-*.mjs` como un proceso y
 * mira su código de salida: encajando aquí sale con su nombre en la lista, se
 * cuenta con las demás y no hay que tocar el runner. Y si un día alguien
 * quiere saltárselo, se ve.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * ── DÓNDE ESTÁ ESLINT (18/09/2026) ─────────────────────────────────────────
 * Se pedía por una ruta fija, `RAIZ/node_modules/eslint/bin/eslint.js`, y en
 * una copia de trabajo del repo sin dependencias instaladas eso no existe: la
 * prueba salía ROJA sin que hubiera nada mal. Con varias sesiones abriendo
 * worktrees a la vez, ese rojo aparecía antes de cada push y costaba el rato
 * de comprobar que era mentira. Ahora se resuelve como cualquier otro import
 * —subiendo por los `node_modules` desde la raíz del repo— y, si de verdad no hay
 * dependencias, la prueba se SALTA diciendo por qué en vez de acusar al
 * código. Si hay dependencias pero falta eslint, eso sí es un fallo: alguien
 * se ha llevado la herramienta que vigila esto.
 */
function buscaEslint(desde) {
  let dir = desde;
  for (;;) {
    const candidato = join(dir, "node_modules", "eslint", "bin", "eslint.js");
    if (existsSync(candidato)) return candidato;
    const padre = dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

const HAY_DEPENDENCIAS = existsSync(join(RAIZ, "node_modules"));
const ESLINT = buscaEslint(RAIZ);

test("ningún identificador sin definir en app, lib, components, modules y scripts", (t) => {
  if (!ESLINT) {
    if (HAY_DEPENDENCIAS) {
      assert.fail("hay node_modules pero no eslint: instala las dependencias (npm ci) o mira qué se lo ha llevado");
    }
    t.skip("esta copia del repo no tiene dependencias instaladas (npm ci); el chequeo se pasa donde sí las hay");
    return;
  }
  // Se llama al binario directamente y no por `npm run`: así no depende de que
  // el `package.json` conserve el nombre del script ni de cómo resuelva npm
  // los ejecutables en Windows.
  const r = spawnSync(
    process.execPath,
    [
      ESLINT,
      "--no-config-lookup",
      "-c", "eslint.undef.mjs",
      "--quiet",
      "app", "lib", "components", "modules", "scripts",
    ],
    { cwd: RAIZ, encoding: "utf8" }
  );

  if (r.error) {
    assert.fail(`no se pudo lanzar eslint: ${r.error.message}`);
  }
  // La salida entera va en el mensaje: sin ella, «falló el lint» obliga a
  // repetirlo a mano para saber qué línea es.
  assert.equal(
    r.status,
    0,
    `\n${(r.stdout || "").trim()}${r.stderr ? `\n${r.stderr.trim()}` : ""}\n\n` +
      "Cada uno de estos es una línea que revienta en cuanto se ejecute. " +
      "Se repite con: npm run lint:undef"
  );
});
