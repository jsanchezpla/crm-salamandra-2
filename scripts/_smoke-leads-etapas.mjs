/**
 * _smoke-leads-etapas.mjs — las etapas de TODAS las pantallas de Leads (17/08/2026;
 * hoy cinco: el base y cuatro overrides).
 *
 *   node scripts/_smoke-leads-etapas.mjs
 *
 * Sin base de datos, sin servidor, sin `.env`. Solo lee ficheros. Corre en
 * cualquier máquina y en cualquier rama, y cubre a los ONCE clientes de
 * producción de una vez —incluidos los cinco que usan el módulo por defecto y
 * que en local no existen—, porque leer un fichero no necesita que nadie esté
 * sembrado.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * La pantalla de Leads existe VARIAS veces: el módulo por defecto y los
 * overrides por cliente (siete en total el 17/08/2026; cinco desde el 18/08,
 * cuando demo y sandbox se borraron: base + aumenta, nutri-laura, retorika y
 * spain-enzymes), que se quedan separados a propósito (decisión de
 * Jorge, 17/08/2026: «si cambio uno y se cambian los demás se podría romper
 * todo»). Esta prueba no viene a unificarlos. Viene a cubrir lo ÚNICO que cada
 * uno declara por su cuenta y que puede matar la pantalla: su lista de etapas.
 * Los overrides se DESCUBREN en disco, así que el número no está escrito aquí.
 *
 * Hasta hoy Leads no tenía NI UNA prueba: ~60 ficheros `_smoke-*` en el repo y
 * ninguno lo tocaba.
 *
 * ── DE QUÉ FALLO REAL NACE CADA BLOQUE ─────────────────────────────────────
 *
 * 1. PANTALLA EN BLANCO. Los overrides recorren su `STAGES` y desreferencian
 *    el estilo SIN defensa: `STAGE_STYLE[s.key].dot` en nutri-laura, retorika y
 *    spain-enzymes, y `const style = STAGE_STYLE[s.key]` + `style.dot` en
 *    aumenta (y en demo y sandbox, que eran copias suyas hasta el 18/08/2026).
 *    Una etapa en `STAGES` que no esté en `STAGE_STYLE`
 *    no da un aviso: tira la pantalla entera con un TypeError, y `next build` no
 *    lo ve porque pasa al renderizar. Donde pintan `lead.stage` (el dato de BD)
 *    sí van defendidos con `?? STAGE_STYLE.new` — el agujero está justo en el
 *    array escrito a mano, que es lo que se toca cuando un cliente pide una
 *    etapa nueva. O sea: el cambio más probable del módulo entra por el único
 *    sitio sin red.
 *
 * 2. BOTÓN DE ETAPA MUERTO. `PATCH /api/leads/[id]` valida contra
 *    `ALLOWED_STAGES`. Una etapa que esté en la pantalla y no en esa lista
 *    responde 422 y el cambio no se guarda: el cliente dice «no me guarda el
 *    estado» y no hay forma de reproducirlo mirando la pantalla. Ya pasó.
 *
 * 3. LA CLAVE EN CRUDO EN EL EXCEL. `/api/leads/export` traduce con
 *    `STAGE_LABELS`. Una etapa permitida sin etiqueta sale como `demo_scheduled`
 *    en un fichero que el cliente reenvía a terceros.
 *
 * 4. LOS DOS CONTADORES DEJAN DE COINCIDIR. Hay TRES listas de «qué etapa está
 *    cerrada» y nada las sincroniza: `ALLOWED_STAGES` en lib/leads/stages.js,
 *    `GANADOS`/`PERDIDOS` en lib/leads/estadisticas.js y `CLOSED_STAGES` en
 *    lib/home/summary.js. Con una sola tocada, la portada dice «12 abiertos» y
 *    el embudo dice 9. Que el cliente deje de creerse los números es peor que un
 *    error visible.
 *
 * 5. EL MÓDULO POR DEFECTO VUELVE A TENER SUS PROPIAS ETIQUETAS. Las tenía, y
 *    distintas de las canónicas: un lead salía con una etapa en pantalla y con
 *    otra en el Excel del mismo lead. Se arregló el 10/08/2026 importando de
 *    `lib/leads/stages.js`. Esto lo deja fijado.
 *
 * 6. SE SIRVE EL OVERRIDE EQUIVOCADO. Las claves del mapa de
 *    `app/(dashboard)/leads/page.jsx` van con GUIÓN BAJO (`nutri_laura`) y las
 *    carpetas con GUIÓN (`nutri-laura`). Un copy-paste en la línea del import y
 *    un cliente ve la marca y el vocabulario de otro. `next build` no lo ve: el
 *    import existe.
 *
 * ── LOS RÓTULOS QUE NO COINCIDEN, A PROPÓSITO ──────────────────────────────
 *
 * Un cliente puede llamar a una etapa como quiera en SU pantalla: eso es el
 * sentido de tener overrides. Hoy hay varias que no coinciden con el rótulo
 * canónico, y son deliberadas. Por eso el bloque de rótulos NO exige igualdad
 * —saldría rojo el primer día en cuatro casos buenos, y una prueba que nace en
 * rojo se deja de mirar en una semana, arrastrando a las de al lado—: es un
 * INVENTARIO CONGELADO. Falla si aparece una divergencia NUEVA (que hay que
 * mirar y, si es intencionada, añadir aquí) y falla también si desaparece una
 * sin quitarla de la lista, para que la lista no envejezca en silencio.
 *
 * ── LO QUE ESTO NO CUBRE ───────────────────────────────────────────────────
 *
 * Que los overrides FUNCIONEN. Prueba que sus etapas son coherentes, no
 * que el panel guarde notas ni que el import de CSV parsee. Son ~4.200 líneas
 * de JavaScript de cliente (los cuatro overrides) y cubrirlas de verdad pide
 * un navegador.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_STAGES, STAGE_LABELS } from "../lib/leads/stages.js";
import { GANADAS, PERDIDAS, etapasDe } from "../lib/leads/embudos.js";

// `fileURLToPath` y no `new URL(...).pathname`: una URL trae el camino
// ESCAPADO, así que una carpeta con un espacio llega como `%20` y el
// `readdirSync` de más abajo se estrella con un ENOENT que no dice nada del
// espacio. Pasa de verdad — un clon en `C:\Claude Code` —, y es el mismo modo
// que ya usan `pruebas.mjs` y `_smoke-piezas-ficha.mjs`.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const avisos = [];

function check(etiqueta, ok, detalle) {
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok && detalle) process.stdout.write(`    ${detalle}\n`);
}

function h(t) {
  process.stdout.write(`\n▶ ${t}\n`);
}

function leer(rel) {
  return readFileSync(`${RAIZ}/${rel}`, "utf8");
}

/**
 * Recorta un bloque declarado en la primera columna: `const X = [` … `];`
 * Devuelve null si no lo encuentra, y quien llame TIENE que tratar el null como
 * un fallo — nunca como «no aplica». Un analizador de texto que se queda a cero
 * y da verde es peor que no tener prueba.
 */
