/**
 * pruebas.mjs — lanza de una vez las pruebas del repositorio (18/08/2026).
 *
 *   npm test                  → las que no necesitan NADA encendido
 *   npm run test:todo         → todas, incluidas las que piden base de datos y servidor
 *
 *   node scripts/pruebas.mjs [--todo] [--listar] [--limite=90]
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Había 63 ficheros de prueba en `scripts/` y ninguna forma de lanzarlos
 * juntos: `package.json` tenía atajo para DOS. El resto solo se ejecutaba si
 * alguien se acordaba del nombre exacto del que le tocaba.
 *
 * Lo que eso cuesta se vio el 17/08/2026: al mover una constante de sitio se
 * rompió `_smoke-leads-etapas.mjs`, y la prueba se quedó comparando contra
 * nada —seguía saliendo verde—. Se descubrió de casualidad, porque el trabajo
 * de esa tarde tocaba justo ese módulo. Con las otras 62 no habría habido
 * casualidad que valiera.
 *
 * ── LO QUE ESTE FICHERO NUNCA HACE: SALTARSE ALGO EN SILENCIO ───────────────
 *
 * Una prueba que no se lanza es peor que una prueba que falla: las dos dejan la
 * pantalla en verde, pero solo una lo avisa. Por eso el resumen SIEMPRE dice
 * cuántas quedaron fuera y por qué, aunque nadie lo haya pedido. Si un fichero
 * acaba en el grupo equivocado, se ve en esa línea y no dentro de seis meses.
 *
 * ── CÓMO DECIDE QUÉ ES LIGERA Y QUÉ ES PESADA ───────────────────────────────
 *
 * Leyendo el fichero, no por una lista escrita a mano aquí: una lista se queda
 * vieja el día que alguien añade la prueba 64 y no se acuerda de apuntarla, y
 * entonces la prueba nueva deja de correr sin que nada chille. Es el mismo
 * fallo que la tabla de módulos de CLAUDE.md, que mentía en 5 de 8 clientes.
 *
 *   pesada = hace fetch()   → necesita el servidor levantado
 *   pesada = toca Sequelize → necesita la base de datos local
 *   ligera = ninguna de las dos cosas
 *
 * Leer texto se equivoca a veces (la palabra puede estar en un comentario). Por
 * eso hay corrección a mano: basta con poner en las primeras líneas del fichero
 * de prueba una de estas dos marcas, y manda sobre lo que se deduzca del texto.
 *
 *     // @prueba ligera
 *     // @prueba pesada
 *
 * Y alguna prueba necesita arrancar Node de una forma concreta —hoy solo
 * `_smoke-retencion-viva-o-muerta.mjs`, que falsea la librería de Stripe con un
 * cargador—. Eso lo declara ella misma, para que la forma de lanzarla viva
 * junto a la prueba y no en una lista aquí:
 *
 *     // @prueba-lanzar --import ./scripts/_fake-stripe-loader.mjs
 *
 * ── QUÉ CUENTA COMO PRUEBA ──────────────────────────────────────────────────
 *
 * `scripts/_smoke-*.mjs`, `scripts/_smoke-*.js` y `scripts/smoke-test-*.mjs`.
 * Todas terminan igual —`process.exit(0)` si va bien, `1` si algo falla—, que
 * es lo único que este runner necesita saber de ellas.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ENTORNO = join(RAIZ, ".env.local");

const args = process.argv.slice(2);
const TODAS = args.includes("--todo");
const LISTAR = args.includes("--listar");
const LIMITE_S = Number(args.find((a) => a.startsWith("--limite="))?.split("=")[1] ?? 90);

// ── Descubrir ───────────────────────────────────────────────────────────────

function esPrueba(nombre) {
  if (!nombre.endsWith(".mjs") && !nombre.endsWith(".js")) return false;
  return nombre.startsWith("_smoke-") || nombre.startsWith("smoke-test-");
}

function nombreCorto(fichero) {
  return fichero
    .replace(/^_smoke-/, "")
    .replace(/^smoke-test-/, "")
    .replace(/\.m?js$/, "");
}

const NECESITA_SERVIDOR = /\bfetch\s*\(/;
const NECESITA_BASE = /\b(masterDb|tenantDb|getTenantContext|sequelize|Sequelize)\b/;

function clasificar(ruta) {
  const texto = readFileSync(ruta, "utf8");
  const cabecera = texto.slice(0, 3000);

  const lanzar = cabecera.match(/@prueba-lanzar\s+([^\n]+)/);
  const extras = lanzar ? lanzar[1].trim().split(/\s+/) : [];

  const marca = cabecera.match(/@prueba\s+(ligera|pesada)/);
  if (marca) return { pesada: marca[1] === "pesada", motivo: "marcada a mano", extras };

  const servidor = NECESITA_SERVIDOR.test(texto);
  const base = NECESITA_BASE.test(texto);
  if (servidor && base) return { pesada: true, motivo: "servidor y base de datos", extras };
  if (servidor) return { pesada: true, motivo: "servidor", extras };
  if (base) return { pesada: true, motivo: "base de datos", extras };
  return { pesada: false, motivo: "", extras };
}

const todas = readdirSync(join(RAIZ, "scripts"))
  .filter(esPrueba)
  .sort()
  .map((fichero) => {
    const ruta = join(RAIZ, "scripts", fichero);
    return { fichero, ruta, nombre: nombreCorto(fichero), ...clasificar(ruta) };
  });

const ligeras = todas.filter((p) => !p.pesada);
const pesadas = todas.filter((p) => p.pesada);
const aLanzar = TODAS ? todas : ligeras;

// ── Lanzar ──────────────────────────────────────────────────────────────────

function lanzar(prueba) {
  return new Promise((resolve) => {
    // Las pesadas necesitan las credenciales de la base local; las ligeras no
    // tocan nada, así que se lanzan SIN entorno a propósito: si alguna empieza
    // a necesitarlo, es que ha dejado de ser ligera y conviene que se vea.
    // Los `--import` y demás banderas van DELANTE del fichero: Node deja de
    // leer opciones en cuanto encuentra el script.
    const conEntorno = prueba.pesada && existsSync(ENTORNO);
    const argv = [...prueba.extras];
    if (conEntorno) argv.push(`--env-file=${ENTORNO}`);
    argv.push(prueba.ruta);

    const desde = Date.now();
    const hijo = spawn(process.execPath, argv, { cwd: RAIZ });

    let salida = "";
    let cortada = false;
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (salida += d));

    const reloj = setTimeout(() => {
      cortada = true;
      hijo.kill("SIGKILL");
    }, LIMITE_S * 1000);

    hijo.on("close", (codigo) => {
      clearTimeout(reloj);
      resolve({
        ...prueba,
        bien: !cortada && codigo === 0,
        cortada,
        segundos: (Date.now() - desde) / 1000,
        salida: salida.trim(),
      });
    });
  });
}

// ── Pintar ──────────────────────────────────────────────────────────────────

const raya = "─".repeat(64);
const ancho = Math.max(...aLanzar.map((p) => p.nombre.length), 10) + 2;

console.log("");
console.log(TODAS ? "Todas las pruebas" : "Pruebas que no necesitan nada encendido");
console.log(raya);

if (TODAS && !existsSync(ENTORNO)) {
  console.log("⚠  No hay .env.local: las pesadas van a fallar por falta de credenciales.\n");
}

const resultados = [];
for (const prueba of aLanzar) {
  const r = await lanzar(prueba);
  resultados.push(r);
  const marca = r.bien ? "✓" : r.cortada ? "⏱" : "✗";
  console.log(`  ${marca} ${r.nombre.padEnd(ancho)}${r.segundos.toFixed(1)}s`);
}

const malas = resultados.filter((r) => !r.bien);
const total = resultados.reduce((s, r) => s + r.segundos, 0);

console.log(raya);
console.log(
  `${malas.length === 0 ? "✓" : "✗"} ${resultados.length - malas.length} bien · ` +
    `${malas.length} mal · ${total.toFixed(1)}s`
);

// Lo que se ha quedado fuera se dice SIEMPRE, aunque no lo pidan: es la única
// forma de que una prueba mal clasificada no desaparezca sin ruido.
if (!TODAS && pesadas.length) {
  const porMotivo = {};
  for (const p of pesadas) porMotivo[p.motivo] = (porMotivo[p.motivo] || 0) + 1;
  const detalle = Object.entries(porMotivo)
    .map(([m, n]) => `${n} piden ${m}`)
    .join(", ");
  console.log("");
  console.log(`No se han lanzado ${pesadas.length}: ${detalle}.`);
  console.log("Para lanzarlas también, con la base de datos y `npm run dev` en marcha:");
  console.log("   npm run test:todo");
  if (LISTAR) for (const p of pesadas) console.log(`     · ${p.nombre} (${p.motivo})`);
  else console.log("   (con --listar salen sus nombres)");
}

// La salida completa de lo que falla, al final y entera: si hay que buscarla en
// otro sitio, no se mira.
for (const r of malas) {
  console.log("");
  console.log(`── ${r.nombre} ${"─".repeat(Math.max(0, 60 - r.nombre.length))}`);
  console.log(`   scripts/${r.fichero}`);
  if (r.cortada) console.log(`   ⏱ cortada a los ${LIMITE_S}s sin terminar.`);
  console.log("");
  console.log(r.salida || "   (no ha dicho nada)");
}

console.log("");
process.exit(malas.length === 0 ? 0 : 1);
