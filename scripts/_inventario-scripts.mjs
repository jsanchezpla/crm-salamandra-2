/**
 * _inventario-scripts.mjs — quién llama a cada script de `scripts/`, para saber
 * qué está vivo y qué ya es historia.
 *
 *   node scripts/_inventario-scripts.mjs            → tabla por veredicto
 *   node scripts/_inventario-scripts.mjs --json     → todo, para otros scripts
 *   node scripts/_inventario-scripts.mjs --solo candidatos|dudas|vivos
 *
 * ── POR QUÉ EXISTE (19/08/2026) ───────────────────────────────────────────
 * `scripts/` tenía 380 entradas: 110 `migrate-*`, 33 `seed-*`, parches de
 * clientes que ya no existen, activaciones de módulo anteriores a
 * `enable-module.js`… Cada vez que hacía falta uno había que buscarlo entre
 * todos. La idea es mover a `scripts/_hechos/` lo que ya se ejecutó y no
 * volverá a ejecutarse, dejando arriba solo lo vivo. Pero «ya se ejecutó en
 * producción» NO es el criterio: una migración aplicada sigue viva si un alta
 * de cliente o un `enable-module` la necesita (las corre
 * `_module-migrations.js`). El criterio es «ningún flujo vivo la llama y no
 * vale para un alta ni para un entorno nuevo», y eso hay que medirlo, no
 * recordarlo. Esto lo mide. No es un índice a mano: se calcula del repo cada
 * vez que se lanza.
 *
 * ── QUÉ MIRA ──────────────────────────────────────────────────────────────
 * Para cada fichero de `scripts/` (sin entrar en subcarpetas):
 *   · si está en MODULES/CORE/MODULE_SEEDS de `_module-migrations.js` (vivo:
 *     lo corren el alta y enable-module) o en ONE_OFF (declarado, no se ejecuta
 *     solo: se mira la razón);
 *   · quién lo importa o lo nombra: lib/, app/, otros scripts, Dockerfile,
 *     deploy.sh, package.json, las skills, CLAUDE.md, los Mapas de docs/modules;
 *   · su cabecera: marcas de «una vez», «SUPERADA», «ONE_OFF», «histórico»;
 *   · si lleva dentro el slug de un cliente que ya no existe.
 *
 * Y da un veredicto:
 *   VIVO       lo llama algo vivo (mapa de migraciones, lib/app, Dockerfile,
 *              deploy.sh, skills, CLAUDE.md, Mapas, pruebas, otro script vivo).
 *   CANDIDATO  nadie vivo lo llama Y tiene marca de una vez / superado / cliente
 *              muerto / patrón de activación vieja (add-*-module-*, fix-*,
 *              clear-*, setup-*-local).
 *   DUDA       nadie vivo lo llama, pero tampoco tiene marca: hay que leerlo.
 *
 * Un alias en package.json NO hace vivo a un script por sí solo (muchos son
 * restos de cuando las migraciones se lanzaban a mano), pero se lista, porque
 * si el script se mueve hay que quitar el alias.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(RAIZ, "scripts");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const SOLO = argv.includes("--solo") ? argv[argv.indexOf("--solo") + 1] : null;

/** Clientes que se dieron de baja y se purgaron (12/08/2026), más sandbox (no existe). */
const TENANTS_MUERTOS = ["abarcaia", "quality_energy", "healim", "sandbox"];

/**
 * Lo que puede nombrar un script. Unas fuentes hacen VIVO al script (lo
 * ejecutan o dicen que se ejecute): los temporizadores del VPS versionados en
 * `scripts/deploy/*.service` (foto de `/etc/systemd/system`, traída el
 * 19/08/2026 —si se instala un timer nuevo, su unidad se versiona aquí o el
 * inventario no lo ve—), el Dockerfile, deploy.sh, las skills y el manual del
 * Registro. Otras solo lo CITAN (CLAUDE.md, los Mapas de docs/modules): se
 * listan para saber qué texto retocar si el script se mueve, pero no lo hacen
 * vivo, porque también cuentan historia.
 */