function bloque(texto, nombre, abre, cierra) {
  const i = texto.indexOf(`const ${nombre} = ${abre}`);
  if (i < 0) return null;
  const j = texto.indexOf(`\n${cierra};`, i);
  if (j < 0) return null;
  return texto.slice(i, j);
}

const clavesDe = (blk) => [...blk.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
const rotulosDe = (blk) =>
  Object.fromEntries([...blk.matchAll(/key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
/** Claves de primer nivel de un objeto indentado con dos espacios. */
const clavesObjeto = (blk) => [...blk.matchAll(/^ {2}(\w+):\s*\{/gm)].map((m) => m[1]);

// ── Lo que hay ───────────────────────────────────────────────────────────────

const DIR_OVERRIDES = `${RAIZ}/modules/overrides`;
// Descubiertos, no escritos a mano: un override nuevo entra en la prueba solo.
const slugs = readdirSync(DIR_OVERRIDES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${DIR_OVERRIDES}/${d.name}/LeadsModule.jsx`))
  .map((d) => d.name)
  .sort();

const overrides = slugs.map((dir) => {
  const rel = `modules/overrides/${dir}/LeadsModule.jsx`;
  const texto = leer(rel);
  const bStages = bloque(texto, "STAGES", "[", "]");
  const bStyle = bloque(texto, "STAGE_STYLE", "{", "}");
  return {
    dir,
    rel,
    texto,
    etapas: bStages ? clavesDe(bStages) : null,
    rotulos: bStages ? rotulosDe(bStages) : null,
    estilos: bStyle ? clavesObjeto(bStyle) : null,
  };
});

// ── 0. Meta: los ficheros dicen lo que esta prueba cree que dicen ────────────

h(`Se han podido leer los ${slugs.length} overrides`);
// El mínimo es 1 y no un número: la lista ENCOGE a propósito (CLAUDE.md, «En
// Leads la pirámide está al revés»: demo y sandbox se fueron el 18/08/2026), y
// una prueba que exija seis carpetas se pondría en rojo cada vez que se gane.
check("hay overrides que leer", slugs.length >= 1, `encontrados: ${slugs.join(", ") || "ninguno"}`);
for (const o of overrides) {
  check(
    `${o.dir}: se le lee el STAGES y el STAGE_STYLE`,
    o.etapas !== null && o.estilos !== null,
    o.etapas === null
      ? `no encuentro «const STAGES = [ … ];» en ${o.rel} — ¿lo han renombrado? Arréglalo AQUÍ o esta prueba deja de mirar ese fichero`
      : `no encuentro «const STAGE_STYLE = { … };» en ${o.rel}`
  );
  if (o.etapas) {
    check(`${o.dir}: y tiene al menos 3 etapas (${o.etapas.length})`, o.etapas.length >= 3, o.etapas.join(", "));
  }
}

const legibles = overrides.filter((o) => o.etapas && o.estilos);

// ── 1. Ninguna etapa de la pantalla se queda sin estilo ─────────────────────
// El fallo 1 de la cabecera: pantalla en blanco.

h("Toda etapa de la pantalla tiene su estilo (si no, pantalla en blanco)");
for (const o of legibles) {
  const huerfanas = o.etapas.filter((k) => !o.estilos.includes(k));
  check(
    `${o.dir}: sus ${o.etapas.length} etapas están en STAGE_STYLE`,
    huerfanas.length === 0,
    `sin estilo: ${huerfanas.join(", ")} → TypeError al renderizar, la pantalla no se pinta`
  );
}

// ── 2. Ninguna etapa inventada ──────────────────────────────────────────────
// El fallo 2: el botón responde 422 y no guarda.

h("Ninguna etapa está fuera de ALLOWED_STAGES (si no, el botón no guarda)");
for (const o of legibles) {
  const inventadas = o.etapas.filter((k) => !ALLOWED_STAGES.includes(k));
  check(
    `${o.dir}: sus etapas las acepta el PATCH`,
    inventadas.length === 0,
    `no están en ALLOWED_STAGES: ${inventadas.join(", ")} → PATCH /api/leads/[id] devuelve 422`
  );
}

// ── 3. La lista canónica y sus etiquetas, cuadradas ─────────────────────────
// El fallo 3: la clave en crudo en el Excel.

h("ALLOWED_STAGES y STAGE_LABELS son el mismo conjunto");
const sinRotulo = ALLOWED_STAGES.filter((k) => !(k in STAGE_LABELS));
const rotuloHuerfano = Object.keys(STAGE_LABELS).filter((k) => !ALLOWED_STAGES.includes(k));
check("toda etapa permitida tiene etiqueta", sinRotulo.length === 0, `saldrían en crudo en el Excel: ${sinRotulo.join(", ")}`);
check("y no hay etiquetas de etapas que ya no existen", rotuloHuerfano.length === 0, rotuloHuerfano.join(", "));

// ── 4. Las tres listas de «cerrado» ─────────────────────────────────────────
// El fallo 4.
//
// GANADOS y PERDIDOS se leían de `lib/leads/estadisticas.js` con una expresión
// regular sobre el TEXTO, porque no se exportaban y exportarlas habría tocado
// /lib/ (regla 2) sin necesidad. Desde el 17/08/2026 viven en
// `lib/leads/embudos.js` y SÍ se exportan —hicieron falta fuera para saber si un
// embudo puede dar a alguien por ganado—, así que aquí se importan.
//
// Y esa mudanza es justo el motivo por el que no se leen a mano nunca más: al
// moverlas, la regex dejó de casar, este fichero cascó, y la comprobación de
// abajo se quedó comparando contra `null` sin que el aviso de arriba dijera nada
// del embudo. CLOSED_STAGES sigue por texto porque sigue sin exportarse.

h("Las tres listas de etapas cerradas dicen lo mismo");
const txtPortada = leer("lib/home/summary.js");

const conjuntoDeArray = (texto, nombre) => {
  const m = texto.match(new RegExp(`const ${nombre} = \\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
};

const ganados = [...GANADAS];
const perdidos = [...PERDIDAS];
const cerradosPortada = conjuntoDeArray(txtPortada, "CLOSED_STAGES");

check(
  "se les lee GANADOS, PERDIDOS y CLOSED_STAGES",
  !!(ganados && perdidos && cerradosPortada),
  "si esto falla, la comparación de abajo no está mirando nada — arréglalo aquí"
);

if (ganados && perdidos && cerradosPortada) {
  const embudo = [...new Set([...ganados, ...perdidos])].sort();
  const portada = [...new Set(cerradosPortada)].sort();
  check(
    "el embudo y la portada cuentan lo mismo como cerrado",
    JSON.stringify(embudo) === JSON.stringify(portada),
    `embudo: ${embudo.join(", ")}\n    portada: ${portada.join(", ")}`
  );
  const fueraDeCanon = embudo.filter((k) => !ALLOWED_STAGES.includes(k));
  check("y todas esas etapas siguen existiendo", fueraDeCanon.length === 0, fueraDeCanon.join(", "));
}

// ── 5. El módulo por defecto no vuelve a tener sus propias etiquetas ────────
// El fallo 5, que ya pasó el 10/08/2026.
//
// Desde el 18/08/2026 el módulo base es el de aumenta promocionado, y ya NI
// SIQUIERA importa las etiquetas: las recibe por props desde la página, que
// es quien las resuelve con `etapasDe()` (embudos.js) + `STAGE_LABELS`
// (stages.js). Así que lo que se vigila es lo mismo —una sola fuente— pero se
// mira en dos sitios: que el módulo no tenga copia propia, y que la página se
// las dé desde /lib.

h("El módulo por defecto sigue sin copia propia de las etiquetas");
const txtDefault = leer("modules/leads/LeadsModule.jsx");
const txtPaginaLeads = leer("app/(dashboard)/leads/page.jsx");
check(
  "el módulo no declara ningún STAGE_LABELS ni STAGES propio",
  !/^const (STAGE_LABELS|STAGES)\s*=/m.test(txtDefault),
  "ha vuelto a tener su propia lista: es la regresión del 10/08/2026"
);
check(
  "el módulo recibe las etapas por props (stages) y no las importa",
  /export default function LeadsModule\(\{[^}]*\bstages\b/.test(txtDefault) &&
    !/from\s*["'][^"']*lib\/leads\/stages\.js["']/.test(txtDefault),
  "si importa stages.js o no recibe `stages`, ha dejado de ser el módulo parametrizado"
);
check(
  "la página resuelve las etapas con etapasDe() de embudos.js",
  /import\s*\{[^}]*\betapasDe\b[^}]*\}\s*from\s*["'][^"']*lib\/leads\/embudos\.js["']/.test(txtPaginaLeads) &&
    // El segundo argumento (`tieneModulo`) entró el 24/08/2026 con el embudo de
    // `booking`, que se decide por módulo y no por slug. Se acepta con y sin él
    // para no atar esta comprobación a la firma exacta.
    /etapasDe\(tenantSlug\s*(?:,[^)]*)?\)/.test(txtPaginaLeads),
  "sin eso el módulo base pintaría un embudo que el servidor no conoce"
);
check(
  "y los rótulos con STAGE_LABELS de stages.js",
  /import\s*\{[^}]*STAGE_LABELS[^}]*\}\s*from\s*["'][^"']*lib\/leads\/stages\.js["']/.test(txtPaginaLeads),
  "sin ese import volvería a pintar etiquetas distintas de las del Excel"
);
check(
  "y se las pasa al módulo",
  /<LeadsModule\s[^>]*\bstages=\{stages\}/.test(txtPaginaLeads),
  "el módulo base recibiría `stages` undefined y reventaría al montar"
);

// ── 6. El cableado de page.jsx ──────────────────────────────────────────────
// El fallo 6: se sirve el override de otro cliente.

h("El mapa de page.jsx apunta a donde dice");
const txtPage = leer("app/(dashboard)/leads/page.jsx");
const importados = Object.fromEntries(
  [...txtPage.matchAll(/import\s+(\w+)\s+from\s+"([^"]*modules\/(?:overrides\/([\w-]+)|leads)\/LeadsModule\.jsx)"/g)].map(
    (m) => [m[1], m[3] ?? null]
  )
);
const bMapa = bloque(txtPage, "UI_OVERRIDES", "{", "}");
check("se le lee el UI_OVERRIDES", bMapa !== null, "no encuentro «const UI_OVERRIDES = { … };» en la página");

