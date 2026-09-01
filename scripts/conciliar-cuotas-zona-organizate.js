// @vivo — Concilia las cuotas del CRM contra Cursos → Zona Pacientes del Organízate (la lista oficial de cada cuota con sus miembros y su PRECIO). Se ejecutó en aumenta el 01/09/2026 y se repite si el centro retoca allí antes del apagado definitivo.
/**
 * conciliar-cuotas-zona-organizate.js — la Zona Pacientes manda (01/09/2026,
 * Rodrigo: «en Cursos - Zona Pacientes están todas las cuotas con sus
 * pacientes adheridos... hay algunos que no han sido pasados al CRM.
 * Envíalos todos y organízalo bien»).
 *
 * El volcado del 01/09 leyó la pestaña «Grupos de cursos» de cada FICHA
 * (checkboxes). La Zona Pacientes es la otra cara —el grupo con su lista— y
 * además trae lo que las fichas no traen: el PRECIO real de cada cuota.
 *
 * Hace TRES cosas, EN SECO por defecto (--confirm para escribir):
 *
 *   1. PRECIOS: pone a cada concepto de cuota el importe que tiene HOY en el
 *      Organízate (incluidos los que estaban a 0 € «a completar» y los que el
 *      catálogo tenía viejos, como Logopedia 60x2 a 370 cuando allí vale 380).
 *      Las cuotas sembradas llevan el importe a NULL a propósito, así que se
 *      corrigen SOLAS con el concepto. Los cobros ya generados NO se tocan.
 *
 *   2. CONCEPTOS que falten (grupo de cuota con miembros y sin concepto en el
 *      catálogo): se crean con su precio real, como hizo el volcado.
 *
 *   3. MIEMBROS que falten: por cada (familia, cuota), si la Zona dice N
 *      miembros y el CRM tiene menos filas activas que N, se crean las que
 *      falten — POR PACIENTE (aquí sí se sabe qué hijo es), importe y método a
 *      NULL como la siembra, y alta el --desde (2026-09-01 por defecto).
 *      Nunca borra ni pisa lo que ya hay.
 *
 * Ambigüedades (mismo nombre en familias distintas) y no casados se cuentan y
 * salen con --detalle. Uso VPS (docker cp del script y el JSON):
 *   docker exec crm-salamandra-app-1 node scripts/conciliar-cuotas-zona-organizate.js scripts/organizate-zona-cuotas.json [--slug aumenta] [--desde 2026-09-01] [--confirm] [--detalle]
 */

import { readFileSync } from "node:fs";
import { getTenantDb } from "../lib/db/tenantDb.js";

