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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

test("ningún identificador sin definir en app, lib, components, modules y scripts", () => {
  // Se llama al binario por su ruta y no por `npm run`: así no depende de que
  // el `package.json` conserve el nombre del script ni de cómo resuelva npm
  // los ejecutables en Windows.
  const r = spawnSync(
    process.execPath,
    [
      join(RAIZ, "node_modules", "eslint", "bin", "eslint.js"),
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
