// @vivo — Vuelca al CRM los cobros de la Caja de Organízate (pagados y pendientes) casándolos POR FAMILIA con los cobros de cuota del mes. Se ejecutó en aumenta el 02/09/2026 (noche); se repite si el centro vuelve a cobrar por Organízate, que no debería.
/**
 * volcar-cobros-organizate.js — lo COBRADO y lo PENDIENTE de la Caja de
 * Organízate, al CRM (02/09/2026, Rodrigo: «asegúrate de que lo cobrado
 * también se ha pasado… los cobros que han hecho estos días además de los que
 * tienen pendientes por hacer, y que las reservas de 30 € estén bien
 * colocadas»).
 *
 * ── Qué entra ──────────────────────────────────────────────────────────────
 * Un JSON extraído de la Caja de Organízate con la sesión de Chrome:
 *   · `caja`: cada línea de la pestaña Pagados (P) o Morosidad (M) de un día:
 *     [P|M, "dd/mm", G|C|B (grupo = cuota, cita, bono), importe, id_pac,
 *      id de la línea en Organízate, nombre (solo altas posteriores al volcado
 *      de fichas)].
 *   · `resumen`: los PAGOS (un pago puede cubrir varias líneas) con fecha,
 *     paciente, concepto, importe EN CÉNTIMOS y forma de pago (T
 *     transferencia, J tarjeta, E efectivo, D domiciliación).
 *   · `pagos`: las líneas de cada pago (fecha, concepto, importe en euros).
 *
 * ── Por qué se casa POR FAMILIA y no línea a línea ─────────────────────────
 * En Organízate cada cuota de cada niño es una línea (HHSS 65 €, Logopedia
 * 130 €…); en el CRM la familia tiene un cobro por cuota asignada, y una
 * cuota puede ser compuesta («Logopedia 45x1 + Psicología 45x1», 260 €). Así
 * que primero se casan las líneas que tienen un cobro del mismo importe
 * (mismo paciente si se puede), y lo que sobra se CONSOLIDA: el cobro
 * pendiente mayor de la familia se queda con lo que Organízate dice que
 * queda por pagar, y lo que Organízate dice que YA está pagado se marca
 * cobrado (o se crea cobrado si no hay cobro que lo lleve). Organízate ya
 * lleva descontada la reserva de plaza en sus importes: manda su importe, y
 * el que tenía el CRM se apunta en la nota.
 *
 * ── Qué hace, EN SECO por defecto (--confirm para escribir) ────────────────
 *   · Línea PAGADA de cuota con cobro pendiente del mismo importe → cobrado,
 *     con la fecha y la forma de pago del pago de Organízate que la cubre.
 *   · Línea PENDIENTE de cuota con cobro pendiente del mismo importe → nada.
 *   · Lo que no casa, por familia: el cobro mayor se alinea al pendiente de
 *     Organízate; lo pagado sobrante se marca en ese cobro (si no queda nada
 *     pendiente) o se crea como cobro nuevo cobrado; sin cobro en el CRM, se
 *     crean el pendiente y el cobrado que digan las líneas.
 *   · Citas pagadas con importe > 0 y bonos pagados → cobro nuevo cobrado
 *     (las citas a 0 € son sesiones de cuota: nada). Citas y bonos pendientes
 *     solo se listan.
 *   · Cobros del CRM que sobran en una familia (no hay línea que los
 *     explique) se listan, no se tocan.
 *
 * Idempotente: cada línea deja «Organízate #<id>» en la nota del cobro y no se
 * vuelve a aplicar. Auditoría: payment.updated / payment.created, como el panel.
 *
 * Uso VPS (docker cp del JSON al contenedor):
 *   docker exec crm-salamandra-app-1 node scripts/volcar-cobros-organizate.js /tmp/migracion-aumenta/caja-organizate.json [--slug aumenta] [--mes 2026-09] [--confirm] [--detalle]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterModels } from "../lib/db/masterDb.js";
import { logBillingAudit } from "../lib/billing/audit.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const valorDe = (flag, porDefecto) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : porDefecto);
const SLUG = valorDe("--slug", "aumenta");
const MES = valorDe("--mes", "2026-09");
const RUTA = args.find((a) => !a.startsWith("--") && a !== SLUG && a !== MES);
if (!RUTA) {
  process.stderr.write("Uso: node scripts/volcar-cobros-organizate.js <caja.json> [--slug] [--mes AAAA-MM] [--confirm] [--detalle]\n");
  process.exit(1);
}
const DATOS = path.dirname(RUTA);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const FORMA = { T: "transfer", J: "card", E: "cash", D: "direct_debit" };
const eur = (n) => `${round2(n).toFixed(2)} €`;

/** Fichas dobles del origen y altas posteriores al volcado de fichas del 02/08 (mismas tablas que actualizar-agenda-organizate.js, más el 1266, al que el centro completó los apellidos en el CRM). */
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };
const ALTAS_POSTERIORES = {
  1266: "Lucas Gabriel Ginghina Gorga",
  1269: "Leo Machio Díez de Baldeón",
  1270: "GUILLERMO Muñoz Nieto",
  1271: "Lucas Herranz Fernández",
};

