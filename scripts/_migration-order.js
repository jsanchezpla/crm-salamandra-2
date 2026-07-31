/**
 * _migration-order.js — DEDUCE el orden de las migraciones leyendo su código.
 *
 * POR QUÉ EXISTE
 * La primera versión de `ORDER` en _module-migrations.js era una lista escrita a
 * mano, reconstruida de docs/deploy-notes-2026-07-19.md. Funcionaba, pero
 * dependía de memoria histórica: si alguien añadía una migración y no la
 * colocaba en el sitio correcto, nadie se enteraba hasta que reventara en
 * producción. Y de hecho el runbook ya tenía una imprecisión — ponía
 * `patients-clients-phase1` antes que `client-module-assignments` como si
 * importara, cuando son independientes: `client_id` lo crea el segundo por su
 * cuenta (ver su línea del ADD COLUMN).
 *
 * Aquí el orden se calcula del SQL de cada fichero:
 *
 *   CREATE TABLE  "${schema}"."x"   → esa migración PROVEE x
 *   CREATE INDEX  "i" ON ..."x"     → PROVEE idx:i  y REQUIERE x
 *   ALTER TABLE   "${schema}"."x"   → REQUIERE x
 *   DROP INDEX    "${schema}"."i"   → REQUIERE idx:i
 *
 * Si A provee algo que B requiere, A va antes que B. Con eso sale un grafo que
 * se ordena topológicamente. Empates (migraciones independientes entre sí) se
 * rompen por orden alfabético para que el resultado sea siempre el mismo.
 *
 * Lo que NO se deduce del SQL se declara en EXTRA_EDGES, con su motivo.
 *
 * Auditable con:  node scripts/check-migration-order.js
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Aristas que el analizador no puede ver en el SQL. Cada una con su motivo: si
 * añades alguna, explica POR QUÉ, que es lo que evita volver a depender de que
 * alguien se acuerde.
 */
export const EXTRA_EDGES = [
  {
    before: "migrate-citas-sprint-1",
    after: "migrate-booking-pending",
    why: "booking-pending hace ALTER TYPE sobre enum_bookings_status, que nace con la tabla bookings de citas-sprint-1. El analizador no relaciona un enum con su tabla.",
  },
  {
    before: "migrate-payments-sprint-1",
    after: "migrate-booking-authorization",
    why: "booking-authorization amplía enums y añade columnas recorriendo dos listas de constantes, así que el analizador no ve NINGÚN SQL estático. Toca bookings (de citas-sprint-1, ya encadenada por booking-pending) y payment_sessions, que la crea payments-sprint-1.",
  },
  {
    before: "migrate-team-fields",
    after: "migrate-rename-therapist-to-employee",
    why: "el rename busca columnas/índices que contengan 'therapist'; team-fields es quien los introduce.",
  },
  {
    before: "migrate-clinica-module",
    after: "migrate-clinica-client-link",
    why: "client-link ALTERea clinic_sessions/clinical_reports/coordinations en un bucle (el analizador no ve el ALTER estático); esas tablas las crea clinica-module.",
  },
  {
    before: "migrate-client-attachments-and-notes",
    after: "migrate-interactions-notes-team",
    why: "notes-team ALTERea interactions/client_notes en un bucle; client_notes la crea client-attachments-and-notes.",
  },
  {
    before: "migrate-patients-care-type",
    after: "migrate-patients-specialties",
    why: "specialties hace UPDATE ... WHERE care_type='nutricion' para el backfill; care_type lo añade care-type. El analizador no ve deps de columna dentro de un UPDATE (hasta ahora solo funcionaba por el desempate alfabético).",
  },
];

const RX = {
  createTable: /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"\$\{schema\}"\."?([a-z_]+)/gi,
  alterTable: /ALTER TABLE\s+"\$\{schema\}"\."?([a-z_]+)/gi,
  createIndex: /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF NOT EXISTS)?\s+"?([a-z_]+)"?\s+ON\s+"\$\{schema\}"\."?([a-z_]+)/gi,
  dropIndex: /DROP INDEX(?:\s+IF EXISTS)?\s+"\$\{schema\}"\."?([a-z_]+)/gi,
};

