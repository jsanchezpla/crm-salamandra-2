/**
 * traer-gastos-de-organizate.js — los gastos que el centro sigue apuntando en
 * Organízate (09/09/2026, AV-0075 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * El volcado del 02/08 trajo 1.802 gastos y se paró en julio. De agosto de 2026
 * el CRM tiene 3 (849 €) y Organízate 22; en los agostos anteriores el centro
 * apuntó 27, 24 y 20. Los gastos de agosto son justo lo que corre para la
 * gestoría, así que van en el mismo viaje que las facturas.
 *
 * ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
 * De la exportación a Excel del listado de Gastos (`opcion=gastos`,
 * `vista=gastos_list_excel`, con `fecha_ini`/`fecha_fin`), que da DOCE columnas
 * —bastantes más que las cuatro de la pantalla—:
 *   { fecha, referencia, cif, proveedor, grupo, concepto,
 *     base, iva_pct, iva, irpf_pct, irpf, total }
 *
 * ── LO QUE SE RESPETA DEL VOLCADO, Y POR QUÉ ───────────────────────────────
 * · **`taxBase` es el TOTAL y el IVA va a cero**, como en los 1.802 que ya
 *   están. La exportación sí trae base e IVA por separado, pero mezclar los dos
 *   criterios dentro del mismo año descuadraría la suma del ejercicio: agosto
 *   sumaría base y el resto totales. Y el desglose no tiene dónde ir: la tabla
 *   `costs` NO tiene columna `notes` —el volcado del 02/08 le pasaba una y
 *   Sequelize la tiraba en silencio—, así que el gasto guarda el total, igual
 *   que los 1.802 de antes.
 * · **`total` y `taxAmount` los calcula `computeCostTotals`**, nunca la mano.
 *   Ponerlos a ojo es lo que dejó 1.803 gastos a 0 € en el volcado, y volvió a
 *   pasar aquí el 09/09/2026 hasta que se arregló: `total` es un DECIMAL con
 *   `defaultValue: 0`, así que no ponerlo NO da error, da cero euros.
 * · **La descripción es `PROVEEDOR · Grupo`**, la misma forma del volcado, que
 *   además es la clave con la que se sabe si un gasto ya está.
 * · El proveedor que no tenga ficha se crea al vuelo, como entonces.
 *
 * ── IDEMPOTENCIA ───────────────────────────────────────────────────────────
 * No hay clave natural, así que se cuenta la terna (fecha, importe,
 * descripción): **cuántas veces existe**, no si existe. En la contabilidad de
 * Aumenta hay gastos legítimamente idénticos —mismo día, mismo proveedor,
 * mismo importe—, y con un simple «¿está?» se perderían.
 *
 * ── CÓMO SE EJECUTA ────────────────────────────────────────────────────────
 *   docker exec -w /app crm-salamandra-app-1 node \
 *     scripts/traer-gastos-de-organizate.js aumenta \
 *     --datos /tmp/migracion-aumenta/gastos-organizate.json [--desde 2026-08-01]
 *   ... y con --confirm para escribir. En seco por defecto.
 */

import { readFileSync } from "node:fs";
import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { auditar } from "../lib/utils/auditoria.js";
import { computeCostTotals } from "../lib/billing/totalesGasto.js";

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const DATOS = args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null;
const DESDE = args.includes("--desde") ? args[args.indexOf("--desde") + 1] : null;
const SLUG = args.find((a) => !a.startsWith("--") && a !== DATOS && a !== DESDE) ?? "aumenta";
const MARCA = new Date().toISOString().slice(0, 10);

const n = (x) => String(x).padStart(6);
const eur = (x) => Number(x ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 });
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** El grupo de Organízate → nuestro `type`. Los impuestos van PRIMERO. */
function tipoGasto(grupo) {
  const g = norm(grupo);
  if (/IRPF|IVA |IVA$|MOD\.|IBI|TASA/.test(g)) return "tax";
  if (/SEGURIDAD SOCIAL|AUTONOMOS|NOMINA|SALARIO|PERSONAL/.test(g)) return "salary";
  if (/ALQUILER|RENTA/.test(g)) return "rent";
  if (/SOFTWARE|INFORMATIC|WEB|DOMINIO|HOSTING/.test(g)) return "software";
  if (/MATERIAL|SUMINISTRO|LIMPIEZA|OFICINA/.test(g)) return "material";
  if (/COMISION/.test(g)) return "commission";
  return "other";
}
/** Fijo lo que se paga sí o sí cada mes; variable el resto. */
const categoriaGasto = (tipo) => (tipo === "salary" || tipo === "rent" || tipo === "tax" ? "fixed" : "variable");

if (!DATOS) {
  console.log("Falta --datos <ruta al JSON de la exportación de gastos>");
  process.exit(1);
}

console.log("═".repeat(64));
console.log(` Gastos de Organízate → ${SLUG}${CONFIRMAR ? "" : "  ·  ENSAYO"}`);
console.log("═".repeat(64));

const fuente = JSON.parse(readFileSync(DATOS, "utf8"));
const todas = fuente.filas ?? fuente;
const filas = todas.filter((g) => g.fecha && (!DESDE || g.fecha >= DESDE));
console.log(`\nOrganízate: ${todas.length} gastos, extraído ${fuente.extraido ?? "?"}${DESDE ? ` · ${filas.length} desde el ${DESDE}` : ""}`);

