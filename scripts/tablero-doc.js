/**
 * tablero-doc.js — leer y publicar el TEXTO del Registro (backlog y resuelto)
 * en `master.tablero_documentos`. Corre DONDE ESTÁ LA BASE: dentro del
 * contenedor en producción, con `--env-file=.env.local` en local.
 *
 * Desde local no se llama a esto a mano: se usa `scripts/registro.mjs`, que
 * envuelve el ssh y el docker exec y pasa los bytes tal cual (PowerShell
 * recodifica lo que se le pasa por tubería y destroza las tildes; Node no).
 *
 * ── POR QUÉ EXISTE (19/08/2026) ───────────────────────────────────────────
 * Hasta hoy el Registro eran dos `.md` que viajaban dentro de la imagen de
 * Docker: apuntar una tarea costaba commit + build + deploy. Jorge quiso
 * reservar los commits para código. Ahora el texto es una fila por versión en
 * master, y publicar es esto. El porqué largo, en
 * `models/master/TableroDocumento.model.js`.
 *
 * ── LO QUE NO HACE NUNCA ──────────────────────────────────────────────────
 * Escribir sin `--confirm`, o con un solo error de `comprobar`
 * (`lib/tablero/parser.js`). Con el texto en una tabla ya no hay diff de git que
 * delate un `###` mal puesto, así que se comprueba ANTES de escribir, con el
 * mismo troceador que pinta la pantalla, y si no casa no se publica. Los dos
 * frenos que no son de formato —la base vieja (alguien publicó en medio) y el
 * encogimiento (parece medio fichero)— se levantan con `--forzar`, y se dice.
 *
 * ── USO ───────────────────────────────────────────────────────────────────
 *   node scripts/tablero-doc.js estado [--json]
 *   node scripts/tablero-doc.js leer <backlog|resuelto> [--version N]      → el texto por stdout
 *   node scripts/tablero-doc.js comprobar <doc> [--fichero ruta]           → valida stdin o el fichero, no toca la base
 *   node scripts/tablero-doc.js publicar <doc> [--fichero ruta] [--nota "…"] [--por quien]
 *                                       [--base N] [--forzar] [--confirm]
 *   node scripts/tablero-doc.js historial <doc> [--ultimas 20]
 *   node scripts/tablero-doc.js restaurar <doc> <version> [--nota "…"] [--por quien] [--confirm]
 *
 * Sin `--fichero`, `comprobar` y `publicar` leen el texto por stdin.
 * Códigos de salida: 0 bien (también el ensayo sin --confirm); 2 no se publica
 * por errores de comprobación; 1 cualquier otra cosa.
 *
 * En producción:
 *   docker exec -i crm-salamandra-app-1 node scripts/tablero-doc.js publicar backlog --nota "…" --confirm < fichero.md
 * En local:
 *   node --env-file=.env.local scripts/tablero-doc.js estado
 */

import { readFileSync } from "node:fs";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { DOCUMENTOS, comprobar } from "../lib/tablero/parser.js";
import {
  ultimaVersion,
  versionConcreta,
  historial,
  estadoDeTodos,
  prepararPublicacion,
  publicarVersion,
  VERSIONES_QUE_SE_GUARDAN,
} from "../lib/tablero/documentos.js";

/* ── Argumentos, a mano ──────────────────────────────────────────────────── */

