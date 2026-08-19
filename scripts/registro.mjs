/**
 * registro.mjs — el Registro desde local: bajar el texto publicado, editarlo, y
 * subirlo. Sin commit, sin build, sin despliegue.
 *
 * ── CÓMO SE USA ───────────────────────────────────────────────────────────
 *   node scripts/registro.mjs bajar                      → docs/registro/backlog.md y resuelto.md, desde producción
 *   node scripts/registro.mjs bajar resuelto             → solo uno
 *   (editar docs/registro/backlog.md con el editor que sea)
 *   node scripts/registro.mjs subir backlog --nota "apuntar el buscador de aumenta"
 *                                                        → ensayo: comprueba y enseña qué entra y qué sale
 *   node scripts/registro.mjs subir backlog --nota "…" --confirm
 *                                                        → publica la versión siguiente
 *   node scripts/registro.mjs estado                     → qué versión hay publicada de cada uno
 *   node scripts/registro.mjs historial backlog          → las últimas 20 versiones, con quién y por qué
 *   node scripts/registro.mjs restaurar backlog 12 --confirm
 *                                                        → la v12 vuelve a ser la actual (como versión nueva)
 *
 *   --local     contra la base de local (node --env-file=.env.local), no contra producción
 *   --forzar    levanta los dos frenos que no son de formato (base vieja, encogimiento)
 *
 * `docs/registro/` está en .gitignore: es una copia de trabajo, no la fuente.
 * La fuente es `master.tablero_documentos` en producción.
 *
 * ── POR QUÉ UN ENVOLTORIO Y NO DOS LÍNEAS DE SSH EN LA SKILL ──────────────
 * Porque desde PowerShell `ssh … < fichero` no existe (el `<` está reservado) y
 * `Get-Content fichero | ssh …` recodifica el texto con la página de códigos de
 * la consola y convierte las tildes en interrogaciones. Node pasa los bytes tal
 * cual por `spawnSync({ input })`, en las dos direcciones. Lo que hace por
 * dentro es exactamente:
 *
 *   ssh crm-vps 'docker exec -i crm-salamandra-app-1 node scripts/tablero-doc.js publicar backlog …' < docs/registro/backlog.md
 *
 * y en el VPS vale igual escribirlo a mano.
 *
 * ── LA BASE: EL CERROJO ENTRE DOS PERSONAS ────────────────────────────────
 * `bajar` apunta en `docs/registro/.versiones.json` qué versión bajó. `subir` se
 * la pasa al contenedor (`--base N`) y, si en producción ya hay otra (el socio
 * publicó en medio), NO se publica: se dice, se vuelve a bajar y se aplica el
 * cambio encima. Es lo que antes era «si `docs/backlog.md` aparece en el diff
 * con origin/master, PARA Y PREGUNTA».
 *
 * Variables: REGISTRO_SSH (alias ssh, por defecto `crm-vps`),
 * REGISTRO_CONTENEDOR (por defecto `crm-salamandra-app-1`).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOCUMENTOS, comprobar } from "../lib/tablero/parser.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "docs", "registro");
const VERSIONES = path.join(CARPETA, ".versiones.json");
const SSH = process.env.REGISTRO_SSH || "crm-vps";
const CONTENEDOR = process.env.REGISTRO_CONTENEDOR || "crm-salamandra-app-1";

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

/* ── Argumentos ──────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const local = argv.includes("--local");
const sueltos = [];
const opciones = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--local") continue;
  if (a.startsWith("--")) {
    const clave = a.slice(2);
    const siguiente = argv[i + 1];
    if (
      ["confirm", "forzar"].includes(clave) ||
      siguiente === undefined ||
      siguiente.startsWith("--")
    ) {
      opciones[clave] = true;
    } else {
      opciones[clave] = siguiente;
      i++;
    }
  } else {
    sueltos.push(a);
  }
}
const [orden, nombre, tercero] = sueltos;

/* ── Ejecutar tablero-doc.js donde está la base ──────────────────────────── */

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Lanza `tablero-doc.js <args>` contra producción (ssh + docker exec -i) o
 * contra local, pasando `input` por stdin como bytes y devolviendo stdout y
 * stderr como bytes. Nada de texto por el camino: así las tildes llegan.
 */
