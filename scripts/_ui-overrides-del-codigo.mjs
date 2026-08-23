/**
 * _ui-overrides-del-codigo.mjs — qué pantallas propias carga el código, y de quién.
 *
 * Es la mitad SIN base de datos de `sincronizar-ui-override.mjs`, separada para
 * que `npm test` pueda vigilarla en segundos: lee las páginas del dashboard,
 * encuentra las que importan algo de `modules/overrides/`, y devuelve
 * [{ slug, moduleKey, ruta }]. La otra mitad (compararlo con `master` y
 * corregir la columna) vive en el script y sí necesita conexión.
 *
 *   import { leerVerdadDelCodigo } from "./_ui-overrides-del-codigo.mjs";
 *   const verdad = leerVerdadDelCodigo(raizDelRepo);
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

// A qué moduleKey pertenece la pantalla de cada página. Es lo ÚNICO que no se
// puede deducir del código (las páginas no lo declaran de forma fiable), así
// que va escrito aquí. Pero las PÁGINAS no: se descubren buscando imports de
// `modules/overrides/`, y si aparece una que no está en esta tabla el script se
// PLANTA y lo dice. Así añadir un override en una página nueva no deja el
// letrero viejo en silencio — que es exactamente cómo se rompió.
const MODULO_DE_PAGINA = {
  "app/(dashboard)/leads/page.jsx": "leads",
  "app/(dashboard)/formacion/page.jsx": "training",
  "app/(dashboard)/clientes/[id]/page.jsx": "clients",
};

/**
 * Todas las páginas del dashboard que IMPORTAN algo de `modules/overrides/`.
 * Solo los `import`, no cualquier mención: un comentario que cuente que «aquí
 * había un override» (formacion/page.jsx desde el 18/08/2026) no carga ninguna
 * pantalla, y contarlo obligaría a la página a tener un mapa que ya no tiene.
 */
const IMPORTA_OVERRIDE = /^import .*["'][^"'\n]*modules\/overrides\//m;
export function paginasConOverride(RAIZ) {
  const base = join(RAIZ, "app", "(dashboard)");
  const encontradas = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name === "page.jsx" && IMPORTA_OVERRIDE.test(readFileSync(ruta, "utf8"))) {
        encontradas.push(relative(RAIZ, ruta).split(sep).join("/"));
      }
    }
  };
  recorrer(base);
  return encontradas.sort();
}

/** Devuelve [{ slug, moduleKey, ruta }] leyendo imports + mapa de cada página. */
export function leerVerdadDelCodigo(RAIZ) {
  const paginas = paginasConOverride(RAIZ);
  const sinModulo = paginas.filter((p) => !MODULO_DE_PAGINA[p]);
  if (sinModulo.length) {
    throw new Error(
      `Hay página(s) con override que no sé a qué módulo pertenecen — añádelas a MODULO_DE_PAGINA:\n` +
        sinModulo.map((p) => `    ${p}`).join("\n")
    );
  }

  const verdad = [];
  for (const fichero of paginas) {
    const p = { fichero, moduleKey: MODULO_DE_PAGINA[fichero] };
    const texto = readFileSync(join(RAIZ, p.fichero), "utf8");

    // import Nombre from ".../modules/overrides/<carpeta>/<Fichero>.jsx";
    const imports = new Map();
    for (const m of texto.matchAll(/import\s+(\w+)\s+from\s+"[^"]*modules\/overrides\/([^"]+)\.jsx"/g)) {
      imports.set(m[1], m[2]);
    }

    // const UI_OVERRIDES = { slug: Nombre, … };
    const bloque = texto.match(/const\s+UI_OVERRIDES\s*=\s*\{([\s\S]*?)\};/);
    if (!bloque) throw new Error(`${p.fichero}: no encuentro el mapa UI_OVERRIDES`);
    for (const m of bloque[1].matchAll(/^\s*([a-z0-9_]+)\s*:\s*(\w+)\s*,?/gm)) {
      const [, slug, nombre] = m;
      const ruta = imports.get(nombre);
      if (!ruta) throw new Error(`${p.fichero}: ${slug} usa ${nombre} pero no veo su import`);
      verdad.push({ slug, moduleKey: p.moduleKey, ruta });
    }
  }
  return verdad;
}
