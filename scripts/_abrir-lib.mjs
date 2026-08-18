/**
 * _abrir-lib.mjs — deja importar `/lib` desde un script suelto (18/08/2026).
 *
 *   node --import ./scripts/_abrir-lib.mjs --env-file=.env.local scripts/lo-que-sea.mjs
 *
 * ── QUÉ MURO TIRA ───────────────────────────────────────────────────────────
 *
 * Tres ficheros de `/lib` empiezan con:
 *
 *     import { NextResponse } from "next/server";
 *
 * y son `lib/utils/apiResponse.js`, `lib/utils/errors.js` y
 * `lib/utils/rateLimit.js`. Como casi todo lo demás de `/lib` acaba pasando por
 * alguno de ellos, ese import de una línea cierra la puerta a MEDIO `/lib`
 * cuando se intenta ejercitar desde fuera de la aplicación.
 *
 * El motivo no es que falte nada: `node_modules/next/server.js` existe y se
 * importa perfectamente. Es de puntuación. Node, al importar como módulo, exige
 * la extensión, y Next no declara el atajo `./server` en su `package.json`
 * (versión 16.2.4, comprobado). Dentro del CRM funciona porque el empaquetador
 * de Next completa el `.js` él solo; un `node scripts/…` pelado no puede.
 *
 * ── POR QUÉ ESTO Y NO CORREGIR LOS TRES FICHEROS ────────────────────────────
 *
 * Porque escribir `next/server.js` en `/lib` sería una línea más corta y un
 * riesgo bastante peor (decisión de Jorge, 18/08/2026). Esos tres ficheros son
 * por donde CADA endpoint del CRM devuelve su respuesta, y Next trata
 * `next/server` como un nombre especial: lo desvía a una implementación u otra
 * según dónde vaya a correr el código. Apuntar al fichero a pelo se salta ese
 * desvío. Compilaría igual —y ahí está la trampa—, así que el build no serviría
 * de prueba. Este gancho no toca la aplicación ni un carácter: solo existe
 * mientras corre un script.
 *
 * ── CÓMO SE USA ─────────────────────────────────────────────────────────────
 *
 * Con `--import`, y SIEMPRE delante del fichero del script (Node deja de leer
 * banderas en cuanto encuentra uno):
 *
 *     node --import ./scripts/_abrir-lib.mjs --env-file=.env.local \
 *          scripts/mi-comprobacion.mjs
 *
 * En una prueba de `scripts/_smoke-*`, se declara en su propia cabecera y el
 * lanzador (`npm test`) ya se encarga:
 *
 *     // @prueba-lanzar --import ./scripts/_abrir-lib.mjs
 *
 * Hermano de `_fake-stripe-loader.mjs`, con una diferencia importante: aquel
 * SUSTITUYE una librería por una de mentira, y por eso se planta si detecta
 * producción. Este no sustituye nada — solo completa una extensión — así que no
 * necesita ese freno y no cambia lo que el código hace.
 */

import { register } from "node:module";

// Se pasa la URL tal cual (no una ruta): en Windows la carpeta del proyecto
// tiene un espacio y convertir de ida y vuelta a ruta lo deja mal escapado.
register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
