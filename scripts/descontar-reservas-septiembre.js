// @vivo — Descuenta la reserva de plaza (30 €) del cobro de SEPTIEMBRE de quien la pagó en verano, con la observación escrita. Se ejecutó en aumenta el 01/09/2026; se repite si el centro vuelve a cobrar reservas de cara a otro curso.
/**
 * descontar-reservas-septiembre.js — la reserva del verano se descuenta del
 * primer mes del curso (01/09/2026, Rodrigo: «las reservas de 30 € que se han
 * hecho en verano de cara a septiembre se tienen que eliminar del coste de esa
 * persona SOLO en septiembre; el resto del tiempo, cuota normal»).
 *
 * Entrada: el JSON con los miembros del grupo «RESERVAS DE PLAZA CURSO
 * 2026-2027» del Organízate (la lista oficial de quién la pagó).
 *
 * Qué hace, EN SECO por defecto (--confirm para escribir):
 *   · casa cada nombre con su paciente del CRM → su familia; N reservas por
 *     familia = N hijos apuntados;
 *   · busca el cobro de cuota de SEPTIEMBRE de esa familia
 *     (`payments.cuota_id` relleno, periodo 2026-09, estado PENDIENTE) y le
 *     resta 30 € por reserva, con la observación escrita en la nota — que es
 *     lo que evita la llamada de la familia preguntando por el importe;
 *   · con varios cobros de septiembre, el descuento va al MAYOR (y si no
 *     cabe entero, el resto salta al siguiente);
 *   · un cobro ya COBRADO no se toca: se lista aparte para el despacho.
 *
 * Octubre y siguientes no se tocan: el descuento vive en el cobro de
 * septiembre, no en la cuota, así que el mes que viene sale cuota normal.
 *
 * Uso VPS (docker cp del script y el JSON):
 *   docker exec crm-salamandra-app-1 node scripts/descontar-reservas-septiembre.js scripts/organizate-reservas-plaza.json [--slug aumenta] [--mes 2026-09] [--importe 30] [--confirm] [--detalle]
 */

import { readFileSync } from "node:fs";
import { getTenantDb } from "../lib/db/tenantDb.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
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
  const valorDe = (flag, porDefecto) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : porDefecto);
  const slug = valorDe("--slug", "aumenta");
  const mes = valorDe("--mes", "2026-09");
  const importeReserva = Number(valorDe("--importe", "30"));
  const rutaJson = args.find((a) => !a.startsWith("--") && a !== slug && a !== mes && a !== String(importeReserva));
  if (!rutaJson) { process.stderr.write("Uso: node scripts/descontar-reservas-septiembre.js <json> [--slug] [--mes] [--importe] [--confirm] [--detalle]\n"); process.exit(1); }

  const { reservas } = JSON.parse(readFileSync(rutaJson, "utf8"));
  const { models } = getTenantDb(slug);
  const { Patient, Payment } = models;

  // Nombre → paciente → familia. N reservas por familia.
  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const porNombre = new Map();
  for (const p of pacientes) {
    const clave = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    if (!clave) continue;
    if (!porNombre.has(clave)) porNombre.set(clave, []);
    porNombre.get(clave).push(p);
  }
  const reservasPorFamilia = new Map();
  const noCasados = [];
  const ambiguos = [];
  for (const nombre of reservas) {
    const candidatos = porNombre.get(norm(nombre)) ?? [];
    const familias = new Set(candidatos.map((c) => c.clientId).filter(Boolean));
    if (!candidatos.length || !familias.size) { noCasados.push(nombre); continue; }
    if (familias.size > 1) { ambiguos.push(nombre); continue; }
    const cid = String([...familias][0]);
    reservasPorFamilia.set(cid, (reservasPorFamilia.get(cid) ?? 0) + 1);
  }

  // Los cobros de cuota del mes, pendientes. La marca de «esto salió de una
  // cuota» es cuota_id; el descuento nunca toca un cobro tecleado a mano.
  const cobros = await Payment.findAll({
    where: { periodMonth: `${mes}-01`, status: "pending" },
    attributes: ["id", "clientId", "amount", "notes", "cuotaId"],
  });
  const cobrosPorFamilia = new Map();
  for (const c of cobros) {
    if (!c.cuotaId || !c.clientId) continue;
    const cid = String(c.clientId);
    if (!cobrosPorFamilia.has(cid)) cobrosPorFamilia.set(cid, []);
    cobrosPorFamilia.get(cid).push(c);
  }

  const ajustes = []; // { cobro, descuento, nota }
  const sinCobro = [];
  let totalDescuento = 0;
  for (const [cid, n] of reservasPorFamilia) {
    const suyos = (cobrosPorFamilia.get(cid) ?? []).sort((a, b) => Number(b.amount) - Number(a.amount));
    if (!suyos.length) { sinCobro.push(cid); continue; }
    let pendiente = round2(importeReserva * n);
    const etiqueta = n === 1
      ? `Reserva de plaza ya abonada: −${importeReserva} €`
      : `${n} reservas de plaza ya abonadas: −${round2(importeReserva * n)} €`;
    for (const cobro of suyos) {
      if (pendiente <= 0) break;
      const cabe = Math.min(pendiente, Number(cobro.amount));
      if (cabe <= 0) continue;
      ajustes.push({ cobro, descuento: round2(cabe), nota: etiqueta });
      pendiente = round2(pendiente - cabe);
      totalDescuento = round2(totalDescuento + cabe);
    }
    if (pendiente > 0) {
      // La reserva es mayor que todo lo pendiente del mes: se descuenta lo que
      // cabe y el resto se dice, no se inventa un cobro negativo.
      process.stdout.write(`  ⚠ a la familia ${cid.slice(0, 8)}… no le cabe el descuento entero (quedan ${pendiente} € sin aplicar)\n`);
    }
  }

  process.stdout.write(`\nReservas en el Organízate: ${reservas.length}\n`);
  process.stdout.write(`  · casadas con su familia: ${reservas.length - noCasados.length - ambiguos.length} (${reservasPorFamilia.size} familias)\n`);
  process.stdout.write(`  · sin casar por nombre: ${noCasados.length} · ambiguos: ${ambiguos.length}\n`);
  process.stdout.write(`Cobros de ${mes} a ajustar: ${ajustes.length} — descuento total ${totalDescuento} €\n`);
  process.stdout.write(`Familias con reserva y SIN cobro pendiente de ${mes}: ${sinCobro.length} (sin cuota generada o ya cobrado — al despacho)\n`);
  if (detalle) {
    for (const n of noCasados) process.stdout.write(`    ? sin casar: ${n}\n`);
    for (const n of ambiguos) process.stdout.write(`    ! ambiguo: ${n}\n`);
  }

  if (!confirm) {
    process.stdout.write("\n(EN SECO: nada escrito. Repite con --confirm para descontar.)\n");
    process.exit(0);
  }

  for (const { cobro, descuento, nota } of ajustes) {
    await Payment.update(
      {
        amount: round2(Number(cobro.amount) - descuento),
        notes: [cobro.notes, nota].filter(Boolean).join(" — "),
      },
      { where: { id: cobro.id, status: "pending" } }
    );
  }
  process.stdout.write(`\n✓ ${ajustes.length} cobros de ${mes} ajustados: −${totalDescuento} € en total, con su observación escrita.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