/** dd/mm del año del mes pedido → Date a mediodía de Madrid. */
function fechaDe(ddmm, anio) {
  const [d, m] = ddmm.split("/").map(Number);
  return new Date(Date.UTC(anio, m - 1, d, 10, 0, 0));
}
const ddmmDe = (fecha) => fecha.toISOString().slice(0, 10).split("-").reverse().join("/");
const anioDe = (mes) => Number(mes.slice(0, 4));
const mesDe = (ddmm, anio) => `${anio}-${ddmm.slice(3, 5)}-01`;
const suma = (l, k = "importe") => round2(l.reduce((s, x) => s + Number(x[k]), 0));

async function main() {
  const { models } = getTenantDb(SLUG);
  const { Patient, Payment, Cuota } = models;
  const datos = JSON.parse(readFileSync(RUTA, "utf8"));
  const fichas = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const anio = anioDe(MES);
  const periodo = `${MES}-01`;

  // ── Nombre por id de Organízate ──────────────────────────────────────────
  const nombrePorId = new Map(fichas.map((f) => [Number(f.id_pac), `${f.nombre ?? ""} ${f.apellidos ?? ""}`]));
  for (const [id, n] of Object.entries(ALTAS_POSTERIORES)) nombrePorId.set(Number(id), n);
  for (const fila of datos.caja) if (fila[4] != null && fila[6] && !nombrePorId.has(Number(fila[4]))) nombrePorId.set(Number(fila[4]), fila[6]);

  // ── Pacientes del CRM por nombre ─────────────────────────────────────────
  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    if (k && !porNombre.has(k)) porNombre.set(k, p);
  }
  const pacienteDe = (idPac, nombreFila) => {
    const id = DOBLES[Number(idPac)] ?? Number(idPac);
    const nombre = nombrePorId.get(id) ?? nombreFila ?? null;
    if (!nombre) return null;
    return porNombre.get(norm(nombre)) ?? null;
  };

  // ── Cobros del CRM del mes ───────────────────────────────────────────────
  const cobros = await Payment.findAll({ where: { periodMonth: periodo } });
  const yaVolcados = new Set();
  for (const c of cobros) for (const m of String(c.notes ?? "").matchAll(/Organízate #(\d+)/g)) yaVolcados.add(Number(m[1]));
  const pendientesPorFamilia = new Map();
  for (const c of cobros) {
    if (c.status !== "pending" || !c.cuotaId) continue;
    const k = String(c.clientId);
    if (!pendientesPorFamilia.has(k)) pendientesPorFamilia.set(k, []);
    pendientesPorFamilia.get(k).push(c);
  }
  const cuotas = Cuota ? await Cuota.findAll({ attributes: ["id", "clientId", "method"], raw: true }) : [];
  const metodoDeFamilia = new Map(cuotas.map((q) => [String(q.clientId), q.method]).filter(([, m]) => m));

  // ── Los pagos del resumen: forma de pago y fecha real ────────────────────
  // El resumen trae el importe en céntimos («38000» = 380,00 €) y las líneas de
  // cada pago en euros. Un pago del 31/08 puede cubrir una línea del 01/09:
  // se casa por NOMBRE e importe (de una línea o del total); con varios, manda
  // el del mismo día. Las «Operación administrativa» son ingresos y retiradas
  // de caja, no cobros de nadie.
  const pagosPorNombre = new Map();
  for (const p of datos.resumen ?? []) {
    if (/operaci[oó]n administrativa/i.test(String(p[2]))) continue;
    const k = norm(p[2]);
    if (!pagosPorNombre.has(k)) pagosPorNombre.set(k, []);
    pagosPorNombre.get(k).push({ id: p[0], fecha: p[1], concepto: p[3], importe: round2(Number(p[4]) / 100), forma: p[5], lineas: (datos.pagos ?? {})[String(p[0])] ?? [] });
  }
  const pagoDe = (nombre, ddmm, importe) => {
    const lista = pagosPorNombre.get(norm(nombre)) ?? [];
    const casa = (p) => round2(p.importe) === round2(importe) || p.lineas.some((l) => round2(l[2]) === round2(importe));
    return lista.find((x) => casa(x) && x.fecha === ddmm) ?? lista.find(casa) ?? lista.find((x) => x.fecha === ddmm) ?? null;
  };
  /** Forma y fecha de un conjunto de líneas pagadas: la del pago mayor que las cubra. */
  const formaYFecha = (lineas, familia) => {
    const pagos = lineas.map((l) => pagoDe(l.nombre, l.ddmm, l.importe)).filter(Boolean);
    const mayor = pagos.sort((a, b) => b.importe - a.importe)[0] ?? null;
    const ddmm = mayor?.fecha ?? lineas.map((l) => l.ddmm).sort().pop();
    return {
      metodo: (mayor && FORMA[mayor.forma]) || metodoDeFamilia.get(familia) || "transfer",
      fecha: fechaDe(ddmm, anio),
      pagos: [...new Set(pagos.map((p) => p.id))],
      formaTexto: mayor ? { T: "transferencia", J: "tarjeta", E: "efectivo", D: "domiciliación" }[mayor.forma] ?? mayor.forma : null,
      sinPago: pagos.length === 0,
    };
  };
  const marca = (lineas) => lineas.map((l) => `Organízate #${l.idLinea}`).join(", ");

  // ── Líneas por familia ───────────────────────────────────────────────────
  const familias = new Map();
  // Familias que ya pasaron por aquí (algún cobro suyo lleva la marca): en una
  // segunda pasada lo pagado que falte se CREA como cobro nuevo y nunca se
  // consolida sobre un cobro sin marca, que en la primera pasada se dejó
  // aposta («sobra en el CRM»).
  const familiasPasadas = new Set(cobros.filter((c) => /Organízate #/.test(String(c.notes ?? ""))).map((c) => String(c.clientId)));
  const familiasConLineas = new Set();
  const plan = { marcar: [], crearCobrados: [], alinear: [], crearPendientes: [], sinPaciente: [], listados: [], sobranCrm: [], saltados: { "ya volcado": 0, "cita a 0 € (sesión de cuota)": 0, "pendiente y cuadra": 0 } };
  for (const fila of datos.caja) {
    const [estado, ddmm, tipo, importe, idPac, idLinea, nombreFila] = fila;
    if (yaVolcados.has(idLinea)) {
      plan.saltados["ya volcado"]++;
      const p = pacienteDe(idPac, nombreFila);
      if (p?.clientId) familiasConLineas.add(String(p.clientId));
      continue;
    }
    if (tipo === "C" && round2(importe) <= 0) { plan.saltados["cita a 0 € (sesión de cuota)"]++; continue; }
    const nombre = nombrePorId.get(DOBLES[Number(idPac)] ?? Number(idPac)) ?? nombreFila ?? `id_pac ${idPac}`;
    const paciente = pacienteDe(idPac, nombreFila);
    if (!paciente || !paciente.clientId) { plan.sinPaciente.push({ estado, ddmm, tipo, importe, idPac, idLinea, nombre }); continue; }
    const familia = String(paciente.clientId);
    familiasConLineas.add(familia);
    if (!familias.has(familia)) familias.set(familia, []);
    familias.get(familia).push({ estado, ddmm, tipo, importe: round2(importe), idLinea, paciente, nombre });
  }

  for (const [familia, lineas] of familias) {
    // Citas y bonos: aparte de las cuotas.
    for (const l of lineas.filter((x) => x.tipo !== "G")) {
      if (l.estado !== "P") { plan.listados.push(l); continue; }
      const ff = formaYFecha([l], familia);
      plan.crearCobrados.push({ ...l, ...ff, familia, periodo: mesDe(ddmmDe(ff.fecha), anio), motivo: l.tipo === "C" ? "cita" : "bono", lineas: [l], cuotaId: null });
    }
    const G = lineas.filter((x) => x.tipo === "G");
    if (!G.length) continue;
    // Un cobro que ya lleva la marca de Organízate es de una pasada anterior:
    // no vuelve a repartirse (así una segunda pasada solo hace lo que faltó).
    const cobrosF = [...(pendientesPorFamilia.get(familia) ?? [])]
      .filter((c) => !/Organízate #/.test(String(c.notes ?? "")))
      .sort((a, b) => Number(b.amount) - Number(a.amount));
    const usados = new Set();
    const sueltas = [];
    // 1. Línea a línea, por importe (mismo paciente primero).
    for (const l of G) {
      const libres = cobrosF.filter((c) => !usados.has(String(c.id)) && round2(c.amount) === l.importe);
      const c = libres.find((x) => String(x.patientId) === String(l.paciente.id)) ?? libres[0] ?? null;
      if (!c) { sueltas.push(l); continue; }
      usados.add(String(c.id));
      if (l.estado === "P") plan.marcar.push({ cobro: c, importe: l.importe, importeAntes: Number(c.amount), ...formaYFecha([l], familia), lineas: [l], nombre: l.nombre });
      else plan.saltados["pendiente y cuadra"]++;
    }
    // 2. Lo que sobra, consolidado por familia.
    const restoCobros = cobrosF.filter((c) => !usados.has(String(c.id)));
    if (!sueltas.length) { for (const c of restoCobros) plan.sobranCrm.push({ cobro: c, familia }); continue; }
    const pagadas = sueltas.filter((l) => l.estado === "P");
    const pendientes = sueltas.filter((l) => l.estado === "M");
    const RP = suma(pagadas), RQ = suma(pendientes);
    const nombre = sueltas[0].nombre;
    // Segunda pasada: los cobros sin marca de esta familia se dejaron aposta.
    const carrier = familiasPasadas.has(familia) ? null : restoCobros[0] ?? null;
    for (const c of restoCobros.slice(carrier ? 1 : 0)) plan.sobranCrm.push({ cobro: c, familia, nota: "sobra en el CRM con líneas de Organízate sin casar" });
    if (carrier) {
      if (RQ > 0) {
        if (round2(carrier.amount) !== RQ || pendientes.length) plan.alinear.push({ cobro: carrier, importe: RQ, importeAntes: Number(carrier.amount), lineas: pendientes, nombre });
        if (RP > 0) plan.crearCobrados.push({ importe: RP, ...formaYFecha(pagadas, familia), familia, paciente: pagadas[0].paciente, periodo, motivo: "cuota", lineas: pagadas, cuotaId: carrier.cuotaId, nombre });
      } else if (RP > 0) {
        plan.marcar.push({ cobro: carrier, importe: RP, importeAntes: Number(carrier.amount), ...formaYFecha(pagadas, familia), lineas: pagadas, nombre });
      }
    } else {
      if (RP > 0) plan.crearCobrados.push({ importe: RP, ...formaYFecha(pagadas, familia), familia, paciente: pagadas[0].paciente, periodo, motivo: "cuota", lineas: pagadas, cuotaId: null, nombre });
      if (RQ > 0) plan.crearPendientes.push({ importe: RQ, metodo: metodoDeFamilia.get(familia) ?? "transfer", familia, paciente: pendientes[0].paciente, periodo, lineas: pendientes, nombre });
    }
  }
  const tocadas = new Set([...plan.marcar, ...plan.alinear].map((x) => String(x.cobro.id)));
  const crmSinOrganizate = cobros.filter((c) => c.status === "pending" && c.cuotaId && !tocadas.has(String(c.id)) && !familiasConLineas.has(String(c.clientId)));

  // ── Informe ──────────────────────────────────────────────────────────────
  process.stdout.write(`\n▶ Caja de Organízate → cobros de ${SLUG} · ${MES}${CONFIRM ? "" : "  (ENSAYO: no se escribe nada)"}\n`);
  process.stdout.write(`  líneas leídas: ${datos.caja.length} · pagos del resumen: ${(datos.resumen ?? []).length} · extraído ${datos.extraido}\n`);
  process.stdout.write(`  cobros del CRM del mes: ${cobros.length} (pendientes de cuota: ${[...pendientesPorFamilia.values()].flat().length}) · familias con líneas: ${familias.size}\n\n`);
  const conDif = plan.marcar.filter((m) => round2(m.importe) !== round2(m.importeAntes)).length;
  process.stdout.write(`  Cobros pendientes → COBRADOS            ${plan.marcar.length}  (${eur(suma(plan.marcar))}; con importe distinto al del CRM: ${conDif})\n`);
  process.stdout.write(`  Cobros nuevos ya cobrados               ${plan.crearCobrados.length}  (${eur(suma(plan.crearCobrados))}: cuota ${plan.crearCobrados.filter((x) => x.motivo === "cuota").length}, cita ${plan.crearCobrados.filter((x) => x.motivo === "cita").length}, bono ${plan.crearCobrados.filter((x) => x.motivo === "bono").length})\n`);
  process.stdout.write(`  Pendientes alineados a Organízate       ${plan.alinear.length}  (CRM ${eur(suma(plan.alinear, "importeAntes"))} → ${eur(suma(plan.alinear))})\n`);
  process.stdout.write(`  Pendientes nuevos (sin cobro en el CRM) ${plan.crearPendientes.length}  (${eur(suma(plan.crearPendientes))})\n`);
  process.stdout.write(`  Cobros del CRM que sobran (no se tocan) ${plan.sobranCrm.length}  (${eur(plan.sobranCrm.map((x) => x.cobro), "amount")})\n`);
  process.stdout.write(`  Pendientes del CRM sin líneas en Organízate ${crmSinOrganizate.length}  (${eur(suma(crmSinOrganizate, "amount"))})\n`);
  process.stdout.write(`  Sin paciente en el CRM                  ${plan.sinPaciente.length}\n`);
  process.stdout.write(`  Saltados                                ${Object.entries(plan.saltados).map(([k, v]) => `${k}: ${v}`).join(" · ")}\n`);
  process.stdout.write(`  Pendientes no de cuota (solo se listan) ${plan.listados.length}  (${eur(suma(plan.listados))})\n`);
  const sinPago = [...plan.marcar, ...plan.crearCobrados].filter((x) => x.sinPago).length;
  process.stdout.write(`  Cobrados sin pago del resumen que los explique ${sinPago} (forma de la cuota o transferencia)\n`);
  const totalCobrado = round2(suma(plan.marcar) + suma(plan.crearCobrados));
  process.stdout.write(`\n  Total que queda COBRADO en el CRM: ${eur(totalCobrado)} · Organízate pagado (cuotas+citas+bonos): ${eur(suma(datos.caja.filter((f) => f[0] === "P").map((f) => ({ importe: f[3] }))))}\n\n`);
  if (DETALLE) {
    const muestra = (l, f, n = 14) => l.slice(0, n).map(f).join("\n");
    if (plan.sinPaciente.length) process.stdout.write(`  Sin paciente:\n${muestra(plan.sinPaciente, (x) => `      ${x.estado} ${x.ddmm} ${x.tipo} ${eur(x.importe)} · id_pac ${x.idPac} · ${x.nombre}`)}\n\n`);
    if (conDif) process.stdout.write(`  Cobrados con importe distinto (muestra):\n${muestra(plan.marcar.filter((m) => round2(m.importe) !== round2(m.importeAntes)), (x) => `      ${eur(x.importe)} (CRM ${eur(x.importeAntes)}) · ${x.metodo} · ${x.nombre} · ${x.lineas.length} línea(s)`)}\n\n`);
    if (plan.alinear.length) process.stdout.write(`  Alineados (muestra):\n${muestra(plan.alinear, (x) => `      ${eur(x.importeAntes)} → ${eur(x.importe)} · ${x.nombre} · ${x.lineas.length} línea(s) pendientes`)}\n\n`);
    if (plan.crearCobrados.length) process.stdout.write(`  Cobros nuevos cobrados (muestra):\n${muestra(plan.crearCobrados, (x) => `      ${x.motivo} ${eur(x.importe)} · ${x.metodo} · ${x.nombre}`)}\n\n`);
    if (plan.crearPendientes.length) process.stdout.write(`  Pendientes nuevos (muestra):\n${muestra(plan.crearPendientes, (x) => `      ${eur(x.importe)} · ${x.nombre}`)}\n\n`);
    if (plan.sobranCrm.length) process.stdout.write(`  Sobran en el CRM:\n${muestra(plan.sobranCrm, (x) => `      ${eur(x.cobro.amount)} · familia ${x.familia.slice(0, 8)} · ${String(x.cobro.notes ?? "").slice(0, 70)}`)}\n\n`);
    if (crmSinOrganizate.length) process.stdout.write(`  CRM sin Organízate:\n${muestra(crmSinOrganizate, (c) => `      ${eur(c.amount)} · familia ${String(c.clientId).slice(0, 8)} · ${String(c.notes ?? "").slice(0, 70)}`)}\n\n`);
    if (plan.listados.length) process.stdout.write(`  Pendientes no de cuota:\n${muestra(plan.listados, (x) => `      ${x.tipo} ${eur(x.importe)} · ${x.nombre}`)}\n\n`);
  }
  if (!CONFIRM) { process.stdout.write("  ENSAYO: no se ha escrito nada. Con --confirm se ejecuta.\n\n"); process.exit(0); }

  // ── Escribir ─────────────────────────────────────────────────────────────
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG }, attributes: ["id"] });
  const auditar = (action, entityId, before, after) => logBillingAudit({ tenantId: tenant?.id ?? null, userId: null, action, entity: "Payment", entityId, before, after: { ...after, via: "script:volcar-cobros-organizate" }, ip: null });
  const hecho = { marcados: 0, creados: 0, alineados: 0, pendientesCreados: 0 };
  const pagosTxt = (x) => (x.pagos?.length ? `, pago${x.pagos.length > 1 ? "s" : ""} ${x.pagos.join("/")}` : "");
  for (const m of plan.marcar) {
    const before = { status: m.cobro.status, amount: Number(m.cobro.amount), method: m.cobro.method };
    const nota = `${m.cobro.notes ? `${m.cobro.notes} — ` : ""}Cobrado en Organízate el ${ddmmDe(m.fecha)} (${marca(m.lineas)}${pagosTxt(m)}${m.formaTexto ? `, ${m.formaTexto}` : ""})${round2(m.importe) !== round2(m.importeAntes) ? `; el CRM tenía ${eur(m.importeAntes)}` : ""}`;
    await m.cobro.update({ status: "completed", paidAt: m.fecha, method: m.metodo, amount: round2(m.importe), notes: nota.slice(0, 2000) });
    await auditar("payment.updated", m.cobro.id, before, { status: "completed", amount: round2(m.importe), method: m.metodo });
    hecho.marcados++;
  }
  for (const a of plan.alinear) {
    const before = { amount: Number(a.cobro.amount) };
    const nota = `${a.cobro.notes ? `${a.cobro.notes} — ` : ""}Pendiente según Organízate: ${eur(a.importe)} (${marca(a.lineas)}); el CRM tenía ${eur(a.importeAntes)}`;
    await a.cobro.update({ amount: round2(a.importe), notes: nota.slice(0, 2000) });
    await auditar("payment.updated", a.cobro.id, before, { amount: round2(a.importe) });
    hecho.alineados++;
  }
  for (const c of plan.crearCobrados) {
    const que = c.motivo === "cita" ? "Cita cobrada" : c.motivo === "bono" ? "Bono cobrado" : "Cuota cobrada";
    const nota = `${que} en Organízate el ${ddmmDe(c.fecha)} (${marca(c.lineas)}${pagosTxt(c)}${c.formaTexto ? `, ${c.formaTexto}` : ""})`;
    const fila = await Payment.create({ invoiceId: null, clientId: c.familia, patientId: c.paciente.id, cuotaId: c.cuotaId ?? null, periodMonth: c.periodo, amount: round2(c.importe), paidAt: c.fecha, method: c.metodo, status: "completed", notes: nota });
    await auditar("payment.created", fila.id, null, { status: "completed", amount: round2(c.importe), method: c.metodo });
    hecho.creados++;
  }
  for (const p of plan.crearPendientes) {
    const fila = await Payment.create({ invoiceId: null, clientId: p.familia, patientId: p.paciente.id, periodMonth: p.periodo, amount: round2(p.importe), paidAt: fechaDe(`01/${MES.slice(5, 7)}`, anio), method: p.metodo, status: "pending", notes: `Pendiente según Organízate (${marca(p.lineas)}); sin cobro de cuota en el CRM` });
    await auditar("payment.created", fila.id, null, { status: "pending", amount: round2(p.importe), method: p.metodo });
    hecho.pendientesCreados++;
  }
  process.stdout.write(`  ✓ marcados cobrados ${hecho.marcados} · cobros nuevos ${hecho.creados} · importes alineados ${hecho.alineados} · pendientes nuevos ${hecho.pendientesCreados}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