function ejecutar(args, { input = "" } = {}) {
  const inputBuf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const r = local
    ? spawnSync(process.execPath, ["--env-file=.env.local", "scripts/tablero-doc.js", ...args], {
        cwd: RAIZ,
        input: inputBuf,
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync(
        "ssh",
        [
          SSH,
          `docker exec -i ${CONTENEDOR} node scripts/tablero-doc.js ${args.map(shQuote).join(" ")}`,
        ],
        { input: inputBuf, maxBuffer: 64 * 1024 * 1024 }
      );
  if (r.error) {
    err(`No se ha podido lanzar ${local ? "node" : "ssh"}: ${r.error.message}`);
    process.exit(1);
  }
  return {
    codigo: r.status ?? 1,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: r.stderr ?? Buffer.alloc(0),
  };
}

/** Pasa tal cual lo que dijo el script y sale con su código. */
function volcar(r) {
  if (r.stdout.length) process.stdout.write(r.stdout);
  if (r.stderr.length) process.stderr.write(r.stderr);
  return r.codigo;
}

function leerVersiones() {
  try {
    return JSON.parse(readFileSync(VERSIONES, "utf8"));
  } catch {
    return {};
  }
}

function estadoRemoto() {
  const r = ejecutar(["estado", "--json"]);
  if (r.codigo !== 0) {
    volcar(r);
    process.exit(r.codigo);
  }
  return JSON.parse(r.stdout.toString("utf8"));
}

function apuntarVersiones(estado) {
  const v = leerVersiones();
  for (const n of DOCUMENTOS) {
    if (estado[n]) v[n] = estado[n].version;
  }
  v.bajadoEn = new Date().toISOString();
  v.desde = local ? "local" : `${SSH}/${CONTENEDOR}`;
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(VERSIONES, `${JSON.stringify(v, null, 2)}\n`);
}

function exigirDocumento(n) {
  if (!DOCUMENTOS.includes(n)) {
    err(`Di cuál: ${DOCUMENTOS.join(" o ")}.`);
    process.exit(1);
  }
}

/* ── Órdenes ─────────────────────────────────────────────────────────────── */

function bajar() {
  const cuales = nombre ? [nombre] : DOCUMENTOS;
  cuales.forEach(exigirDocumento);
  mkdirSync(CARPETA, { recursive: true });
  const estado = estadoRemoto();
  let alguno = false;
  for (const n of cuales) {
    if (!estado[n]) {
      out(
        `${n}: sin versión publicada en ${local ? "local" : "producción"}; no hay nada que bajar.`
      );
      continue;
    }
    const r = ejecutar(["leer", n]);
    if (r.codigo !== 0) {
      volcar(r);
      process.exit(r.codigo);
    }
    const destino = path.join(CARPETA, `${n}.md`);
    writeFileSync(destino, r.stdout);
    const d = estado[n];
    out(`${n}: v${d.version} (${d.tareas} tareas) → ${path.relative(RAIZ, destino)}`);
    alguno = true;
  }
  if (alguno) apuntarVersiones(estado);
}

function subir() {
  exigirDocumento(nombre);
  const ruta = path.join(CARPETA, `${nombre}.md`);
  if (!existsSync(ruta)) {
    err(
      `No existe ${path.relative(RAIZ, ruta)}. Primero: node scripts/registro.mjs bajar${local ? " --local" : ""}`
    );
    process.exit(1);
  }
  const texto = readFileSync(ruta, "utf8");

  // Lo que se puede saber sin ir a producción se dice aquí y ahora.
  const previa = comprobar(texto, nombre);
  if (previa.errores.length) {
    out(`${nombre}: no se sube, tiene ${previa.errores.length} error(es) de formato:`);
    for (const e of previa.errores) out(`  · ${e}`);
    process.exit(2);
  }

  const args = ["publicar", nombre, "--por", userInfo().username];
  const base = leerVersiones()[nombre];
  if (base !== undefined) args.push("--base", String(base));
  if (opciones.nota) args.push("--nota", String(opciones.nota));
  if (opciones.forzar) args.push("--forzar");
  if (opciones.confirm) args.push("--confirm");
  if (opciones.confirm && !opciones.nota) {
    err(
      'Con --confirm hace falta --nota "por qué esta versión": es lo que luego se lee en el historial.'
    );
    process.exit(1);
  }

  const r = ejecutar(args, { input: texto });
  const codigo = volcar(r);
  if (codigo === 0 && opciones.confirm) {
    // La versión que acabamos de publicar pasa a ser nuestra base.
    apuntarVersiones(estadoRemoto());
  }
  process.exit(codigo);
}

function reenviar(args) {
  process.exit(volcar(ejecutar(args)));
}

switch (orden) {
  case "bajar":
    bajar();
    break;
  case "subir":
    subir();
    break;
  case "estado":
    reenviar(["estado"]);
    break;
  case "historial":
    exigirDocumento(nombre);
    reenviar([
      "historial",
      nombre,
      ...(opciones.ultimas ? ["--ultimas", String(opciones.ultimas)] : []),
    ]);
    break;
  case "restaurar": {
    exigirDocumento(nombre);
    const args = ["restaurar", nombre, String(tercero ?? ""), "--por", userInfo().username];
    if (opciones.nota) args.push("--nota", String(opciones.nota));
    if (opciones.confirm) args.push("--confirm");
    const r = ejecutar(args);
    const codigo = volcar(r);
    if (codigo === 0 && opciones.confirm) apuntarVersiones(estadoRemoto());
    process.exit(codigo);
  }
  default:
    err(
      'Órdenes: bajar [doc] | subir <doc> --nota "…" [--confirm] [--forzar] | estado | historial <doc> | restaurar <doc> <version> [--confirm]   (añade --local para la base de local)'
    );
    process.exit(1);
}
