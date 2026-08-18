/**
 * _smoke-ui-overrides.mjs — las pantallas propias por cliente, contadas (18/08/2026).
 *
 *   node scripts/_smoke-ui-overrides.mjs
 *
 * Sin base de datos, sin servidor. Solo lee ficheros del repo.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El letrero `ui_override` de `master.tenant_modules` se rompió en silencio dos
 * veces: se movió o borró un override y nadie tocó la fila. Desde el 18/08 lo
 * repara `sincronizar-ui-override.mjs`, que lee la verdad de los mapas
 * `UI_OVERRIDES` de las páginas. Pero ese script tiene una tabla a mano —a qué
 * módulo pertenece cada página— y se PLANTA si aparece una página con override
 * que no está en ella. Bien: mejor plantarse que mentir. Lo malo es que solo se
 * plantaría cuando alguien lo lanzara, que es lo que no pasa.
 *
 * Esto lo lanza `npm test`. Así, añadir un override en una página nueva sin
 * decirle a qué módulo pertenece sale en ROJO en la siguiente subida, no en el
 * back-office dentro de tres meses.
 *
 * ── LO QUE FIJA ─────────────────────────────────────────────────────────────
 *
 *   · toda página con import de `modules/overrides/` tiene su módulo declarado
 *     (si no, `leerVerdadDelCodigo` lanza y esto sale rojo);
 *   · cada entrada del mapa apunta a un fichero que EXISTE en disco — es lo que
 *     antes fallaba en la base de datos, y aquí se cierra en el código;
 *   · las claves de los mapas son slugs de BD (`nutri_laura`, con guion bajo),
 *     no la carpeta con guion (`nutri-laura`) — confundirlos deja al cliente
 *     viendo el módulo pobre sin ningún error;
 *   · y un recuento por módulo, para que un override que se cuele en una página
 *     inesperada se VEA en la salida.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leerVerdadDelCodigo, paginasConOverride } from "./_ui-overrides-del-codigo.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
let pasadas = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    pasadas++;
    process.stdout.write(`  ✓ ${nombre}\n`);
  } else {
    fallos++;
    process.stdout.write(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}\n`);
  }
}

process.stdout.write("\nPantallas propias por cliente (mapas UI_OVERRIDES)\n\n");

let verdad = null;
let paginas = [];
try {
  paginas = paginasConOverride(RAIZ);
  verdad = leerVerdadDelCodigo(RAIZ);
  check(`las ${paginas.length} páginas con override tienen su módulo declarado`, true);
} catch (e) {
  check("las páginas con override tienen su módulo declarado", false, String(e.message).split("\n")[0]);
}

if (verdad) {
  check("hay al menos una pantalla propia (si esto falla, el lector se ha roto)", verdad.length > 0);

  for (const v of verdad) {
    const fichero = join(RAIZ, "modules", "overrides", `${v.ruta}.jsx`);
    check(`${v.slug} · ${v.moduleKey} → ${v.ruta}.jsx existe`, existsSync(fichero), fichero);
  }

  const conGuion = verdad.filter((v) => v.slug.includes("-"));
  check(
    "las claves de los mapas son slugs de BD (guion bajo), no carpetas (guion)",
    conGuion.length === 0,
    conGuion.map((v) => `${v.slug} en ${v.moduleKey}`).join(", ")
  );

  const porModulo = {};
  for (const v of verdad) porModulo[v.moduleKey] = (porModulo[v.moduleKey] || 0) + 1;
  process.stdout.write(
    `\n  Recuento: ${Object.entries(porModulo)
      .map(([m, n]) => `${m}=${n}`)
      .join(" · ")}\n`
  );
}

process.stdout.write(`\n${fallos === 0 ? "✓" : "✗"} ${pasadas} bien · ${fallos} mal\n\n`);
process.exit(fallos === 0 ? 0 : 1);
