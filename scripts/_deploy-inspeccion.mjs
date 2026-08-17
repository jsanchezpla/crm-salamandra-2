/**
 * _deploy-inspeccion.mjs — qué va a entrar en el próximo despliegue, y qué de
 * eso toca DATOS de producción.
 *
 * Lo usa la skill `/deploy`. Existe para que la pregunta «¿esto cambia datos?»
 * no dependa de que a alguien se le ocurra hacérsela: se contesta leyendo el SQL
 * de lo que se sube, siempre, y con el mismo criterio.
 *
 * NO TOCA LA BASE DE DATOS ni la red. Solo lee ficheros y el historial de git.
 *
 * Uso:
 *   node scripts/_deploy-inspeccion.mjs             # lo que haya sin commitear;
 *                                                   # si no hay nada, origin/master..HEAD
 *   node scripts/_deploy-inspeccion.mjs --trabajo   # a la fuerza, lo sin commitear
 *   node scripts/_deploy-inspeccion.mjs <base> [cabeza]
 *
 * El modo por defecto mira PRIMERO el árbol de trabajo porque es cuando se
 * pregunta: antes de commitear ya hace falta saber si viene una migración y en
 * qué orden va. Inspeccionar solo commits llegaba tarde.
 *
 * Código de salida:
 *   0  nada que toque datos: la skill puede seguir sola
 *   2  hay algo que toca datos: la skill PARA y pide permiso
 *   1  no se ha podido inspeccionar (rango inválido, etc.)
 *
 * El código 2 es la pieza importante. No es un aviso que se pueda leer por
 * encima: es una puerta cerrada.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

const forzarTrabajo = process.argv[2] === "--trabajo";
const base = (!forzarTrabajo && process.argv[2]) || "origin/master";
const cabeza = (!forzarTrabajo && process.argv[3]) || "HEAD";
const rangoPedido = !forzarTrabajo && !!process.argv[2];

/** Los sin commitear: modificados, en el índice y sin seguir. */
function delArbol() {
  const tocados = git("diff", "--name-only", "HEAD").split("\n").filter(Boolean);
  const nuevos = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return [...new Set([...tocados, ...nuevos])];
}

let ficheros;
let commits;
let modo;
let argsDiff; // cómo pedirle a git el diff de una carpeta concreta, más abajo
try {
  const sinCommitear = delArbol();
  if (forzarTrabajo || (!rangoPedido && sinCommitear.length)) {
    ficheros = sinCommitear;
    commits = [];
    modo = "sin commitear (árbol de trabajo)";
    argsDiff = ["HEAD"];
  } else {
    ficheros = git("diff", "--name-only", `${base}..${cabeza}`).split("\n").filter(Boolean);
    commits = git("log", "--oneline", `${base}..${cabeza}`).split("\n").filter(Boolean);
    modo = `${base}..${cabeza}`;
    argsDiff = [`${base}..${cabeza}`];
  }
} catch (e) {
  process.stdout.write(`✗ No se ha podido leer ${forzarTrabajo ? "el árbol" : `el rango ${base}..${cabeza}`}\n  ${e.message}\n`);
  process.exit(1);
}

/**
 * Lo que convierte un script en «toca datos».
 *
 * Se busca en el SQL y en las llamadas de Sequelize, NO en el nombre del
 * fichero: hay migraciones que se llaman `migrate-` y llevan un relleno dentro
 * (`migrate-buzon` rellena `cliente_escribio_at`), y hay scripts de datos que no
 * se llaman `backfill-` (`podar-*`, `reset-*`, `clear-*`).
 *
 * DOS NIVELES, y la diferencia es lo que hace que esto sirva para algo:
 *
 *   `datos`    escribe, borra o mueve filas que ya existen. BLOQUEA.
 *   `revisar`  no cambia ninguna fila, pero puede FALLAR y dejar la migración a
 *              medias. Se cuenta y se dice, no bloquea.
 *
 * Meter las dos cosas en el mismo saco fue el primer intento y estaba mal: un
 * `CREATE UNIQUE INDEX IF NOT EXISTS` aparece en casi todas las migraciones, así
 * que bloqueaba siempre. Un freno que salta siempre se firma sin leer, y entonces
 * el día que de verdad hay un UPDATE también se firma sin leer.
 *
 * Las expresiones son GENEROSAS a propósito. Un falso positivo cuesta una
 * pregunta; un falso negativo cuesta datos de producción. La primera versión
 * pedía `UPDATE tabla SET` en la misma línea y se le escapó el relleno de
 * `migrate-buzon`, que lleva alias y parte la línea.
 *
 * `porque` se imprime tal cual: tiene que explicarle a una persona qué pasa si
 * lo deja correr.
 */