/**
 * Varias migraciones no escriben la tabla como literal sino con una constante:
 *   const TABLE = "training_users";  →  `ALTER TABLE "${schema}"."${TABLE}"`
 * Sin resolverlas, el analizador no ve NADA de esos ficheros y quedan flotando
 * sin dependencias en el orden. Se sustituyen antes de analizar (respetando
 * `${schema}`, que los patrones esperan literal).
 */
function resolveConsts(src) {
  const consts = {};
  for (const m of src.matchAll(/^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([a-z][a-z0-9_]*)["']\s*;/gm)) {
    consts[m[1]] = m[2];
  }
  return src.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (todo, nombre) =>
    nombre === "schema" ? todo : consts[nombre] ?? todo
  );
}

/** Nombres de migración cuyo SQL el analizador no consigue leer. */
export function blindSpots(deps = extractDeps()) {
  return Object.entries(deps)
    .filter(([, v]) => !v.provides.length && !v.requires.length)
    .map(([k]) => k);
}

/** Lee todas las migraciones y saca qué provee y qué requiere cada una. */
export function extractDeps(dir = HERE) {
  const out = {};
  for (const f of readdirSync(dir).filter((f) => /^migrate-.*\.js$/.test(f))) {
    const src = resolveConsts(readFileSync(join(dir, f), "utf8"));
    const provides = new Set();
    const requires = new Set();

    for (const m of src.matchAll(RX.createTable)) provides.add(m[1]);
    for (const m of src.matchAll(RX.alterTable)) requires.add(m[1]);
    for (const m of src.matchAll(RX.createIndex)) {
      provides.add(`idx:${m[1]}`);
      requires.add(m[2]);
    }
    for (const m of src.matchAll(RX.dropIndex)) requires.add(`idx:${m[1]}`);

    // Lo que una migración crea ella misma no se lo pide a nadie.
    for (const p of provides) requires.delete(p);

    out[f.replace(/\.js$/, "")] = { provides: [...provides].sort(), requires: [...requires].sort() };
  }
  return out;
}

/** Aristas A→B ("A antes que B") deducidas + declaradas, con su motivo. */
export function edges(deps = extractDeps()) {
  const productor = {};
  for (const [name, v] of Object.entries(deps)) {
    for (const p of v.provides) (productor[p] ||= []).push(name);
  }
  const res = [];
  for (const [name, v] of Object.entries(deps)) {
    for (const r of v.requires) {
      for (const prod of productor[r] || []) {
        if (prod !== name) res.push({ before: prod, after: name, why: `${name} altera ${r}, que crea ${prod}`, derivada: true });
      }
    }
  }
  for (const e of EXTRA_EDGES) {
    if (deps[e.before] && deps[e.after]) res.push({ ...e, derivada: false });
  }
  return res;
}

/**
 * Orden topológico determinista. Lanza si hay un ciclo (sería un error real de
 * dependencias entre migraciones, no algo que deba resolverse en silencio).
 */
export function computeOrder(deps = extractDeps()) {
  const nombres = Object.keys(deps).sort();
  const entrantes = Object.fromEntries(nombres.map((n) => [n, 0]));
  const salientes = Object.fromEntries(nombres.map((n) => [n, []]));

  const vistas = new Set();
  for (const e of edges(deps)) {
    const k = `${e.before}→${e.after}`;
    if (vistas.has(k)) continue; // el mismo par puede salir por varias tablas
    vistas.add(k);
    salientes[e.before].push(e.after);
    entrantes[e.after]++;
  }

  // Kahn con cola ordenada alfabéticamente → salida estable entre ejecuciones.
  const listas = nombres.filter((n) => entrantes[n] === 0).sort();
  const orden = [];
  while (listas.length) {
    const n = listas.shift();
    orden.push(n);
    for (const m of salientes[n].sort()) {
      if (--entrantes[m] === 0) {
        listas.push(m);
        listas.sort();
      }
    }
  }

  if (orden.length !== nombres.length) {
    const enCiclo = nombres.filter((n) => !orden.includes(n));
    throw new Error(`Ciclo de dependencias entre migraciones: ${enCiclo.join(", ")}`);
  }
  return orden;
}
