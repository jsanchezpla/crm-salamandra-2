// @vivo — Comprueba que cada familia con reserva de plaza pagada en verano tiene su cobro de septiembre con los 30 € descontados y cuadra con la Caja de Organízate; con --corregir --confirm vuelve a descontarla donde Organízate la cobró entera. Se corrió en aumenta el 02/09/2026 (noche).
/**
 * comprobar-reservas-septiembre.js — ¿cuadran las familias con reserva de
 * plaza? (02/09/2026, Rodrigo: «revisa que las familias con reserva de 30 €
 * cuadren»).
 *
 * Solo lee (salvo --corregir --confirm). Por cada nombre del grupo «RESERVAS
 * DE PLAZA CURSO 2026-2027» de Organízate: su paciente en el CRM → su familia
 * → N reservas por familia. Para cada familia:
 *   · lo que valen sus cuotas del CRM al mes (importeDeCuota, la misma pieza
 *     que genera el mes) → esperado en septiembre = cuotas − 30 × N;
 *   · lo que tiene en septiembre en el CRM (cobros del mes, cobrados y
 *     pendientes);
 *   · lo que dice la Caja de Organízate para sus pacientes (líneas de cuota
 *     pagadas y pendientes del volcado `caja-organizate.json`, si se pasa).
 * Y clasifica: cuadra (CRM = cuotas − 30N), sin descuento (CRM = cuotas
 * enteras), otra cifra, sin cobro de septiembre, sin cuota en el CRM, nombre
 * sin casar. Con --detalle lista las familias que no cuadran (id corto, sin
 * nombres).
 *
 * --corregir: en las familias SIN DESCUENTO —Organízate les cobra la cuota
 * entera y el volcado de la Caja alineó el CRM a eso— vuelve a restar los
 * 30 × N del cobro pendiente mayor, con la nota escrita; si ya han pagado la
 * cuota entera, no se toca el importe: se les deja en la nota que hay 30 € a
 * compensar. En seco salvo --confirm. Auditoría payment.updated.
 *
 * Uso VPS:
 *   docker exec crm-salamandra-app-1 node scripts/comprobar-reservas-septiembre.js /tmp/migracion-aumenta/reservas-plaza.json [--caja /tmp/migracion-aumenta/caja-organizate.json] [--slug aumenta] [--mes 2026-09] [--importe 30] [--detalle] [--corregir [--confirm]]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterModels } from "../lib/db/masterDb.js";
import { importeDeCuota } from "../lib/billing/cuotas.js";
import { logBillingAudit } from "../lib/billing/audit.js";

const args = process.argv.slice(2);
const DETALLE = args.includes("--detalle");
const CORREGIR = args.includes("--corregir");
const CONFIRM = args.includes("--confirm");
const valorDe = (flag, porDefecto) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : porDefecto);
const SLUG = valorDe("--slug", "aumenta");
const MES = valorDe("--mes", "2026-09");
const IMPORTE = Number(valorDe("--importe", "30"));
const CAJA = valorDe("--caja", null);
const RUTA = args.find((a) => !a.startsWith("--") && ![SLUG, MES, String(IMPORTE), CAJA].includes(a));
if (!RUTA) {
  process.stderr.write("Uso: node scripts/comprobar-reservas-septiembre.js <reservas.json> [--caja <caja.json>] [--slug] [--mes] [--importe] [--detalle] [--corregir [--confirm]]\n");
  process.exit(1);
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const eur = (n) => `${round2(n).toFixed(2)} €`;
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };
const ALTAS_POSTERIORES = { 1266: "Lucas Gabriel Ginghina Gorga", 1269: "Leo Machio Díez de Baldeón", 1270: "GUILLERMO Muñoz Nieto", 1271: "Lucas Herranz Fernández" };

async function main() {
  const { models } = getTenantDb(SLUG);
  const { Patient, Payment, Cuota, BillingConcept } = models;
  const { reservas } = JSON.parse(readFileSync(RUTA, "utf8"));
  const periodo = `${MES}-01`;

  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const porNombre = new Map();
  for (const p of pacientes) { const k = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`); if (k && !porNombre.has(k)) porNombre.set(k, p); }

  // Reservas → familia (N por familia).
  const reservasPorFamilia = new Map();
  const sinCasar = [];
  for (const nombre of reservas) {
    const p = porNombre.get(norm(nombre));
    if (!p || !p.clientId) { sinCasar.push(nombre); continue; }
    const f = String(p.clientId);
    reservasPorFamilia.set(f, (reservasPorFamilia.get(f) ?? 0) + 1);
  }

  // Cuotas y conceptos del CRM → lo que vale el mes por familia.
  const conceptos = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"], raw: true });
  const porId = new Map(conceptos.map((c) => [String(c.id), { ...c, amount: Number(c.unitPrice) }]));
  const cuotas = await Cuota.findAll({ where: { active: true }, raw: true });
  const cuotaMensualPorFamilia = new Map();
  for (const q of cuotas) {
    const f = String(q.clientId);
    let importe = 0;
    try { ({ importe } = importeDeCuota({ ...q, amount: q.amount == null ? null : Number(q.amount) }, porId)); } catch { importe = Number(q.amount) || 0; }
    cuotaMensualPorFamilia.set(f, round2((cuotaMensualPorFamilia.get(f) ?? 0) + Number(importe || 0)));
  }

  // Cobros del mes por familia.
  const cobros = await Payment.findAll({ where: { periodMonth: periodo }, raw: true });
  const crmPorFamilia = new Map();
  for (const c of cobros) {
    const f = String(c.clientId);
    const acc = crmPorFamilia.get(f) ?? { total: 0, cobrado: 0, pendiente: 0, n: 0, conNota: 0 };
    acc.total = round2(acc.total + Number(c.amount)); acc.n++;
    if (c.status === "completed") acc.cobrado = round2(acc.cobrado + Number(c.amount)); else if (c.status === "pending") acc.pendiente = round2(acc.pendiente + Number(c.amount));
    if (/reserva/i.test(String(c.notes ?? ""))) acc.conNota++;
    crmPorFamilia.set(f, acc);
  }

  // La Caja de Organízate por familia (líneas de cuota, pagadas y pendientes).
  const orgPorFamilia = new Map();
  if (CAJA) {
    const caja = JSON.parse(readFileSync(CAJA, "utf8")).caja;
    const fichas = JSON.parse(readFileSync(path.join(path.dirname(CAJA), "pacientes-limpio.json"), "utf8")).fichas;
    const nombrePorId = new Map(fichas.map((f) => [Number(f.id_pac), `${f.nombre ?? ""} ${f.apellidos ?? ""}`]));
    for (const [id, n] of Object.entries(ALTAS_POSTERIORES)) nombrePorId.set(Number(id), n);
    for (const l of caja) if (l[4] != null && l[6] && !nombrePorId.has(Number(l[4]))) nombrePorId.set(Number(l[4]), l[6]);
    for (const [estado, , tipo, importe, idPac] of caja) {
      if (tipo !== "G") continue;
      const nombre = nombrePorId.get(DOBLES[Number(idPac)] ?? Number(idPac));
      const p = nombre ? porNombre.get(norm(nombre)) : null;
      if (!p?.clientId) continue;
      const f = String(p.clientId);
      const acc = orgPorFamilia.get(f) ?? { total: 0, pagado: 0, pendiente: 0 };
      acc.total = round2(acc.total + importe);
      if (estado === "P") acc.pagado = round2(acc.pagado + importe); else acc.pendiente = round2(acc.pendiente + importe);
      orgPorFamilia.set(f, acc);
    }
  }

  // Clasificar.
  const cat = { cuadra: [], sinDescuento: [], otraCifra: [], sinCobro: [], sinCuota: [] };
  for (const [f, n] of reservasPorFamilia) {
    const crm = crmPorFamilia.get(f) ?? null;
    const cuota = cuotaMensualPorFamilia.get(f) ?? null;
    const org = orgPorFamilia.get(f) ?? null;
    const esperado = cuota != null ? round2(cuota - IMPORTE * n) : null;
    const fila = { fid: f, f: f.slice(0, 8), n, cuota, esperado, crm: crm?.total ?? null, cobrado: crm?.cobrado ?? 0, org: org?.total ?? null, notas: crm?.conNota ?? 0 };
    if (!crm) { cat.sinCobro.push(fila); continue; }
    if (cuota == null) { cat.sinCuota.push(fila); continue; }
    if (Math.abs(crm.total - esperado) < 0.011) cat.cuadra.push(fila);
    else if (Math.abs(crm.total - cuota) < 0.011) cat.sinDescuento.push(fila);
    else cat.otraCifra.push(fila);
  }
  const desacuerdoOrg = [...reservasPorFamilia.keys()].filter((f) => orgPorFamilia.has(f) && crmPorFamilia.has(f) && Math.abs(orgPorFamilia.get(f).total - crmPorFamilia.get(f).total) > 0.011).length;
  const orgSinDescuento = [...reservasPorFamilia.entries()].filter(([f, n]) => orgPorFamilia.has(f) && cuotaMensualPorFamilia.has(f) && Math.abs(orgPorFamilia.get(f).total - cuotaMensualPorFamilia.get(f)) < 0.011 && n > 0).length;

  process.stdout.write(`\n▶ Reservas de plaza (${IMPORTE} €) contra septiembre · ${SLUG}${CORREGIR ? (CONFIRM ? " · CORRIGIENDO" : " · corrección EN SECO") : ""}\n`);
  process.stdout.write(`  nombres en el grupo: ${reservas.length} · casados: ${reservas.length - sinCasar.length} · familias con reserva: ${reservasPorFamilia.size} (${[...reservasPorFamilia.values()].filter((n) => n > 1).length} con más de una)\n`);
  process.stdout.write(`  sin casar por nombre: ${sinCasar.length}\n\n`);
  process.stdout.write(`  CUADRAN (CRM = cuota − ${IMPORTE}×N)            ${cat.cuadra.length}\n`);
  process.stdout.write(`  SIN DESCUENTO (CRM = cuota entera)         ${cat.sinDescuento.length}\n`);
  process.stdout.write(`  OTRA CIFRA (ni una ni otra)                ${cat.otraCifra.length}\n`);
  process.stdout.write(`  Sin cobro de septiembre en el CRM           ${cat.sinCobro.length}\n`);
  process.stdout.write(`  Con cobro pero sin cuota activa en el CRM   ${cat.sinCuota.length}\n`);
  process.stdout.write(`  Familias con reserva cuyo total CRM ≠ Organízate: ${desacuerdoOrg} · Organízate sin descontar (= cuota entera): ${orgSinDescuento}\n`);
  const cobradas = [...reservasPorFamilia.keys()].filter((f) => (crmPorFamilia.get(f)?.cobrado ?? 0) > 0).length;
  process.stdout.write(`  Familias con reserva que ya han pagado algo de septiembre: ${cobradas}\n\n`);
  if (DETALLE) {
    const pinta = (l) => l.slice(0, 40).map((x) => `      ${x.f} · N=${x.n} · cuota ${x.cuota == null ? "?" : eur(x.cuota)} · esperado ${x.esperado == null ? "?" : eur(x.esperado)} · CRM ${x.crm == null ? "—" : eur(x.crm)} (cobrado ${eur(x.cobrado)}) · Organízate ${x.org == null ? "—" : eur(x.org)} · notas reserva ${x.notas}`).join("\n");
    if (cat.sinDescuento.length) process.stdout.write(`  SIN DESCUENTO:\n${pinta(cat.sinDescuento)}\n\n`);
    if (cat.otraCifra.length) process.stdout.write(`  OTRA CIFRA:\n${pinta(cat.otraCifra)}\n\n`);
    if (cat.sinCuota.length) process.stdout.write(`  SIN CUOTA ACTIVA:\n${pinta(cat.sinCuota)}\n\n`);
    if (cat.sinCobro.length) process.stdout.write(`  SIN COBRO (primeras):\n${pinta(cat.sinCobro.slice(0, 15))}\n\n`);
    if (sinCasar.length) process.stdout.write(`  Sin casar: ${sinCasar.length} nombres (se listan solo iniciales): ${sinCasar.map((n) => n.split(/\s+/).map((w) => w[0]).join(".")).join(", ")}\n\n`);
  }

  // ── --listar: la tabla con nombres, para el despacho ─────────────────────
  // Una línea por familia con reserva: categoría, familia, pacientes con
  // reserva, N, cuota, CRM (cobrado), Organízate y si esta noche se le volvió
  // a descontar o se le anotó la compensación. Sale por stdout en TSV para
  // guardarla en un fichero fuera del repo, nunca para pegarla en un chat.
  if (args.includes("--listar")) {
    const { Client } = models;
    const clientes = new Map((await Client.findAll({ attributes: ["id", "name"], raw: true })).map((c) => [String(c.id), c.name]));
    const nombresPorFamilia = new Map();
    for (const nombre of reservas) {
      const p = porNombre.get(norm(nombre));
      if (!p?.clientId) continue;
      const f = String(p.clientId);
      if (!nombresPorFamilia.has(f)) nombresPorFamilia.set(f, []);
      nombresPorFamilia.get(f).push(nombre);
    }
    const marcaDe = (f) => {
      const notas = cobros.filter((c) => String(c.clientId) === f).map((c) => String(c.notes ?? "")).join(" | ");
      if (/vuelta a descontar/.test(notas)) return "vuelta a descontar";
      if (/a compensar/.test(notas)) return "a compensar";
      return "";
    };
    const filas = [];
    for (const [categoria, lista] of Object.entries(cat)) {
      for (const x of lista) filas.push([categoria, clientes.get(x.fid) ?? x.fid, (nombresPorFamilia.get(x.fid) ?? []).join(" / "), x.n, x.cuota ?? "", x.crm ?? "", x.cobrado ?? 0, x.org ?? "", marcaDe(x.fid)]);
    }
    filas.sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es"));
    process.stdout.write("__TSV__\n");
    process.stdout.write(["categoria", "familia", "pacientes", "reservas", "cuota", "crm", "cobrado", "organizate", "marca"].join("\t") + "\n");
    for (const f of filas) process.stdout.write(f.join("\t") + "\n");
    process.stdout.write("__FIN__\n");
  }

  // ── --marcar: la lista, dentro del CRM ───────────────────────────────────
  // Escribe en `clients.custom_fields.reservaPlaza` lo que sabe de cada familia
  // con reserva (cuántas, qué pacientes, cuota, septiembre en el CRM y en
  // Organízate, y el aviso si hay algo que mirar). De ahí la lee la carpeta
  // «reserva_plaza» de Fichas a completar (lib/clients/urgentes.js). En seco
  // salvo --confirm. Se puede repetir: pisa la clave, no el resto de campos.
  if (args.includes("--marcar")) {
    const { Client } = models;
    const clientes = await Client.findAll({ attributes: ["id", "customFields"], raw: true });
    const porCliente = new Map(clientes.map((c) => [String(c.id), c]));
    const nombresPorFamilia = new Map();
    for (const nombre of reservas) {
      const p = porNombre.get(norm(nombre));
      if (!p?.clientId) continue;
      const f = String(p.clientId);
      if (!nombresPorFamilia.has(f)) nombresPorFamilia.set(f, []);
      nombresPorFamilia.get(f).push(nombre);
    }
    const avisoDe = (fid, categoria) => {
      const notas = cobros.filter((c) => String(c.clientId) === fid).map((c) => String(c.notes ?? "")).join(" | ");
      if (/vuelta a descontar/.test(notas)) return "vuelta a descontar el 02/09";
      if (/a compensar/.test(notas)) return "pagó entero: 30 € a compensar";
      if (categoria === "sinDescuento") return "sin descuento";
      if (categoria === "sinCobro") return "sin cobro de septiembre";
      if (categoria === "sinCuota") return "sin cuota en el CRM";
      return null;
    };
    const SITUACION = { cuadra: "cuadra", sinDescuento: "sin descuento", otraCifra: "otra cifra", sinCobro: "sin cobro de septiembre", sinCuota: "sin cuota activa" };
    const marcas = [];
    for (const [categoria, lista] of Object.entries(cat)) {
      for (const x of lista) {
        const pacientesRes = nombresPorFamilia.get(x.fid) ?? [];
        const resumen = [
          `${x.n} reserva${x.n > 1 ? "s" : ""} (${pacientesRes.join(", ")})`,
          x.cuota != null ? `cuota ${eur(x.cuota)}` : "sin cuota",
          x.crm != null ? `septiembre CRM ${eur(x.crm)}${x.cobrado ? ` (cobrado ${eur(x.cobrado)})` : ""}` : "sin cobro de septiembre",
          x.org != null ? `Organízate ${eur(x.org)}` : null,
        ].filter(Boolean).join(" · ");
        marcas.push({ fid: x.fid, valor: { curso: "2026-2027", importe: IMPORTE, reservas: x.n, pacientes: pacientesRes, cuota: x.cuota, septiembreCrm: x.crm, cobrado: x.cobrado, organizate: x.org, situacion: SITUACION[categoria], aviso: avisoDe(x.fid, categoria), resumen, fecha: "2026-09-02" } });
      }
    }
    process.stdout.write(`  Marcar en la ficha (custom_fields.reservaPlaza): ${marcas.length} familias · con aviso: ${marcas.filter((m) => m.valor.aviso).length}${CONFIRM ? "" : "  (EN SECO)"}\n`);
    if (CONFIRM) {
      let n = 0;
      for (const m of marcas) {
        const actual = porCliente.get(m.fid);
        if (!actual) continue;
        const cf = actual.customFields && typeof actual.customFields === "object" && !Array.isArray(actual.customFields) ? actual.customFields : {};
        await Client.update({ customFields: { ...cf, reservaPlaza: m.valor } }, { where: { id: m.fid } });
        n++;
      }
      process.stdout.write(`  ✓ ${n} fichas marcadas\n`);
    }
    if (!CORREGIR) process.exit(0);
  }

  if (!CORREGIR) process.exit(0);

  // ── Corregir las SIN DESCUENTO ───────────────────────────────────────────
  const plan = { descontar: [], compensar: [], sinPendiente: [] };
  for (const fila of cat.sinDescuento) {
    const suyos = cobros.filter((c) => String(c.clientId) === fila.fid);
    const pendientes = suyos.filter((c) => c.status === "pending" && c.cuotaId).sort((a, b) => Number(b.amount) - Number(a.amount));
    const cobradosF = suyos.filter((c) => c.status === "completed").sort((a, b) => Number(b.amount) - Number(a.amount));
    let descuento = round2(IMPORTE * fila.n);
    if (fila.cobrado > 0 && cobradosF.length) {
      // Ya han pagado la cuota entera: se deja dicho en el cobro mayor.
      plan.compensar.push({ fila, cobro: cobradosF[0], importe: descuento });
      continue;
    }
    if (!pendientes.length) { plan.sinPendiente.push(fila); continue; }
    for (const cobro of pendientes) {
      if (descuento <= 0) break;
      const cabe = round2(Math.min(descuento, Number(cobro.amount) - 0.01));
      if (cabe <= 0) continue;
      plan.descontar.push({ fila, cobro, cabe, nuevo: round2(Number(cobro.amount) - cabe) });
      descuento = round2(descuento - cabe);
    }
  }
  process.stdout.write(`  Corrección: descontar en ${plan.descontar.length} cobro(s) pendiente(s) (−${eur(plan.descontar.reduce((s, x) => s + x.cabe, 0))}) · ya pagados enteros, a compensar: ${plan.compensar.length} (${eur(plan.compensar.reduce((s, x) => s + x.importe, 0))}) · sin cobro pendiente donde descontar: ${plan.sinPendiente.length}\n`);
  if (DETALLE) {
    for (const d of plan.descontar) process.stdout.write(`      ${d.fila.f} · ${eur(d.cobro.amount)} → ${eur(d.nuevo)}\n`);
    for (const c of plan.compensar) process.stdout.write(`      ${c.fila.f} · pagado ${eur(c.cobro.amount)} entero · ${eur(c.importe)} a compensar\n`);
  }
  if (!CONFIRM) { process.stdout.write("  EN SECO: no se ha escrito nada. Con --confirm se ejecuta.\n\n"); process.exit(0); }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG }, attributes: ["id"] });
  const auditar = (entityId, before, after) => logBillingAudit({ tenantId: tenant?.id ?? null, userId: null, action: "payment.updated", entity: "Payment", entityId, before, after: { ...after, via: "script:comprobar-reservas-septiembre" }, ip: null });
  let hechos = 0;
  for (const d of plan.descontar) {
    const etiqueta = d.fila.n === 1 ? `Reserva de plaza ya abonada: −${eur(d.cabe)}` : `${d.fila.n} reservas de plaza ya abonadas: −${eur(d.cabe)}`;
    const notes = `${d.cobro.notes ? `${d.cobro.notes} — ` : ""}${etiqueta} (vuelta a descontar el 02/09/2026: Organízate la cobraba entera)`;
    await Payment.update({ amount: d.nuevo, notes: notes.slice(0, 2000) }, { where: { id: d.cobro.id } });
    await auditar(d.cobro.id, { amount: Number(d.cobro.amount) }, { amount: d.nuevo });
    hechos++;
  }
  for (const c of plan.compensar) {
    const notes = `${c.cobro.notes ? `${c.cobro.notes} — ` : ""}Cobrado sin descontar la reserva de plaza (${eur(c.importe)}): a compensar en el próximo mes (02/09/2026)`;
    await Payment.update({ notes: notes.slice(0, 2000) }, { where: { id: c.cobro.id } });
    await auditar(c.cobro.id, { notes: String(c.cobro.notes ?? "").slice(0, 200) }, { nota: "reserva a compensar" });
    hechos++;
  }
  process.stdout.write(`  ✓ ${hechos} cobro(s) tocados\n\n`);
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`); process.exit(1); });
