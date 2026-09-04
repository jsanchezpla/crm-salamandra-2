// @vivo — Compara, familia a familia, lo COBRADO y lo PENDIENTE de septiembre entre la Caja de Organízate y los cobros del CRM. Solo lectura: no escribe nada. Se usó el 04/09/2026 tras volcar los cobros de la contable.
/**
 * comparar-cobros-organizate.js — el cuadre de los cobros (04/09/2026).
 *
 * Rodrigo (04/09): «comparar para asegurarnos de que todo está registrado bien
 * en el CRM: todos los cobros de septiembre tanto COBRADOS como PENDIENTES
 * tienen que salir en el CRM + los que han sido COBRADOS en el CRM».
 *
 * SOLO LEE. Cruza por FAMILIA (que es como cobra el CRM: un cobro por cuota
 * asignada) las líneas de la Caja de Organízate contra `payments` del mes, y
 * dice dónde no cuadran y por qué. Los nombres salen en INICIALES: esto se
 * lee en un chat.
 *
 * Uso:
 *   docker exec crm-salamandra-app-1 node scripts/comparar-cobros-organizate.js /tmp/migracion-aumenta/caja-organizate.json [--slug aumenta] [--mes 2026-09] [--detalle]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const DETALLE = args.includes("--detalle");
const valorDe = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const SLUG = valorDe("--slug", "aumenta");
const MES = valorDe("--mes", "2026-09");
const RUTA = args.find((a) => !a.startsWith("--") && a !== SLUG && a !== MES);
if (!RUTA) { process.stderr.write("Falta el JSON de la Caja\n"); process.exit(1); }

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const eur = (n) => `${round2(n).toFixed(2)} €`;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const ini = (s) => norm(s).split(" ").filter(Boolean).map((w) => w[0]).join(".");
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };
const ALTAS_POSTERIORES = { 1266: "Lucas Gabriel Ginghina Gorga", 1269: "Leo Machio Díez de Baldeón", 1270: "GUILLERMO Muñoz Nieto", 1271: "Lucas Herranz Fernández" };

async function main() {
  const datos = JSON.parse(readFileSync(RUTA, "utf8"));
  const fichas = JSON.parse(readFileSync(path.join(path.dirname(RUTA), "pacientes-limpio.json"), "utf8")).fichas;
  const { models } = getTenantDb(SLUG);
  const { Patient, Payment } = models;

  const nombrePorId = new Map(fichas.map((f) => [Number(f.id_pac), `${f.nombre ?? ""} ${f.apellidos ?? ""}`]));
  for (const [id, n] of Object.entries(ALTAS_POSTERIORES)) nombrePorId.set(Number(id), n);
  for (const f of datos.caja) if (f[4] != null && f[6] && !nombrePorId.has(Number(f[4]))) nombrePorId.set(Number(f[4]), f[6]);

  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    if (k && !porNombre.has(k)) porNombre.set(k, p);
  }
  const pacienteDe = (idPac, nombreFila) => {
    const nombre = nombrePorId.get(DOBLES[Number(idPac)] ?? Number(idPac)) ?? nombreFila ?? null;
    return nombre ? porNombre.get(norm(nombre)) ?? null : null;
  };

  // ── Organízate por familia ───────────────────────────────────────────────
  const org = new Map(); // familia → { pagado, pendiente, nombre, noCuota:{pagado,pendiente} }
  const sinPaciente = [];
  for (const [estado, , tipo, importe, idPac, idLinea, nombreFila] of datos.caja) {
    if (tipo === "C" && round2(importe) <= 0) continue; // sesión de cuota
    const p = pacienteDe(idPac, nombreFila);
    const nombre = nombrePorId.get(DOBLES[Number(idPac)] ?? Number(idPac)) ?? nombreFila ?? `id_pac ${idPac}`;
    if (!p?.clientId) { sinPaciente.push({ estado, tipo, importe, idLinea, nombre }); continue; }
    const k = String(p.clientId);
    if (!org.has(k)) org.set(k, { pagado: 0, pendiente: 0, nombre, noCuotaPagado: 0, noCuotaPendiente: 0 });
    const o = org.get(k);
    const cuota = tipo === "G";
    if (estado === "P") { o.pagado += Number(importe); if (!cuota) o.noCuotaPagado += Number(importe); }
    else { o.pendiente += Number(importe); if (!cuota) o.noCuotaPendiente += Number(importe); }
  }

  // ── CRM por familia ──────────────────────────────────────────────────────
  const cobros = await Payment.findAll({ where: { periodMonth: `${MES}-01` }, raw: true });
  const crm = new Map();
  for (const c of cobros) {
    const k = String(c.clientId);
    if (!crm.has(k)) crm.set(k, { cobrado: 0, pendiente: 0, n: 0 });
    const x = crm.get(k);
    x.n++;
    if (c.status === "completed") x.cobrado += Number(c.amount);
    else if (c.status === "pending") x.pendiente += Number(c.amount);
  }

  // ── Cuadre ───────────────────────────────────────────────────────────────
  const familias = new Set([...org.keys(), ...crm.keys()]);
  const difCobrado = [], difPendiente = [], soloCrm = [];
  let tot = { orgPagado: 0, orgPend: 0, crmCobrado: 0, crmPend: 0 };
  for (const k of familias) {
    const o = org.get(k) ?? { pagado: 0, pendiente: 0, nombre: "(sin líneas)", noCuotaPagado: 0, noCuotaPendiente: 0 };
    const c = crm.get(k) ?? { cobrado: 0, pendiente: 0, n: 0 };
    tot.orgPagado += o.pagado; tot.orgPend += o.pendiente;
    tot.crmCobrado += c.cobrado; tot.crmPend += c.pendiente;
    if (!org.has(k)) { if (c.cobrado || c.pendiente) soloCrm.push({ k, ...c }); continue; }
    if (round2(o.pagado) !== round2(c.cobrado)) difCobrado.push({ nombre: o.nombre, org: o.pagado, crm: c.cobrado, noCuota: o.noCuotaPagado });
    if (round2(o.pendiente) !== round2(c.pendiente)) difPendiente.push({ nombre: o.nombre, org: o.pendiente, crm: c.pendiente, noCuota: o.noCuotaPendiente });
  }

  const w = (s) => process.stdout.write(s);
  w(`\n▶ Cuadre de cobros ${MES} · ${SLUG} (solo lectura)\n\n`);
  w(`  ${"".padEnd(12)} ${"Organízate".padStart(13)} ${"CRM".padStart(13)} ${"dif".padStart(11)}\n`);
  w(`  ${"COBRADO".padEnd(12)} ${eur(tot.orgPagado).padStart(13)} ${eur(tot.crmCobrado).padStart(13)} ${eur(tot.crmCobrado - tot.orgPagado).padStart(11)}\n`);
  w(`  ${"PENDIENTE".padEnd(12)} ${eur(tot.orgPend).padStart(13)} ${eur(tot.crmPend).padStart(13)} ${eur(tot.crmPend - tot.orgPend).padStart(11)}\n\n`);
  w(`  Familias: Organízate ${org.size} · CRM ${crm.size} · cobros del CRM ${cobros.length}\n`);
  w(`  Familias que NO cuadran: cobrado ${difCobrado.length} · pendiente ${difPendiente.length}\n`);
  w(`  Familias con cobros en el CRM y sin líneas en Organízate: ${soloCrm.length} (${eur(soloCrm.reduce((s, x) => s + x.cobrado + x.pendiente, 0))})\n`);
  w(`  Líneas de Organízate sin paciente en el CRM: ${sinPaciente.length}\n\n`);

  const pinta = (titulo, lista) => {
    if (!lista.length) return;
    w(`  ${titulo}\n`);
    for (const x of lista.sort((a, b) => Math.abs(b.org - b.crm) - Math.abs(a.org - a.crm)).slice(0, DETALLE ? 60 : 12)) {
      const nota = x.noCuota ? `  (de ellos ${eur(x.noCuota)} no son cuota: bono/cita/informe)` : "";
      w(`     ${ini(x.nombre).padEnd(10)} Organízate ${eur(x.org).padStart(10)} · CRM ${eur(x.crm).padStart(10)} · dif ${eur(x.crm - x.org).padStart(10)}${nota}\n`);
    }
    w("\n");
  };
  pinta("COBRADO que no cuadra:", difCobrado);
  pinta("PENDIENTE que no cuadra:", difPendiente);
  if (soloCrm.length) {
    w("  Solo en el CRM (sin líneas en Organízate):\n");
    for (const x of soloCrm.slice(0, DETALLE ? 40 : 10)) w(`     familia ${x.k.slice(0, 8)} · cobrado ${eur(x.cobrado)} · pendiente ${eur(x.pendiente)} · ${x.n} cobro(s)\n`);
    w("\n");
  }
  if (sinPaciente.length) {
    w("  Sin paciente en el CRM:\n");
    for (const x of sinPaciente.slice(0, 20)) w(`     ${x.estado === "P" ? "pagada" : "pendiente"} ${x.tipo} ${eur(x.importe)} · ${ini(x.nombre)} · línea #${x.idLinea}\n`);
    w("\n");
  }
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`\n✗ ${e.message}\n${e.stack}\n`); process.exit(1); });
