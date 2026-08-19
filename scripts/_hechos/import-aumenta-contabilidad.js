/**
 * import-aumenta-contabilidad.js — segunda tanda: proveedores, gastos,
 * facturas y cierres de caja.
 *
 * Va DESPUÉS de `import-aumenta.js`: las facturas necesitan que las familias ya
 * existan para poder colgarse de ellas.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── El riesgo de esta tanda: emparejar factura ↔ familia ───────────────────
 *
 * En Organízate la factura NO guarda un identificador de cliente: guarda un
 * TEXTO con el nombre. Así que hay que cruzarlo contra las familias ya
 * importadas, y `Invoice.clientId` es OBLIGATORIO — una factura sin familia
 * sencillamente no se puede grabar.
 *
 * Por eso el script mide primero y escribe después: la simulación dice qué
 * porcentaje encuentra a su familia, y ese número es el que decide si esto
 * está listo o si hay que afinar el cruce.
 *
 * El cruce va en tres pasadas, de más a menos seguro:
 *   1. Nombre exacto de la familia (normalizado, sin acentos).
 *   2. Nombre del PACIENTE → su familia. En Organízate muchas facturas salen
 *      a nombre del niño, no del pagador.
 *   3. Sin coincidencia → se cuenta aparte y NO se inventa nada.
 *
 * ── Decisiones de Rodrigo (02/08/2026) ────────────────────────────────────
 *
 * · Todas las facturas entran como COBRADAS. El estado de Organízate no se
 *   mantenía (el 97 % figuraba impagado) y copiarlo diría que a Aumenta le
 *   deben 2 M€.
 * · Los 828 cierres entran con los importes A CERO: Organízate solo guarda la
 *   fecha y el descuadre, y rellenar el resto sería inventarse contabilidad.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();

/** "1.234,56 €" → 1234.56 (en céntimos enteros para no arrastrar decimales). */
const cent = (s) => {
  const t = String(s ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = parseFloat(t);
  return isNaN(v) ? 0 : Math.round(v * 100);
};
/** "27/03/24" → "2024-03-27". Organízate usa año de dos cifras. */
const fecha = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2]}-${m[1]}`;
};

/**
 * Grupo de gasto de Organízate → `type` y `category` de nuestro Cost.
 *
 * Los grupos reales de Aumenta son estos (1.802 gastos):
 *   Clinica 1207 · Banco 338 · Material 68 · AUTONOMOS 59 · Seg. Social 50
 *   IRPF/IVA (varios modelos) 80 · IBI 6 · Tasa residuos 2
 *
 * Los impuestos (IRPF, IVA, IBI, tasas) van a `tax`, el tipo que se añadió el
 * 02/08/2026 a petición de Rodrigo: antes caían en `other` mezclados con la
 * compra de folios y no había forma de ver cuánto se lleva Hacienda.
 *
 * Que «Clinica» se lleve el 67 % no es un fallo del cruce: es que ese grupo es
 * el cajón de sastre de Aumenta en Organízate.
 */
function tipoGasto(grupo) {
  const g = norm(grupo);
  // Los impuestos van PRIMERO: "IRPF EMPLEADOS" es un impuesto, no una nómina.
  if (/IRPF|IVA |IVA$|MOD\.|IBI|TASA/.test(g)) return "tax";
  if (/SEGURIDAD SOCIAL|AUTONOMOS|NOMINA|SALARIO|PERSONAL/.test(g)) return "salary";
  if (/ALQUILER|RENTA/.test(g)) return "rent";
  if (/SOFTWARE|INFORMATIC|WEB|DOMINIO|HOSTING/.test(g)) return "software";
  if (/MATERIAL|SUMINISTRO|LIMPIEZA|OFICINA/.test(g)) return "material";
  if (/COMISION/.test(g)) return "commission";
  return "other";
}

/** Fijo lo que se paga sí o sí cada mes; variable el resto. */
function categoriaGasto(tipo) {
  return tipo === "salary" || tipo === "rent" || tipo === "tax" ? "fixed" : "variable";
}

function leer(nombre) {
  return JSON.parse(readFileSync(path.join(DATOS, nombre), "utf8"));
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` CONTABILIDAD DE AUMENTA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const conta = leer("organizate-contabilidad.json");
  const bloque = (c) => conta.bloques.find((b) => b.clave === c);
  const proveedores = bloque("s6_gastos_proveedores")?.filas ?? [];
  const gastos = bloque("gastos_TODO")?.filas ?? [];
  const cierres = bloque("cierres_TODO")?.filas ?? [];
  const facturas = conta.bloques.filter((b) => /^facturas_\d{4}$/.test(b.clave)).flatMap((b) => b.filas);

  console.log(`Leído: ${proveedores.length} proveedores · ${gastos.length} gastos · ${facturas.length} facturas · ${cierres.length} cierres\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  // ── Índice de familias, para el cruce ───────────────────────────────────
  const clientes = await m.Client.findAll({ attributes: ["id", "name"] });
  const porNombre = new Map();
  for (const c of clientes) if (!porNombre.has(norm(c.name))) porNombre.set(norm(c.name), c.id);

  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName", "clientId"] });
  const porPaciente = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porPaciente.has(k)) porPaciente.set(k, p.clientId);
  }

  const cruzar = (texto) => {
    const k = norm(texto);
    if (!k) return { id: null, via: "vacio" };
    if (porNombre.has(k)) return { id: porNombre.get(k), via: "familia" };
    if (porPaciente.has(k)) return { id: porPaciente.get(k), via: "paciente" };
    // Organízate bautiza las fichas duplicadas añadiendo " 1" al nombre, y
    // algunas facturas viejas salieron a nombre de esa copia. La ficha buena es
    // la de sin sufijo, así que se reintenta sin él.
    const sinSufijo = k.replace(/\s+1$/, "");
    if (sinSufijo !== k) {
      if (porNombre.has(sinSufijo)) return { id: porNombre.get(sinSufijo), via: "familia" };
      if (porPaciente.has(sinSufijo)) return { id: porPaciente.get(sinSufijo), via: "paciente" };
    }
    return { id: null, via: "sin" };
  };

  // ── Medir el cruce ANTES de tocar nada ──────────────────────────────────
  const via = { familia: 0, paciente: 0, sin: 0, vacio: 0 };
  const sinCruce = new Map();
  let totalCent = 0;
  for (const f of facturas) {
    const nombre = f[3];
    const r = cruzar(nombre);
    via[r.via]++;
    totalCent += cent(f[4]);
    if (r.via === "sin") sinCruce.set(norm(nombre), (sinCruce.get(norm(nombre)) ?? 0) + 1);
  }
  const cruzadas = via.familia + via.paciente;
  const pct = ((cruzadas / facturas.length) * 100).toFixed(1);

  console.log("── EMPAREJAMIENTO FACTURA ↔ FAMILIA ──────────────────────────\n");
  console.log(`  Por nombre de la familia   ${String(via.familia).padStart(6)}`);
  console.log(`  Por nombre del paciente    ${String(via.paciente).padStart(6)}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  ENCUENTRAN FAMILIA         ${String(cruzadas).padStart(6)}   ${pct} %`);
  console.log(`  Sin coincidencia           ${String(via.sin).padStart(6)}`);
  console.log(`  Sin nombre en la factura   ${String(via.vacio).padStart(6)}\n`);
  console.log(`  Importe total facturado: ${(totalCent / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €\n`);

  if (sinCruce.size) {
    console.log(`  Los ${Math.min(12, sinCruce.size)} nombres sin cruce que más se repiten (de ${sinCruce.size}):`);
    [...sinCruce.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([n, c]) => console.log(`    ${String(c).padStart(4)} ×  ${n.slice(0, 52)}`));
    console.log("");
  }

  // ── Proveedores y gastos ────────────────────────────────────────────────
  const provPorNombre = new Map();
  for (const p of proveedores) if (cap(p[0])) provPorNombre.set(norm(p[0]), cap(p[0]));

  let gastoCent = 0, gastosSinProv = 0;
  const tipos = {};
  for (const g of gastos) {
    gastoCent += cent(g[4]);
    if (!provPorNombre.has(norm(g[2]))) gastosSinProv++;
    const t = tipoGasto(g[3]);
    tipos[t] = (tipos[t] ?? 0) + 1;
  }

  console.log("── GASTOS Y PROVEEDORES ──────────────────────────────────────\n");
  console.log(`  Proveedores del catálogo   ${String(provPorNombre.size).padStart(6)}`);
  console.log(`  Gastos                     ${String(gastos.length).padStart(6)}   ${(gastoCent / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`);
  console.log(`  …con proveedor del catálogo${String(gastos.length - gastosSinProv).padStart(6)}`);
  console.log(`  …con proveedor suelto      ${String(gastosSinProv).padStart(6)}   se crea su ficha al vuelo`);
  console.log(`  Reparto por tipo: ${Object.entries(tipos).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);

  // ── Cierres ─────────────────────────────────────────────────────────────
  const conDescuadre = cierres.filter((c) => c.some((x) => /€/.test(String(x))));
  console.log("── CIERRES DE CAJA ───────────────────────────────────────────\n");
  console.log(`  Cierres                    ${String(cierres.length).padStart(6)}   importes a cero (Organízate no los guarda)`);
  console.log(`  …con descuadre             ${String(conDescuadre.length).padStart(6)}\n`);

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("⚠️  Escribiendo…\n");
  const hoy = new Date().toISOString().slice(0, 10);
  const n = { prov: 0, gastos: 0, facturas: 0, saltadas: 0, cierres: 0 };

  await sequelize.transaction(async (t) => {
    // Proveedores del catálogo + los que solo aparecen en un gasto.
    const provId = new Map();
    const nombresProv = new Set([...provPorNombre.values()]);
    for (const g of gastos) if (cap(g[2])) nombresProv.add(cap(g[2]));

    for (const nombre of nombresProv) {
      const ya = await m.Supplier.findOne({ where: { name: nombre }, transaction: t });
      if (ya) { provId.set(norm(nombre), ya.id); continue; }
      const cat = proveedores.find((p) => norm(p[0]) === norm(nombre));
      const s = await m.Supplier.create({
        name: nombre,
        phone: cap(cat?.[2]) || null,
        email: cap(cat?.[3]) || null,
        contactName: cap(cat?.[1]) || null,
        notes: `Importado de Organízate el ${hoy}`,
      }, { transaction: t });
      provId.set(norm(nombre), s.id);
      n.prov++;
    }

    // Gastos. Sin clave natural, así que la idempotencia va por la terna
    // (fecha, importe, descripción), cargada de una vez: un `findOne` por fila
    // serían 1.802 consultas. Sin esto, una segunda pasada los DUPLICA — pasó
    // al probarlo y dejó 3.604 gastos por 3,8 M€.
    // Y se cuenta CUÁNTAS veces existe cada clave, no solo si existe: en la
    // contabilidad de Aumenta hay 62 gastos legítimamente idénticos (mismo día,
    // mismo proveedor, mismo importe). Con un Set a secas se perdían, y el total
    // dejaba de cuadrar con los 1.922.960,55 € de Organízate.
    const yaGastos = new Map();
    for (const c of await m.Cost.findAll({ attributes: ["incurredAt", "taxBase", "description"], transaction: t })) {
      const k = `${c.incurredAt}|${Number(c.taxBase).toFixed(2)}|${c.description}`;
      yaGastos.set(k, (yaGastos.get(k) ?? 0) + 1);
    }
    const vistosGasto = new Map();

    for (const g of gastos) {
      const f = fecha(g[1]);
      if (!f) continue;
      const base = cent(g[4]) / 100;
      const desc = `${cap(g[2]) || "Gasto"}${g[3] ? ` · ${cap(g[3])}` : ""}`;
      const clave = `${f}|${base.toFixed(2)}|${desc}`;
      const iEsta = (vistosGasto.get(clave) ?? 0) + 1;
      vistosGasto.set(clave, iEsta);
      // Ya hay al menos `iEsta` iguales en la BD → esta repetición ya se importó.
      if (iEsta <= (yaGastos.get(clave) ?? 0)) continue;
      await m.Cost.create({
        type: tipoGasto(g[3]),
        category: categoriaGasto(tipoGasto(g[3])),
        description: desc,
        taxBase: base,
        vatRate: 0,
        incurredAt: f,
        supplierId: provId.get(norm(g[2])) ?? null,
        notes: `Importado de Organízate. Grupo: ${cap(g[3]) || "—"}`,
      }, { transaction: t });
      n.gastos++;
    }

    // Facturas — todas COBRADAS (decisión de Rodrigo)
    for (const fac of facturas) {
      const { id: clientId } = cruzar(fac[3]);
      const f = fecha(fac[2]);
      if (!clientId || !f) { n.saltadas++; continue; }
      const numero = cap(fac[1]);
      if (!numero) { n.saltadas++; continue; }
      const ya = await m.Invoice.findOne({ where: { number: numero }, transaction: t });
      if (ya) { n.saltadas++; continue; }
      const total = cent(fac[4]) / 100;
      await m.Invoice.create({
        clientId,
        series: /^R/i.test(numero) ? "R" : "F",
        number: numero,
        issueDate: f,
        status: "paid",
        // Organízate da el importe TOTAL, sin desglose de IVA: se guarda como
        // base sin impuesto en vez de inventarse un desglose que no tenemos.
        taxBase: total,
        vatAmount: 0,
        total,
        paidAmount: total,
        subtotal: total,
        vatRate: 0,
        lines: [{ description: "Importado de Organízate", quantity: 1, unitPrice: total, vatRate: 0 }],
        notes: `Importado de Organízate el ${hoy}`,
      }, { transaction: t });
      n.facturas++;
    }

    // Cierres — una caja «Recepción», que es la única que hay en Organízate
    let caja = await m.CashPoint.findOne({ where: { name: "Recepción" }, transaction: t });
    if (!caja) caja = await m.CashPoint.create({ name: "Recepción", notes: "Importada de Organízate" }, { transaction: t });

    // Un cierre por FILA. Al principio se agrupaban por día porque el modelo
    // tenía un único (caja, día); Rodrigo pidió poder arquear varias veces al
    // día —que es lo que ya hacían en Organízate— y ese único se quitó. Así
    // entran los 828 tal cual, cada uno con su hora.
    const filas = [];
    for (const c of cierres) {
      const f = fecha(c.find((x) => /^\d{2}\/\d{2}\/\d{2,4}$/.test(String(x))));
      if (!f) continue;
      const hora = c.find((x) => /^\d{1,2}:\d{2}$/.test(String(x)));
      const imp = c.find((x) => /€/.test(String(x)));
      filas.push({ f, hora: hora || null, cent: imp ? cent(imp) : 0 });
    }
    // Idempotencia CONTANDO repeticiones de (día, descuadre), no por hora.
    //
    // El primer intento usaba la hora, y duplicó los 812 cierres enteros: se
    // escribe la hora en horario local (15:07) y al releerla para comparar salía
    // en UTC (13:07), así que la clave NUNCA coincidía. Quitando la hora de la
    // clave el problema desaparece de raíz, y contar repeticiones respeta que
    // un mismo día pueda tener varios cierres con el mismo importe.
    const yaCierres = new Map();
    for (const c of await m.CashClose.findAll({ attributes: ["closeDate", "difference"], where: { cashPointId: caja.id }, transaction: t })) {
      const k = `${c.closeDate}|${Number(c.difference).toFixed(2)}`;
      yaCierres.set(k, (yaCierres.get(k) ?? 0) + 1);
    }
    const vistosCierre = new Map();

    for (const r of filas) {
      const hhmm = (r.hora ?? "00:00").padStart(5, "0");
      const clave = `${r.f}|${(r.cent / 100).toFixed(2)}`;
      const iEste = (vistosCierre.get(clave) ?? 0) + 1;
      vistosCierre.set(clave, iEste);
      if (iEste <= (yaCierres.get(clave) ?? 0)) continue;
      await m.CashClose.create({
        cashPointId: caja.id,
        closeDate: r.f,
        closedAt: new Date(`${r.f}T${hhmm}:00`),
        openingAmount: 0, expectedAmount: 0, countedAmount: 0,
        difference: r.cent / 100,
        notes: "Importado de Organízate: solo constan la fecha, la hora y el descuadre.",
      }, { transaction: t });
      n.cierres++;
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Proveedores  ${String(n.prov).padStart(6)}`);
  console.log(`  Gastos       ${String(n.gastos).padStart(6)}`);
  console.log(`  Facturas     ${String(n.facturas).padStart(6)}   (${n.saltadas} saltadas: sin familia, sin fecha o repetidas)`);
  console.log(`  Cierres      ${String(n.cierres).padStart(6)}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