const db = getMasterDb();
const [tenant] = await db.query(`SELECT id, slug FROM master.tenants WHERE slug = :slug`, {
  type: db.QueryTypes.SELECT,
  replacements: { slug: SLUG },
});
if (!tenant) {
  console.log(`No existe el tenant ${SLUG}`);
  process.exit(1);
}

const { models: m, sequelize } = getTenantDb(SLUG);

// ── Lo que ya hay, contado por la terna ─────────────────────────────────────
const yaEstan = new Map();
for (const c of await m.Cost.findAll({ attributes: ["incurredAt", "taxBase", "description"] })) {
  const k = `${String(c.incurredAt).slice(0, 10)}|${Number(c.taxBase).toFixed(2)}|${c.description}`;
  yaEstan.set(k, (yaEstan.get(k) ?? 0) + 1);
}

const proveedores = new Map();
for (const s of await m.Supplier.findAll({ attributes: ["id", "name"] })) proveedores.set(norm(s.name), s.id);

// ── Qué entra ───────────────────────────────────────────────────────────────
const entran = [];
const vistos = new Map();
const tipos = {};
for (const g of filas) {
  const total = Number(g.total ?? 0);
  const desc = `${String(g.proveedor ?? "").trim() || "Gasto"}${g.grupo ? ` · ${String(g.grupo).trim()}` : ""}`;
  const clave = `${g.fecha}|${total.toFixed(2)}|${desc}`;
  const iEsta = (vistos.get(clave) ?? 0) + 1;
  vistos.set(clave, iEsta);
  if (iEsta <= (yaEstan.get(clave) ?? 0)) continue;
  const tipo = tipoGasto(g.grupo);
  tipos[tipo] = (tipos[tipo] ?? 0) + 1;
  entran.push({ g, desc, total, tipo });
}

const nuevosProv = [...new Set(entran.map((x) => String(x.g.proveedor ?? "").trim()).filter((p) => p && !proveedores.has(norm(p))))];
const porMes = new Map();
for (const x of entran) porMes.set(x.g.fecha.slice(0, 7), (porMes.get(x.g.fecha.slice(0, 7)) ?? 0) + 1);

console.log(`\n── LO QUE ENTRA ──────────────────────────────────────────────`);
console.log(`  gastos nuevos                             ${n(entran.length)}   ${eur(entran.reduce((s, x) => s + x.total, 0))} €`);
console.log(`  · por mes: ${[...porMes.entries()].sort().map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`);
console.log(`  · por tipo: ${Object.entries(tipos).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`);
console.log(`  proveedores que se crean                  ${n(nuevosProv.length)}`);
console.log(`  ya estaban, no se tocan                   ${n(filas.length - entran.length)}`);
if (DETALLE) entran.forEach((x) => console.log(`    ${x.g.fecha}  ${eur(x.total).padStart(11)} €  ${x.desc.slice(0, 44)}`));

// ── Escribir ────────────────────────────────────────────────────────────────
if (CONFIRMAR && entran.length) {
  await sequelize.transaction(async (t) => {
    for (const nombre of nuevosProv) {
      const cat = filas.find((g) => norm(g.proveedor) === norm(nombre));
      const s = await m.Supplier.create(
        { name: nombre, taxId: cat?.cif || null, notes: `Importado de Organízate el ${MARCA}` },
        { transaction: t },
      );
      proveedores.set(norm(nombre), s.id);
    }
    for (const x of entran) {
      const { g } = x;
      await m.Cost.create(
        {
          type: x.tipo,
          category: categoriaGasto(x.tipo),
          description: x.desc,
          // `total` y `taxAmount` NUNCA se ponen a mano: los calcula
          // `computeCostTotals`, o el gasto se guarda a 0 € — que es
          // justo el fallo de los 1.803 gastos del volcado (08/09/2026).
          ...computeCostTotals({ taxBase: x.total, vatRate: 0 }),
          incurredAt: g.fecha,
          supplierId: proveedores.get(norm(g.proveedor)) ?? null,
        },
        { transaction: t },
      );
    }
  });
  console.log(`\n  ✓ ${entran.length} gastos creados · ${nuevosProv.length} proveedores nuevos`);

  await auditar({
    tenantId: tenant.id,
    action: "billing.costs_import_organizate",
    entity: "cost",
    after: { creados: entran.length, proveedores: nuevosProv.length, desde: DESDE ?? null, marca: MARCA },
  });
}

const despues = await sequelize.query(
  `SELECT to_char(incurred_at,'YYYY-MM') mes, COUNT(*)::int n, SUM(total)::numeric suma
     FROM crm_${SLUG}.costs WHERE incurred_at >= '2026-06-01' GROUP BY 1 ORDER BY 1`,
  { type: sequelize.QueryTypes.SELECT },
);
console.log(`\n  gastos del CRM desde junio:`);
despues.forEach((r) => console.log(`    ${r.mes}   ${n(r.n)}   ${eur(r.suma)} €`));
if (!CONFIRMAR) console.log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)");

await closeAllConnections();
await db.close();