function parsearArgs(argv) {
  const sueltos = [];
  const opciones = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const clave = a.slice(2);
      const siguiente = argv[i + 1];
      if (
        ["confirm", "forzar", "json"].includes(clave) ||
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
  return { sueltos, opciones };
}

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

function fecha(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function exigirDocumento(nombre) {
  if (!DOCUMENTOS.includes(nombre)) {
    err(`Documento desconocido: «${nombre ?? ""}». Son ${DOCUMENTOS.join(" y ")}.`);
    process.exit(1);
  }
}

function leerTexto(opciones) {
  if (opciones.fichero) return readFileSync(opciones.fichero, "utf8");
  if (process.stdin.isTTY) {
    err("Pasa el texto por stdin (… < fichero.md) o con --fichero ruta.");
    process.exit(1);
  }
  return readFileSync(0, "utf8");
}

function quien(opciones) {
  return (
    opciones.por || process.env.TABLERO_POR || process.env.USER || process.env.USERNAME || null
  );
}

/* ── Órdenes ─────────────────────────────────────────────────────────────── */

async function estado(models, opciones) {
  const todos = await estadoDeTodos(models);
  if (opciones.json) {
    out(JSON.stringify(todos));
    return;
  }
  for (const nombre of DOCUMENTOS) {
    const d = todos[nombre];
    if (!d) {
      out(`${nombre}: sin publicar (el tablero lee del fichero si existe)`);
      continue;
    }
    out(
      `${nombre}: v${d.version} · ${d.tareas ?? "?"} tareas · ${Math.round(d.bytes / 1024)} KB · ${fecha(d.publicadoEn)}` +
        (d.publicadoPor ? ` · ${d.publicadoPor}` : "") +
        (d.nota ? ` · «${d.nota}»` : "")
    );
  }
}

async function leer(models, nombre, opciones) {
  exigirDocumento(nombre);
  const fila = opciones.version
    ? await versionConcreta(models, nombre, Number(opciones.version))
    : await ultimaVersion(models, nombre);
  if (!fila) {
    err(
      opciones.version
        ? `No existe la v${opciones.version} de ${nombre}.`
        : `${nombre} no tiene ninguna versión publicada.`
    );
    process.exit(1);
  }
  // Solo el texto, sin salto de más: lo que se baja es lo que se publicó.
  process.stdout.write(fila.contenido);
}

/** Hasta diez títulos; la primera carga trae noventa y no hace falta leerlos todos. */
function listaCorta(titulos) {
  const TOPE = 10;
  const vistos = titulos
    .slice(0, TOPE)
    .map((t) => `«${t}»`)
    .join(", ");
  return titulos.length > TOPE ? `${vistos} … y ${titulos.length - TOPE} más` : vistos;
}

function pintarComprobacion(r) {
  if (r.avisos.length) {
    out(`  avisos (${r.avisos.length}):`);
    for (const a of r.avisos) out(`    · ${a}`);
  }
  if (r.errores.length) {
    out(`  ✗ errores (${r.errores.length}):`);
    for (const e of r.errores) out(`    · ${e}`);
  }
}

async function comprobarOrden(nombre, opciones) {
  exigirDocumento(nombre);
  const r = comprobar(leerTexto(opciones), nombre);
  out(`${nombre}: ${r.tareas} tareas en ${r.secciones} secciones`);
  pintarComprobacion(r);
  if (r.errores.length) process.exit(2);
  out("  ✓ se puede publicar");
}

async function publicar(
  models,
  nombre,
  opciones,
  { textoDado = null, notaPorDefecto = null } = {}
) {
  exigirDocumento(nombre);
  const contenido = textoDado ?? leerTexto(opciones);
  const actual = await ultimaVersion(models, nombre);
  const base = opciones.base !== undefined ? Number(opciones.base) : null;
  const p = prepararPublicacion({
    nombre,
    contenido,
    actual,
    base,
    forzar: Boolean(opciones.forzar),
  });

  out(
    actual
      ? `${nombre}: actual v${actual.version} (${actual.publicadoPor ?? "—"}, ${fecha(actual.createdAt)}${actual.nota ? `, «${actual.nota}»` : ""})`
      : `${nombre}: sin ninguna versión publicada`
  );
  if (p.sinCambios) {
    out(`  Sin cambios respecto a la v${actual.version}: no se publica nada.`);
    return;
  }
  out(
    `  → v${p.versionNueva}: ${p.tareasAntes} → ${p.tareasDespues} tareas · ${Math.round(p.bytes / 1024)} KB`
  );
  if (p.entran.length) out(`  entran (${p.entran.length}): ${listaCorta(p.entran)}`);
  if (p.salen.length) out(`  salen (${p.salen.length}): ${listaCorta(p.salen)}`);
  pintarComprobacion(p);

  if (p.errores.length) {
    out("  No se publica.");
    process.exit(2);
  }
  if (!opciones.confirm) {
    out("  (ensayo: sin --confirm no se escribe)");
    return;
  }

  const nota = opciones.nota ?? notaPorDefecto;
  const { fila, podadas } = await publicarVersion(models, {
    nombre,
    contenido: p.contenido,
    nota,
    por: quien(opciones),
    version: p.versionNueva,
    tareas: p.tareasDespues,
  });
  out(
    `  ✓ ${nombre} v${fila.version} publicada${fila.publicadoPor ? ` por ${fila.publicadoPor}` : ""}${fila.nota ? ` — «${fila.nota}»` : ""}`
  );
  if (podadas)
    out(
      `  · podadas ${podadas} versión(es) antiguas (se guardan las últimas ${VERSIONES_QUE_SE_GUARDAN})`
    );
}

async function historialOrden(models, nombre, opciones) {
  exigirDocumento(nombre);
  const filas = await historial(models, nombre, { ultimas: Number(opciones.ultimas ?? 20) });
  if (!filas.length) {
    out(`${nombre}: sin versiones.`);
    return;
  }
  for (const f of filas) {
    out(
      `v${String(f.version).padStart(3)} · ${fecha(f.createdAt)} · ${String(f.tareas ?? "?").padStart(3)} tareas · ${(f.publicadoPor ?? "—").padEnd(12)} ${f.nota ? `«${f.nota}»` : ""}`
    );
  }
}

async function restaurar(models, nombre, version, opciones) {
  exigirDocumento(nombre);
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) {
    err("Falta la versión a restaurar: restaurar <doc> <version>");
    process.exit(1);
  }
  const vieja = await versionConcreta(models, nombre, v);
  if (!vieja) {
    err(`No existe la v${v} de ${nombre}.`);
    process.exit(1);
  }
  // Restaurar es publicar otra vez el texto viejo como versión nueva: así el
  // historial cuenta lo que pasó. El encogimiento se fuerza solo: volver a una
  // versión con menos tareas es justo para lo que sirve restaurar.
  await publicar(
    models,
    nombre,
    { ...opciones, forzar: true },
    {
      textoDado: vieja.contenido,
      notaPorDefecto: `restaurada desde la v${v}`,
    }
  );
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  const { sueltos, opciones } = parsearArgs(process.argv.slice(2));
  const [orden, nombre, tercero] = sueltos;

  // `comprobar` no toca la base: vale sin conexión ni DATABASE_URL.
  if (orden === "comprobar") {
    await comprobarOrden(nombre, opciones);
    return;
  }

  if (!process.env.DATABASE_URL) {
    err("Falta DATABASE_URL (en local: node --env-file=.env.local …).");
    process.exit(1);
  }

  const models = getMasterModels();
  // En local (NODE_ENV=development) la instancia pinta cada SELECT; aquí es
  // ruido que tapa lo que importa.
  getMasterDb().options.logging = false;
  try {
    switch (orden) {
      case "estado":
        await estado(models, opciones);
        break;
      case "leer":
        await leer(models, nombre, opciones);
        break;
      case "publicar":
        await publicar(models, nombre, opciones);
        break;
      case "historial":
        await historialOrden(models, nombre, opciones);
        break;
      case "restaurar":
        await restaurar(models, nombre, tercero, opciones);
        break;
      default:
        err(
          "Órdenes: estado | leer <doc> | comprobar <doc> | publicar <doc> | historial <doc> | restaurar <doc> <version>"
        );
        process.exit(1);
    }
  } finally {
    await getMasterDb().close();
  }
}

main().catch((e) => {
  err(e?.code === "VERSION_PISADA" ? e.message : e?.stack || String(e));
  process.exit(1);
});
