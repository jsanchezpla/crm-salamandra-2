/**
 * sql.mjs — una consulta de SOLO LECTURA contra un cliente, sin comillas anidadas.
 *
 * POR QUÉ EXISTE (17/08/2026). Cada vez que hacía falta un dato de producción se
 * escribía a mano un `node -e` de veinte líneas metido dentro de un `docker exec`
 * metido dentro de un `ssh`: tres niveles de comillas, y el `import()` dinámico
 * repetido entero cada vez. En la mañana del 17/08 se escribieron cinco así y
 * DOS se rompieron sin llegar a tocar la base de datos — una por nombres de
 * columna inventados y otra porque el shell del VPS se comió un `$` (los `$1` de
 * los bind de Postgres se expanden como variables del shell). Cada rotura son
 * dos turnos perdidos mirando un error que no habla de los datos.
 *
 * Aquí el SQL viaja como UN argumento entre comillas simples y nada más.
 *
 * ── QUE SEA DE LECTURA NO ES UNA PROMESA, ES POSTGRES ───────────────────────
 * La consulta corre dentro de una transacción marcada `READ ONLY` y que SIEMPRE
 * termina en ROLLBACK. Un INSERT/UPDATE/DELETE/ALTER no es que esté "prohibido
 * por convención": el motor lo rechaza con
 * `cannot execute ... in a read-only transaction`.
 *
 * Deliberadamente NO hay un filtro de palabras prohibidas encima. Un `\bdelete\b`
 * bloquearía `WHERE action = 'cliente.delete'` y dejaría pasar cosas que no
 * previó quien escribió el regex: dos formas de equivocarse a cambio de nada,
 * cuando debajo ya hay un guardia de verdad. Tampoco hay una opción para
 * saltárselo, porque para escribir en producción están las migraciones.
 *
 * Lleva además `statement_timeout`: una consulta torpe no puede quedarse
 * apretando la base de datos de la que dependen los clientes.
 *
 * ⚠️ ESTO PUEDE IMPRIMIR DATOS PERSONALES Y DE SALUD. Es una herramienta de
 * diagnóstico, no un visor: pide recuentos, fechas y nombres de columna. El
 * contenido de una ficha, una sesión clínica o un correo NO se saca por pantalla
 * ni se pega en un chat.
 *
 * Uso local:      node --env-file=.env.local scripts/sql.mjs aumenta 'SELECT count(*) FROM clients'
 * Uso producción: docker exec crm-salamandra-app-1 node scripts/sql.mjs aumenta 'SELECT count(*) FROM clients'
 *   (dentro del contenedor las envs ya vienen por env_file; NO usar --env-file)
 *
 * El primer argumento es el CLIENTE, no el schema: se escribe `aumenta` y el
 * `search_path` queda en `crm_aumenta`, así que las tablas van sin prefijo.
 * Para el schema global, `master`.
 *
 * Opciones:
 *   --limite=N   filas que se PINTAN (por defecto 50). El total siempre se dice.
 *   --json       salida JSON en crudo, para encadenar con otra cosa.
 *   --ancho=N    ancho máximo de celda antes de recortar (por defecto 48).
 */

import { QueryTypes } from "sequelize";
import { getMasterDb } from "../lib/db/masterDb.js";

const SLUG_RE = /^[a-z0-9_]+$/;
const TIMEOUT_S = 20;

function out(msg = "") {
  process.stdout.write(`${msg}\n`);
}

function morir(msg) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** Parte argv en opciones (`--k=v`) y argumentos libres, respetando el orden. */
function parsearArgs(argv) {
  const opciones = {};
  const libres = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [clave, valor] = a.slice(2).split("=");
      opciones[clave] = valor === undefined ? true : valor;
    } else {
      libres.push(a);
    }
  }
  return { opciones, libres };
}