const FUENTES_VIVAS = {
  "timer VPS": listar(path.join(RAIZ, "scripts", "deploy"), /\.service$/),
  Dockerfile: ["Dockerfile"],
  "deploy.sh": ["deploy.sh"],
  "CLAUDE.md": ["CLAUDE.md"],
  skills: listar(path.join(RAIZ, ".claude", "skills"), /\.md$/),
  "docs/modules (Mapa)": listar(path.join(RAIZ, "docs", "modules"), /\.md$/),
  "docs/como-apuntar": ["docs/como-apuntar-en-el-tablero.md"],
};

function listar(dir, re) {
  if (!existsSync(dir)) return [];
  const salida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...listar(p, re));
    else if (re.test(e.name)) salida.push(path.relative(RAIZ, p).replace(/\\/g, "/"));
  }
  return salida;
}

function leer(rel) {
  try {
    return readFileSync(path.join(RAIZ, rel), "utf8");
  } catch {
    return "";
  }
}

/** Solo el bloque «Mapa» de un doc de módulo (las 40 primeras líneas tras «## Mapa»). */
function soloMapa(texto) {
  const i = texto.indexOf("## Mapa");
  if (i < 0) return "";
  return texto.slice(i).split(/\r?\n/).slice(0, 45).join("\n");
}

/* ── El mapa de migraciones ──────────────────────────────────────────────── */

const { MODULES, CORE, ONE_OFF, MODULE_SEEDS } = await import("./_module-migrations.js");
const enModules = new Map();
for (const [mod, lista] of Object.entries(MODULES))
  for (const m of lista) {
    if (!enModules.has(m)) enModules.set(m, []);
    enModules.get(m).push(mod);
  }
const enCore = new Set(CORE);
const enSeeds = new Set(
  Object.values(MODULE_SEEDS)
    .flat()
    .map((s) => s.script.replace(/\.js$/, ""))
);

/* ── Ficheros ────────────────────────────────────────────────────────────── */

const ficheros = readdirSync(SCRIPTS)
  .filter((n) => statSync(path.join(SCRIPTS, n)).isFile())
  .filter((n) => /\.(js|mjs|cjs|sh|sql)$/.test(n))
  .sort();

const pkg = JSON.parse(leer("package.json"));
const aliasDe = (nombre) =>
  Object.entries(pkg.scripts ?? {})
    .filter(([, v]) => v.includes(`scripts/${nombre}`))
    .map(([k]) => k);

/** Todos los ficheros de código que pueden importar o nombrar un script. */
const codigo = [
  ...listar(path.join(RAIZ, "lib"), /\.(js|mjs)$/),
  ...listar(path.join(RAIZ, "app"), /\.(js|jsx|mjs)$/),
  ...listar(path.join(RAIZ, "components"), /\.(js|jsx)$/),
  ...listar(path.join(RAIZ, "modules"), /\.(js|jsx)$/),
  ...ficheros.map((n) => `scripts/${n}`),
];
const textos = new Map(codigo.map((rel) => [rel, leer(rel)]));
const textosVivos = Object.fromEntries(
  Object.entries(FUENTES_VIVAS).map(([k, lista]) => [
    k,
    lista.map((rel) => [rel, k.startsWith("docs/modules") ? soloMapa(leer(rel)) : leer(rel)]),
  ])
);

const MARCAS = [
  [/ONE[_-]OFF|one-off|one-shot/i, "one-off"],
  [/SUPERAD[AO]/i, "superada"],
  // «se corre una vez» habla del script; «imprime una sola vez» no. Por eso el
  // verbo de ejecutar va delante y «una sola vez» a secas no cuenta.
  [
    /se (corre|lanza|ejecuta|aplica) (a mano )?(solo )?una (sola )?vez|(ejecutar|correr|lanzar) (solo )?una (sola )?vez|one-shot/i,
    "una vez",
  ],
  [/hist[óo]rico|se conserva como/i, "histórico"],
  [/ya (est[áa] )?aplicad[ao]|ya ejecutad[ao]|ya se (corri[óo]|aplic[óo])/i, "ya aplicada"],
  // «NO usar --env-file» es una instrucción de uso, no una marca de obsoleto.
  [/DEPRECATED|obsolet[oa]|ya no se usa|superseded/i, "obsoleto"],
];