if (bMapa) {
  const pares = [...bMapa.matchAll(/^ {2}(\w+):\s*(\w+)\s*,/gm)].map((m) => ({ clave: m[1], comp: m[2] }));
  check(`el mapa tiene una entrada por override (${pares.length} de ${slugs.length})`, pares.length === slugs.length,
    `mapa: ${pares.map((p) => p.clave).join(", ")}\n    carpetas: ${slugs.join(", ")}`);

  for (const p of pares) {
    const carpeta = importados[p.comp];
    check(
      `${p.clave} → ${carpeta ?? "(no es un override)"}`,
      carpeta !== undefined && carpeta !== null && p.clave === carpeta.replaceAll("-", "_"),
      carpeta == null
        ? `${p.comp} no se importa de modules/overrides/*/LeadsModule.jsx`
        : `la clave debería ser «${carpeta.replaceAll("-", "_")}» (guión bajo), no «${p.clave}»`
    );
  }

  const enMapa = new Set(pares.map((p) => p.clave));
  for (const dir of slugs) {
    check(
      `${dir} está enganchado en la página`,
      enMapa.has(dir.replaceAll("-", "_")),
      "el fichero existe y nadie lo sirve: o falta la entrada, o es un override muerto"
    );
  }
}

// ── 7. Los rótulos que no coinciden, congelados ─────────────────────────────
//
// Un cliente puede llamar a su etapa como quiera; el Excel y la pantalla
// compartida de estadísticas usan el rótulo canónico. Estas divergencias están
// MEDIDAS contra el código, no copiadas de la memoria de nadie.