function celda(v) {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function recortar(txt, ancho) {
  return txt.length <= ancho ? txt : `${txt.slice(0, ancho - 1)}…`;
}

/**
 * Hay columnas que llegan como ARRAY en vez de como objeto: pasa con los tipos
 * del dominio `sql_identifier` (`table_name`, `column_name` de
 * `information_schema`), para los que el driver de Postgres no trae parser. Sin
 * esto la tabla saldría con las columnas llamadas «0», «1»…
 *
 * Se pintan con nombres posicionales y se avisa de cuál es el arreglo, porque
 * el arreglo de verdad está en la consulta: `SELECT table_name::text AS tabla`.
 */
function normalizarFilas(filas) {
  if (!filas.length || !Array.isArray(filas[0])) return { filas, posicional: false };
  return {
    filas: filas.map((f) => Object.fromEntries(f.map((v, i) => [`col${i + 1}`, v]))),
    posicional: true,
  };
}

function pintarTabla(filas, ancho) {
  const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  const anchos = columnas.map((c) =>
    Math.min(ancho, Math.max(c.length, ...filas.map((f) => celda(f[c]).length)))
  );

  const linea = (celdas) =>
    celdas.map((t, i) => recortar(t, anchos[i]).padEnd(anchos[i])).join("  ");

  out(linea(columnas));
  out(anchos.map((a) => "─".repeat(a)).join("  "));
  for (const f of filas) out(linea(columnas.map((c) => celda(f[c]))));
}

async function main() {
  const { opciones, libres } = parsearArgs(process.argv.slice(2));
  const [destino, ...resto] = libres;
  const sql = resto.join(" ").trim();

  if (!destino || !sql) {
    morir(
      "Faltan argumentos.\n" +
        "  node scripts/sql.mjs <cliente|master> '<SQL>' [--limite=N] [--json]\n" +
        "  node scripts/sql.mjs aumenta 'SELECT count(*) FROM clients'"
    );
  }
  if (!SLUG_RE.test(destino)) {
    morir(`Cliente '${destino}' inválido: solo se aceptan [a-z0-9_].`);
  }

  const limite = Number(opciones.limite ?? 50);
  const ancho = Number(opciones.ancho ?? 48);
  const json = opciones.json === true;

  const s = getMasterDb();
  // Sin esto, cada consulta imprime su «Executing (default): …» por delante del
  // resultado. Aquí la salida ES el producto: se lee en una terminal y se pega
  // en un chat, y el eco del SQL la entierra.
  s.options.logging = false;

  // Que el cliente EXISTA se comprueba antes de nada: un slug mal escrito daría
  // un search_path a un schema fantasma y la consulta fallaría con
  // «relation does not exist», que hace pensar en la tabla y no en el slug.
  let schema = "master";
  if (destino !== "master") {
    const tenants = await s.query("SELECT slug FROM master.tenants WHERE slug = :slug", {
      replacements: { slug: destino },
      type: QueryTypes.SELECT,
    });
    if (!tenants.length) {
      const todos = await s.query("SELECT slug FROM master.tenants ORDER BY slug", {
        type: QueryTypes.SELECT,
      });
      morir(
        `Cliente '${destino}' no existe en master.tenants.\n` +
          `  Los que hay: ${todos.map((t) => t.slug).join(", ")}`
      );
    }
    schema = `crm_${destino}`;
  }

  const t = await s.transaction();
  let filas;
  try {
    // Este orden importa: SET TRANSACTION tiene que ir antes de cualquier
    // sentencia de la transacción o Postgres lo rechaza.
    await s.query("SET TRANSACTION READ ONLY", { transaction: t });
    await s.query(`SET LOCAL statement_timeout = '${TIMEOUT_S}s'`, { transaction: t });
    await s.query(`SET LOCAL search_path TO "${schema}", public`, { transaction: t });
    // `type: SELECT` a propósito: sin él, Sequelize devuelve unas veces las filas
    // y otras la tupla [filas, metadata] según la consulta, y quien lo llama no
    // puede saber cuál le va a tocar. Con el tipo puesto siempre son las filas.
    filas = await s.query(sql, { transaction: t, type: QueryTypes.SELECT });
  } catch (err) {
    await t.rollback().catch(() => {});
    await s.close().catch(() => {});
    morir(`${err.message}\n\n  schema: ${schema}\n  sql   : ${sql}`);
  }
  // Siempre ROLLBACK, incluso cuando todo va bien: no hay nada que confirmar.
  await t.rollback();

  if (!Array.isArray(filas)) filas = filas === undefined ? [] : [filas];

  if (json) {
    out(JSON.stringify(filas, null, 2));
    await s.close();
    process.exit(0);
  }

  out("");
  out(`  ${schema}  ·  ${filas.length} fila(s)`);
  out("");

  if (filas.length === 0) {
    out("  (sin resultados)");
  } else {
    const { filas: pintables, posicional } = normalizarFilas(filas);
    if (posicional) {
      out("  ⚠️ Las columnas llegan sin nombre (tipo sql_identifier).");
      out("     Castea y renombra en la consulta: SELECT table_name::text AS tabla");
      out("");
    }
    pintarTabla(pintables.slice(0, limite), ancho);
    if (filas.length > limite) {
      out("");
      out(`  … ${filas.length - limite} fila(s) más. --limite=${filas.length} para verlas todas.`);
    }
  }
  out("");

  await s.close();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try {
    await getMasterDb().close();
  } catch {}
  process.exit(1);
});