function nombreBase(n) {
  return n.replace(/\.(js|mjs|cjs|sh|sql)$/, "");
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Dos formas de nombrar un script, y no valen lo mismo:
 *   · IMPORTARLO o EJECUTARLO: el fichero con extensión entre comillas en código
 *     (`from "./x.js"`, `import("…/x.js")`, `"scripts/x.js"` en un comando). Eso
 *     es una dependencia real.
 *   · MENCIONARLO en prosa: el nombre suelto en un comentario, un doc o un alias.
 *     Eso es historia o documentación; no hace vivo a nadie, pero si el script
 *     se mueve hay que retocar el texto.
 * El nombre base va seguido de algo que no sea letra ni guión, para no casar
 * `migrate-team` dentro de `migrate-team-fields`.
 */
function quienLoNombra(nombre) {
  const base = escapar(nombreBase(nombre));
  const reImport = new RegExp(
    `["'\`](\\./|\\.\\./|scripts/|/app/scripts/)?${base}\\.(js|mjs|cjs|sh|sql)["'\`]`,
    "i"
  );
  const reProsa = new RegExp(`(^|[^a-z0-9_-])${base}(\\.(js|mjs|cjs|sh|sql)|[^a-z0-9_-]|$)`, "i");
  const importadoPor = [];
  const citadoEnCodigo = [];
  for (const [rel, texto] of textos) {
    if (rel === `scripts/${nombre}`) continue;
    if (reImport.test(texto)) importadoPor.push(rel);
    else if (reProsa.test(texto)) citadoEnCodigo.push(rel);
  }
  const nombradoEn = [];
  for (const [fuente, lista] of Object.entries(textosVivos)) {
    for (const [rel, texto] of lista) if (reProsa.test(texto)) nombradoEn.push(`${fuente}: ${rel}`);
  }
  return { importadoPor, citadoEnCodigo, nombradoEn };
}

const filas = ficheros.map((nombre) => {
  const base = nombreBase(nombre);
  const texto = textos.get(`scripts/${nombre}`) ?? "";
  const cabecera = texto.split(/\r?\n/).slice(0, 40).join("\n");
  const marcas = MARCAS.filter(([re]) => re.test(cabecera)).map(([, m]) => m);
  const muertos = TENANTS_MUERTOS.filter((s) =>
    new RegExp(`(^|[^a-z0-9_])${s}([^a-z0-9_]|$)`, "i").test(texto)
  );
  const { importadoPor, citadoEnCodigo, nombradoEn } = quienLoNombra(nombre);
  const modulos = enModules.get(base) ?? [];
  const esCore = enCore.has(base);
  const esSeed = enSeeds.has(base);
  const oneOff = ONE_OFF[base] ?? null;
  const alias = aliasDe(nombre);
  // Lo que lanza `pruebas.mjs`: `_smoke-*` y `smoke-test-*.mjs` (las pesadas de
  // `npm run test:todo`). Las `smoke-*.mjs` a secas NO: son smokes manuales.
  const esPrueba = /^_smoke-|^smoke-test-.*\.mjs$|^pruebas\.mjs$/.test(nombre);
  const esHelper = /^_/.test(nombre) && !esPrueba;
  // El fichero se declara vivo en su cabecera («// @vivo — motivo (leído el
  // DD/MM/AAAA)»): es el resultado de haberlo leído cuando nadie lo nombraba.
  // Vive con el fichero, no en un índice; si el motivo deja de ser verdad, se
  // quita la marca y vuelve a salir como duda.
  const declaradoVivo =
    (texto
      .split(/\r?\n/)
      .slice(0, 3)
      .join("\n")
      .match(/@vivo\s*[—-]\s*(.*)$/m) || [])[1] ?? null;

  // Importado por lib/app/components/modules = vivo seguro. Importado por otro
  // script: vivo si ese otro es vivo (se resuelve en una segunda pasada abajo).
  const importadoPorApp = importadoPor.filter((r) => !r.startsWith("scripts/"));
  const importadoPorScripts = importadoPor.filter((r) => r.startsWith("scripts/"));

  return {
    nombre,
    base,
    modulos,
    esCore,
    esSeed,
    oneOff,
    alias,
    importadoPorApp,
    importadoPorScripts,
    citadoEnCodigo,
    nombradoEn,
    marcas,
    muertos,
    esPrueba,
    esHelper,
    declaradoVivo,
    lineas: texto.split(/\r?\n/).length,
  };
});

/* ── Veredicto, en dos pasadas (los scripts que importa otro script vivo son vivos) ── */

const porNombre = new Map(filas.map((f) => [f.nombre, f]));
function vivoDirecto(f) {
  if (f.esPrueba || f.esHelper) return "prueba/helper";
  if (f.declaradoVivo) return `@vivo: ${f.declaradoVivo.replace(/\s*\(leído.*$/, "")}`;
  if (f.modulos.length || f.esCore) return "mapa de migraciones (alta/enable-module)";
  if (f.esSeed) return "MODULE_SEEDS (enable-module)";
  if (f.importadoPorApp.length) return `lo importa ${f.importadoPorApp[0]}`;
  // Skills, Dockerfile, deploy.sh y el manual del Registro nombran lo que se
  // ejecuta. CLAUDE.md y los Mapas tambien cuentan historia: se listan, no hacen vivo.
  const viva = f.nombradoEn.find((n) =>
    /^(timer VPS|skills|Dockerfile|deploy\.sh|docs\/como-apuntar)/.test(n)
  );
  if (viva) return viva;
  if (f.oneOff && /MASTER|MANTENIMIENTO|repetible|dry-run|temporizador/i.test(f.oneOff)) {
    return "ONE_OFF de master/mantenimiento: hace falta en un entorno nuevo o se repite";
  }
  return null;
}
for (const f of filas) f.vivoPor = vivoDirecto(f);
// Segunda pasada: importado por un script vivo → vivo (hasta fijo).
let cambio = true;
while (cambio) {
  cambio = false;
  for (const f of filas) {
    if (f.vivoPor) continue;
    const padre = f.importadoPorScripts
      .map((r) => porNombre.get(path.basename(r)))
      .find((p) => p?.vivoPor);
    if (padre) {
      f.vivoPor = `lo importa ${padre.nombre} (vivo)`;
      cambio = true;
    }
  }
}

const PATRON_VIEJO =
  /^(add-[a-z0-9-]+-module-|add-[a-z0-9-]+-c\d-|fix-|clear-|setup-.*-local|update-.*-brand|enable-.*-all-tenants)/;
for (const f of filas) {
  if (f.vivoPor) f.veredicto = "VIVO";
  else if (
    f.marcas.length ||
    f.muertos.length ||
    PATRON_VIEJO.test(f.nombre) ||
    (f.oneOff && !/MASTER/.test(f.oneOff))
  )
    f.veredicto = "CANDIDATO";
  else f.veredicto = "DUDA";
  f.motivo =
    f.veredicto === "VIVO"
      ? f.vivoPor
      : [
          f.marcas.length && `marca: ${f.marcas.join(", ")}`,
          f.muertos.length && `cliente muerto: ${f.muertos.join(", ")}`,
          f.oneOff && `ONE_OFF: ${f.oneOff.slice(0, 60)}…`,
          PATRON_VIEJO.test(f.nombre) && "patrón de activación/parche viejo",
          f.importadoPorScripts.length &&
            `lo importa ${f.importadoPorScripts.map((r) => path.basename(r)).join(", ")} (no vivo)`,
          f.nombradoEn.length && `prosa: ${f.nombradoEn.map((n) => n.split(": ")[1]).join(", ")}`,
          f.citadoEnCodigo.length && `comentado en ${f.citadoEnCodigo.length} fichero(s)`,
        ]
          .filter(Boolean)
          .join(" · ") || "nadie lo nombra y no lleva marca: leerlo";
}

/* ── Salida ──────────────────────────────────────────────────────────────── */

if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify(filas, null, 2)}\n`);
  process.exit(0);
}

const grupos = { VIVO: [], CANDIDATO: [], DUDA: [] };
for (const f of filas) grupos[f.veredicto].push(f);
const quiere = (v) => !SOLO || SOLO.toUpperCase().startsWith(v.slice(0, 4));

for (const v of ["CANDIDATO", "DUDA", "VIVO"]) {
  if (!quiere(v)) continue;
  process.stdout.write(`\n▶ ${v} (${grupos[v].length})\n`);
  for (const f of grupos[v]) {
    const alias = f.alias.length ? `  [npm: ${f.alias.join(", ")}]` : "";
    process.stdout.write(`  ${f.nombre.padEnd(52)} ${f.motivo}${alias}\n`);
  }
}
process.stdout.write(
  `\n${filas.length} ficheros · ${grupos.VIVO.length} vivos · ${grupos.CANDIDATO.length} candidatos · ${grupos.DUDA.length} dudas\n`
);