// (`demo` y `sandbox` salieron el 18/08/2026 con sus overrides.)
const DIVERGENCIAS_ACEPTADAS = {
  "nutri-laura": { consulta_agendada: 1, consulta_realizada: 1, paciente: 1 },
  "spain-enzymes": { new: 1 },
  aumenta: {},
  retorika: {},
};

h("Los rótulos que no coinciden con el Excel son los conocidos");
for (const o of legibles) {
  const esperadas = DIVERGENCIAS_ACEPTADAS[o.dir];
  if (!esperadas) {
    check(`${o.dir}: está en el inventario`, false, "override nuevo: añádelo a DIVERGENCIAS_ACEPTADAS tras mirar sus rótulos");
    continue;
  }
  const reales = Object.entries(o.rotulos)
    .filter(([k, v]) => STAGE_LABELS[k] && STAGE_LABELS[k] !== v)
    .map(([k]) => k)
    .sort();
  const conocidas = Object.keys(esperadas).sort();
  const nuevas = reales.filter((k) => !esperadas[k]);
  const desaparecidas = conocidas.filter((k) => !reales.includes(k));

  check(
    `${o.dir}: sin divergencias nuevas (${reales.length})`,
    nuevas.length === 0,
    nuevas
      .map((k) => `«${o.rotulos[k]}» en pantalla y «${STAGE_LABELS[k]}» en el Excel (${k}) — si es a propósito, añádelo al inventario`)
      .join("\n    ")
  );
  check(
    `${o.dir}: y el inventario no se ha quedado viejo`,
    desaparecidas.length === 0,
    `ya coinciden, quítalas del inventario: ${desaparecidas.join(", ")}`
  );
}