const SEÑALES = [
  { nivel: "datos", re: /\bUPDATE\b[\s\S]{0,140}?\bSET\b/i, ancla: /\bUPDATE\b/i, porque: "reescribe filas que ya existen" },
  { nivel: "datos", re: /\bINSERT\s+INTO\b/i, porque: "mete filas nuevas" },
  { nivel: "datos", re: /\bDELETE\s+FROM\b/i, porque: "borra filas" },
  { nivel: "datos", re: /\bTRUNCATE\b/i, porque: "vacía una tabla entera" },
  { nivel: "datos", re: /\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i, porque: "tira datos por la ventana" },
  { nivel: "datos", re: /\bADD\s+COLUMN\b[\s\S]{0,160}?\bNOT\s+NULL\b[\s\S]{0,80}?\bDEFAULT\b/i, ancla: /\bADD\s+COLUMN\b/i, porque: "escribe el valor por defecto en TODAS las filas que ya hay" },
  { nivel: "datos", re: /\bRENAME\s+(COLUMN|TO)\b/i, porque: "mueve datos de sitio: lo que lea el nombre viejo deja de encontrarlos" },
  { nivel: "datos", re: /\.destroy\s*\(/, porque: "borra filas (Sequelize)" },
  { nivel: "datos", re: /\.(bulkCreate|upsert|findOrCreate)\s*\(/, porque: "crea filas (Sequelize)" },
  { nivel: "datos", re: /\.update\s*\(\s*\{/, porque: "reescribe filas (Sequelize)" },
  { nivel: "datos", re: /sync\s*\(\s*\{[^}]*alter/, porque: "sync({alter}) reescribe el schema comparándolo con los modelos" },
  { nivel: "datos", re: /\bpg_dump\b|\bpg_restore\b/i, porque: "mueve una base entera" },

  { nivel: "revisar", re: /\bCREATE\s+UNIQUE\s+INDEX\b/i, porque: "no cambia filas, pero FALLA si ya hay duplicados" },
  { nivel: "revisar", re: /\bSET\s+NOT\s+NULL\b/i, porque: "no cambia filas, pero FALLA si alguna está vacía" },
  { nivel: "revisar", re: /\bADD\s+(CONSTRAINT|FOREIGN\s+KEY)\b/i, porque: "no cambia filas, pero FALLA si alguna no cumple" },
];

/**
 * Lo que cambia datos SIN que nadie ejecute ningún script: código que se
 * dispara solo —un temporizador, un botón del panel, el primer uso— y que al
 * desplegarlo empieza a escribir, borrar o congelar cosas.
 *
 * ⚠️ ESTA LISTA NO ES COMPLETA Y NO PUEDE SERLO. Son los caminos indirectos que
 * ya conocemos. Que el inspector no diga nada NO demuestra que no haya otro: eso
 * lo tiene que pensar quien despliega, leyendo el diff. La lista está para que
 * los que ya nos han mordido no vuelvan a colarse.
 */
const INDIRECTOS = [
  {
    casa: (f) => /^scripts\/podar-/.test(f),
    aviso: "es una PODA con temporizador detrás: tocarle el umbral hace que la próxima vez borre más, y nadie la lanza a mano",
  },
  {
    casa: (f) => /demo-golden-snapshot/.test(f),
    aviso: "la foto dorada CONGELA lo que haya en la demo en ese momento, incluido lo que dejara un visitante cinco minutos antes",
  },
  {
    casa: (f) => /^lib\/provisioning\/cicloVida\.js$/.test(f),
    aviso: "reactivar un cliente pone su schema al día SOLO: al reactivar se corren sus migraciones",
  },
  {
    casa: (f) => /^lib\/provisioning\/bajaTenant\.js$/.test(f),
    aviso: "la baja renombra el schema del cliente y mueve sus ficheros de sitio, desde un botón del panel",
  },
  {
    casa: (f) => /^scripts\/(enable-module|ensure-tenant-schema)\.js$/.test(f),
    aviso: "activar un módulo crea sus tablas y SIEMBRA sus datos base (p. ej. los 497 alimentos de nutrición)",
  },
  {
    casa: (f) => /^lib\/demo\//.test(f),
    aviso: "las demos se limpian solas: esto decide qué se borra y qué se vuelve a sembrar en las cuatro",
  },
];

/**
 * Este fichero se salta a sí mismo.
 *
 * No es comodidad: sus propias expresiones y sus comentarios CONTIENEN las
 * palabras que busca («UPDATE», `sync({alter})`), así que se acusaba en cada
 * despliegue que lo tocara. Un freno que salta siempre por lo mismo se acaba
 * ignorando, y entonces no frena el día que importa. Es un detector: lo único
 * que escribe es por pantalla.
 */
const YO = "scripts/_deploy-inspeccion.mjs";

const scripts = ficheros.filter(
  (f) => /^scripts\/.+\.(m?js)$/.test(f) && !/^scripts\/_smoke-/.test(f) && f !== YO
);
const modelos = ficheros.filter((f) => f.startsWith("models/"));
const hayDeploySh = ficheros.includes("deploy.sh");
const hayDeps = ficheros.some((f) => f === "package.json" || f === "package-lock.json");

function sección(t) {
  process.stdout.write(`\n▶ ${t}\n`);
}

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Qué va a entrar:  ${modo}\n`);
process.stdout.write("══════════════════════════════════════════════════════\n");

if (commits.length) {
  sección(`Commits (${commits.length})`);
  for (const c of commits) process.stdout.write(`  ${c}\n`);
} else if (ficheros.length) {
  sección("Commits (0)");
  process.stdout.write("  (todavía ninguno: esto es lo que hay sin commitear)\n");
}

sección(`Ficheros (${ficheros.length})`);
for (const f of ficheros) process.stdout.write(`  ${f}\n`);

// ── Scripts, uno a uno ──────────────────────────────────────────────────────
const tocanDatos = [];
const aRevisar = [];

sección(`Scripts que entran (${scripts.length})`);
if (!scripts.length) process.stdout.write("  (ninguno)\n");
for (const f of scripts) {
  if (!existsSync(f)) {
    process.stdout.write(`  ${f}\n       · BORRADO en este rango — nada que ejecutar\n`);
    continue;
  }
  const texto = readFileSync(f, "utf8");
  const lineas = texto.split("\n");

  const hallazgos = [];
  for (const s of SEÑALES) {
    if (!s.re.test(texto)) continue;
    const buscar = s.ancla ?? s.re;
    const i = lineas.findIndex((l) => buscar.test(l));
    hallazgos.push({
      ...s,
      linea: i >= 0 ? i + 1 : null,
      muestra: i >= 0 ? lineas[i].trim().slice(0, 90) : "(reparte en varias líneas)",
    });
  }

  // Un dry-run por defecto no quita que toque datos, pero cambia CÓMO se
  // pregunta: se puede MEDIR antes de decidir, y una pregunta con números es
  // una pregunta de verdad.
  const tieneDryRun = /--confirm|dry[- ]?run|DRY_RUN/i.test(texto);

  const datos = hallazgos.filter((h) => h.nivel === "datos");
  const revisar = hallazgos.filter((h) => h.nivel === "revisar");

  if (datos.length) {
    tocanDatos.push({ fichero: f, hallazgos: datos, tieneDryRun });
    process.stdout.write(`  ⛔ ${f}   DATOS\n`);
  } else if (revisar.length) {
    aRevisar.push({ fichero: f, hallazgos: revisar });
    process.stdout.write(`  ~  ${f}   estructura, pero puede fallar\n`);
  } else {
    process.stdout.write(`  ✓  ${f}   estructura (aditiva, idempotente)\n`);
  }

  for (const h of [...datos, ...revisar]) {
    process.stdout.write(`       ${h.linea ? `L${String(h.linea).padEnd(4)}` : "—    "} ${h.porque}\n`);
    process.stdout.write(`             ${h.muestra}\n`);
  }
  if (datos.length && tieneDryRun) {
    process.stdout.write("       · tiene marcha atrás: dry-run por defecto, escribe con --confirm.\n");
    process.stdout.write("         Lánzalo en seco PRIMERO y enseña los números.\n");
  }
}

// ── Peligros que no vienen de ejecutar nada ─────────────────────────────────
const indirectos = [];
for (const f of ficheros) {
  for (const i of INDIRECTOS) {
    if (i.casa(f)) indirectos.push({ fichero: f, aviso: i.aviso });
  }
}

sección(`Cambia datos SIN ejecutar nada (${indirectos.length})`);
if (!indirectos.length) process.stdout.write("  (nada)\n");
for (const i of indirectos) process.stdout.write(`  ⛔ ${i.fichero}\n       ${i.aviso}\n`);

// ── El orden: modelos sin migración es el 42703 clásico ─────────────────────
sección("Orden de despliegue");
if (modelos.length) {
  const nuevosCampos = git("diff", ...argsDiff, "--", "models/")
    .split("\n")
    .filter((l) => /^\+\s{2,}\w+:\s*\{/.test(l))
    .map((l) => l.replace(/^\+\s+/, "").replace(/:.*$/, ""));
  process.stdout.write(`  Modelos tocados: ${modelos.join(", ")}\n`);
  if (nuevosCampos.length) {
    process.stdout.write(`  Campos que parecen NUEVOS: ${[...new Set(nuevosCampos)].join(", ")}\n`);
    process.stdout.write("  → LA MIGRACIÓN VA ANTES DEL CÓDIGO. Sequelize hace SELECT de todos los\n");
    process.stdout.write("    atributos del modelo: con el código por delante de la columna, cada\n");
    process.stdout.write("    lectura revienta con 42703.\n");
  }
  if (!scripts.some((f) => /^scripts\/migrate-/.test(f))) {
    process.stdout.write("  ⚠ Se tocan modelos y NO entra ninguna migración. ¿Falta? Compruébalo\n");
    process.stdout.write("    contra el schema de producción antes de desplegar.\n");
  }
} else {
  process.stdout.write("  Ningún modelo tocado: el orden da igual, despliega y listo.\n");
}
if (hayDeploySh) {
  process.stdout.write("  ⚠ Cambia deploy.sh: el `git pull` lo reemplaza mientras bash lo ejecuta,\n");
  process.stdout.write("    así que la ejecución en curso usa el contenido VIEJO. Lánzalo DOS veces.\n");
}
if (hayDeps) {
  process.stdout.write("  · Cambian dependencias: deploy.sh lo detecta solo y hace npm ci (ruta larga).\n");
}

// ── Veredicto ───────────────────────────────────────────────────────────────
const bloquean = tocanDatos.length + indirectos.length;
process.stdout.write("\n══════════════════════════════════════════════════════\n");
if (bloquean) {
  process.stdout.write(" ⛔ PARA.\n");
  if (tocanDatos.length) {
    process.stdout.write(`    · ${tocanDatos.length} script(s) escriben, borran o mueven filas.\n`);
  }
  if (indirectos.length) {
    process.stdout.write(`    · ${indirectos.length} cambio(s) tocan datos SIN ejecutar nada, en cuanto se despliegan.\n`);
  }
  process.stdout.write("    Mídelo (dry-run o SELECT de solo lectura), enséñalo con números y\n");
  process.stdout.write("    ESPERA permiso. Nada de esto se ejecuta por iniciativa propia.\n");
} else {
  process.stdout.write(" ✓ Nada toca datos, de lo que este inspector sabe mirar.\n");
  process.stdout.write("   Repasa el diff igual: la lista de caminos indirectos no es completa.\n");
}
if (aRevisar.length) {
  process.stdout.write(`\n    ~ ${aRevisar.length} script(s) no cambian filas pero pueden FALLAR.\n`);
  process.stdout.write("      No frenan el despliegue; si uno falla, se para ahí y se cuenta.\n");
}
process.stdout.write("══════════════════════════════════════════════════════\n\n");

process.exit(bloquean ? 2 : 0);