// Grupo del Organízate → nombre del concepto en el CRM (la misma tabla que
// volcar-cuotas-organizate.js; el precio ya no va aquí: viene del JSON).
const CUOTA_A_CONCEPTO = {
  5: "Cuota Logopedia 60x2",
  6: "Cuota Logopedia 45x3",
  7: "Cuota Pedagogía 60x1",
  8: "Cuota Logopedia 30x1",
  9: "Cuota Logopedia 45x1",
  10: "Cuota Logopedia 60x1",
  11: "Cuota Logopedia 45x2",
  12: "Cuota Pedagogía 45x1",
  13: "Cuota Pedagogía 45x2",
  15: "Cuota Psicología 45x1",
  16: "Cuota Psicología 60x1",
  17: "Cuota Psicología 45x2",
  18: "Cuota T.O. 30x1",
  19: "Cuota T.O. 45x1",
  20: "Cuota T.O. 60x1",
  21: "Cuota T.O. 45x2",
  22: "Cuota Refuerzo / TT.EE. 1 día",
  23: "Cuota Refuerzo / TT.EE. 2 días",
  24: "Cuota Refuerzo / TT.EE. 3 días",
  25: "Cuota Refuerzo / TT.EE. 4 días",
  30: "Cuota HHSS",
  69: "Cuota T.O. 60+45",
  70: "Cuota Psicología 60x2",
  88: "Cuota Pedagogía 60x2",
  89: "Cuota T.O. 60x2",
  110: "Cuota HHSS 1h 30",
};

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const detalle = args.includes("--detalle");
  const slug = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : "aumenta";
  const desde = args.includes("--desde") ? args[args.indexOf("--desde") + 1] : "2026-09-01";
  const rutaJson = args.find((a) => !a.startsWith("--") && a !== slug && a !== desde);
  if (!rutaJson) { process.stderr.write("Uso: node scripts/conciliar-cuotas-zona-organizate.js <json> [--slug aumenta] [--desde AAAA-MM-DD] [--confirm] [--detalle]\n"); process.exit(1); }

  const zona = JSON.parse(readFileSync(rutaJson, "utf8"));
  const { models } = getTenantDb(slug);
  const { BillingConcept, Cuota, Patient } = models;

  // ── 1 y 2: precios y conceptos ───────────────────────────────────────────
  const conceptos = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"] });
  const porNombre = new Map(conceptos.map((c) => [c.name, c]));

  const cambiosPrecio = [];
  const aCrear = [];
  for (const [grupo, nombre] of Object.entries(CUOTA_A_CONCEPTO)) {
    const precio = Number(zona.precios?.[grupo]);
    if (!Number.isFinite(precio)) continue;
    const existente = porNombre.get(nombre);
    if (!existente) {
      const conMiembros = (zona.miembros.find((g) => String(g.id) === String(grupo))?.m ?? []).length;
      if (conMiembros > 0) aCrear.push({ nombre, precio });
      continue;
    }
    if (Math.abs(Number(existente.unitPrice) - precio) >= 0.005) {
      cambiosPrecio.push({ nombre, de: Number(existente.unitPrice), a: precio, id: existente.id });
    }
  }

  process.stdout.write(`\nPrecios a corregir (el Organízate manda): ${cambiosPrecio.length}\n`);
  for (const c of cambiosPrecio) process.stdout.write(`  · ${c.nombre}: ${c.de} € → ${c.a} €\n`);
  process.stdout.write(`Conceptos que faltan: ${aCrear.length}\n`);
  for (const c of aCrear) process.stdout.write(`  + ${c.nombre} — ${c.precio} €/mensual\n`);

  // ── 3: miembros ──────────────────────────────────────────────────────────
  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const pacientePorNombre = new Map();
  for (const p of pacientes) {
    const clave = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    if (!clave) continue;
    if (!pacientePorNombre.has(clave)) pacientePorNombre.set(clave, []);
    pacientePorNombre.get(clave).push(p);
  }

  const cuotasCrm = await Cuota.findAll({
    where: { active: true },
    attributes: ["id", "clientId", "patientId", "conceptIds"],
    raw: true,
  });
  // Cuántas veces cubre cada familia cada concepto (una fila con el concepto
  // dos veces son dos hermanos: cuenta dos).
  const cubiertas = new Map(); // `${clientId}|${nombreConcepto}` → n
  const idANombre = new Map(conceptos.map((c) => [String(c.id), c.name]));
  for (const fila of cuotasCrm) {
    for (const cid of Array.isArray(fila.conceptIds) ? fila.conceptIds : []) {
      const nombre = idANombre.get(String(cid));
      if (!nombre) continue;
      const clave = `${fila.clientId}|${nombre}`;
      cubiertas.set(clave, (cubiertas.get(clave) ?? 0) + 1);
    }
  }

  const nuevas = []; // { clientId, patientId, nombreConcepto, paciente }
  const noCasados = [];
  const ambiguos = [];
  const sinFamilia = [];
  const pendientes = new Map(cubiertas); // se va descontando

  for (const g of zona.miembros) {
    const nombreConcepto = CUOTA_A_CONCEPTO[g.id];
    if (!nombreConcepto) continue;
    for (const nombrePaciente of g.m) {
      const candidatos = pacientePorNombre.get(norm(nombrePaciente)) ?? [];
      const familias = new Set(candidatos.map((c) => c.clientId).filter(Boolean));
      if (!candidatos.length) { noCasados.push(`${nombrePaciente} (${nombreConcepto})`); continue; }
      if (familias.size > 1) { ambiguos.push(`${nombrePaciente} (${nombreConcepto})`); continue; }
      if (!familias.size) { sinFamilia.push(`${nombrePaciente} (${nombreConcepto})`); continue; }
      const clientId = [...familias][0];
      const clave = `${clientId}|${nombreConcepto}`;
      const cubre = pendientes.get(clave) ?? 0;
      if (cubre > 0) { pendientes.set(clave, cubre - 1); continue; } // ya está en el CRM
      nuevas.push({ clientId, patientId: candidatos[0].id, nombreConcepto, paciente: nombrePaciente });
    }
  }

  const familiasNuevas = new Set(nuevas.map((n) => n.clientId)).size;
  const totalZona = zona.miembros.reduce((s, g) => s + g.m.length, 0);
  process.stdout.write(`\nPertenencias en la Zona Pacientes: ${totalZona}\n`);
  process.stdout.write(`  · ya en el CRM: ${totalZona - nuevas.length - noCasados.length - ambiguos.length - sinFamilia.length}\n`);
  process.stdout.write(`  · a crear: ${nuevas.length} cuotas nuevas (${familiasNuevas} familias)\n`);
  process.stdout.write(`  · sin casar por nombre: ${noCasados.length} · ambiguos: ${ambiguos.length} · sin familia: ${sinFamilia.length}\n`);
  if (detalle) {
    for (const n of noCasados) process.stdout.write(`    ? sin casar: ${n}\n`);
    for (const n of ambiguos) process.stdout.write(`    ! ambiguo: ${n}\n`);
    for (const n of sinFamilia) process.stdout.write(`    ~ sin familia: ${n}\n`);
  }

  if (!confirm) {
    process.stdout.write("\n(EN SECO: nada escrito. Repite con --confirm para conciliar.)\n");
    process.exit(0);
  }

  for (const c of cambiosPrecio) {
    await BillingConcept.update({ unitPrice: c.a }, { where: { id: c.id } });
  }
  let orden = conceptos.length;
  for (const c of aCrear) {
    const creado = await BillingConcept.create({
      name: c.nombre,
      description: `Cuota mensual (Zona Pacientes del Organízate)`,
      unitPrice: c.precio,
      vatRate: 0,
      category: "Cuotas del Organízate",
      periodicity: "mensual",
      sortOrder: ++orden,
    });
    porNombre.set(c.nombre, creado);
  }
  let creadas = 0;
  for (const n of nuevas) {
    const concepto = porNombre.get(n.nombreConcepto);
    if (!concepto) continue;
    await Cuota.create({
      clientId: n.clientId,
      patientId: n.patientId,
      conceptIds: [String(concepto.id)],
      amount: null,
      method: null,
      startDate: desde,
      active: true,
      notes: "Zona Pacientes del Organízate (01/09/2026)",
    });
    creadas++;
  }
  process.stdout.write(`\n✓ ${cambiosPrecio.length} precios corregidos, ${aCrear.length} conceptos creados y ${creadas} cuotas nuevas dadas de alta.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