// ── 8. Los overrides siguen dejando contar al servidor ──────────────────────
// El contador de la cabecera se rompió una vez contando sobre la lista ya
// filtrada. El arreglo vive en el endpoint, pero depende de que la pantalla
// pida el desglose y lea la respuesta.

// ⚠️ Buscar «desglose» a secas NO vale: la palabra está en los comentarios de
// todos los ficheros, así que pasaría en verde aunque el código dejara de
// pedirlo. Hay que mirar los dos patrones de CÓDIGO: que lo pida en la query y
// que lo lea de la respuesta.
h("Los contadores de cabecera los sigue dando el servidor");
for (const o of legibles) {
  const loPide = /desglose:\s*"1"|set\(\s*"desglose"/.test(o.texto);
  const loLee = /\.desglose\b/.test(o.texto);
  check(
    `${o.dir}: pide desglose=1 y lee la respuesta`,
    loPide && loLee,
    !loPide
      ? "ya no manda desglose=1: los contadores de arriba volverán a contar solo lo que hay en pantalla"
      : "manda desglose=1 pero no lee data.desglose: los contadores se quedarán a cero"
  );
}

// ── 8. El servidor sabe qué etapas ofrece cada embudo ───────────────────────
// `lib/leads/embudos.js` COPIA la lista de etapas de cada override, porque los
// componentes son "use client" y desde el servidor no se pueden importar. Esa
// copia es lo que permite ocultar «Convertidos» donde el embudo no puede dar a
// nadie por ganado — y también lo que se desviaría en silencio si alguien añade
// una etapa a un componente y no la añade allí. Esto es lo que lo impide.
//
// Se comparan como CONJUNTO y no en orden: el orden es cosa de cómo se pinta la
// botonera, y hacer fallar la prueba por reordenar dos botones sería un falso
// positivo, que es lo que hace que a la larga nadie mire las pruebas.
h("El servidor sabe qué etapas ofrece cada embudo");
for (const o of legibles) {
  // La carpeta va con guión (`nutri-laura`) y el slug de la BD con guión bajo
  // (`nutri_laura`), que es la clave real de embudos.js.
  const slug = o.dir.replace(/-/g, "_");
  const declarado = [...etapasDe(slug)].sort();
  const enElComponente = [...o.etapas].sort();
  check(
    `${o.dir}: embudos.js declara sus ${o.etapas.length} etapas`,
    declarado.length === enElComponente.length && declarado.every((k, i) => k === enElComponente[i]),
    `el componente ofrece [${enElComponente.join(", ")}] y embudos.js dice ` +
      `[${declarado.join(", ")}] para '${slug}' — si son las 15 canónicas, es que esa clave no está`
  );
}

// Y el embudo POR DEFECTO, el que ve un cliente sin override (18/08/2026):
// cinco etapas, todas canónicas, con una de ganado dentro — que es lo que hace
// que «Convertidos» le salga a un cliente nuevo en /leads/estadisticas. Si
// alguien lo deja en las 15 de ALLOWED_STAGES, el módulo base pinta quince
// tarjetas y esto lo dice.
{
  const porDefecto = etapasDe("__cliente_sin_override__");
  check(
    `el embudo por defecto tiene entre 3 y 7 etapas (${porDefecto.length})`,
    porDefecto.length >= 3 && porDefecto.length <= 7,
    `tiene ${porDefecto.length}: ${porDefecto.join(", ")}`
  );
  check(
    "y todas son canónicas",
    porDefecto.every((k) => ALLOWED_STAGES.includes(k)),
    porDefecto.filter((k) => !ALLOWED_STAGES.includes(k)).join(", ")
  );
  check(
    "y tiene una etapa de ganado (para que «Convertidos» le salga a un cliente nuevo)",
    porDefecto.some((k) => GANADAS.has(k)),
    `sin ganado, /leads/estadisticas taparía «Convertidos» a todo cliente nuevo`
  );
  check(
    "y termina en una de perdido",
    porDefecto.some((k) => PERDIDAS.has(k)),
    "sin descartado no hay forma de sacar a nadie del embudo"
  );
}

// ── Avisos: no fallan, pero conviene saberlos ───────────────────────────────

const usadas = new Set(legibles.flatMap((o) => o.etapas));
const sinUsar = ALLOWED_STAGES.filter((k) => !usadas.has(k));
if (sinUsar.length) avisos.push(`Etapas permitidas que ningún override usa: ${sinUsar.join(", ")}`);

for (const o of legibles) {
  if (ganados && !o.etapas.some((k) => ganados.includes(k))) {
    avisos.push(
      `${o.dir} no tiene ninguna etapa ganadora: en /leads/estadisticas no se le enseña «Convertidos» ` +
        `(lo decide embudos.js). Si algún día debe convertir a alguien, le falta la etapa`
    );
  }
  const estilosSinEtapa = o.estilos.filter((k) => !o.etapas.includes(k));
  if (estilosSinEtapa.length) {
    avisos.push(`${o.dir} tiene estilo para etapas que no ofrece: ${estilosSinEtapa.join(", ")} — si hay leads ahí, sus chips no suman el total`);
  }
}

if (avisos.length) {
  process.stdout.write("\n▶ Avisos (no fallan)\n");
  for (const a of avisos) process.stdout.write(`  · ${a}\n`);
}

process.stdout.write(fallos ? `\n✗ ${fallos} fallo(s)\n\n` : `\n✓ Todo correcto — ${legibles.length} overrides + el módulo por defecto\n\n`);
process.exit(fallos ? 1 : 0);
