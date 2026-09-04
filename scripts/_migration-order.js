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
  // ── La tienda va DESPUÉS del rework de Inventario (25/08/2026) ────────────
  // `migrate-tienda` hace ALTER sobre `products`, `stock_movements`,
  // `order_lines` y `orders`, y las dos primeras las crea el rework. El
  // analizador no lo ve porque su SQL usa un marcador `{S}` para el schema en
  // vez del nombre literal, así que la arista se declara aquí.
  //
  // Sin ella, en un tenant nuevo la tienda saldría antes y sus ALTER fallarían
  // con «relation does not exist» a mitad del alta.
  {
    before: "migrate-inventario-rework",
    after: "migrate-tienda",
    why: "migrate-tienda altera `products` y `stock_movements`, que crea el rework de Inventario. Su SQL usa un marcador de schema y el analizador no puede leerlo.",
  },
  // ── Pedidos va ANTES de la tienda (03/09/2026) ────────────────────────────
  // `migrate-tienda` también altera `orders` y `order_lines`, que desde hoy
  // crea `migrate-orders` (hasta ahora solo existían por un script de _hechos).
  // Mismo motivo que la arista de arriba: el marcador `{S}` de la tienda.
  {
    before: "migrate-orders",
    after: "migrate-tienda",
    why: "migrate-tienda añade columnas a `orders` y `order_lines`, que crea migrate-orders. Su SQL usa un marcador de schema y el analizador no puede leerlo.",
  },
  // ── Rework de Inventario / Arqueo / Proveedores (02/08/2026) ──────────────
  // Las tres deciden por EXISTENCIA de tabla (`if (!tableExists(costs)) return`),
  // así que el analizador no ve un SQL que las ate a nada y las colocaba al
  // principio. En un tenant NUEVO eso significaba saltárselas en silencio: el
  // arqueo salía 2º, antes de que billing-rework creara `costs`, y se iba sin
  // crear cash_points ni cash_closes. Un no-op silencioso es peor que un error.
  {
    before: "migrate-billing-rework",
    after: "migrate-arqueo",
    why: "arqueo se salta el schema si no existe `costs`, y `costs` la crea billing-rework. Sin esta arista, un tenant nuevo se quedaba sin las tablas del arqueo y nadie se enteraba.",
  },
  {
    before: "migrate-billing-rework",
    after: "migrate-suppliers",
    why: "suppliers añade `costs.supplier_id` y se salta el schema si no hay `costs`.",
  },
  {
    before: "migrate-suppliers",
    after: "migrate-inventario-rework",
    why: "stock_entries.supplier_id apunta a `suppliers`. Si el rework va antes, la FK no se crea (solo deja un aviso) y el desplegable de proveedores del almacén queda sin integridad.",
  },
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
  {
    before: "migrate-team-fields",
    after: "migrate-fichaje-module",
    why: "fichajes.team_member_id apunta a `team_members`, y la migración se SALTA el schema que no la tenga en vez de fallar. Sin esta arista, un tenant que estrene Equipo y Fichaje a la vez podría quedarse sin las tablas del fichaje y nadie se enteraría hasta que alguien abriera la pantalla.",
  },
  // ── Fichaje: el valor 'extra' del tipo de fichaje (31/08/2026) ────────────
  // Mismo caso que el informe de beca de aquí abajo: `tipo-extra` solo hace
  // ALTER TYPE, así que el analizador no le lee nada y flotaba libre. Sin la
  // arista, en un tenant nuevo podía salir ANTES de que `fichaje-module`
  // creara la tabla —y con ella el enum— y saltarse el schema en silencio.
  {
    before: "migrate-fichaje-module",
    after: "migrate-fichaje-tipo-extra",
    why: "tipo-extra hace ALTER TYPE sobre enum_fichajes_tipo, que nace con la tabla fichajes de fichaje-module. El analizador solo lee ALTER TABLE, no ALTER TYPE, así que este fichero le resulta ilegible entero.",
  },
  // ── Clínica: el enum del informe de beca (26/08/2026) ─────────────────────
  {
    before: "migrate-clinica-module",
    after: "migrate-informe-beca",
    why: "informe-beca hace ALTER TYPE sobre enum_clinical_reports_report_type, que nace con la tabla clinical_reports de clinica-module. El analizador solo lee ALTER TABLE, no ALTER TYPE, así que este fichero le resulta ilegible entero.",
  },
  // ── Clínica: el enum del informe de asesoramiento (04/09/2026) ────────────
  {
    before: "migrate-clinica-module",
    after: "migrate-informe-asesoramiento",
    why: "mismo caso que informe-beca: solo hace ALTER TYPE sobre enum_clinical_reports_report_type, que nace con la tabla clinical_reports de clinica-module, y el analizador no le lee nada.",
  },
  // ── Las FKs de equipo se alinean DESPUÉS de que existan sus tablas ────────
  // fks-equipo-alineadas no tiene un solo SQL estático (recorre OBJETIVO y
  // construye los ALTER con variables), así que el analizador no ve nada. Y
  // como elige schemas por EXISTENCIA de tabla y se salta sin quejarse el que
  // no la tenga, correrla antes de los creadores sería el no-op silencioso de
  // siempre: el tenant nacería con las FK que inventa sync().
  {
    before: "migrate-clinica-module",
    after: "migrate-fks-equipo-alineadas",
    why: "tres de las cuatro FK que alinea (clinical_reports, clinic_sessions, coordinations) viven en tablas que crea clinica-module; antes de ella se las saltaría en silencio.",
  },
  {
    before: "migrate-vacaciones",
    after: "migrate-fks-equipo-alineadas",
    why: "la cuarta FK es team_blocks.team_member_id, y `team_blocks` la crea migrate-vacaciones. Mismo caso que la de arriba.",
  },
  {
    before: "migrate-nutricion-base",
    after: "migrate-nutricion-recipes",
    why: "recipes se salta el schema entero si no encuentra `foods` y `plan_meal_options` («faltan foods/plan_meal_options. Se salta»), y las dos las crea nutricion-base. El analizador no ve la atadura porque recipes solo nombra `foods` dentro de un REFERENCES, así que el orden salía bien por PURO DESEMPATE ALFABÉTICO ('base' < 'recipes'). Renombrar cualquiera de las dos lo habría invertido en silencio, y el síntoma sería el de siempre: tenant nuevo con el módulo puesto y sin recetario.",
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
